// WAV files from the recorder: parse the RIFF header, repair one ffmpeg left unfinished (killed mid-write),
// join pause-separated segments into one file, and measure loudness of raw PCM for the level meter.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** { channels, sampleRate, bits, dataOffset, dataSize } from the first bytes of a WAV file, or null if it isn't one. */
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 24 <= buf.length) {
      fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), sampleRate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    }
    if (id === 'data') return fmt && { ...fmt, dataOffset: at + 8, dataSize: size };
    at += 8 + size + (size & 1); // chunks are word-aligned
  }
  return null;
}

const HEAD_BYTES = 4096; // ffmpeg's header (fmt + LIST/INFO) fits easily

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
  } finally { fs.closeSync(fd); }
}

/** Info for a WAV file on disk (sizes taken from the file length, so unfinished files read correctly). */
export function wavInfo(file) {
  const h = parseWav(readHead(file));
  if (!h) return null;
  // Whole samples only: a killed ffmpeg can leave half a sample, which would shift every later segment by a byte.
  const block = h.channels * (h.bits / 8);
  const dataSize = Math.max(0, fs.statSync(file).size - h.dataOffset);
  const whole = dataSize - (dataSize % block);
  return { ...h, dataSize: whole, seconds: whole / (h.sampleRate * block) };
}

/** Rewrite the RIFF and data sizes from the file length (ffmpeg writes them last, so a killed ffmpeg leaves 0 / garbage). */
export function fixWavHeader(file) {
  const h = parseWav(readHead(file));
  if (!h) return false;
  const total = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r+');
  try {
    const n = Buffer.alloc(4);
    n.writeUInt32LE(total - 8); fs.writeSync(fd, n, 0, 4, 4);
    n.writeUInt32LE(total - h.dataOffset); fs.writeSync(fd, n, 0, 4, h.dataOffset - 4);
  } finally { fs.closeSync(fd); }
  return true;
}

/** A canonical 44-byte PCM header. */
export function wavHeader({ channels, sampleRate, bits }, dataSize) {
  const b = Buffer.alloc(44);
  const blockAlign = channels * (bits / 8);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + dataSize, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * blockAlign, 28); b.writeUInt16LE(blockAlign, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(dataSize, 40);
  return b;
}

/** Join WAV segments (same format) into `out`; segments with no audio are skipped. Resolves to the total seconds. */
export async function concatWav(files, out) {
  const parts = files.map(f => ({ f, h: wavInfo(f) })).filter(p => p.h && p.h.dataSize > 0);
  if (!parts.length) throw new Error('no audio recorded');
  const fmt = parts[0].h;
  for (const p of parts) {
    if (p.h.channels !== fmt.channels || p.h.sampleRate !== fmt.sampleRate || p.h.bits !== fmt.bits) throw new Error(`segment format differs: ${p.f}`);
  }
  const total = parts.reduce((n, p) => n + p.h.dataSize, 0);
  const ws = fs.createWriteStream(out);
  ws.write(wavHeader(fmt, total));
  for (const p of parts) await pipeline(fs.createReadStream(p.f, { start: p.h.dataOffset, end: p.h.dataOffset + p.h.dataSize - 1 }), ws, { end: false });
  await new Promise((resolve, reject) => ws.end((e) => (e ? reject(e) : resolve())));
  return total / (fmt.sampleRate * fmt.channels * (fmt.bits / 8));
}

/** Loudness of signed 16-bit little-endian mono PCM, in dBFS (−90 for silence). */
export function pcmLevelDb(buf) {
  const n = Math.floor(buf.length / 2);
  if (!n) return -90;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; }
  return Math.max(-90, 10 * Math.log10(sum / n || 1e-9));
}
