// Tiny file logger: %LOCALAPPDATA%\ulanzi_lab\plugin.log (rotates at 2 MB).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ulanzi_lab');
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
