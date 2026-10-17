// WSL status: running distros + memory/load of the configured distro (only queried while it runs,
// so polling never boots a stopped distro).
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

const run = (args, timeout = 5000) => new Promise((resolve) => {
  execFile('wsl.exe', args, { timeout, windowsHide: true, encoding: 'buffer' }, (err, stdout) => resolve(err ? null : stdout));
});
// wsl.exe's own messages are UTF-16LE; output of Linux commands is UTF-8.
const decode16 = (b) => (b ? b.toString('utf16le').replace(/\0/g, '') : '');

export function parseProc(text) {
  const lines = String(text).split('\n');
  const load = parseFloat(lines[0]);
  const kv = Object.fromEntries(lines.slice(1).map(l => l.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map(m => [m[1], +m[2]]));
  const mem = kv.MemTotal ? ((kv.MemTotal - kv.MemAvailable) / kv.MemTotal) * 100 : null;
  return { load: Number.isFinite(load) ? load : null, mem, memTotalGb: kv.MemTotal ? kv.MemTotal / 2 ** 20 : null };
}

/**
 * Parse the discovery script output: line 1 = uid, then "pid<TAB>starttime<TAB>tty<TAB>{registry json}".
 * Keeps live interactive sessions whose /proc start time matches the registry's procStart (pid reuse guard).
 */
export function parseRegistry(text, distro) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const uid = /^\d+$/.test(lines[0] || '') ? lines.shift() : '1000';
  const out = [];
  for (const line of lines) {
    const [pid, start, tty, ...rest] = line.split('\t');
    let j;
    try { j = JSON.parse(rest.join('\t')); } catch { continue; }
    if (!j.sessionId || (j.kind && j.kind !== 'interactive')) continue;
    if (j.procStart && String(j.procStart) !== String(start)) continue; // pid was reused by another process
    const pane = /(%\d+)$/.exec(String(j.tmux || ''))?.[1] || null;
    out.push({
      session_id: j.sessionId, cwd: j.cwd || '', title: j.name || null, busy: j.status === 'busy',
      focus: { src: 'wsl', distro, pid: String(pid), tty: tty && tty !== '?' ? tty : '', ...(pane ? { tmux_pane: pane, tmux: `/tmp/tmux-${uid}/default,0,0` } : {}) },
    });
  }
  return out;
}

const DISCOVER_SH = 'id -u; for f in "$HOME"/.claude/sessions/*.json; do p=${f##*/}; p=${p%.json}; '
  + 'case $p in *[!0-9]*) continue;; esac; [ -r /proc/$p/stat ] || continue; '
  + 'st=$(cut -d" " -f22 /proc/$p/stat); tty=$(ps -o tty= -p $p | tr -d " "); '
  + 'printf "%s\\t%s\\t%s\\t" "$p" "$st" "$tty"; tr -d "\\n" < "$f"; echo; done; true';

export class WslProvider extends EventEmitter {
  constructor({ distro = 'Ubuntu', intervalMs = 10000, log = () => {} } = {}) {
    super();
    this.distro = distro;
    this.intervalMs = intervalMs;
    this.log = log;
    this.s = null;
  }

  async tick() {
    const running = decode16(await run(['-l', '--running', '-q'])).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let metrics = {};
    if (running.includes(this.distro)) {
      const out = await run(['-d', this.distro, '-e', 'sh', '-c', 'cat /proc/loadavg; grep -E "^(MemTotal|MemAvailable):" /proc/meminfo']);
      if (out) metrics = parseProc(out.toString('utf8'));
    }
    this.s = { distro: this.distro, running, ...metrics, at: Date.now() };
    this.emit('change');
  }

  get() { return this.s; }
  start() { this.timer = setInterval(() => this.tick().catch(e => this.log('wsl', e.message)), this.intervalMs); this.tick(); }
  stop() { clearInterval(this.timer); }

  /** Live Claude Code sessions in a distro, from ~/.claude/sessions (one wsl.exe call). null = could not tell. */
  async discoverSessions(distro = this.distro) {
    const out = await run(['-d', distro, '-e', 'sh', '-c', DISCOVER_SH], 8000);
    return out ? parseRegistry(out.toString('utf8'), distro) : null;
  }

  /** pids alive inside a distro (for Claude session liveness). */
  async alivePids(distro, pids) {
    if (!pids.length) return new Set();
    const sh = `for p in ${pids.map(p => parseInt(p, 10)).filter(Boolean).join(' ')}; do [ -d /proc/$p ] && echo $p; done; true`;
    const out = await run(['-d', distro, '-e', 'sh', '-c', sh]);
    if (!out) return null; // unknown → don't prune
    return new Set(out.toString('utf8').split(/\s+/).filter(Boolean));
  }
}
