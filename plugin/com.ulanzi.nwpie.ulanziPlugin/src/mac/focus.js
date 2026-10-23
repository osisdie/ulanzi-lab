// Bring a Claude Code session's terminal/editor to the front on macOS.
// Order: VS Code (by folder) → tmux pane (then the terminal showing that tmux client) → iTerm2 / Terminal tab
// by tty → the app named by $TERM_PROGRAM → any running terminal app.
import { execFile } from 'node:child_process';
import { osa } from './osa.js';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 4000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

// $TERM_PROGRAM → app name ('tmux' tells us nothing about the outer terminal).
const TERM_APPS = { 'iTerm.app': 'iTerm2', Apple_Terminal: 'Terminal', ghostty: 'Ghostty', WezTerm: 'WezTerm', WarpTerminal: 'Warp', kitty: 'kitty', alacritty: 'Alacritty' };

export function createMacFocuser({ log = () => {} } = {}) {
  /** Switch tmux to the pane; returns the tty of an attached client (the terminal tab showing tmux), or ''. */
  async function tmux(f) {
    const sock = q(String(f.tmux).split(',')[0]);
    const pane = q(f.tmux_pane);
    const sh = `tmux -S ${sock} switch-client -t ${pane} 2>/dev/null; tmux -S ${sock} select-window -t ${pane} \\; select-pane -t ${pane}; `
      + `tmux -S ${sock} list-clients -F '#{client_tty}' 2>/dev/null | head -n 1`;
    const r = await run('/bin/sh', ['-c', sh]);
    log('focus.tmux', f.tmux_pane, r.ok, r.stderr.trim());
    return r.stdout.trim();
  }

  async function focus(s) {
    if (!s) return false;
    const f = s.focus || {};
    try {
      if (f.term === 'vscode' && s.cwd) {
        const r = await run('open', ['-b', 'com.microsoft.VSCode', s.cwd]);
        if (r.ok) return true;
      }
      let tty = f.tty || '';
      if (f.tmux_pane && f.tmux) tty = (await tmux(f)) || '';
      if (tty && await osa('tty', tty)) return true;
      if (TERM_APPS[f.term] && await osa('activate', TERM_APPS[f.term])) return true;
      if (await osa('activate', '')) return true;
      return !!(await osa('activate', 'Claude')); // Claude desktop app sessions
    } catch (e) {
      log('focus.error', String(e?.stack || e));
    }
    return false;
  }

  return { focus };
}
