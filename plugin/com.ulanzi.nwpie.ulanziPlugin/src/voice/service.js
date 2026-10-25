// On-demand local services (speech-to-text now, voice cloning later): start one when a key needs it, wait for
// /health, and keep its stdin open; the service exits when the pipe closes (plugin quit) or after it idles.
// On Windows the service lives in WSL: `wsl.exe -d <distro> -e bash -lc <start command>`.
import { spawn as nodeSpawn } from 'node:child_process';

/** POSIX-quote a string for bash. */
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The bash command that runs `script` (a path inside the repo, e.g. services/voice-asr/start.sh). On Windows the repo
 * is a Windows path, so let WSL translate it with wslpath.
 */
export function startCommand(repoRoot, script, { platform = process.platform } = {}) {
  if (platform === 'win32') return `"$(wslpath -u ${shq(repoRoot)})"/${script}`;
  return `${shq(repoRoot)}/${script}`;
}

/**
 * State machine: off → starting → ready (or error). `ensure()` resolves true once /health answers, starting the
 * service first if needed (callers share one start). `command` is null when the service can't run here.
 */
export function createService({ name, url, command, distro = null, platform = process.platform, spawn = nodeSpawn,
  health = defaultHealth, log = () => {}, startTimeoutMs = 180e3, pollMs = 2000, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  let proc = null;
  let starting = null;
  const st = { state: 'off', error: '', since: now() };
  const listeners = new Set();
  const set = (state, error = '') => { if (st.state === state && st.error === error) return; Object.assign(st, { state, error, since: now() }); for (const f of listeners) f({ ...st }); };

  async function up() {
    try { return (await health(url)) === true; } catch { return false; }
  }

  function launch() {
    const [cmd, args] = platform === 'win32'
      ? ['wsl.exe', [...(distro ? ['-d', distro] : []), '-e', 'bash', '-lc', command]]
      : ['bash', ['-lc', command]];
    log(`${name}: starting`, cmd, args.join(' '));
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-400); });
    p.stdin?.on('error', () => {});
    p.on('error', (e) => { log(`${name}: spawn failed`, e.message); set('error', e.message); });
    p.on('exit', (code) => {
      const last = stderr.trim().split('\n').pop() || '';
      log(`${name}: exited`, code, last);
      if (proc === p) proc = null;
      if (code === 3) set('error', 'not installed');
      else if (st.state === 'starting') set('error', `exit ${code}${last ? `: ${last.slice(0, 80)}` : ''}`); // died before /health
      else if (st.state !== 'off') set('off');
    });
    return p;
  }

  async function ensure() {
    if (await up()) { set('ready'); return true; }
    if (!command) { set('error', 'not available'); return false; }
    starting ||= (async () => {
      set('starting');
      if (!proc) proc = launch();
      const until = now() + startTimeoutMs;
      while (now() < until) {
        await sleep(pollMs);
        if (await up()) { set('ready'); return true; }
        if (!proc) break; // exited during startup (st.state already says why)
      }
      if (st.state === 'starting') set('error', 'start timed out');
      return false;
    })().finally(() => { starting = null; });
    return starting;
  }

  /** Refresh the state without starting anything (for the status key). */
  async function check() {
    if (starting) return st.state;
    if (await up()) set('ready');
    else if (st.state === 'ready') set('off');
    return st.state;
  }

  function stop() {
    const p = proc;
    proc = null;
    set('off');
    if (!p) return;
    p.stdin?.end(); // the service exits on stdin EOF
    setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 3000).unref?.();
  }

  return { ensure, check, stop, get: () => ({ ...st }), on: (f) => { listeners.add(f); return () => listeners.delete(f); } };
}

async function defaultHealth(url) {
  const r = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
  return r.ok && (await r.json()).ok === true;
}
