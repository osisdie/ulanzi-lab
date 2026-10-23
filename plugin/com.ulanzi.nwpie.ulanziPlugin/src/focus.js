// Bring a Claude Code session's terminal/editor to the front.
// Windows order: tmux pane (WSL) → VS Code window → Windows Terminal tab (UIA title match) → any WT window.
// macOS: see mac/focus.js.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_MAC } from './platform.js';
import { createMacFocuser } from './mac/focus.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

export function createFocuser(win32, { log = () => {} } = {}) {
  if (IS_MAC) return createMacFocuser({ log });
  if (!win32) return { focus: async () => false };
  const byExe = (re) => win32.listWindows({ includeMinimized: true }).filter(w => re.test(w.exeName));

  async function tmux(f) {
    const socket = (f.tmux || '').split(',')[0];
    const t = ['-S', socket];
    const pane = f.tmux_pane;
    // switch-client can fail when no client is attached; select-window/pane still help the next attach.
    const sh = `tmux ${t.map(q).join(' ')} switch-client -t ${q(pane)} 2>/dev/null; tmux ${t.map(q).join(' ')} select-window -t ${q(pane)} \\; select-pane -t ${q(pane)}`;
    const args = f.distro ? ['-d', f.distro, '-e', 'sh', '-c', sh] : ['-e', 'sh', '-c', sh];
    const r = await run('wsl.exe', args);
    log('focus.tmux', pane, r.ok, r.stderr.trim());
    return r.ok;
  }

  function vscode(s) {
    const wins = byExe(/^Code( - Insiders)?\.exe$/i);
    const hit = wins.find(w => w.title.includes(s.project)) || null;
    if (hit) { win32.activate(hit.hwnd); return true; }
    // Not open (or title differs): ask VS Code to open/focus that folder.
    const uri = s.focus.src === 'wsl' && s.focus.distro ? ['--folder-uri', `vscode-remote://wsl+${s.focus.distro}${s.cwd}`] : [s.cwd];
    run('cmd.exe', ['/c', 'code', ...uri]);
    return true;
  }

  async function terminal(s) {
    const needles = [s.title, s.project].filter(Boolean);
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'ps', 'select-wt-tab.ps1'), '-Match', needles.join(',')], 6000);
    const wts = byExe(/^WindowsTerminal\.exe$/i);
    let target = null;
    if (r.ok) {
      const hwnd = Number(r.stdout.split('\t')[0]);
      target = wts.find(w => Number(win32.hwndKey(w.hwnd)) === hwnd) || null;
      log('focus.wt-tab', r.stdout.trim());
    }
    target = target || wts.find(w => needles.some(n => w.title.includes(n))) || wts[0];
    if (target) { win32.activate(target.hwnd); return true; }
    return false;
  }

  async function focus(s) {
    if (!s) return false;
    const f = s.focus || {};
    try {
      if (f.term === 'vscode') return vscode(s);
      if (f.tmux_pane && f.tmux) {
        await tmux(f);
        const wt = byExe(/^WindowsTerminal\.exe$/i);
        const hit = wt.find(w => /tmux/i.test(w.title) || w.title.includes(s.project)) || wt[0];
        if (hit) { win32.activate(hit.hwnd); return true; }
      }
      if (await terminal(s)) return true;
      // Claude desktop app sessions.
      const claude = byExe(/^claude\.exe$/i)[0];
      if (claude) { win32.activate(claude.hwnd); return true; }
    } catch (e) {
      log('focus.error', String(e?.stack || e));
    }
    return false;
  }

  return { focus };
}

function q(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
