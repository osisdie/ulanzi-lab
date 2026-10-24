// Deck controller: maps key contexts → actions, renders them, handles presses.
// Output goes through a `sink` ({setIcon(ctx, dataUrl), toast(msg)}) so the same code
// drives the real Ulanzi device and the browser preview.
import { execFile, spawn } from 'node:child_process';
import * as R from './render.js';
import { IS_WIN, openSystemMonitor, openUrl } from './platform.js';
import { quoteUrl } from './providers/quotes.js';
import { previewRects, labelOf } from './layout.js';

const LONG_PRESS_MS = 800;
const TICK_MS = 250; // animation frame; the blink phase is every 2 ticks (500 ms)
const WAVE_FRAMES = 8; // full-panel alert wave length (2 s)

/** Panel position of a "col_row" key; the D200X wide key 3_2 spans columns 3–4. */
export function keyPos(key) {
  const [c, r] = String(key).split('_').map(Number);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  return { x: key === '3_2' ? 3.5 : c, y: r };
}

export function createDeck({ sessions, usage, quotes, sys, wsl, iot, layout, focuser, pages = null, play = () => {}, log = () => {}, now = () => Date.now() }) {
  const keys = new Map(); // ctx -> {action, settings, key, sinkId, last, downAt, confirmUntil, stockKey}
  const sinks = new Map(); // sinkId -> sink
  let tick = 0;
  let phase = 0;
  let wave = null; // { start: tick, slot, color }
  let mascotEvent = null; // { mood: 'celebrate'|'love', until }
  const waitStart = new Map(); // session id -> ms it started waiting (for "love")
  const workStart = new Map(); // session id -> ms it started working (for "celebrate")
  let hitlCursor = { at: 0, idx: 0 };
  const nag = { enabled: false, everyMs: 60e3, lastAt: 0 };
  // Demo mode: temporarily show simulated sessions on the session/HITL keys (real sessions untouched).
  let demo = null; // { until, slots: { [slot]: session } }
  const demoOn = () => demo && demo.until > now();
  const sessionAt = (slot) => (demoOn() ? demo.slots[slot] || null : sessions.bySlot(slot));
  const waitingNow = () => (demoOn()
    ? Object.values(demo.slots).filter(x => x.state === 'waiting').sort((a, b) => a.waitingSince - b.waitingSince)
    : sessions.waiting());
  const countsNow = () => {
    if (!demoOn()) return sessions.counts();
    const c = {};
    for (const x of Object.values(demo.slots)) c[x.state] = (c[x.state] || 0) + 1;
    return c;
  };

  const actionOf = (uuid) => String(uuid || '').split('.').pop();

  function add(sinkId, ctx, uuid, settings = {}, key = '') {
    const k = { action: actionOf(uuid), settings: { ...settings }, key: String(key), sinkId, last: null, active: true, ctx };
    if (k.action === 'session' && !k.settings.slot) {
      // New session key without a slot: take the lowest slot not already on a key of this device.
      const used = new Set([...keys.values()].filter(o => o.sinkId === sinkId && o.action === 'session').map(o => +o.settings.slot));
      k.settings.slot = [1, 2, 3, 4, 5, 6, 7, 8].find(n => !used.has(n)) || 1;
      sinks.get(sinkId)?.saveSettings?.(ctx, k.settings);
    }
    keys.set(ctx, k);
    bind(k);
    render(ctx, true);
  }

  function update(ctx, settings = {}) {
    const k = keys.get(ctx);
    if (!k) return;
    unbind(k);
    k.settings = { ...k.settings, ...settings };
    bind(k);
    render(ctx, true);
  }

  function remove(ctx) {
    const k = keys.get(ctx);
    if (k) unbind(k);
    keys.delete(ctx);
  }

  function bind(k) {
    if (k.action === 'stock') {
      // "code" may be a comma list → multi-row strip (e.g. "GC=F,SI=F,^TNX" on the wide key).
      k.stockKeys = String(k.settings.code || '2330').split(',').map(c => c.trim()).filter(Boolean).map(c => quotes.subscribe(c)).filter(Boolean);
    }
    if (k.action === 'hitl' && k.settings.nag != null) nag.enabled = k.settings.nag === true || k.settings.nag === 'on' || k.settings.nag === 'true';
    if (k.action === 'hitl' && k.settings.theme && k.settings.theme !== R.C.style) applyTheme(k.settings.theme);
    if (pages?.handles(k.action)) pages.bind(k);
  }

  function applyTheme(name) {
    const was = R.C.style;
    if (R.setTheme(name) !== was) { log('theme', name); setTimeout(() => renderAll(true), 0); }
  }
  function unbind(k) {
    if (k.action === 'stock') for (const key of k.stockKeys || []) quotes.unsubscribe(key);
    if (pages?.handles(k.action)) pages.unbind(k);
  }

  // ------------------------------------------------------------ render

  function svgFor(k) {
    const t = now();
    const s = k.settings;
    switch (k.action) {
      case 'session': {
        const slot = parseInt(s.slot, 10) || 1;
        return R.sessionKey(slot, sessionAt(slot), { phase, now: t });
      }
      case 'hitl': {
        const w = waitingNow();
        return R.hitlKey(w, countsNow(), { phase, frame: tick, now: t, nag: nag.enabled && w.some(x => !x.acked), wide: k.key === '3_2', style: s.style || 'mascot', event: mascotEvent });
      }
      case 'usage': {
        const win = s.window && s.window !== 'auto' ? s.window : k.key === '3_2' ? 'wide' : '5h';
        if (win === 'wide') return R.usageWide(usage.snapshot(), demoOn() ? Object.values(demo.slots) : sessions.list(), { now: t, phase });
        return R.usageKey(win === '7d' ? '7d' : '5h', win === '7d' ? usage.seven_day : usage.five_hour, { now: t });
      }
      case 'stock': {
        const labels = String(s.label || '').split(',').map(x => x.trim());
        const rows = (k.stockKeys || []).map((key, i) => { const q = quotes.get(key); return q && labels[i] ? { ...q, name: labels[i] } : q || { code: key, name: labels[i] || key }; });
        const opts = { colors: s.colors === 'us' ? 'us' : 'tw' };
        if (rows.length > 1 || k.key === '3_2') return R.stockStrip(rows, { ...opts, wide: k.key === '3_2' });
        return R.stockKey(s.code || '2330', rows[0]?.price !== undefined ? rows[0] : null, opts);
      }
      case 'wsl': return R.wslKey(wsl.get(), { confirm: k.confirmUntil > t });
      case 'iot': return R.iotKey(iot.get(s.device || 'mock.temp'));
      case 'layout': { const m = s.mode || 'left'; return R.layoutKey(previewRects(m), labelOf(m)); }
      case 'sys': return R.sysKey(sys.get());
      default: return (pages?.handles(k.action) && pages.render(k, { phase, tick, ctx: k.ctx })) || R.messageKey(k.action, 'unknown action');
    }
  }

  function render(ctx, force = false) {
    const k = keys.get(ctx);
    if (!k) return;
    let svg;
    try { svg = svgFor(k); } catch (e) { log('render error', k.action, e.stack); svg = R.messageKey('error', k.action); }
    if (wave && k.active) svg = R.withOverlay(svg, wave.color, waveAt(k));
    if (!force && svg === k.last) return;
    k.last = svg;
    sinks.get(k.sinkId)?.setIcon(ctx, R.toDataUrl(svg), svg);
  }

  /** Overlay opacity of the alert wave on key k (origin = that session's key, else HITL, else panel center). */
  function waveAt(k) {
    const p = keyPos(k.key);
    if (!p) return 0;
    const o = waveOrigin(k.sinkId);
    return R.waveOpacity(Math.hypot(p.x - o.x, p.y - o.y), tick - wave.start);
  }
  function waveOrigin(sinkId) {
    wave.origins ||= {};
    if (!wave.origins[sinkId]) {
      const mine = [...keys.values()].filter(o => o.sinkId === sinkId && o.active);
      const src = mine.find(o => o.action === 'session' && +o.settings.slot === wave.slot) || mine.find(o => o.action === 'hitl');
      wave.origins[sinkId] = (src && keyPos(src.key)) || { x: 2, y: 1 };
    }
    return wave.origins[sinkId];
  }
  function startWave(slot, kind) {
    wave = { start: tick, slot, color: R.C[kind] || R.C.permission };
  }

  const renderAll = (force = false) => { for (const ctx of keys.keys()) render(ctx, force); };
  const renderWhere = (pred) => { for (const [ctx, k] of keys) if (pred(k)) render(ctx); };

  // ------------------------------------------------------------ input

  function keyDown(ctx) { const k = keys.get(ctx); if (k) k.downAt = now(); }

  async function keyUp(ctx) {
    const k = keys.get(ctx);
    if (!k) return;
    const long = k.downAt && now() - k.downAt >= LONG_PRESS_MS;
    k.downAt = 0;
    try { await press(k, ctx, long); } catch (e) { log('press error', k.action, e.stack); }
  }

  async function press(k, ctx, long) {
    const s = k.settings;
    log('press', k.action, long ? 'long' : 'short', s);
    if (demoOn() && (k.action === 'session' || k.action === 'hitl')) { toast('demo mode: press ignored'); return; }
    switch (k.action) {
      case 'session': {
        const sess = sessions.bySlot(parseInt(s.slot, 10) || 1);
        if (!sess) return;
        if (long) { sessions.remove(sess.id); toast(`已移除 S${sess.slot} ${sess.project}`); return; }
        sessions.ack(sess.id);
        await focuser.focus(sess);
        return;
      }
      case 'hitl': {
        const w = sessions.waiting();
        if (long) { for (const x of w) sessions.ack(x.id); toast(`已確認 ${w.length} 個等待中的 session（停止提醒）`); return; }
        let target;
        if (w.length) {
          // Repeated presses within 5 s cycle through waiting sessions, oldest first.
          hitlCursor = now() - hitlCursor.at < 5000 ? { at: now(), idx: (hitlCursor.idx + 1) % w.length } : { at: now(), idx: 0 };
          target = w[hitlCursor.idx];
        } else {
          target = sessions.list().filter(x => x.state === 'done').sort((a, b) => b.since - a.since)[0];
        }
        if (target) { sessions.ack(target.id); await focuser.focus(target); }
        return;
      }
      case 'usage': return;
      case 'stock': {
        // Press: open the quote page (a strip opens its first symbol). Hold: refresh now.
        if (long) { quotes.refreshSoon(); toast('Quotes: refreshing…'); return; }
        const url = quoteUrl(k.stockKeys?.[0] || s.code || '2330');
        if (url) openUrl(url);
        return;
      }
      case 'sys': openSystemMonitor(); return;
      case 'wsl': {
        if (!IS_WIN) { toast('WSL is Windows-only'); return; }
        const distro = s.distro || wsl.distro;
        if (k.confirmUntil > now()) {
          k.confirmUntil = 0;
          execFile('wsl.exe', ['--shutdown'], { windowsHide: true }, () => wsl.tick());
          toast('wsl --shutdown');
        } else if (long) {
          k.confirmUntil = now() + 5000;
          toast('再按一次 WSL 鍵執行 wsl --shutdown（5 秒內）');
        } else {
          spawn('wt.exe', ['-w', '0', 'nt', '--title', distro, 'wsl.exe', '-d', distro, '--cd', '~'], { detached: true, stdio: 'ignore' }).unref();
        }
        render(ctx, true);
        return;
      }
      case 'iot': {
        const id = s.device || 'mock.temp';
        if (!(await iot.toggle(id))) await iot.refresh(id);
        return;
      }
      case 'layout': {
        const r = layout.apply(s.mode || 'left');
        if (!r.ok) log('layout failed', r.why);
        return;
      }
      default:
        if (pages?.handles(k.action)) { await pages.press(k, ctx, long); render(ctx, true); }
    }
  }

  // Focus mode (Pomodoro DND): keys still light up, but no toasts.
  function toast(msg, { force = false } = {}) { if (!force && pages?.quiet?.()) return; for (const sink of sinks.values()) sink.toast?.(msg); }

  // ------------------------------------------------------------ wiring

  sessions.on('change', (e) => {
    const t = now();
    if (e.type === 'state') {
      const s = sessions.get(e.id);
      const busy = (st) => st === 'working' || st === 'thinking';
      if (e.to === 'waiting') {
        waitStart.set(e.id, t);
        startWave(s?.slot, s?.kind);
        toast(`⚑ Claude 等你決定：S${s?.slot ?? '?'} ${s?.project ?? ''}（${s?.kind ?? ''}${s?.tool ? ' · ' + s.tool : ''}）`);
      }
      // Quick approval (< 5 s) earns a heart, like claude-desktop-buddy.
      if (e.from === 'waiting' && busy(e.to) && t - (waitStart.get(e.id) || 0) < 5000) mascotEvent = { mood: 'love', until: t + 2000 };
      if (busy(e.to) && !busy(e.from)) workStart.set(e.id, t);
      // A long job finishing earns confetti.
      if (e.to === 'done' && busy(e.from) && t - (workStart.get(e.id) || t) >= 3 * 60e3) mascotEvent = { mood: 'celebrate', until: t + 3000 };
    }
    if (e.type === 'removed') { waitStart.delete(e.id); workStart.delete(e.id); }
    renderWhere(k => k.action === 'session' || k.action === 'hitl' || (k.action === 'usage'));
  });
  usage.on('change', () => renderWhere(k => k.action === 'usage'));
  quotes.on('change', () => renderWhere(k => k.action === 'stock'));
  sys.on('change', () => renderWhere(k => k.action === 'sys'));
  wsl.on('change', () => renderWhere(k => k.action === 'wsl'));
  iot.on('change', () => renderWhere(k => k.action === 'iot'));
  for (const [src, action] of pages?.sources || []) src.on('change', () => renderWhere(k => k.action === action || (action === 'focus' && k.action === 'hitl')));
  sessions.on('change', () => renderWhere(k => k.action === 'prompt' || k.action === 'target'));

  // 250 ms frames: mascot + alert wave every tick; blink/clocks every 2 ticks. Only changed SVGs are sent.
  const timer = setInterval(() => {
    tick++;
    const half = tick % 2 === 0;
    if (half) phase++;
    if (wave && tick - wave.start > WAVE_FRAMES) { wave = null; renderAll(); return; }
    renderWhere(k => (wave && k.active)
      || (k.action === 'hitl' && (k.settings.style || 'mascot') === 'mascot')
      || (half && (k.action === 'session' || k.action === 'hitl' || k.action === 'usage' || k.action === 'wsl'))
      || (pages?.handles(k.action) && pages.animated(k, half)));
    if (half) maybeNag();
  }, TICK_MS);

  function maybeNag() {
    if (!nag.enabled || pages?.quiet?.()) return;
    const t = now();
    const due = sessions.waiting().filter(s => !s.acked && t - s.waitingSince >= nag.everyMs);
    if (!due.length || t - nag.lastAt < nag.everyMs) return;
    nag.lastAt = t;
    log('nag', due.map(s => s.project));
    play('waiting');
  }

  return {
    addSink: (id, sink) => sinks.set(id, sink),
    toast,
    add, update, remove, keyDown, keyUp, render, renderAll,
    pressNow: (ctx, long = false) => { const k = keys.get(ctx); return k && press(k, ctx, long); },
    contexts: () => [...keys.entries()].map(([ctx, k]) => ({ ctx, action: k.action, key: k.key, settings: k.settings, sinkId: k.sinkId })),
    svgOf: (ctx) => keys.get(ctx)?.last,
    nag,
    /** slots = { 1: session, ... } or null to stop; ms = how long to show it. */
    setDemo(slots, ms = 30e3) {
      demo = slots ? { until: now() + ms, slots } : null;
      const w = waitingNow();
      if (demo && w.length) startWave(w[0].slot, w[0].kind);
      renderWhere(k => k.action === 'session' || k.action === 'hitl' || k.action === 'usage');
    },
    setActive(ctx, active) { const k = keys.get(ctx); if (k) { k.active = active !== false; if (k.active) render(ctx, true); } },
    setTheme: (name) => applyTheme(name),
    theme: () => R.C.style,
    /** Test hook: fire a mascot event. */
    mascotEvent(mood, ms = 3000) { mascotEvent = { mood, until: now() + ms }; },
    stop: () => { clearInterval(timer); pages?.stop?.(); },
  };
}
