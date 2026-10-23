// Claude Code sessions on this machine (macOS): the same role WslProvider plays on Windows.
// Discovery reads Claude Code's own registry (~/.claude/sessions/<pid>.json); liveness is a local pid check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

/** ps etime "[[dd-]hh:]mm:ss" → seconds. */
export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  return m ? (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3]) * 60) + Number(m[4]) : null;
}

/** `ps -o pid=,etime=,tty=` → Map(pid → { ageSec, tty }). */
export function parsePs(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const [pid, etime, tty] = line.trim().split(/\s+/);
    const ageSec = parseEtime(etime || '');
    if (/^\d+$/.test(pid || '') && ageSec != null) out.set(pid, { ageSec, tty: tty && !/^\?+$/.test(tty) ? tty : '' });
  }
  return out;
}

/**
 * Registry entries ({ pid, json }) + ps info → seed records for live interactive sessions.
 * Pid-reuse guard: the process must have started before the session did (a reused pid starts later).
 */
export function localRecords(entries, ps, { now = Date.now(), tmuxSocket = '' } = {}) {
  const out = [];
  for (const { pid, json: j } of entries) {
    const p = ps.get(String(pid));
    if (!p || !j?.sessionId || (j.kind && j.kind !== 'interactive')) continue;
    if (j.startedAt && now - p.ageSec * 1000 > Number(j.startedAt) + 60e3) continue;
    const pane = /(%\d+)$/.exec(String(j.tmux || ''))?.[1] || null;
    out.push({
      session_id: j.sessionId, cwd: j.cwd || '', title: j.name || null, busy: j.status === 'busy',
      focus: { src: 'mac', pid: String(pid), tty: p.tty, ...(pane && tmuxSocket ? { tmux_pane: pane, tmux: `${tmuxSocket},0,0` } : {}) },
    });
  }
  return out;
}

export class LocalProvider extends EventEmitter {
  constructor({ log = () => {}, dir = path.join(os.homedir(), '.claude', 'sessions') } = {}) {
    super();
    this.log = log;
    this.dir = dir;
    this.distro = null;
  }

  get() { return null; } // no WSL-style status; the WSL key shows a placeholder
  start() {}
  stop() {}
  tick() {}

  /** Liveness group for a session (sessions reported by hooks on this Mac). */
  groupOf(s) { return s.focus?.src === 'mac' && s.focus.pid ? 'local' : null; }
  isDown() { return false; }

  async discoverSessions() {
    let names;
    try { names = await fs.promises.readdir(this.dir); } catch { return []; }
    const entries = [];
    for (const n of names) {
      const pid = n.endsWith('.json') ? n.slice(0, -5) : '';
      if (!/^\d+$/.test(pid)) continue;
      try { entries.push({ pid, json: JSON.parse(await fs.promises.readFile(path.join(this.dir, n), 'utf8')) }); } catch { /* being rewritten */ }
    }
    if (!entries.length) return [];
    const out = await new Promise((resolve) => execFile('ps', ['-o', 'pid=,etime=,tty=', '-p', entries.map(e => e.pid).join(',')], { timeout: 4000 },
      (err, stdout) => resolve(String(stdout || '')))); // exit 1 = none of them alive
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const tmuxSocket = path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${uid}`, 'default');
    return localRecords(entries, parsePs(out), { tmuxSocket });
  }

  async alivePids(_group, pids) {
    const alive = new Set();
    for (const p of pids) {
      try { process.kill(Number(p), 0); alive.add(String(p)); } catch (e) { if (e.code === 'EPERM') alive.add(String(p)); }
    }
    return alive;
  }
}
