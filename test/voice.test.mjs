import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { parseWav, wavInfo, fixWavHeader, wavHeader, concatWav, pcmLevelDb } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/wav.js';
import { findFfmpeg, parseDshowDevices, pickMic, recordArgs } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/ffmpeg.js';
import { punctuate, toSrt, transcribe, LANGUAGES } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/asr.js';
import { postMultipart, retryBusy } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/http.js';
import { createService, startCommand, shq } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/service.js';
import { Recorder, recoverParts, killOrphan } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/recorder.js';
import { voiceDirs, voiceRoot, ensureDirs, newestFile, stamp } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice/paths.js';
import { VoiceProvider } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/voice.js';
import { voiceKey } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/render-voice.js';
import { createVoiceActions, VOICE_PARTS } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice-actions.js';
import { combineActions } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/page-actions.js';
import { VOICE_PAGES } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice-pages.js';
import { PAGES } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/pages.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-voice-'));
const FMT = { channels: 1, sampleRate: 16000, bits: 16 };

/** A WAV the way ffmpeg writes it: fmt, a LIST/INFO chunk, then data. */
function ffmpegWav(file, samples, { sizes = true } = {}) {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
  const info = Buffer.concat([Buffer.from('INFOISFT'), Buffer.from([14, 0, 0, 0]), Buffer.from('Lavf61.7.100\0\0')]);
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.alloc(4), info]);
  list.writeUInt32LE(info.length, 4);
  const head = wavHeader(FMT, data.length);
  const out = Buffer.concat([head.subarray(0, 36), list, head.subarray(36), data]);
  out.writeUInt32LE(sizes ? out.length - 8 : 0, 4);
  if (!sizes) out.writeUInt32LE(0, 36 + list.length + 4);
  fs.writeFileSync(file, out);
  return out;
}

// ---------------------------------------------------------------- wav

test('wav: parse past a LIST chunk, repair sizes ffmpeg never wrote, join segments', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.wav'), b = path.join(dir, 'b.wav'), empty = path.join(dir, 'e.wav'), out = path.join(dir, 'out.wav');
  ffmpegWav(a, 16000);
  ffmpegWav(b, 8000, { sizes: false });
  ffmpegWav(empty, 0);
  const h = parseWav(fs.readFileSync(a));
  assert.deepEqual({ ch: h.channels, sr: h.sampleRate, bits: h.bits, size: h.dataSize }, { ch: 1, sr: 16000, bits: 16, size: 32000 });
  assert.equal(parseWav(fs.readFileSync(b)).dataSize, 0); // as left by a killed ffmpeg
  assert.equal(wavInfo(b).seconds, 0.5); // sizes come from the file length
  assert.ok(fixWavHeader(b));
  assert.equal(parseWav(fs.readFileSync(b)).dataSize, 16000);
  assert.equal(await concatWav([a, empty, b], out), 1.5);
  const j = fs.readFileSync(out);
  assert.equal(j.length, 44 + 48000);
  assert.equal(parseWav(j).dataSize, 48000);
  assert.deepEqual(j.subarray(44, 44 + 32000), fs.readFileSync(a).subarray(h.dataOffset));
  const other = path.join(dir, 'o.wav');
  fs.writeFileSync(other, Buffer.concat([wavHeader({ ...FMT, sampleRate: 8000 }, 2), Buffer.alloc(2)]));
  await assert.rejects(concatWav([a, other], out), /format differs/);
  await assert.rejects(concatWav([empty], out), /no audio/);
  assert.equal(parseWav(Buffer.from('not a wav file at all')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wav: level in dBFS', () => {
  assert.equal(pcmLevelDb(Buffer.alloc(1600)), -90);
  const loud = Buffer.alloc(1600);
  for (let i = 0; i < 800; i++) loud.writeInt16LE(i % 2 ? 32767 : -32768, i * 2);
  assert.ok(pcmLevelDb(loud) > -0.1);
});

// ---------------------------------------------------------------- ffmpeg

test('ffmpeg: DirectShow device list, new and old output formats, non-ASCII names', () => {
  const newer = [
    '[dshow @ 000001] "Integrated Camera" (video)',
    '[dshow @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid"',
    '[dshow @ 000001] "Microphone (Realtek(R) Audio)" (audio)',
    '[dshow @ 000001]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{AAA}"',
    '[dshow @ 000001] "耳機麥克風 (USB Audio)" (audio)',
    '[dshow @ 000001]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{BBB}"',
    'dummy: Immediate exit requested',
  ].join('\r\n');
  assert.deepEqual(parseDshowDevices(newer).map(d => d.name), ['Microphone (Realtek(R) Audio)', '耳機麥克風 (USB Audio)']);
  assert.match(parseDshowDevices(newer)[1].alt, /wave_\{BBB\}/);
  const older = [
    '[dshow @ 0x1] DirectShow video devices (some may be both video and audio devices)',
    '[dshow @ 0x1]  "Integrated Camera"',
    '[dshow @ 0x1] DirectShow audio devices',
    '[dshow @ 0x1]  "Microphone Array (Realtek High Definition Audio)"',
    '[dshow @ 0x1]     Alternative name "@device_cm_{X}\\wave_{Y}"',
  ].join('\n');
  assert.deepEqual(parseDshowDevices(older), [{ name: 'Microphone Array (Realtek High Definition Audio)', alt: '@device_cm_{X}\\wave_{Y}' }]);
});

test('ffmpeg: microphone choice, recording arguments, finding a winget install', () => {
  const devs = [{ name: 'Microphone (Realtek(R) Audio)', alt: '@a' }, { name: 'Headset Microphone (Jabra Evolv2 85 - Long Na', alt: '@b' }];
  assert.equal(pickMic(devs, { preferred: 'jabra' }).alt, '@b');
  assert.equal(pickMic(devs, { defaultName: 'Headset Microphone (Jabra Evolv2 85 - Long Name)' }).alt, '@b'); // truncated by dshow
  assert.equal(pickMic(devs, { preferred: 'nope', defaultName: 'nope' }).alt, '@a');
  assert.equal(pickMic([], {}), null);
  const args = recordArgs({ device: devs[0], out: 'C:\\v\\001.wav', maxSec: 90.7 });
  assert.ok(args.indexOf('-t') < args.indexOf('-i'), '-t limits the input, so both outputs');
  assert.equal(args[args.indexOf('-i') + 1], 'audio=@a');
  assert.equal(args[args.indexOf('-t') + 1], '90');
  assert.deepEqual(args.slice(-3), ['-f', 's16le', 'pipe:1']);
  const pkgs = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages';
  const exe = `${pkgs}\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0-full_build\\bin\\ffmpeg.exe`;
  const fake = { exists: (f) => f === exe, readdir: (d) => (d === pkgs ? ['Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'Other.App'] : d.endsWith('8wekyb3d8bbwe') ? ['ffmpeg-8.0-full_build'] : []) };
  assert.equal(findFfmpeg({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: 'C:\\Windows' }, ...fake }), exe);
  assert.equal(findFfmpeg({ platform: 'win32', env: { ULANZI_LAB_FFMPEG: 'D:\\ff.exe' }, exists: (f) => f === 'D:\\ff.exe', readdir: () => [] }), 'D:\\ff.exe');
  assert.equal(findFfmpeg({ platform: 'win32', env: {}, exists: () => false, readdir: () => [] }), null);
});

// ---------------------------------------------------------------- transcripts

test('punctuate: commas between clauses, stops at pauses / particles / language switches, ？ after 嗎', () => {
  const seg = (text, start, end) => ({ text, start, end });
  assert.equal(punctuate([seg('大家好 我是主持人', 0, 2), seg('很高興見到大家', 2, 4)]), '大家好，我是主持人，很高興見到大家。');
  assert.equal(punctuate([seg('記得先訂位喔', 0, 2), seg('你真的要現在出發嗎', 2, 4), seg('外面雨很大耶', 5, 7)]), '記得先訂位喔。你真的要現在出發嗎？外面雨很大耶。');
  assert.equal(punctuate([seg('先看 jira 上的 ticket', 0, 2), seg('Please review the PR', 2, 4), seg('and let me know', 4, 6), seg('謝謝', 6, 7)]),
    '先看 jira 上的 ticket。Please review the PR, and let me know. 謝謝。');
  assert.equal(punctuate([seg('第一句', 0, 1), seg('第二句', 1.8, 3)]), '第一句。第二句。'); // 0.8 s pause
  assert.equal(punctuate([seg('已經有標點了。', 0, 1), seg('', 1, 2)]), '已經有標點了。');
  assert.equal(punctuate([]), '');
  const long = Array.from({ length: 8 }, (_, i) => seg('這是一個比較長的子句內容', i, i + 1));
  assert.match(punctuate(long), /。這是/); // a long run of clauses gets a full stop
});

test('toSrt: numbered cues with hh:mm:ss,mmm times', () => {
  assert.equal(toSrt([{ start: 0.56, end: 6.32, text: '大家好' }, { start: 3725.5, end: 3727, text: ' ' }, { start: 3727, end: 3729.04, text: 'bye' }]),
    '1\n00:00:00,560 --> 00:00:06,320\n大家好\n\n2\n01:02:07,000 --> 01:02:09,040\nbye\n');
});

/** A local stand-in for the speech-to-text service. `replies` is consumed in order. */
async function fakeAsr(replies) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('latin1') });
      const [status, body] = replies.shift() || [500, '{}'];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(r => server.close(r)) };
}

test('postMultipart streams fields and the file; retryBusy retries 503 only', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a b.wav');
  fs.writeFileSync(f, Buffer.from('RIFFdata\x00\x01'));
  const asr = await fakeAsr([[200, { ok: 1 }]]);
  const r = await postMultipart(`${asr.url}/v1/audio/transcriptions`, { fields: { model: 'breeze-asr-25' }, file: { path: f, type: 'audio/wav' } });
  assert.equal(r.status, 200);
  const { type, body } = asr.seen[0];
  const boundary = type.match(/boundary=(.+)$/)[1];
  assert.ok(body.includes(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nbreeze-asr-25\r\n`));
  assert.ok(body.includes('filename="a b.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFdata\x00\x01\r\n'));
  assert.ok(body.endsWith(`--${boundary}--\r\n`));
  await asr.close();
  let calls = 0;
  const waits = [];
  const res = await retryBusy(async () => ({ status: ++calls < 3 ? 503 : 200 }), { delays: [1, 2, 3], sleep: async (ms) => waits.push(ms) });
  assert.deepEqual([res.status, calls, waits], [200, 3, [1, 2]]);
  calls = 0;
  assert.equal((await retryBusy(async () => ({ status: (++calls, 401) }), { sleep: async () => {} })).status, 401);
  assert.equal(calls, 1);
  assert.equal((await retryBusy(async () => ({ status: 503 }), { delays: [1, 1], sleep: async () => {} })).status, 503);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transcribe: language picks the model; errors carry the service message', async () => {
  const dir = tmp();
  const f = path.join(dir, 'r.wav');
  ffmpegWav(f, 1600);
  const segments = [{ id: 0, start: 0, end: 1, text: '你好' }];
  const asr = await fakeAsr([[200, { text: '你好', segments, duration: 1, elapsed: 0.5, model: 'breeze-asr-26' }], [400, { detail: 'unknown model x' }], [200, 'oops']]);
  const r = await transcribe(f, { url: asr.url, lang: 'nan' });
  assert.deepEqual([r.text, r.segments, r.model], ['你好', segments, 'breeze-asr-26']);
  assert.match(asr.seen[0].body, /name="model"\r\n\r\nbreeze-asr-26\r\n/);
  assert.match(asr.seen[0].body, /name="response_format"\r\n\r\nverbose_json\r\n/);
  await assert.rejects(transcribe(f, { url: asr.url }), /ASR 400: unknown model x/);
  await assert.rejects(transcribe(f, { url: asr.url }), /unexpected reply/);
  await asr.close();
  assert.deepEqual(LANGUAGES.map(l => l.id), ['zh', 'en', 'nan', 'auto']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- on-demand service

function fakeProc() {
  const p = new EventEmitter();
  p.stdin = new PassThrough();
  p.stderr = new PassThrough();
  p.pid = 4242;
  p.kill = () => p.emit('exit', null);
  return p;
}

test('service: one start for concurrent callers, ready once /health answers, stdin closed on stop', async () => {
  let healthy = false;
  const spawned = [];
  const svc = createService({
    name: 'asr', url: 'http://x', command: 'start.sh', distro: 'Ubuntu', platform: 'win32', pollMs: 1, startTimeoutMs: 1000,
    health: async () => healthy, spawn: (cmd, args) => { spawned.push([cmd, ...args]); const p = fakeProc(); setTimeout(() => { healthy = true; }, 5); return p; },
  });
  const states = [];
  svc.on((s) => states.push(s.state));
  const [a, b] = await Promise.all([svc.ensure(), svc.ensure()]);
  assert.deepEqual([a, b], [true, true]);
  assert.deepEqual(spawned, [['wsl.exe', '-d', 'Ubuntu', '-e', 'bash', '-lc', 'start.sh']]);
  assert.deepEqual(states, ['starting', 'ready']);
  assert.equal(await svc.ensure(), true); // already up: no second start
  assert.equal(spawned.length, 1);
  svc.stop();
  assert.equal(svc.get().state, 'off');
});

test('service: "not installed" (exit 3), no command, and start timeouts become errors', async () => {
  const svc = createService({ name: 'asr', url: 'http://x', command: 'start.sh', platform: 'linux', pollMs: 1, startTimeoutMs: 1000,
    health: async () => false, spawn: () => { const p = fakeProc(); setTimeout(() => p.emit('exit', 3), 3); return p; } });
  assert.equal(await svc.ensure(), false);
  assert.deepEqual([svc.get().state, svc.get().error], ['error', 'not installed']);
  const none = createService({ name: 'asr', url: 'http://x', command: null, health: async () => false });
  assert.equal(await none.ensure(), false);
  assert.equal(none.get().error, 'not available');
  let t = 0;
  const slow = createService({ name: 'asr', url: 'http://x', command: 'c', platform: 'linux', pollMs: 1, startTimeoutMs: 10, now: () => t, sleep: async () => { t += 5; },
    health: async () => false, spawn: () => fakeProc() });
  assert.equal(await slow.ensure(), false);
  assert.equal(slow.get().error, 'start timed out');
});

test('service: start command quoting', () => {
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(startCommand('C:\\writable\\git\\ulanzi-lab', 'services/voice-asr/start.sh', { platform: 'win32' }),
    `"$(wslpath -u 'C:\\writable\\git\\ulanzi-lab')"/services/voice-asr/start.sh`);
  assert.equal(startCommand('/Users/me/ulanzi lab', 'services/voice-asr/start.sh', { platform: 'darwin' }), `'/Users/me/ulanzi lab'/services/voice-asr/start.sh`);
});

// ---------------------------------------------------------------- recorder

/**
 * A fake ffmpeg: streams level PCM on stdout; on "q" writes `samples` of WAV to its output file and exits 0 after
 * `exitMs`. `ignoreQ` makes it hang until killed; `rates[i]` sets the i-th segment's sample rate.
 */
function fakeFfmpeg({ samples = 8000, calls = [], exitMs = 1, ignoreQ = false, rates = [] } = {}) {
  return (cmd, args) => {
    calls.push(args);
    const out = args[args.indexOf('-y') + 1];
    const rate = rates[calls.length - 1];
    const p = fakeProc();
    p.stdout = new PassThrough();
    setTimeout(() => p.stdout.write(Buffer.alloc(800)), 1);
    const finish = () => {
      ffmpegWav(out, samples);
      if (rate) { const b = fs.readFileSync(out); b.writeUInt32LE(rate, 24); fs.writeFileSync(out, b); }
    };
    p.kill = () => { finish(); p.emit('exit', null); };
    p.stdin.on('data', (d) => { if (String(d).includes('q') && !ignoreQ) setTimeout(() => { finish(); p.emit('exit', 0); }, exitMs); });
    return p;
  };
}

test('recorder: record, pause, resume, stop → one WAV of both segments; parts cleaned up', async () => {
  const dir = tmp();
  const dirs = voiceDirs(dir);
  ensureDirs(dirs);
  let t = Date.parse('2026-10-25T10:00:00');
  const calls = [];
  const rec = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic', alt: '@m' }, dirs, maxSec: 600, spawn: fakeFfmpeg({ calls }), now: () => t });
  const live = new Promise(r => rec.once('live', r));
  assert.ok(rec.start());
  await live;
  t += 4000;
  assert.equal(rec.elapsedSec(), 4);
  assert.ok(await rec.pause());
  t += 60e3; // paused time doesn't count
  assert.ok(rec.resume());
  t += 2000;
  assert.equal(rec.elapsedSec(), 6);
  assert.equal(calls[1][calls[1].indexOf('-t') + 1], '596'); // second segment gets what's left
  const r = await rec.stop();
  assert.equal(path.basename(r.file), '20261025-100000.wav');
  assert.equal(r.seconds, 1); // two fake segments of 0.5 s
  assert.equal(rec.state, 'idle');
  assert.deepEqual(fs.readdirSync(dirs.parts), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recorder: cancel discards; recoverParts saves what a crash left', async () => {
  const dir = tmp();
  const dirs = voiceDirs(dir);
  ensureDirs(dirs);
  const rec = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, spawn: fakeFfmpeg() });
  rec.start();
  assert.ok(await rec.cancel());
  assert.deepEqual(fs.readdirSync(dirs.parts), []);
  assert.deepEqual(fs.readdirSync(dirs.recordings).filter(f => f.endsWith('.wav')), []);
  // A crash: segments with unfinished headers and a stale pid file.
  const left = path.join(dirs.parts, '20261025-090000');
  fs.mkdirSync(left, { recursive: true });
  ffmpegWav(path.join(left, '001.wav'), 16000);
  ffmpegWav(path.join(left, '002.wav'), 16000, { sizes: false });
  fs.writeFileSync(path.join(left, 'ffmpeg.pid'), '999999');
  const killed = [];
  const saved = await recoverParts(dirs, { kill: async (pid) => { killed.push(pid); return false; } });
  assert.deepEqual(killed, [999999]);
  assert.deepEqual(saved.map(f => path.basename(f)), ['20261025-090000-recovered.wav']);
  assert.equal(wavInfo(saved[0]).seconds, 2);
  assert.deepEqual(fs.readdirSync(dirs.parts), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('paths: stamp and newest file', () => {
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.srt'), 'b');
  fs.utimesSync(path.join(dir, 'a.txt'), new Date(2026, 0, 1), new Date(2026, 0, 1));
  fs.writeFileSync(path.join(dir, 'c.TXT'), 'c');
  assert.equal(path.basename(newestFile(dir, ['.txt'])), 'c.TXT');
  assert.equal(newestFile(path.join(dir, 'missing'), ['.txt']), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- provider + keys

test('VoiceProvider: record → finish → transcript files, clipboard, sounds; cancel needs two presses', async () => {
  const dir = tmp();
  const segments = [{ start: 0, end: 2, text: '大家好 我是主持人' }, { start: 2, end: 4, text: '今天要討論 PR 嗎' }];
  const asr = await fakeAsr([[200, { text: 'x', segments, duration: 4, elapsed: 1, model: 'breeze-asr-25' }]]);
  process.env.ULANZI_LAB_ASR_URL = asr.url;
  process.env.ULANZI_LAB_VOICE_DIR = path.join(dir, 'voice');
  const sounds = [];
  const copied = [];
  const v = new VoiceProvider({
    platform: 'win32', stateFile: path.join(dir, 'voice.json'), helper: { request: async () => null }, play: (e) => sounds.push(e),
    spawn: fakeFfmpeg(), ffmpeg: 'ffmpeg.exe', devices: [{ name: 'Microphone (Realtek(R) Audio)', alt: '@m' }],
    service: { ensure: async () => true, check: async () => 'ready', stop() {}, get: () => ({ state: 'ready', error: '' }), on: () => {} },
    clipboard: { set: async (t) => { copied.push(t); return true; } },
  });
  try {
    await v.ready;
    assert.equal(v.get().mic, 'Microphone (Realtek(R) Audio)');
    assert.equal(await v.toggle(), '● recording');
    assert.equal(v.get().phase, 'recording');
    assert.match(await v.cancel(), /again within 5 s/);
    assert.equal(v.get().phase, 'recording'); // first press only arms it
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await v.finish({ transcribe: true }), '📝 transcript copied');
    const st = v.get();
    assert.equal(st.phase, 'done');
    assert.equal(fs.readFileSync(st.last.txt, 'utf8'), '大家好，我是主持人，今天要討論 PR 嗎？\n');
    assert.match(fs.readFileSync(st.last.srt, 'utf8'), /^1\n00:00:00,000 --> 00:00:02,000\n大家好 我是主持人\n/);
    assert.deepEqual(copied, ['大家好，我是主持人，今天要討論 PR 嗎？']);
    assert.deepEqual(sounds, ['recordStart', 'recordStop', 'transcriptDone']);
    assert.equal(v.lastTranscript(), st.last.txt);
    // Cancel: the second press within 5 s discards.
    await v.toggle();
    await v.cancel();
    assert.equal(await v.cancel(), 'recording discarded');
    assert.equal(v.get().phase, 'idle');
    assert.equal(fs.readdirSync(path.join(dir, 'voice', 'recordings')).filter(f => f.endsWith('.wav')).length, 1);
    assert.equal(v.cycleLang(), '🌐 English');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'voice.json'), 'utf8')).lang, 'en');
  } finally {
    delete process.env.ULANZI_LAB_ASR_URL;
    delete process.env.ULANZI_LAB_VOICE_DIR;
    await asr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('VoiceProvider: needs ffmpeg; not supported off Windows', async () => {
  const dir = tmp();
  process.env.ULANZI_LAB_VOICE_DIR = path.join(dir, 'voice');
  try {
    const v = new VoiceProvider({ platform: 'win32', stateFile: path.join(dir, 's.json'), helper: { request: async () => null }, ffmpeg: null,
      service: { ensure: async () => false, check: async () => 'off', stop() {}, get: () => ({ state: 'off' }), on: () => {} } });
    await v.ready;
    assert.deepEqual(v.get().needs, ['ffmpeg']);
    assert.match(await v.toggle(), /winget install Gyan\.FFmpeg/);
    const mac = new VoiceProvider({ platform: 'darwin', stateFile: path.join(dir, 's.json') });
    assert.equal(mac.get().supported, false);
    assert.match(await mac.toggle(), /Windows only/);
  } finally {
    delete process.env.ULANZI_LAB_VOICE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every voice key renders an SVG in every phase', () => {
  const base = { supported: true, phase: 'idle', needs: [], lang: 'zh', langLabel: '華語', mic: 'Mic', levels: [-30, -20, -60, -5], live: true, elapsed: 75,
    maxSec: 3600, message: '', error: 'ASR 503: busy', confirmCancelUntil: 0, dir: 'C:\\Users\\me\\Documents\\ulanzi-lab\\voice', asr: { state: 'ready', error: '' },
    last: { recording: 'r.wav', txt: 't.txt', preview: '大家好，我是今天的主持人，很高興在這裡跟大家見面。', seconds: 92 } };
  const states = [{}, { phase: 'recording' }, { phase: 'paused' }, { phase: 'transcribing' }, { phase: 'done' }, { phase: 'error' },
    { needs: ['ffmpeg'] }, { needs: ['mic'] }, { confirmCancelUntil: Date.now() + 5000, phase: 'recording' }, { last: null, asr: { state: 'starting' } }, { supported: false }];
  for (const part of VOICE_PARTS) {
    for (const s of states) {
      const svg = voiceKey(part, { ...base, ...s }, { phase: 1, wide: part === 'wide' });
      assert.match(svg, /^<svg[^>]*>.*<\/svg>$/s, `${part} ${JSON.stringify(s)}`);
      assert.doesNotMatch(svg, /undefined|NaN/, `${part} ${JSON.stringify(s)}`);
    }
  }
});

test('voice actions route through combineActions; layout uses only manifest actions', async () => {
  const pressed = [];
  const voice = new EventEmitter();
  Object.assign(voice, { get: () => ({ supported: true, phase: 'idle', needs: [], levels: [], asr: {}, langLabel: '華語', last: null }), toggle: async () => { pressed.push('toggle'); return 'ok'; }, cycleLang: () => '🌐 English', stop() {} });
  const toasts = [];
  const acts = combineActions({ handles: (a) => a === 'media', press: async () => pressed.push('media'), render: () => '<svg/>', animated: () => false, sources: [] },
    createVoiceActions({ voice, toast: (m) => toasts.push(m) }));
  assert.ok(acts.handles('voice') && acts.handles('media') && !acts.handles('stock'));
  await acts.press({ action: 'voice', key: '0_0', settings: { part: 'rec' } }, 'ctx', false);
  await acts.press({ action: 'voice', key: '0_2', settings: { part: 'lang' } }, 'ctx', false);
  await acts.press({ action: 'media', key: '2_1', settings: { part: 'mic' } }, 'ctx', false);
  assert.deepEqual(pressed, ['toggle', 'media']);
  assert.deepEqual(toasts, ['Voice: ok', 'Voice: 🌐 English']);
  assert.match(acts.render({ action: 'voice', key: '3_2', settings: {} }, { phase: 0 }), /^<svg/);
  assert.deepEqual(acts.sources.map(s => s[1]), ['voice']);

  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin/com.ulanzi.nwpie.ulanziPlugin/manifest.json', import.meta.url), 'utf8'));
  const declared = new Set(manifest.Actions.map(a => a.UUID.split('.').pop()));
  for (const page of [...PAGES, ...VOICE_PAGES]) for (const [key, action] of page.keys) assert.ok(declared.has(action), `${page.name} ${key}: ${action}`);
  for (const [key, action, s] of VOICE_PAGES[0].keys) if (action === 'voice') assert.ok(VOICE_PARTS.includes(s.part), `${key}: ${s.part}`);
  assert.ok(fs.existsSync(new URL('../plugin/com.ulanzi.nwpie.ulanziPlugin/images/voice.svg', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../plugin/com.ulanzi.nwpie.ulanziPlugin/inspector/voice.html', import.meta.url)));
});

// ---------------------------------------------------------------- review fixes: races, data loss, edge cases

const fakeService = () => ({ ensure: async () => true, check: async () => 'ready', stop() {}, get: () => ({ state: 'ready', error: '' }), on: () => {} });
function provider(dir, opts = {}) {
  process.env.ULANZI_LAB_VOICE_DIR = path.join(dir, 'voice');
  return new VoiceProvider({ platform: 'win32', stateFile: path.join(dir, 'voice.json'), helper: { request: async () => null }, ffmpeg: 'ffmpeg.exe',
    devices: [{ name: 'Mic', alt: '@m' }], service: fakeService(), clipboard: { set: async () => true }, ...opts });
}

test('a second ● press while recording starts is refused: one ffmpeg, not two', async () => {
  const dir = tmp();
  const calls = [];
  try {
    const v = provider(dir, { spawn: fakeFfmpeg({ calls }) });
    await v.ready;
    const [a, b] = await Promise.all([v.toggle(), v.toggle()]);
    assert.deepEqual([a, b].sort(), ['● recording', 'wait: recording in progress'].sort());
    assert.equal(calls.length, 1);
    await v.recorder.cancel();
  } finally { delete process.env.ULANZI_LAB_VOICE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Finish pressed while a pause is still stopping ffmpeg waits instead of cutting the audio', async () => {
  const dir = tmp();
  try {
    const v = provider(dir, { spawn: fakeFfmpeg({ exitMs: 60, samples: 16000 }) });
    await v.ready;
    await v.toggle();
    const pausing = v.toggle(); // ffmpeg takes 60 ms to exit
    await new Promise(r => setTimeout(r, 10)); // the pause is under way
    assert.equal(await v.finish({ transcribe: false }), 'wait: recording in progress');
    assert.equal(await pausing, '⏸ paused');
    assert.equal(v.get().phase, 'paused');
    assert.match(await v.finish({ transcribe: false }), /^saved /);
    assert.equal(wavInfo(v.get().last.recording).seconds, 1); // the whole segment
    // Recorder level: a stop during an in-flight stop shares it.
    const dirs = voiceDirs(path.join(dir, 'r'));
    ensureDirs(dirs);
    const rec = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, spawn: fakeFfmpeg({ exitMs: 40, samples: 16000 }) });
    rec.start();
    const p = rec.pause();
    const r = await rec.stop();
    await p;
    assert.equal(r.seconds, 1);
  } finally { delete process.env.ULANZI_LAB_VOICE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a failed join keeps the segments for recovery and removes the partial output', async () => {
  const dir = tmp();
  const dirs = voiceDirs(dir);
  ensureDirs(dirs);
  const rec = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, spawn: fakeFfmpeg({ rates: [16000, 8000] }) });
  rec.start();
  await rec.pause();
  rec.resume();
  await assert.rejects(rec.stop(), /format differs/);
  const [id] = fs.readdirSync(dirs.parts);
  assert.deepEqual(fs.readdirSync(path.join(dirs.parts, id)).sort(), ['001.wav', '002.wav']); // no pid file left
  assert.deepEqual(fs.readdirSync(dirs.recordings).filter(f => f.endsWith('.wav')), []);
  assert.equal(rec.state, 'idle');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recorder: a hung ffmpeg is killed after the grace period; ffmpeg ending on its own is reported', async () => {
  const dir = tmp();
  const dirs = voiceDirs(dir);
  ensureDirs(dirs);
  const hung = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, spawn: fakeFfmpeg({ ignoreQ: true, samples: 8000 }), stopGraceMs: 20 });
  hung.start();
  const r = await hung.stop();
  assert.equal(r.seconds, 0.5);
  let t = 0;
  const procs = [];
  const own = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, maxSec: 10, now: () => t, spawn: (c, a) => { const p = fakeFfmpeg()(c, a); procs.push(p); return p; } });
  own.start();
  const ended = new Promise(res => own.once('ended', res));
  t = 3000;
  procs[0].emit('exit', 1); // the microphone went away
  assert.equal((await ended).code, 1);
  assert.equal(own.state, 'paused');
  own.resume();
  const limit = new Promise(res => own.once('limit', res));
  t = 10000;
  procs[1].emit('exit', 0); // -t reached
  await limit;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('killOrphan kills only an ffmpeg writing into this recording\'s .parts folder', async () => {
  const run = (out) => (cmd, args, opts, cb) => { const done = typeof opts === 'function' ? opts : cb; done(null, cmd === 'taskkill' ? '' : out); };
  const ours = 'C:\\ffmpeg.exe -f dshow -i audio=@m C:\\v\\recordings\\.parts\\20261025-090000\\001.wav';
  assert.equal(await killOrphan(1234, { id: '20261025-090000', platform: 'win32', run: run(ours) }), true);
  assert.equal(await killOrphan(1234, { id: '20261025-090000', platform: 'win32', run: run('ffmpeg.exe -i movie.mkv out.mp4') }), false);
  assert.equal(await killOrphan(1234, { id: '20261025-090000', platform: 'win32', run: run('C:\\notepad.exe') }), false);
  assert.equal(await killOrphan('12; rm -rf /', { id: 'x', platform: 'win32', run: () => assert.fail('must not run') }), false);
});

test('a missing model is a 404 (not retried as busy); a service dying at start reports why', async () => {
  const dir = tmp();
  const f = path.join(dir, 'r.wav');
  ffmpegWav(f, 1600);
  const asr = await fakeAsr([[404, { detail: 'model breeze-asr-26 is not installed; run services/voice-asr/install.sh --taigi' }]]);
  await assert.rejects(transcribe(f, { url: asr.url, lang: 'nan' }), /ASR 404: .*--taigi/);
  assert.equal(asr.seen.length, 1);
  await asr.close();
  const svc = createService({ name: 'asr', url: 'http://x', command: 'c', platform: 'linux', pollMs: 1, startTimeoutMs: 1000, health: async () => false,
    spawn: () => { const p = fakeProc(); setTimeout(() => { p.stderr.write('bash: /x/start.sh: No such file or directory\n'); setTimeout(() => p.emit('exit', 127), 2); }, 2); return p; } });
  assert.equal(await svc.ensure(), false);
  assert.equal(svc.get().error, 'exit 127: bash: /x/start.sh: No such file or directory');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wav: half a trailing sample is ignored; same-second recordings get distinct names', async () => {
  const dir = tmp();
  const f = path.join(dir, 'odd.wav');
  ffmpegWav(f, 100);
  fs.appendFileSync(f, Buffer.from([7]));
  assert.equal(wavInfo(f).dataSize, 200);
  const dirs = voiceDirs(dir);
  ensureDirs(dirs);
  const t = Date.parse('2026-10-25T10:00:00');
  const names = [];
  for (let i = 0; i < 2; i++) {
    const rec = new Recorder({ ffmpeg: 'ffmpeg', device: { name: 'Mic' }, dirs, now: () => t, spawn: fakeFfmpeg() });
    rec.start();
    names.push(path.basename((await rec.stop()).file));
  }
  assert.deepEqual(names, ['20261025-100000.wav', '20261025-100000-2.wav']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- local folder, empty recordings, recovery on press

test('voice folder: ~/ulanzi-lab/voice on every OS (not Documents), ULANZI_LAB_VOICE_DIR overrides', () => {
  assert.equal(voiceRoot({ env: {}, home: '/home/me' }), path.join('/home/me', 'ulanzi-lab', 'voice'));
  assert.equal(voiceRoot({ env: { ULANZI_LAB_VOICE_DIR: '/data/voice' }, home: '/home/me' }), '/data/voice');
});

test('a recording with no audio is dropped with "nothing was recorded", not kept for recovery', async () => {
  const dir = tmp();
  try {
    const v = provider(dir, { spawn: fakeFfmpeg({ samples: 0 }) });
    await v.ready;
    await v.toggle();
    assert.equal(await v.finish({ transcribe: true }), 'nothing was recorded');
    assert.deepEqual([v.get().phase, v.get().message], ['idle', 'nothing was recorded']);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'voice', 'recordings', '.parts')), []);
  } finally { delete process.env.ULANZI_LAB_VOICE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('segments kept by a failed save are recovered on the next ● press', async () => {
  const dir = tmp();
  try {
    const v = provider(dir, { spawn: fakeFfmpeg() });
    await v.ready;
    const left = path.join(dir, 'voice', 'recordings', '.parts', '20261025-080000');
    fs.mkdirSync(left, { recursive: true });
    ffmpegWav(path.join(left, '001.wav'), 16000);
    await v.toggle();
    assert.equal(path.basename(v.get().last.recording), '20261025-080000-recovered.wav');
    assert.equal(fs.readdirSync(path.join(dir, 'voice', 'recordings', '.parts')).length, 1); // only the new recording
    await v.recorder.cancel();
  } finally { delete process.env.ULANZI_LAB_VOICE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the time limit finishes once the key step holding the lock is done', async () => {
  const dir = tmp();
  try {
    const v = provider(dir, { spawn: fakeFfmpeg() });
    await v.ready;
    await v.toggle();
    const calls = [];
    v.finish = async (o) => { calls.push(o); return 'finished'; };
    v.op = 'pause';
    const done = v.finishWhenFree();
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(calls, []); // still waiting for the step
    v.op = null;
    assert.equal(await done, 'finished');
    assert.deepEqual(calls, [{ transcribe: true }]);
    v.recorder = null; // a cancel won meanwhile: nothing left to finish
    assert.equal(await v.finishWhenFree(), null);
  } finally { delete process.env.ULANZI_LAB_VOICE_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});
