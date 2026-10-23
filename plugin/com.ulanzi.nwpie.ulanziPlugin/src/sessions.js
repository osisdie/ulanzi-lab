// Claude Code session state machine + HITL queue.
// Pure (no I/O): fed by hook events, read by the deck renderer and the HTTP API.
import { EventEmitter } from 'node:events';

export const STATES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error'];

// Tools whose PreToolUse means "Claude is now blocked on the human".
const HITL_TOOLS = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };

// Notification types that mean "waiting on a human decision".
const WAIT_NOTIFS = {
  permission_prompt: 'permission',
  elicitation_dialog: 'question',
  elicitation_url_dialog: 'question',
  agent_needs_input: 'question',
};

// Fields we accept from hooks. Anything else (prompt, tool_input, transcript...) is dropped.
export const HOOK_FIELDS = [
  'session_id', 'hook_event_name', 'notification_type', 'cwd', 'tool_name', 'tool_use_id',
  'permission_mode', 'source', 'reason', 'model', 'agent_type', 'session_title', 'ts', 'focus',
];
const FOCUS_FIELDS = ['src', 'distro', 'tmux_pane', 'tmux', 'term', 'wt_session', 'pid', 'tty', 'host'];

export function sanitizeHookEvent(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of HOOK_FIELDS) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue;
    if (k === 'focus') {
      const f = {};
      for (const fk of FOCUS_FIELDS) if (raw.focus[fk]) f[fk] = String(raw.focus[fk]).slice(0, 200);
      out.focus = f;
    } else if (k === 'ts') {
      out.ts = Number(raw.ts) || undefined;
    } else if (k === 'model') {
      out.model = typeof raw.model === 'string' ? raw.model : raw.model?.display_name || raw.model?.id;
    } else {
      out[k] = String(raw[k]).slice(0, 300);
    }
  }
  return out;
}

export function projectName(cwd = '') {
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '?';
}

export class SessionStore extends EventEmitter {
  constructor({ now = () => Date.now(), maxSlots = 8 } = {}) {
    super();
    this.now = now;
    this.maxSlots = maxSlots;
    this.sessions = new Map();
  }

  get(id) { return this.sessions.get(id); }

  list() {
    return [...this.sessions.values()].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.firstSeen - b.firstSeen);
  }

  bySlot(n) { return this.list().find(s => s.slot === n); }

  /** Waiting sessions, longest-waiting first. */
  waiting() {
    return this.list().filter(s => s.state === 'waiting').sort((a, b) => a.waitingSince - b.waitingSince);
  }

  counts() {
    const c = Object.fromEntries(STATES.map(s => [s, 0]));
    for (const s of this.sessions.values()) c[s.state]++;
    return c;
  }

  _freeSlot() {
    const used = new Set([...this.sessions.values()].map(s => s.slot));
    for (let i = 1; i <= this.maxSlots; i++) if (!used.has(i)) return i;
    return null;
  }

  _ensure(ev) {
    let s = this.sessions.get(ev.session_id);
    if (!s) {
      const t = this.now();
      s = {
        id: ev.session_id, slot: this._freeSlot(), cwd: ev.cwd || '', project: projectName(ev.cwd),
        state: 'idle', kind: null, since: t, firstSeen: t, lastEvent: t, lastTs: 0,
        waitingSince: null, pendingToolUse: null, tool: null, model: null, title: null,
        ctxPct: null, costUsd: null, acked: false, focus: {},
      };
      this.sessions.set(s.id, s);
    }
    return s;
  }

  _set(s, state, kind = null) {
    if (s.state !== state || s.kind !== kind) {
      s.state = state;
      s.kind = kind;
      s.since = this.now();
    }
    if (state === 'waiting') {
      if (!s.waitingSince) { s.waitingSince = this.now(); s.acked = false; }
    } else {
      s.waitingSince = null;
      s.pendingToolUse = null;
      s.acked = false;
    }
  }

  /** Apply one sanitized hook event. Returns the session (or null if removed / ignored). */
  ingest(raw) {
    const ev = sanitizeHookEvent(raw);
    if (!ev.session_id || !ev.hook_event_name) return null;
    const name = ev.hook_event_name;

    if (name === 'SessionEnd') {
      const had = this.sessions.delete(ev.session_id);
      if (had) this.emit('change', { type: 'removed', id: ev.session_id });
      return null;
    }

    const s = this._ensure(ev);
    const prev = { state: s.state, kind: s.kind };
    s.lastEvent = this.now();
    if (ev.cwd) { s.cwd = ev.cwd; s.project = projectName(ev.cwd); }
    if (ev.model) s.model = ev.model;
    if (ev.session_title) s.title = ev.session_title;
    if (ev.focus) s.focus = { ...s.focus, ...ev.focus };

    // Out-of-order guard: hooks post in the background, so an older event may arrive late.
    if (ev.ts && ev.ts < s.lastTs) return s;
    if (ev.ts) s.lastTs = ev.ts;

    const waiting = s.state === 'waiting';
    switch (name) {
      case 'SessionStart':
        this._set(s, 'idle');
        break;
      case 'UserPromptSubmit':
        this._set(s, 'thinking');
        break;
      case 'PreCompact':
        this._set(s, 'thinking', 'compact');
        break;
      case 'PreToolUse':
        s.tool = ev.tool_name || s.tool;
        if (HITL_TOOLS[ev.tool_name]) {
          this._set(s, 'waiting', HITL_TOOLS[ev.tool_name]);
          s.pendingToolUse = ev.tool_use_id || null;
        } else if (!waiting) {
          this._set(s, 'working');
        }
        break;
      case 'PermissionRequest':
        s.tool = ev.tool_name || s.tool;
        this._set(s, 'waiting', 'permission');
        s.pendingToolUse = ev.tool_use_id || s.pendingToolUse;
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionDenied':
        // A parallel tool finishing must not clear someone else's pending permission.
        if (waiting && s.pendingToolUse && ev.tool_use_id && ev.tool_use_id !== s.pendingToolUse) break;
        this._set(s, 'working');
        break;
      case 'SubagentStart':
      case 'SubagentStop':
        if (!waiting) this._set(s, 'working');
        break;
      case 'Notification': {
        const kind = WAIT_NOTIFS[ev.notification_type];
        if (kind) this._set(s, 'waiting', s.state === 'waiting' && s.kind ? s.kind : kind);
        else if (ev.notification_type === 'idle_prompt' && !waiting) this._set(s, 'done', 'idle');
        break;
      }
      case 'Stop':
        this._set(s, 'done');
        break;
      case 'StopFailure':
        this._set(s, 'error');
        break;
      default:
        break;
    }
    if (prev.state !== s.state || prev.kind !== s.kind) {
      this.emit('change', { type: 'state', id: s.id, from: prev.state, to: s.state, kind: s.kind });
    } else {
      this.emit('change', { type: 'touch', id: s.id });
    }
    return s;
  }

  /**
   * Add a session found in Claude Code's own registry (e.g. after a hub restart, before it fires any hook).
   * Known sessions only get missing focus hints filled in. Returns true when a session was added.
   */
  seed({ session_id, cwd, title = null, busy = false, focus = {} }) {
    if (!session_id) return false;
    const known = this.sessions.get(session_id);
    if (known) {
      for (const [k, v] of Object.entries(focus)) if (v && !known.focus[k]) known.focus[k] = v;
      return false;
    }
    const s = this._ensure({ session_id, cwd });
    s.focus = { ...focus };
    if (title) s.title = title;
    if (busy) this._set(s, 'working');
    this.emit('change', { type: 'state', id: s.id, from: null, to: s.state, kind: null });
    return true;
  }

  /** Per-session metrics from the statusLine (context %, cost, model). */
  updateMetrics({ session_id, ctxPct, costUsd, model }) {
    const s = session_id && this.sessions.get(session_id);
    if (!s) return;
    if (ctxPct != null) s.ctxPct = ctxPct;
    if (costUsd != null) s.costUsd = costUsd;
    if (model) s.model = model;
    this.emit('change', { type: 'touch', id: s.id });
  }

  ack(id) {
    const s = this.sessions.get(id);
    if (s && s.state === 'waiting') { s.acked = true; this.emit('change', { type: 'touch', id }); }
  }

  remove(id) {
    if (this.sessions.delete(id)) this.emit('change', { type: 'removed', id });
  }

  /** Drop sessions not seen for `maxIdleMs` (fallback when no pid liveness is available). */
  expire(maxIdleMs) {
    const t = this.now();
    for (const s of [...this.sessions.values()]) {
      if (t - s.lastEvent > maxIdleMs && s.state !== 'waiting') this.remove(s.id);
    }
  }

  toJSON() { return this.list(); }

  load(list = []) {
    for (const s of list) if (s && s.id) this.sessions.set(s.id, s);
  }
}
