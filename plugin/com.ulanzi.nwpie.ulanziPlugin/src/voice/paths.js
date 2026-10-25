// Where the Voice profile keeps its files: ~/ulanzi-lab/voice/{recordings,transcripts,tts,voices,inbox} in the home
// folder of whichever OS runs the plugin (C:\Users\<you>\ulanzi-lab\voice on Windows, browsable from WSL as
// /mnt/c/Users/<you>/ulanzi-lab/voice). Not Documents: it is often redirected into OneDrive, and recordings should
// stay on this machine. ULANZI_LAB_VOICE_DIR overrides the root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SUBDIRS = ['recordings', 'transcripts', 'tts', 'voices', 'inbox'];

export function voiceDirs(root) {
  const dirs = { root };
  for (const d of SUBDIRS) dirs[d] = path.join(root, d);
  dirs.parts = path.join(dirs.recordings, '.parts'); // segments of the recording in progress
  return dirs;
}

export function voiceRoot({ env = process.env, home = os.homedir() } = {}) {
  return env.ULANZI_LAB_VOICE_DIR || path.join(home, 'ulanzi-lab', 'voice');
}

export function ensureDirs(dirs) { for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true }); }

/** "20261025-103015" in local time: sortable, and safe in file names. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Newest file in `dir` with one of `exts` (by modification time), or null. */
export function newestFile(dir, exts) {
  let best = null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isFile() || !exts.includes(path.extname(e.name).toLowerCase())) continue;
    const f = path.join(dir, e.name);
    const t = fs.statSync(f).mtimeMs;
    if (!best || t > best.t) best = { f, t };
  }
  return best?.f || null;
}
