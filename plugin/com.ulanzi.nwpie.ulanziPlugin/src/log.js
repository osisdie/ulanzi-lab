// Tiny file logger: %LOCALAPPDATA%\ulanzi-lab\plugin.log, ~/Library/Application Support/ulanzi-lab/plugin.log on macOS (rotates at 2 MB).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.LOCALAPPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : os.tmpdir());
// Pre-rename name: move it over (logs + state); if it is locked, keep using it this run and retry next start.
function dataDir(dir = path.join(BASE, 'ulanzi-lab'), legacy = path.join(BASE, 'ulanzi_lab')) {
  if (fs.existsSync(dir) || !fs.existsSync(legacy)) return dir;
  try { fs.renameSync(legacy, dir); return dir; } catch { return legacy; }
}
export const DATA_DIR = process.env.ULANZI_LAB_DATA_DIR || dataDir(); // override: tests / CI
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'plugin.log');

export function log(...args) {
  const line = `${new Date().toISOString()} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > 2e6) fs.renameSync(FILE, FILE + '.1');
    fs.appendFileSync(FILE, line);
  } catch { /* logging must never crash the plugin */ }
  if (process.env.ULANZI_LAB_STDOUT) process.stdout.write(line);
}
