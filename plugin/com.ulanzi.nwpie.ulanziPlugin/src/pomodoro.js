// Pomodoro / focus timer. State survives restarts (%LOCALAPPDATA%\ulanzi_lab\pomodoro.json).
// While a focus block runs with DND on, the deck keeps lighting HITL keys but drops toasts and nag sounds.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export class Pomodoro extends EventEmitter {
  constructor({ file = null, now = () => Date.now() } = {}) {
    super();
    this.file = file;
    this.now = now;
    this.s = {
      phase: 'idle', // idle | focus | break | long
      running: false, endsAt: 0, remainingMs: 0, lengthMs: 0,
      focusMin: 25, breakMin: 5, longMin: 15, goal: 8,
      streak: 0, // focus blocks since the last long break
      dnd: true, days: {}, // 'YYYY-MM-DD' -> completed focus blocks
    };
    this.load();
  }

  load() {
    if (!this.file) return;
    try { Object.assign(this.s, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first run */ }
  }

  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.s)); } catch { /* best effort */ }
  }

  changed(evt) { this.save(); this.emit('change', evt); }

  remaining() {
    const s = this.s;
    if (s.phase === 'idle') return s.focusMin * 60e3;
    return s.running ? Math.max(0, s.endsAt - this.now()) : s.remainingMs;
  }

  progress() { return this.s.lengthMs ? 1 - this.remaining() / this.s.lengthMs : 0; }
  today() { return this.s.days[dayKey(this.now())] || 0; }
  week() {
    const out = [];
    for (let i = 6; i >= 0; i--) { const k = dayKey(this.now() - i * 86400e3); out.push({ day: k, count: this.s.days[k] || 0 }); }
    return out;
  }
  /** DND is in effect: a focus block is running and DND is on. */
  quiet() { return this.s.dnd && this.s.phase === 'focus' && this.s.running; }

  begin(phase, minutes) {
    const ms = minutes * 60e3;
    Object.assign(this.s, { phase, running: true, lengthMs: ms, endsAt: this.now() + ms, remainingMs: ms });
    this.changed({ type: 'start', phase });
  }

  /** Start / pause / resume. */
  toggle() {
    const s = this.s;
    if (s.phase === 'idle') return this.begin('focus', s.focusMin);
    if (s.running) { s.remainingMs = Math.max(0, s.endsAt - this.now()); s.running = false; }
    else { s.endsAt = this.now() + s.remainingMs; s.running = true; }
    this.changed({ type: s.running ? 'resume' : 'pause' });
  }

  reset() { Object.assign(this.s, { phase: 'idle', running: false, endsAt: 0, remainingMs: 0, lengthMs: 0 }); this.changed({ type: 'reset' }); }

  plus(minutes = 5) {
    const s = this.s;
    if (s.phase === 'idle') return;
    const ms = minutes * 60e3;
    s.lengthMs += ms;
    if (s.running) s.endsAt += ms; else s.remainingMs += ms;
    this.changed({ type: 'plus' });
  }

  cycleLength() { this.s.focusMin = this.s.focusMin === 25 ? 50 : this.s.focusMin === 50 ? 15 : 25; this.changed({ type: 'length' }); }
  toggleDnd() { this.s.dnd = !this.s.dnd; this.changed({ type: 'dnd' }); }
  startBreak(long = false) { this.begin(long ? 'long' : 'break', long ? this.s.longMin : this.s.breakMin); }

  /** Call every second; finishes blocks. Returns the completion event, if any. */
  tick() {
    const s = this.s;
    if (!s.running || this.now() < s.endsAt) return null;
    if (s.phase === 'focus') {
      const k = dayKey(this.now());
      s.days[k] = (s.days[k] || 0) + 1;
      s.streak++;
      // Keep two weeks of history.
      for (const d of Object.keys(s.days).sort().slice(0, -14)) delete s.days[d];
      const long = s.streak >= 4;
      if (long) s.streak = 0;
      this.begin(long ? 'long' : 'break', long ? s.longMin : s.breakMin);
      const evt = { type: 'focus-done', long, today: s.days[k] };
      this.emit('change', evt);
      return evt;
    }
    this.reset();
    const evt = { type: 'break-done' };
    this.emit('change', evt);
    return evt;
  }
}
