// Ulanzi Studio starts the plugin on its bundled Node (Studio 3.4: 20.12.2, end of life, no security fixes).
// When a patched Node is installed, app.js only supervises: the real plugin (main.js, with all network I/O)
// runs in a child on that Node. Studio's own Node then does no work besides keeping the child alive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { nodeProblem } from './node-floor.js';

/** Places a system Node may live, best first: ULANZI_LAB_NODE, PATH, the usual installers. */
export function nodeCandidates(env = process.env, platform = process.platform) {
  const exe = platform === 'win32' ? 'node.exe' : 'node';
  const sep = platform === 'win32' ? ';' : ':';
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const list = [
    env.ULANZI_LAB_NODE,
    ...(env.PATH || env.Path || '').split(sep).filter(Boolean).map(d => join(d, exe)),
    ...(platform === 'win32'
      ? [join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', exe), env.NVM_SYMLINK && join(env.NVM_SYMLINK, exe), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'nodejs', exe)]
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', join(os.homedir(), '.volta', 'bin', 'node')]),
  ];
  return [...new Set(list.filter(Boolean))];
}

/** The first installed Node with current security fixes (not the one running us), or null. */
export function findPatchedNode({ log = () => {}, candidates = nodeCandidates() } = {}) {
  for (const file of candidates) {
    if (!fs.existsSync(file) || path.resolve(file) === path.resolve(process.execPath)) continue;
    const r = spawnSync(file, ['-p', 'process.version'], { timeout: 8000, windowsHide: true, encoding: 'utf8' });
    const version = String(r.stdout || '').trim();
    if (r.status !== 0 || !/^v\d+\.\d+\.\d+/.test(version)) continue;
    const problem = nodeProblem(version);
    if (!problem) return { file, version };
    log('supervisor: skip', file, problem);
  }
  return null;
}

/**
 * Run `entry` (app.js, with Studio's arguments) on `node` and keep it running. Resolves with false when the
 * child keeps dying right after start (the caller then runs the plugin in-process instead).
 */
export function supervise(node, entry, args, { log = () => {}, fastExitMs = 15e3, maxFastExits = 3 } = {}) {
  return new Promise((resolve) => {
    let child = null, fastExits = 0, stopping = false;
    const stop = () => { stopping = true; child?.kill(); process.exit(0); };
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, stop);

    function start() {
      const at = Date.now();
      // IPC channel: when this process dies (Studio stops the plugin), the child sees 'disconnect' and exits.
      child = spawn(node.file, [entry, ...args], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true, env: { ...process.env, ULANZI_LAB_SUPERVISED: '1' },
      });
      log('supervisor: started', node.file, node.version, 'pid', child.pid);
      let done = false;
      const ended = (why) => { // 'exit', or 'error' alone when the spawn itself fails
        if (done || stopping) return;
        done = true;
        fastExits = Date.now() - at < fastExitMs ? fastExits + 1 : 0;
        log('supervisor: child ended', why, fastExits ? `(fast exit ${fastExits}/${maxFastExits})` : '');
        if (fastExits >= maxFastExits) { for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.off(sig, stop); return resolve(false); }
        setTimeout(start, 2000);
      };
      child.on('exit', (code, signal) => ended(code ?? signal));
      child.on('error', (e) => ended(`spawn failed: ${e.message}`));
    }
    start();
  });
}
