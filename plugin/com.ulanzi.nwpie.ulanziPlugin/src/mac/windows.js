// macOS window backend for layout.js: same calls as win32.js, served by the JXA bridge (System Events).
// A window handle is { pid, title, rect }; the rect doubles as a hint to find the window again.
import { osaSync } from './osa.js';

let screenCache = { list: [], at: 0 };
const cachedScreens = () => {
  if (Date.now() - screenCache.at > 10e3) screenCache = { list: osaSync('screens') || [], at: Date.now() };
  return screenCache.list;
};

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The screen a window is (mostly) on; the main screen when it is off-screen. */
export function screenFor(rect, screens) {
  if (!screens.length) return null;
  if (!rect) return screens[0];
  return screens.reduce((best, s) => (overlap(rect, s.full) > overlap(rect, best.full) ? s : best), screens[0]);
}

export const hwndKey = (h) => `${h.pid}:${h.title}`;

export function foreground() {
  const d = osaSync('front');
  if (!d?.pid || !d.rect) return null;
  screenCache = { list: d.screens || [], at: Date.now() };
  return { hwnd: { pid: d.pid, title: d.title, rect: d.rect }, title: d.title, pid: d.pid, exe: d.app, exeName: d.app };
}

export function getRect(h) {
  if (!h.rect) h.rect = osaSync('rect', h.pid, h.title, null);
  return h.rect;
}

export function workAreaOf(h) {
  const s = screenFor(getRect(h), cachedScreens());
  const zero = { x: 0, y: 0, w: 0, h: 0 };
  return { mon: s, work: s?.work || zero, full: s?.full || zero };
}

export function monitors() {
  return cachedScreens().map((s, i) => ({ mon: s, work: s.work, full: s.full, primary: i === 0 }))
    .sort((a, b) => a.full.x - b.full.x || a.full.y - b.full.y);
}

// macOS has no "restore": remember where we first moved a window from, and put it back there.
const before = new Map();

function moveTo(h, r) {
  const got = osaSync('place', h.pid, h.title, h.rect, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
  if (got) h.rect = got;
  return !!got;
}

export function place(h, rect) {
  const key = hwndKey(h);
  if (!before.has(key) && getRect(h)) before.set(key, { ...h.rect });
  return moveTo(h, rect);
}

export function maximize(h) { return place(h, workAreaOf(h).work); }

export function restore(h) {
  const prev = before.get(hwndKey(h));
  if (!prev) return false;
  before.delete(hwndKey(h));
  return moveTo(h, prev);
}

export function isMaximized(h) {
  const r = getRect(h), w = workAreaOf(h).work;
  return !!r && ['x', 'y', 'w', 'h'].every(k => Math.abs(r[k] - w[k]) <= 8);
}

export const isResizable = () => true;

export function listWindows() {
  return (osaSync('windows') || []).map(w => ({ hwnd: { pid: w.pid, title: w.title, rect: w.rect }, title: w.title || w.app, pid: w.pid, exe: w.app, exeName: w.app, minimized: false }));
}

export function activate(h) { return !!osaSync('raise', h.pid, h.title, h.rect); }
