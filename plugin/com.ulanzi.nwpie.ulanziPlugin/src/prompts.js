// Claude command pad: type text / keys into a Claude Code session's tmux pane (in WSL on Windows, local on macOS).
// Sessions outside tmux are refused: typing into "whatever window is in front" is how the wrong thing gets approved.
import { hostShell } from './platform.js';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const TMUX_KEYS = new Set(['Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BTab', 'C-c', '1', '2', '3']);

/** Sessions a prompt key can target (in tmux), and the auto choice: longest-waiting, else most recently active. */
export function promptTargets(sessions) {
  return sessions.filter(s => s.focus?.tmux_pane && s.focus?.tmux);
}

export function autoTarget(sessions) {
  const t = promptTargets(sessions);
  const waiting = t.filter(s => s.state === 'waiting').sort((a, b) => a.waitingSince - b.waitingSince);
  if (waiting.length) return waiting[0];
  return t.sort((a, b) => b.lastEvent - a.lastEvent)[0] || null;
}

/** Build the shell snippet for tmux. Exported for tests. */
export function tmuxScript(focus, { text = '', keys = [], enter = false } = {}) {
  const sock = String(focus.tmux).split(',')[0];
  const base = `tmux -S ${q(sock)} send-keys -t ${q(focus.tmux_pane)}`;
  const parts = [];
  if (text) parts.push(`${base} -l ${q(text)}`);
  for (const k of keys) if (TMUX_KEYS.has(k)) parts.push(`${base} ${k}`);
  if (enter) parts.push(`${base} Enter`);
  return parts.join(' && ');
}

export async function sendToSession(session, payload, { log = () => {} } = {}) {
  const f = session?.focus || {};
  if (!f.tmux_pane || !f.tmux) return { ok: false, error: 'session is not in tmux' };
  const sh = tmuxScript(f, payload);
  if (!sh) return { ok: false, error: 'nothing to send' };
  const r = await hostShell(sh, { distro: f.distro || null });
  log('prompt.send', session.project, f.tmux_pane, payload.text || payload.keys, r.ok ? 'ok' : r.err.trim());
  return { ok: r.ok, error: r.ok ? null : r.err.trim() };
}
