// Which WSL distro to talk to: $ULANZI_LAB_DISTRO, else the machine's default distro (`wsl -l -v`, the row marked *).
// Windows only; elsewhere Claude Code runs on the host itself and this is null.
import './env.js';
import { execFileSync } from 'node:child_process';
import { IS_WIN } from './platform.js';

/** Parse `wsl.exe -l -v` output (already decoded) → default distro name, or null. */
export function parseDefaultDistro(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*\*\s+(\S+)/);
    if (m) return m[1];
  }
  return null;
}

let cached = null;
export function defaultDistro() {
  if (!IS_WIN) return null;
  if (cached) return cached;
  cached = process.env.ULANZI_LAB_DISTRO || null;
  if (!cached) {
    try {
      // wsl.exe prints UTF-16LE.
      const out = execFileSync('wsl.exe', ['-l', '-v'], { timeout: 8000, windowsHide: true }).toString('utf16le').replace(/\0/g, '');
      cached = parseDefaultDistro(out);
    } catch { /* no WSL */ }
  }
  cached ||= 'Ubuntu';
  return cached;
}
