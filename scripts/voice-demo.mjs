#!/usr/bin/env node
// README demo of the Voice profile: docs/media/voice-demo.mp4 (with sound) and docs/images/voice-demo.gif.
//
//   services/voice-asr/start.sh &                      # the local speech-to-text service
//   node scripts/voice-demo.mjs --audio speech.wav     # any audio ffmpeg reads
//
// The deck states follow a scripted timeline, but every key is drawn by the plugin's own templates, the level meter
// is the clip's real loudness, and the transcript is what the local service returns for the clip (punctuated by the
// plugin, as on the deck). Needs ffmpeg and rsvg-convert (Linux / WSL: apt install librsvg2-bin; macOS: brew install
// librsvg).
//
// The committed clip is a synthetic voice, not a person: MediaTek's BreezyVoice (Apache-2.0) speaking with the example
// speaker bundled in its repository (data/example.wav), so the media can be redistributed under those terms.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = pathToFileURL(path.join(REPO, 'plugin', 'com.ulanzi.nwpie.ulanziPlugin', 'src') + '/').href;
const imp = (m) => import(new URL(m, SRC).href);
const { voiceKey } = await imp('render-voice.js');
const { VOICE_PAGES } = await imp('voice-pages.js');
const { transcribe, punctuate } = await imp('voice/asr.js');
const { pcmLevelDb, wavInfo } = await imp('voice/wav.js');
const R = await imp('render.js');
const P = await imp('render-pages.js');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const AUDIO = arg('audio');
if (!AUDIO) { console.error('usage: node scripts/voice-demo.mjs --audio <file> [--asr http://127.0.0.1:39312]'); process.exit(2); }
const ASR = arg('asr', 'http://127.0.0.1:39312');
const TMP = path.join(REPO, 'tmp', 'voice-demo');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'frames'), { recursive: true });

// ---------------------------------------------------------------- the clip: loudness and the real transcript

const wav = path.join(TMP, 'speech.wav');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', AUDIO, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
const info = wavInfo(wav); // ffmpeg writes a LIST chunk before the data: don't assume a 44-byte header
const pcm = fs.readFileSync(wav).subarray(info.dataOffset, info.dataOffset + info.dataSize);
const SPEECH = pcm.length / 32000; // seconds
const levels = [];
for (let o = 0; o < pcm.length; o += 3200) levels.push(pcmLevelDb(pcm.subarray(o, o + 3200))); // one per 100 ms
console.log(`clip: ${SPEECH.toFixed(1)} s; transcribing with ${ASR} …`);
// Warm the service first (loads the model), so the time shown in the video is transcription only.
const silence = path.join(TMP, 'warm.wav');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-c:a', 'pcm_s16le', silence]);
await transcribe(silence, { url: ASR, audioSec: 1 });
const asr = await transcribe(wav, { url: ASR, lang: 'zh', audioSec: SPEECH });
const text = punctuate(asr.segments);
console.log(`transcript (${asr.elapsed} s): ${text}`);

// ---------------------------------------------------------------- timeline

const FPS = 10;
const NOW = Date.parse('2026-10-25T10:31:00+08:00');
const REC_AT = 2.0; // press ● here; the speech starts 0.4 s later (the start cue)
const SPEAK_AT = REC_AT + 0.4;
const STOP_AT = SPEAK_AT + SPEECH + 0.6;
const ASR_AT = STOP_AT + 0.5; // saving → transcribing
const DONE_AT = ASR_AT + 3.0; // transcription shown sped up
const CARD_AT = DONE_AT + 2.5;
const END = CARD_AT + 5.0;

const base = {
  supported: true, needs: [], lang: 'zh', langLabel: '華語', mic: 'Microphone (USB Audio)', levels: [], live: true, elapsed: 0, maxSec: 3600,
  message: '', error: '', confirmCancelUntil: 0, dir: 'C:\\Users\\me\\ulanzi-lab\\voice', asr: { state: 'off', error: '' }, last: null,
};
const last = { recording: 'r.wav', txt: 't.txt', srt: 't.srt', seconds: Math.round(SPEECH + 1), preview: text.slice(0, 80) };

function stateAt(t) {
  if (t < REC_AT) return { ...base, phase: 'idle', step: ['ulanzi-lab Voice', '錄音 → 逐字稿，全部在這台電腦上'] };
  if (t < STOP_AT) {
    const n = Math.max(0, Math.floor((t - SPEAK_AT) * 10));
    const lv = t < SPEAK_AT ? [] : levels.slice(0, n).map(db => Math.max(db, -58));
    return { ...base, phase: 'recording', elapsed: t - REC_AT, levels: lv.slice(-48), asr: { state: t < REC_AT + 4 ? 'starting' : 'ready' },
      press: t < REC_AT + 0.4 ? '0_0' : null, step: ['● 錄音中', '同時在 WSL 啟動本機語音辨識（Breeze-ASR-25）'] };
  }
  if (t < ASR_AT) return { ...base, phase: 'saving', asr: { state: 'ready' }, press: '2_0', last: { ...last, txt: null, preview: '' }, step: ['完成＋逐字稿', '合併錄音段落'] };
  if (t < DONE_AT) return { ...base, phase: 'transcribing', asr: { state: 'ready' }, last: { ...last, txt: null, preview: '' }, step: ['轉寫中', `本機 CPU 實際 ${asr.elapsed} 秒（影片加速）`] };
  return { ...base, phase: 'done', message: 'copied to clipboard', asr: { state: 'ready' }, last, step: ['完成', '逐字稿（.txt＋.srt）已存檔，並複製到剪貼簿'] };
}

// ---------------------------------------------------------------- one frame (SVG, then rsvg-convert)

const KEY = 132, GAP = 16, PADX = 30, PADTOP = 52;
const DEV_W = PADX * 2 + KEY * 5 + GAP * 4, DEV_H = PADTOP + KEY * 3 + GAP * 2 + 46;
const W = DEV_W + 56, H = DEV_H + 56 + 92;
const OX = 28, OY = 28;
const FONT = 'Segoe UI, Microsoft JhengHei, Noto Sans CJK TC, sans-serif';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64 = (s) => Buffer.from(s).toString('base64');
const clockStub = { s: { phase: 'idle' }, remaining: () => 0, progress: () => 0, today: () => 0, week: () => [], quiet: () => false };

function keySvg(key, action, set, v, t) {
  const now = NOW + t * 1000;
  const phase = Math.floor(t * 2);
  if (action === 'voice') return voiceKey(set.part, v, { phase, wide: key === '3_2', now });
  if (action === 'hitl') return R.hitlKey([], {}, { phase, frame: Math.floor(t * 4), style: 'mascot', now });
  if (action === 'media') return P.mediaKey('mic', { audio: { micMuted: false } }, {});
  return P.focusKey('clock', clockStub, { now });
}

/** Wrap to `max` columns (CJK counts double); a Latin word is never split, CJK breaks anywhere. */
function wrapText(s, max) {
  const lines = [];
  let cur = '', cols = 0;
  for (const tok of s.match(/[A-Za-z0-9.,'’-]+|\s+|./gu) || []) {
    const w = [...tok].reduce((n, ch) => n + (/[ᄀ-￿]/.test(ch) ? 2 : 1), 0);
    if (cols + w > max && cur) { lines.push(cur.trimEnd()); cur = ''; cols = 0; if (/^\s+$/.test(tok)) continue; }
    cur += tok; cols += w;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

function frame(t) {
  const v = stateAt(t);
  let body = `<defs><linearGradient id="dev" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#30343b"/><stop offset="1" stop-color="#1b1d22"/></linearGradient>`;
  VOICE_PAGES[0].keys.forEach(([key]) => {
    const [c, r] = key.split('_').map(Number);
    body += `<clipPath id="k${key}"><rect x="${OX + PADX + c * (KEY + GAP)}" y="${OY + PADTOP + r * (KEY + GAP)}" width="${key === '3_2' ? KEY * 2 + GAP : KEY}" height="${KEY}" rx="16"/></clipPath>`;
  });
  body += `</defs><rect width="${W}" height="${H}" fill="#0b0d10"/>`
    + `<rect x="${OX}" y="${OY}" width="${DEV_W}" height="${DEV_H}" rx="30" fill="url(#dev)"/>`
    + `<text x="${OX + DEV_W / 2}" y="${OY + 34}" font-family="${FONT}" font-size="13" font-weight="bold" fill="#6e7681" text-anchor="middle" letter-spacing="4">ULANZI</text>`
    + `<text x="${OX + DEV_W / 2}" y="${OY + DEV_H - 16}" font-family="${FONT}" font-size="15" font-weight="bold" fill="#8b949e" text-anchor="middle" letter-spacing="1">VOICE · ulanzi-lab</text>`;
  for (const [key, action, set] of VOICE_PAGES[0].keys) {
    const [c, r] = key.split('_').map(Number);
    const x = OX + PADX + c * (KEY + GAP), y = OY + PADTOP + r * (KEY + GAP), w = key === '3_2' ? KEY * 2 + GAP : KEY;
    body += `<g clip-path="url(#k${key})"><image x="${x}" y="${y}" width="${w}" height="${KEY}" href="data:image/svg+xml;base64,${b64(keySvg(key, action, set, v, t))}"/></g>`;
    if (v.press === key) body += `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${KEY + 8}" rx="19" fill="none" stroke="#58a6ff" stroke-width="5"/>`;
  }
  // Caption: what is happening.
  const cy = OY + DEV_H + 40;
  body += `<text x="${OX + 4}" y="${cy}" font-family="${FONT}" font-size="26" font-weight="bold" fill="#e6edf3">${esc(v.step[0])}</text>`
    + `<text x="${OX + 4}" y="${cy + 34}" font-family="${FONT}" font-size="18" fill="#8b949e">${esc(v.step[1])}</text>`;
  // Finale: the transcript file.
  if (t >= CARD_AT) {
    const a = Math.min(1, (t - CARD_AT) / 0.4);
    const lines = wrapText(text, 50);
    const ch = 92 + lines.length * 34;
    const cx = OX + 40, cy2 = OY + 70;
    body += `<g opacity="${a.toFixed(2)}"><rect x="${OX}" y="${OY}" width="${DEV_W}" height="${DEV_H}" rx="30" fill="#000" fill-opacity="0.55"/>`
      + `<rect x="${cx}" y="${cy2}" width="${DEV_W - 80}" height="${ch}" rx="14" fill="#f6f8fa"/>`
      + `<text x="${cx + 24}" y="${cy2 + 40}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#57606a">transcripts\\20261025-103100.txt</text>`
      + lines.map((l, i) => `<text x="${cx + 24}" y="${cy2 + 84 + i * 34}" font-family="${FONT}" font-size="22" fill="#1f2328">${esc(l)}</text>`).join('')
      + '</g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

const total = Math.ceil(END * FPS);
for (let i = 0; i < total; i++) {
  const svgFile = path.join(TMP, 'frames', `f${String(i).padStart(4, '0')}.svg`);
  fs.writeFileSync(svgFile, frame(i / FPS));
  execFileSync('rsvg-convert', [svgFile, '-o', svgFile.replace(/\.svg$/, '.png')]);
  fs.rmSync(svgFile);
  if (i % 50 === 0) console.log(`frame ${i}/${total}`);
}

// ---------------------------------------------------------------- encode

const MEDIA = path.join(REPO, 'docs', 'media');
const IMAGES = path.join(REPO, 'docs', 'images');
fs.mkdirSync(MEDIA, { recursive: true });
const frames = path.join(TMP, 'frames', 'f%04d.png');
const mp4 = path.join(MEDIA, 'voice-demo.mp4');
const delayMs = Math.round(SPEAK_AT * 1000);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', frames, '-i', wav,
  '-filter_complex', `[1:a]adelay=${delayMs}|${delayMs},apad[a]`, '-map', '0:v', '-map', '[a]', '-shortest',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', mp4]);
const gif = path.join(IMAGES, 'voice-demo.gif');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', frames,
  '-vf', 'fps=8,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', gif]);
for (const f of [mp4, gif]) console.log('wrote', path.relative(REPO, f), `${(fs.statSync(f).size / 2 ** 20).toFixed(1)} MB`);
