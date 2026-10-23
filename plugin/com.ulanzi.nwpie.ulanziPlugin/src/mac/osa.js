// Runs src/mac/bridge.jxa through osascript: sync for the window-layout engine, async everywhere else.
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bridge.jxa');
let log = () => {};
export const setOsaLog = (fn) => { log = fn; };

const argv = (cmd, args) => ['-l', 'JavaScript', BRIDGE, cmd, ...args.map(a => (a == null ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a)))];

/** Bridge reply line → data, or null on failure (logged). */
export function parseReply(cmd, out) {
  let r;
  try { r = JSON.parse(String(out).trim()); } catch { log('osa', cmd, 'bad reply', String(out).slice(0, 200)); return null; }
  if (!r.ok) { log('osa', cmd, r.error); return null; }
  return r.data ?? null;
}

export function osaSync(cmd, ...args) {
  try { return parseReply(cmd, execFileSync('osascript', argv(cmd, args), { timeout: 4000, encoding: 'utf8' })); } catch (e) { log('osa', cmd, String(e.stderr || e.message).trim()); return null; }
}

export function osa(cmd, ...args) {
  return new Promise((resolve) => {
    execFile('osascript', argv(cmd, args), { timeout: 6000 }, (err, stdout, stderr) => {
      if (err) { log('osa', cmd, String(stderr || err.message).trim()); return resolve(null); }
      resolve(parseReply(cmd, stdout));
    });
  });
}
