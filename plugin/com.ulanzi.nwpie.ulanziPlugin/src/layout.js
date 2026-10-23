// Window layouts (Rectangle / FancyZones style) for the foreground window + multi-window presets.
// Geometry is pure (fractions of the monitor work area) so it is unit-testable; the OS backend
// (win32.js, or mac/windows.js on macOS) does the I/O.

const r = (x, y, w, h) => ({ x, y, w, h });

/**
 * Single-window modes. A mode with several fractions cycles on repeated presses
 * (e.g. left: 1/2 → 1/3 → 2/3), like Rectangle on macOS.
 */
export const MODES = {
  left: { label: 'Left', cycle: [r(0, 0, 1 / 2, 1), r(0, 0, 1 / 3, 1), r(0, 0, 2 / 3, 1)] },
  right: { label: 'Right', cycle: [r(1 / 2, 0, 1 / 2, 1), r(2 / 3, 0, 1 / 3, 1), r(1 / 3, 0, 2 / 3, 1)] },
  top: { label: 'Top', cycle: [r(0, 0, 1, 1 / 2)] },
  bottom: { label: 'Bottom', cycle: [r(0, 1 / 2, 1, 1 / 2)] },
  tl: { label: 'Top-Left', cycle: [r(0, 0, 1 / 2, 1 / 2)] },
  tr: { label: 'Top-Right', cycle: [r(1 / 2, 0, 1 / 2, 1 / 2)] },
  bl: { label: 'Bottom-Left', cycle: [r(0, 1 / 2, 1 / 2, 1 / 2)] },
  br: { label: 'Bottom-Right', cycle: [r(1 / 2, 1 / 2, 1 / 2, 1 / 2)] },
  third1: { label: 'Left ⅓', cycle: [r(0, 0, 1 / 3, 1)] },
  third2: { label: 'Center ⅓', cycle: [r(1 / 3, 0, 1 / 3, 1)] },
  third3: { label: 'Right ⅓', cycle: [r(2 / 3, 0, 1 / 3, 1)] },
  center: { label: 'Center', cycle: [r(1 / 6, 1 / 10, 2 / 3, 4 / 5), r(1 / 4, 1 / 6, 1 / 2, 2 / 3)] },
  maximize: { label: 'Maximize', cycle: [r(0, 0, 1, 1)] },
  restore: { label: 'Restore', cycle: [] },
  nextmon: { label: 'Next Screen', cycle: [] },
};

/** Multi-window presets: applied to the N front-most windows on the current monitor (z-order). */
export const PRESETS = {
  split2: { label: '2 Split', rects: [r(0, 0, 1 / 2, 1), r(1 / 2, 0, 1 / 2, 1)] },
  stack2: { label: '2 Stack', rects: [r(0, 0, 1, 1 / 2), r(0, 1 / 2, 1, 1 / 2)] },
  grid4: { label: '4 Grid', rects: [r(0, 0, 1 / 2, 1 / 2), r(1 / 2, 0, 1 / 2, 1 / 2), r(0, 1 / 2, 1 / 2, 1 / 2), r(1 / 2, 1 / 2, 1 / 2, 1 / 2)] },
  cols3: { label: '3 Columns', rects: [r(0, 0, 1 / 3, 1), r(1 / 3, 0, 1 / 3, 1), r(2 / 3, 0, 1 / 3, 1)] },
  main3: { label: 'Main + 2', rects: [r(0, 0, 3 / 5, 1), r(3 / 5, 0, 2 / 5, 1 / 2), r(3 / 5, 1 / 2, 2 / 5, 1 / 2)] },
};

/** Fractional rect → pixels inside a work area, with an optional gap. */
export function toPixels(frac, work, gap = 0) {
  const x = work.x + frac.x * work.w, y = work.y + frac.y * work.h;
  const w = frac.w * work.w, h = frac.h * work.h;
  const gl = frac.x === 0 ? gap : gap / 2, gt = frac.y === 0 ? gap : gap / 2;
  const gr = frac.x + frac.w >= 0.999 ? gap : gap / 2, gb = frac.y + frac.h >= 0.999 ? gap : gap / 2;
  return { x: Math.round(x + gl), y: Math.round(y + gt), w: Math.round(w - gl - gr), h: Math.round(h - gt - gb) };
}

/** Which cycle step to use next: advance if the window still sits where we last put it. */
export function nextCycleIndex(mode, last, hwndKey, now, current, tolerance = 4) {
  const n = MODES[mode]?.cycle.length || 0;
  if (n <= 1 || !last || last.mode !== mode || last.hwnd !== hwndKey || now - last.at > 4000) return 0;
  const same = current && last.rect && ['x', 'y', 'w', 'h'].every(k => Math.abs(current[k] - last.rect[k]) <= tolerance);
  return same ? (last.idx + 1) % n : 0;
}

/** Preview rects for the key icon. */
export function previewRects(mode) {
  if (PRESETS[mode]) return PRESETS[mode].rects;
  if (mode === 'restore') return [r(0.2, 0.2, 0.5, 0.5)];
  if (mode === 'nextmon') return [r(0.55, 0.1, 0.4, 0.8)];
  return MODES[mode]?.cycle.slice(0, 1) || [];
}

export const labelOf = (mode) => PRESETS[mode]?.label || MODES[mode]?.label || mode;

// ---------------------------------------------------------------- I/O side

export function createLayoutEngine(win32, { gap = 0, log = () => {} } = {}) {
  let last = null;

  function snap(mode) {
    const fg = win32.foreground();
    if (!fg || !fg.hwnd) return { ok: false, why: 'no foreground window' };
    const h = fg.hwnd;
    const key = win32.hwndKey(h);
    if (mode === 'restore') { win32.restore(h); return { ok: true }; }
    if (mode === 'maximize') { win32.maximize(h); return { ok: true }; }
    const { work } = win32.workAreaOf(h);
    if (mode === 'nextmon') {
      const mons = win32.monitors();
      if (mons.length < 2) return { ok: false, why: 'single monitor' };
      const cur = win32.getRect(h);
      const i = mons.findIndex(m => m.work.x === work.x && m.work.y === work.y);
      const to = mons[(i + 1) % mons.length].work;
      const was = win32.isMaximized(h);
      // Keep relative position/size.
      const fx = (cur.x - work.x) / work.w, fy = (cur.y - work.y) / work.h;
      win32.place(h, { x: to.x + fx * to.w, y: to.y + fy * to.h, w: Math.min(cur.w, to.w), h: Math.min(cur.h, to.h) });
      if (was) win32.maximize(h);
      return { ok: true };
    }
    const m = MODES[mode];
    if (!m) return { ok: false, why: `unknown mode ${mode}` };
    const now = Date.now();
    const idx = nextCycleIndex(mode, last, key, now, win32.getRect(h));
    const target = toPixels(m.cycle[idx], work, gap);
    win32.place(h, target);
    last = { mode, hwnd: key, idx, at: now, rect: win32.getRect(h) };
    log('layout', mode, idx, fg.exe?.split('\\').pop(), target);
    return { ok: true, idx };
  }

  function preset(name) {
    const p = PRESETS[name];
    const fg = win32.foreground();
    if (!p || !fg) return { ok: false };
    const { work } = win32.workAreaOf(fg.hwnd);
    const sameMon = (w) => { const a = win32.workAreaOf(w.hwnd).work; return a.x === work.x && a.y === work.y; };
    const wins = win32.listWindows().filter(w => !/UlanziDeck\.exe$|^Ulanzi Studio$/i.test(w.exe) && win32.isResizable(w.hwnd) && sameMon(w)).slice(0, p.rects.length);
    wins.forEach((w, i) => win32.place(w.hwnd, toPixels(p.rects[i], work, gap)));
    if (wins[0]) win32.activate(wins[0].hwnd);
    log('preset', name, wins.map(w => w.exeName));
    return { ok: true, n: wins.length };
  }

  return { apply: (mode) => (PRESETS[mode] ? preset(mode) : snap(mode)) };
}
