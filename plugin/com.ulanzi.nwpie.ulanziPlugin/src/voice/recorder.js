// Microphone recorder: one ffmpeg per segment. Pause sends "q" (ffmpeg finishes the WAV header), resume starts the
// next segment, stop joins them into recordings/<stamp>.wav. Segments live in recordings/.parts/<stamp>/ with the
// running ffmpeg's pid, so a crash leaves something `recoverParts` can kill and save on the next start.
import { EventEmitter } from 'node:events';
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { recordArgs } from './ffmpeg.js';
import { concatWav, fixWavHeader, pcmLevelDb } from './wav.js';
import { stamp } from './paths.js';


export class Recorder extends EventEmitter {
  /** `device` is a pickMic() result; `maxSec` caps the whole recording across pauses. */
  constructor({ ffmpeg, device, dirs, maxSec = 3600, spawn = nodeSpawn, now = () => Date.now(), log = () => {}, stopGraceMs = 3000 }) {
    super();
    Object.assign(this, { ffmpeg, device, dirs, maxSec, spawn, now, log, stopGraceMs });
    this.stopping = null; // the in-flight stopSegment(), so a second stop waits for the same ffmpeg exit
    this.state = 'idle'; // idle | recording | paused
    this.id = null;
    this.proc = null;
    this.segments = [];
    this.doneMs = 0; // recorded time in finished segments
    this.segStart = 0;
    this.live = false; // first audio arrived for the current segment
  }

  elapsedSec() { return (this.doneMs + (this.state === 'recording' ? this.now() - this.segStart : 0)) / 1000; }

  start() {
    if (this.state !== 'idle') return false;
    // Two recordings within one second would share a name: add a suffix rather than overwrite.
    const base = stamp(new Date(this.now()));
    this.id = base;
    for (let n = 2; fs.existsSync(path.join(this.dirs.recordings, `${this.id}.wav`)) || fs.existsSync(path.join(this.dirs.parts, this.id)); n++) this.id = `${base}-${n}`;
    this.dir = path.join(this.dirs.parts, this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.segments = [];
    this.doneMs = 0;
    this.startSegment();
    return true;
  }

  startSegment() {
    const file = path.join(this.dir, `${String(this.segments.length + 1).padStart(3, '0')}.wav`);
    const left = this.maxSec - this.doneMs / 1000;
    const p = this.spawn(this.ffmpeg, recordArgs({ device: this.device, out: file, maxSec: left }), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    this.segments.push(file);
    this.state = 'recording';
    this.segStart = this.now();
    this.live = false;
    if (p.pid) fs.writeFileSync(path.join(this.dir, 'ffmpeg.pid'), String(p.pid));
    let stderr = '';
    let lastLevel = 0;
    p.stdout?.on('data', (buf) => {
      if (!this.live) { this.live = true; this.emit('live'); }
      const t = this.now();
      if (t - lastLevel >= 100) { lastLevel = t; this.emit('level', pcmLevelDb(buf)); }
    });
    p.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-500); });
    p.stdin?.on('error', () => {});
    p.on('error', (e) => { this.log('recorder: ffmpeg failed', e.message); this.emit('error', e); });
    p.on('exit', (code) => {
      if (this.proc !== p) return; // a stop we asked for; stopSegment() handles it
      // ffmpeg ended on its own: the time limit (-t), or the microphone went away.
      this.proc = null;
      this.doneMs += this.now() - this.segStart;
      this.state = 'paused';
      try { fixWavHeader(file); } catch { /* empty file */ }
      this.log('recorder: ffmpeg exited', code, stderr.trim().split('\n').pop() || '');
      this.emit(this.elapsedSec() >= this.maxSec - 1 ? 'limit' : 'ended', { code, stderr: stderr.trim() });
    });
  }

  /**
   * Stop the running segment cleanly ("q"), killing it if it doesn't finish in time. Resolves once ffmpeg has
   * exited and the file is complete; a call while a stop is in flight gets the same promise.
   */
  stopSegment() {
    if (this.stopping) return this.stopping;
    const p = this.proc;
    if (!p) return Promise.resolve();
    this.proc = null;
    this.doneMs += this.now() - this.segStart;
    const file = this.segments[this.segments.length - 1];
    this.stopping = new Promise((resolve) => {
      const done = () => { clearTimeout(timer); try { fixWavHeader(file); } catch { /* nothing written */ } resolve(); };
      const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, this.stopGraceMs);
      p.once('exit', done);
      try { p.stdin.write('q'); } catch { p.kill(); }
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }

  async pause() {
    if (this.state !== 'recording') return false;
    await this.stopSegment();
    this.state = 'paused';
    return true;
  }

  resume() {
    if (this.state !== 'paused' || this.elapsedSec() >= this.maxSec - 1) return false;
    this.startSegment();
    return true;
  }

  /**
   * Finish: join the segments into recordings/<stamp>.wav. Resolves { file, seconds }. If joining fails (disk full,
   * a locked file), the segments stay in .parts for recoverParts on the next start; only the partial output goes.
   */
  async stop() {
    if (this.state === 'idle') return null;
    await this.stopSegment();
    const file = path.join(this.dirs.recordings, `${this.id}.wav`);
    let seconds;
    try {
      seconds = await concatWav(this.segments, file);
    } catch (e) {
      fs.rmSync(file, { force: true });
      fs.rmSync(path.join(this.dir, 'ffmpeg.pid'), { force: true });
      this.reset({ keepParts: true });
      throw e;
    }
    this.reset();
    return { file, seconds };
  }

  async cancel() {
    if (this.state === 'idle') return false;
    await this.stopSegment();
    this.reset();
    return true;
  }

  reset({ keepParts = false } = {}) {
    if (this.dir && !keepParts) fs.rmSync(this.dir, { recursive: true, force: true });
    Object.assign(this, { state: 'idle', id: null, dir: null, proc: null, segments: [], doneMs: 0, live: false });
  }
}

/**
 * Kill `pid` only if it is still our recorder: an ffmpeg whose command line writes into `.parts/<id>`. After a reboot
 * the pid may belong to anything, even another ffmpeg, so the image name alone is not enough.
 */
export function killOrphan(pid, { id, platform = process.platform, run = execFile } = {}) {
  return new Promise((resolve) => {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0 || !id) return resolve(false);
    const ours = (cmdline) => /ffmpeg/i.test(cmdline) && cmdline.includes('.parts') && cmdline.includes(id);
    if (platform !== 'win32') {
      run('ps', ['-p', String(n), '-o', 'args='], (err, out) => {
        if (err || !ours(String(out))) return resolve(false);
        try { process.kill(n); resolve(true); } catch { resolve(false); }
      });
      return;
    }
    run('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${n}").CommandLine`], { windowsHide: true }, (err, out) => {
      if (err || !ours(String(out))) return resolve(false);
      run('taskkill', ['/PID', String(n), '/F'], { windowsHide: true }, (e) => resolve(!e));
    });
  });
}

/**
 * After a crash: stop any ffmpeg still recording into recordings/.parts, repair its segments and save them as
 * recordings/<stamp>-recovered.wav. Resolves the list of recovered files.
 */
export async function recoverParts(dirs, { kill = killOrphan, log = () => {} } = {}) {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync(dirs.parts); } catch { return out; }
  for (const id of ids) {
    const dir = path.join(dirs.parts, id);
    try {
      const pidFile = path.join(dir, 'ffmpeg.pid');
      if (fs.existsSync(pidFile) && await kill(Number(fs.readFileSync(pidFile, 'utf8')), { id })) await new Promise(r => setTimeout(r, 500));
      const segs = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort().map(f => path.join(dir, f));
      for (const f of segs) { try { fixWavHeader(f); } catch { /* unreadable */ } }
      const file = path.join(dirs.recordings, `${id}-recovered.wav`);
      await concatWav(segs, file);
      out.push(file);
      log('recorder: recovered', file);
    } catch (e) {
      log('recorder: nothing to recover in', dir, e.message);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
