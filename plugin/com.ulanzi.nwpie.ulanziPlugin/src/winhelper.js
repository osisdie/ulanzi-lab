// Client for src/ps/winhelper.ps1: one resident PowerShell process, JSON lines over stdio.
// Media session (SMTC), Core Audio and perf counters are all served from it, so polling
// never spawns a process. Restarts itself (with backoff) if PowerShell exits.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ps', 'winhelper.ps1');

export function createWinHelper({ log = () => {} } = {}) {
  let proc = null;
  let nextId = 1;
  let backoff = 1000;
  const pending = new Map(); // id -> {resolve, timer}

  function start() {
    proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) { backoff = 1000; log('winhelper ready'); return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg.ok ? msg.data : null);
      if (!msg.ok) log('winhelper error', msg.error);
    });
    proc.stderr.on('data', (d) => log('winhelper stderr', String(d).slice(0, 300)));
    proc.stdin.on('error', () => { /* helper died mid-write; 'exit' handles the restart */ });
    proc.on('exit', (code) => {
      log('winhelper exited', code);
      for (const p of pending.values()) { clearTimeout(p.timer); p.resolve(null); }
      pending.clear();
      proc = null;
      if (!stopped) setTimeout(start, (backoff = Math.min(backoff * 2, 60e3)));
    });
  }

  let stopped = false;
  start();

  /** Resolves with the reply's data, or null on error/timeout. */
  function request(cmd, arg, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!proc || !proc.stdin.writable) return resolve(null);
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
      pending.set(id, { resolve, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, arg }) + '\n');
    });
  }

  return { request, stop() { stopped = true; proc?.kill(); } };
}
