// OS-specific side effects in one place: where Claude Code's shell lives, opening URLs/apps, sounds.
// Windows talks to WSL; macOS (and Linux, for dev) run everything on the local machine.
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

// Apps started from the Dock get a bare PATH (/usr/bin:/bin:...); Homebrew tools (gh, glab, tmux, docker) live elsewhere.
if (IS_MAC) {
  const have = new Set((process.env.PATH || '').split(':'));
  const extra = ['/opt/homebrew/bin', '/usr/local/bin'].filter(p => !have.has(p));
  if (extra.length) process.env.PATH = [...extra, process.env.PATH].filter(Boolean).join(':');
}

/** Login shell for CLIs configured in the user's profile (gh/glab auth, PATH); POSIX-compatible ones only. */
function loginShell() {
  const sh = process.env.SHELL || '';
  return /^(bash|zsh|sh|ksh)$/.test(path.basename(sh)) ? sh : '/bin/zsh';
}

/**
 * Run a POSIX shell snippet where Claude Code runs: inside WSL (`distro`) on Windows, locally elsewhere.
 * `login` loads the user's profile (needed for gh/glab). Resolves { ok, out, err }; never rejects.
 */
export function hostShell(sh, { distro = null, login = false, timeout = 5000, maxBuffer = 1 << 20 } = {}) {
  const [cmd, args] = IS_WIN
    ? ['wsl.exe', [...(distro ? ['-d', distro] : []), '-e', login ? 'bash' : 'sh', login ? '-lc' : '-c', sh]]
    : login ? [loginShell(), ['-lc', sh]] : ['/bin/sh', ['-c', sh]];
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });
}

const detached = (cmd, args, onError) => {
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', (e) => onError?.(e));
  p.unref();
};

export function openUrl(url) {
  if (IS_WIN) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
  else execFile(IS_MAC ? 'open' : 'xdg-open', [url], () => {});
}

/** Show a folder in Explorer / Finder. */
export function openFolder(dir) { detached(IS_WIN ? 'explorer.exe' : IS_MAC ? 'open' : 'xdg-open', [dir]); }

/** Task Manager / Activity Monitor. */
export function openSystemMonitor() {
  if (IS_WIN) detached('taskmgr.exe', []);
  else if (IS_MAC) detached('open', ['-a', 'Activity Monitor']);
}

const DOCKER_EXE = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
export function startDocker(onError) {
  if (IS_WIN) detached(DOCKER_EXE, [], onError);
  else if (IS_MAC) execFile('open', ['-a', 'Docker'], (err) => err && onError?.(err));
  else onError?.(new Error('unsupported'));
}

/** Play a sound file (Windows: .wav; macOS: anything afplay reads). Which file per event: sounds.js. */
export function chime(file) {
  if (!file) return;
  // PowerShell single-quoted string: a quote inside the path (' or the typographic ‘ ’ ‚ ‛, which PowerShell also
  // treats as quotes) is escaped by doubling it.
  if (IS_WIN) execFile('powershell.exe', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${String(file).replace(/['\u2018-\u201B]/g, '$&$&')}').PlaySync()`], { windowsHide: true }, () => {});
  else if (IS_MAC) execFile('afplay', [file], () => {});
}
