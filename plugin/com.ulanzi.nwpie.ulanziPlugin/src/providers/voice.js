// Voice profile (page 1): record from the microphone, transcribe with the local speech-to-text service, keep the
// transcript as .txt (punctuated) and .srt next to the recording, and copy it to the clipboard.
// Windows only for now (ffmpeg DirectShow capture + the service in WSL); elsewhere `get().supported` is false.
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import { findFfmpeg, listDevicesArgs, parseDshowDevices, pickMic } from '../voice/ffmpeg.js';
import { Recorder, recoverParts } from '../voice/recorder.js';
import { LANGUAGES, languageOf, punctuate, toSrt, transcribe } from '../voice/asr.js';
import { createService, startCommand } from '../voice/service.js';
import { createClipboard } from '../voice/clipboard.js';
import { ensureDirs, newestFile, voiceDirs, voiceRoot } from '../voice/paths.js';
import { wavInfo } from '../voice/wav.js';

const CONFIRM_MS = 5000;
const LEVELS = 48; // level-meter history (one value per 100 ms)

export class VoiceProvider extends EventEmitter {
  constructor({ helper, play = () => {}, log = () => {}, platform = process.platform, repoRoot, stateFile, distro = null,
    spawn, now = () => Date.now(), service = null, clipboard = null, ffmpeg = undefined, devices = null } = {}) {
    super();
    Object.assign(this, { helper, play, log, platform, repoRoot, stateFile, now, spawn });
    this.supported = platform === 'win32';
    this.asrUrl = env('ULANZI_LAB_ASR_URL', 'http://127.0.0.1:39312');
    this.service = service || createService({
      name: 'voice-asr', url: this.asrUrl, distro, platform, log,
      command: env('ULANZI_LAB_ASR_START') || (this.supported && repoRoot ? startCommand(repoRoot, 'services/voice-asr/start.sh', { platform }) : null),
    });
    this.service.on(() => this.changed());
    this.clipboard = clipboard || createClipboard({ helper, platform });
    this.ffmpegOverride = ffmpeg;
    this.devicesOverride = devices;
    this.maxSec = (Number(env('ULANZI_LAB_REC_MAX_MIN', '60')) || 60) * 60;
    this.s = {
      phase: 'idle', // idle | recording | paused | saving | transcribing | done | error
      lang: 'zh', mic: '', levels: [], live: false, message: '', error: '',
      last: null, // { recording, txt, srt, preview, seconds, at }
      confirmCancelUntil: 0, needs: [], dir: '',
    };
    this.recorder = null;
    this.ready = this.supported ? this.init() : Promise.resolve();
  }

  async init() {
    try { Object.assign(this.s, JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))); } catch { /* first run */ }
    this.s.lang = languageOf(this.s.lang).id;
    const docs = (await this.helper?.request('docs.path'))?.path || null;
    this.dirs = voiceDirs(voiceRoot({ documents: docs })); // created on first use, not at every plugin start
    this.s.dir = this.dirs.root;
    this.log('voice: files in', this.dirs.root);
    const saved = await recoverParts(this.dirs, { log: this.log });
    if (saved.length) this.s.message = `recovered ${saved.length} recording${saved.length > 1 ? 's' : ''}`;
    this.refreshLast();
    await this.detect();
    this.changed();
  }

  /** Find ffmpeg and the microphone (again: the user may install ffmpeg or plug in a mic while the plugin runs). */
  async detect() {
    this.ffmpeg = this.ffmpegOverride !== undefined ? this.ffmpegOverride : findFfmpeg();
    this.s.needs = [];
    if (!this.ffmpeg) { this.s.needs.push('ffmpeg'); this.device = null; return; }
    const devices = this.devicesOverride || await new Promise((resolve) => {
      execFile(this.ffmpeg, listDevicesArgs, { windowsHide: true, timeout: 10e3 }, (_e, _o, stderr) => resolve(parseDshowDevices(stderr)));
    });
    const defaultName = (await this.helper?.request('mic.default'))?.name || '';
    this.device = pickMic(devices, { preferred: env('ULANZI_LAB_MIC'), defaultName });
    this.s.mic = this.device?.name || '';
    if (!this.device) this.s.needs.push('mic');
  }

  get() {
    const elapsed = this.recorder ? this.recorder.elapsedSec() : 0;
    return { ...this.s, supported: this.supported, elapsed, maxSec: this.maxSec, asr: this.service.get(), langLabel: languageOf(this.s.lang).label };
  }

  changed() { this.emit('change'); }

  save() {
    try { fs.writeFileSync(this.stateFile, JSON.stringify({ lang: this.s.lang, last: this.s.last })); } catch { /* not fatal */ }
  }

  setPhase(phase, extra = {}) { Object.assign(this.s, { phase, ...extra }); this.changed(); }

  fail(msg) {
    this.log('voice: error', msg);
    this.play('voiceError');
    this.setPhase('error', { error: msg, live: false });
  }

  // ------------------------------------------------------------ recording

  /** ● key: start, pause, resume. */
  async toggle() {
    if (!this.supported) return 'Voice: Windows only for now';
    await this.ready;
    const r = this.recorder;
    if (r?.state === 'recording') { await r.pause(); this.setPhase('paused', { live: false }); return '⏸ paused'; }
    if (r?.state === 'paused') { if (r.resume()) this.setPhase('recording'); return '● recording'; }
    if (['saving', 'transcribing'].includes(this.s.phase)) return 'busy: wait for the transcript';
    if (!this.device) await this.detect();
    if (this.s.needs.length) { this.changed(); return this.s.needs[0] === 'ffmpeg' ? 'Install ffmpeg: winget install Gyan.FFmpeg' : 'No microphone found'; }
    ensureDirs(this.dirs);
    // The start cue plays before ffmpeg opens the microphone, so it isn't in the recording.
    this.play('recordStart');
    await new Promise(r2 => setTimeout(r2, 400));
    const rec = new Recorder({ ffmpeg: this.ffmpeg, device: this.device, dirs: this.dirs, maxSec: this.maxSec, spawn: this.spawn, now: this.now, log: this.log });
    rec.on('live', () => { this.s.live = true; this.changed(); });
    rec.on('level', (db) => { this.s.levels.push(db); if (this.s.levels.length > LEVELS) this.s.levels.shift(); });
    rec.on('limit', () => { this.s.message = 'time limit reached'; this.finish({ transcribe: true }); });
    rec.on('ended', ({ stderr }) => { this.s.live = false; this.s.message = stderr ? stderr.split('\n').pop().slice(0, 60) : 'microphone stopped'; this.setPhase('paused'); });
    rec.on('error', (e) => { this.recorder = null; this.fail(`ffmpeg: ${e.message}`); });
    this.recorder = rec;
    rec.start();
    this.setPhase('recording', { levels: [], live: false, error: '', message: '', confirmCancelUntil: 0 });
    this.service.ensure(); // warm the speech-to-text service while you talk
    return '● recording';
  }

  /** ✓ keys: stop and keep the recording; with `transcribe`, also make the transcript. */
  async finish({ transcribe: doAsr = true } = {}) {
    const r = this.recorder;
    if (!r || r.state === 'idle') return 'not recording';
    this.recorder = null;
    this.setPhase('saving', { live: false, confirmCancelUntil: 0 });
    let saved;
    try { saved = await r.stop(); } catch (e) { this.fail(`save failed: ${e.message}`); return 'save failed'; }
    this.play('recordStop');
    this.s.last = { recording: saved.file, seconds: Math.round(saved.seconds), at: this.now(), txt: null, srt: null, preview: '' };
    this.save();
    if (!doAsr) { this.setPhase('done', { message: 'saved' }); return `saved ${path.basename(saved.file)}`; }
    return this.transcribeFile(saved.file, saved.seconds);
  }

  /** ✕ key: press twice within 5 s to throw the recording away. */
  async cancel() {
    const r = this.recorder;
    if (!r || r.state === 'idle') return 'not recording';
    if (this.s.confirmCancelUntil <= this.now()) { this.s.confirmCancelUntil = this.now() + CONFIRM_MS; this.changed(); return 'Press ✕ again within 5 s to discard'; }
    this.s.confirmCancelUntil = 0;
    this.recorder = null;
    await r.cancel();
    this.setPhase('idle', { live: false, message: 'discarded' });
    return 'recording discarded';
  }

  // ------------------------------------------------------------ transcripts

  async transcribeFile(file, seconds = wavInfo(file)?.seconds || 60) {
    ensureDirs(this.dirs);
    this.setPhase('transcribing', { error: '', message: 'starting speech-to-text…' });
    if (!(await this.service.ensure())) {
      const why = this.service.get().error || 'not running';
      this.fail(why === 'not installed' ? 'ASR not installed: services/voice-asr/install.sh' : `ASR ${why}`);
      return 'speech-to-text unavailable';
    }
    this.setPhase('transcribing', { message: '' });
    try {
      const r = await transcribe(file, { url: this.asrUrl, lang: this.s.lang, audioSec: seconds,
        onWait: (ms) => { this.s.message = `busy, retry in ${Math.round(ms / 1000)} s`; this.changed(); } });
      const base = path.join(this.dirs.transcripts, path.basename(file, path.extname(file)));
      const txt = punctuate(r.segments);
      fs.writeFileSync(`${base}.txt`, txt + '\n');
      fs.writeFileSync(`${base}.srt`, toSrt(r.segments));
      let copied = false;
      if (env('ULANZI_LAB_VOICE_CLIPBOARD', 'on') !== 'off' && txt) copied = await this.clipboard.set(txt);
      this.s.last = { ...(this.s.last?.recording === file ? this.s.last : { recording: file, seconds: Math.round(seconds), at: this.now() }), txt: `${base}.txt`, srt: `${base}.srt`, preview: txt.slice(0, 80) };
      this.save();
      this.play('transcriptDone');
      this.log('voice: transcript', path.basename(base), `${txt.length} chars`, `${r.elapsed}s for ${Math.round(seconds)}s audio`);
      this.setPhase('done', { message: copied ? 'copied to clipboard' : '' });
      return copied ? '📝 transcript copied' : '📝 transcript saved';
    } catch (e) {
      this.fail(e.message);
      return 'transcription failed';
    }
  }

  /** 🔁 key: transcribe the last recording again (e.g. after switching language, or after an error). */
  async retry() {
    if (!this.supported) return 'Voice: Windows only for now';
    await this.ready;
    if (this.recorder) return 'recording: finish first';
    const file = this.s.last?.recording && fs.existsSync(this.s.last.recording) ? this.s.last.recording : newestFile(this.dirs.recordings, ['.wav']);
    if (!file) return 'no recording yet';
    return this.transcribeFile(file);
  }

  refreshLast() {
    if (this.s.last?.txt && fs.existsSync(this.s.last.txt)) return;
    const txt = newestFile(this.dirs.transcripts, ['.txt']);
    if (txt) {
      let preview = '';
      try { preview = fs.readFileSync(txt, 'utf8').slice(0, 80); } catch { /* unreadable */ }
      this.s.last = { ...(this.s.last || {}), txt, srt: txt.replace(/\.txt$/, '.srt'), preview };
    }
  }

  lastTranscript() { this.refreshLast(); return this.s.last?.txt && fs.existsSync(this.s.last.txt) ? this.s.last.txt : null; }

  async copyLast() {
    const f = this.lastTranscript();
    if (!f) return 'no transcript yet';
    return (await this.clipboard.set(fs.readFileSync(f, 'utf8').trim())) ? '📋 copied' : 'copy failed';
  }

  cycleLang() {
    const i = LANGUAGES.findIndex(l => l.id === this.s.lang);
    this.s.lang = LANGUAGES[(i + 1) % LANGUAGES.length].id;
    this.save();
    this.changed();
    return `🌐 ${languageOf(this.s.lang).label}`;
  }

  /** ASR key: start (warm up) the service, or report it. */
  async warmUp() {
    if (!this.supported) return 'Voice: Windows only for now';
    const st = await this.service.check();
    if (st === 'ready') return 'speech-to-text ready';
    this.service.ensure();
    return 'starting speech-to-text…';
  }

  /** Plugin shutdown: end ffmpeg cleanly but keep the segments; the next start saves them as "-recovered". */
  stop() {
    this.recorder?.stopSegment();
    this.service.stop();
  }
}
