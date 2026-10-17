// SVG key templates. The Ulanzi host accepts SVG data URLs via setBaseDataIcon,
// so every key is a small hand-written SVG (keep to SVG Tiny features: no filters/CSS).
import { areaChart, candles, rangeBar } from './charts.js';
import { mascot } from './mascot.js';

export const W = 144; // logical key size; exported at 196px
const FONT = "Segoe UI, Microsoft JhengHei, Noto Sans CJK TC, sans-serif";

// ---------------------------------------------------------------- themes

const BASE = {
  bg: '#0d1117', bg2: '#0d1117', panel: '#161b22', fg: '#e6edf3', dim: '#7d8590', faint: '#30363d',
  idle: '#3a3f47', thinking: '#1fa3b8', working: '#2d7ff9', done: '#f5a623',
  permission: '#ff2d2d', question: '#a259ff', plan: '#ff8a00', error: '#d6336c',
  ok: '#2ea043', warn: '#f5a623', bad: '#ff2d2d',
  twUp: '#ff3b30', twDown: '#2ea043', // Taiwan convention: red = up, green = down
  style: 'classic',
};

export const THEMES = {
  classic: { ...BASE },
  neon: {
    ...BASE, style: 'neon', bg: '#04050a', bg2: '#04050a', panel: '#0b0f1a', faint: '#1b2233', dim: '#6b7894', fg: '#f0f6ff',
    idle: '#3a4256', thinking: '#00e5d4', working: '#00b3ff', done: '#ffc400', permission: '#ff2a6d', question: '#c04dff',
    plan: '#ff7a00', error: '#ff2a6d', ok: '#39ff88', warn: '#ffc400', bad: '#ff2a6d', twUp: '#ff2a6d', twDown: '#39ff88',
  },
  glass: {
    ...BASE, style: 'glass', bg: '#0e1522', bg2: '#22324f', panel: '#1a2436', faint: '#2d3b55', dim: '#8b9ab5',
    working: '#4c8dff', thinking: '#3cc8dc', ok: '#3fbf6f', twDown: '#3fbf6f',
  },
};

/** Live palette. Mutated in place by setTheme() so every template picks it up. */
export const C = { ...THEMES.classic };
export function setTheme(name) { Object.assign(C, THEMES[name] || THEMES.classic); return C.style; }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function svg(body, { w = W, h = W, bg = C.bg } = {}) {
  const scale = 196 / W;
  let back = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  if (bg === C.bg && C.style === 'glass') {
    back = `<defs><linearGradient id="gbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient></defs>`
      + `<rect width="${w}" height="${h}" fill="url(#gbg)"/>`
      + `<rect x="3" y="3" width="${w - 6}" height="${h * 0.42}" rx="14" fill="#ffffff" fill-opacity="0.05"/>`;
  } else if (bg === C.bg && C.style === 'neon') {
    back += `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="10" fill="none" stroke="${C.faint}" stroke-width="2"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">${back}${body}</svg>`;
}

export const toDataUrl = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s, 'utf8').toString('base64');

/** Tint an already-rendered key (used by the full-panel alert wave). */
export function withOverlay(svgStr, color, opacity) {
  if (!(opacity > 0.01)) return svgStr;
  const vb = svgStr.match(/viewBox="0 0 (\d+) (\d+)"/);
  const [w, h] = vb ? [vb[1], vb[2]] : [W, W];
  return svgStr.replace(/<\/svg>$/, `<rect width="${w}" height="${h}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/></svg>`);
}

/** Alert wave: ring of radius 0.75·frame key-pitches; opacity by distance from the wavefront. */
export function waveOpacity(dist, frame, { speed = 0.75, width = 0.9, peak = 0.85 } = {}) {
  const r = frame * speed;
  return Math.max(0, 1 - Math.abs(dist - r) / width) * peak;
}

function text(x, y, str, { size = 16, fill = C.fg, anchor = 'middle', weight = 'normal' } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
}

/** Truncate to roughly `max` display columns (CJK counts double). */
export function fit(str, max) {
  let out = '', cols = 0;
  for (const ch of String(str ?? '')) {
    const w = /[ᄀ-￿]/.test(ch) ? 2 : 1;
    if (cols + w > max) return out + '…';
    out += ch; cols += w;
  }
  return out;
}

function arcPath(cx, cy, r, from, to) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(from), [x2, y2] = p(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Neon: fake a glow by stacking a wide translucent copy under the stroke. */
const glowStroke = (d, color, width) => (C.style === 'neon'
  ? `<path d="${d}" stroke="${color}" stroke-width="${width * 2.2}" stroke-opacity="0.22" fill="none" stroke-linecap="round"/>` : '');

/** 270° ring gauge, pct 0..100. */
function ring(cx, cy, r, pct, color, width = 12) {
  const start = Math.PI * 0.75, span = Math.PI * 1.5;
  const v = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  let out = `<path d="${arcPath(cx, cy, r, start, start + span)}" stroke="${C.faint}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
  if (v > 0.005) {
    const d = arcPath(cx, cy, r, start, start + span * v);
    out += glowStroke(d, color, width) + `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

function bar(x, y, w, h, pct, color) {
  const v = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  const fw = Math.max(h, w * v);
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${C.faint}"/>`;
  if (v > 0 && C.style === 'neon') out += `<rect x="${x - 2}" y="${y - 2}" width="${fw + 4}" height="${h + 4}" rx="${h / 2 + 2}" fill="${color}" fill-opacity="0.25"/>`;
  if (v > 0) out += `<rect x="${x}" y="${y}" width="${fw}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
  return out;
}

function sparkline(x, y, w, h, values, color) {
  if (!values || values.length < 2) return '';
  const n = values.length;
  const pts = values.map((v, i) => `${(x + (w * i) / (n - 1)).toFixed(1)},${(y + h - (h * Math.max(0, Math.min(100, v))) / 100).toFixed(1)}`);
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
}

export const levelColor = (pct) => (pct == null ? C.dim : pct >= 80 ? C.bad : pct >= 50 ? C.warn : C.ok);

export function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

// ---------------------------------------------------------------- Claude keys

const STATE_LABEL = {
  idle: 'IDLE', thinking: 'THINK', working: 'WORK', done: 'YOUR TURN', error: 'ERROR',
  waiting: { permission: 'APPROVE?', question: 'QUESTION', plan: 'PLAN OK?' },
};

export function stateColor(s) {
  if (!s) return C.idle;
  if (s.state === 'waiting') return C[s.kind] || C.permission;
  return C[s.state] || C.idle;
}

/** Waiting sessions blink; acked ones blink slower (handled by caller via phase). */
export const needsBlink = (s) => s && s.state === 'waiting';

export function sessionKey(slot, s, { phase = 0, now = Date.now() } = {}) {
  if (!s) {
    return svg(text(72, 66, `S${slot}`, { size: 30, fill: C.faint, weight: 'bold' }) + text(72, 96, 'no session', { size: 14, fill: C.faint }));
  }
  const col = stateColor(s);
  const flash = needsBlink(s) && phase % 2 === 1;
  const bg = flash ? '#ffffff' : s.state === 'waiting' ? col : C.bg;
  const fg = flash ? col : s.state === 'waiting' ? '#ffffff' : C.fg;
  const label = s.state === 'waiting' ? STATE_LABEL.waiting[s.kind] || 'WAITING' : STATE_LABEL[s.state];
  let body = '';
  if (s.state !== 'waiting') {
    if (C.style === 'neon') body += `<rect x="0" y="0" width="${W}" height="16" fill="${col}" fill-opacity="0.25"/>`;
    body += `<rect x="0" y="0" width="${W}" height="10" fill="${col}"/>`;
  }
  body += text(10, 34, `S${slot}`, { size: 16, fill: s.state === 'waiting' ? fg : C.dim, anchor: 'start', weight: 'bold' });
  body += text(134, 34, fmtDur(now - (s.waitingSince || s.since)), { size: 15, fill: s.state === 'waiting' ? fg : C.dim, anchor: 'end' });
  body += text(72, 72, fit(s.project, 11), { size: 22, fill: fg, weight: 'bold' });
  body += text(72, 102, label, { size: s.state === 'waiting' ? 22 : 18, fill: s.state === 'waiting' ? fg : col, weight: 'bold' });
  if (s.tool && (s.state === 'working' || s.state === 'waiting')) body += text(72, 124, fit(s.tool, 14), { size: 13, fill: s.state === 'waiting' ? fg : C.dim });
  if (s.ctxPct != null && s.state !== 'waiting') body += bar(10, 132, 124, 6, s.ctxPct, levelColor(s.ctxPct));
  return svg(body, { bg });
}

/** Which mood the HITL mascot shows. `event` = transient {mood, until}. */
export function mascotMood(waiting, counts, event, now = Date.now()) {
  if (waiting.length) return 'waiting';
  if (event && event.until > now) return event.mood;
  if ((counts.working || 0) + (counts.thinking || 0) > 0) return 'working';
  if (counts.error) return 'error';
  if (counts.done) return 'done';
  return 'idle';
}

export function hitlKey(waiting, counts, { phase = 0, frame = phase * 2, now = Date.now(), nag = false, wide = false, style = 'mascot', event = null } = {}) {
  if (wide) return hitlWide(waiting, counts, { phase, frame, now, nag, style, event });
  if (style === 'mascot') return hitlMascot(waiting, counts, { phase, frame, now, nag, event });
  const n = waiting.length;
  if (n === 0) {
    const done = counts.done || 0;
    let body = `<circle cx="72" cy="58" r="30" fill="none" stroke="${C.ok}" stroke-width="6"/>`
      + `<path d="M58 58 L68 68 L88 46" stroke="${C.ok}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      + text(72, 112, 'ALL CLEAR', { size: 18, fill: C.ok, weight: 'bold' });
    if (done) body += text(72, 134, `${done} your turn`, { size: 14, fill: C.done });
    return svg(body);
  }
  const top = waiting[0];
  const col = C[top.kind] || C.permission;
  const flash = phase % 2 === 1;
  const bg = flash ? '#ffffff' : col;
  const fg = flash ? col : '#ffffff';
  const body = text(72, 30, top.acked ? 'HITL (ack)' : 'HITL', { size: 16, fill: fg, weight: 'bold' })
    + text(72, 92, String(n), { size: 64, fill: fg, weight: 'bold' })
    + text(72, 118, fit(top.project, 12), { size: 15, fill: fg })
    + text(72, 136, `${fmtDur(now - top.waitingSince)}${nag ? ' 🔔' : ''}`, { size: 13, fill: fg });
  return svg(body, { bg });
}

function hitlMascot(waiting, counts, { phase, frame, now, nag, event }) {
  const mood = mascotMood(waiting, counts, event, now);
  const n = waiting.length;
  if (n) {
    const top = waiting[0];
    const col = C[top.kind] || C.permission;
    const flash = phase % 2 === 1;
    const bg = flash ? '#ffffff' : col, fg = flash ? col : '#ffffff';
    const body = mascot('waiting', frame, { cx: 72, top: 52, p: 7, accent: fg, fg })
      + `<circle cx="120" cy="24" r="17" fill="${fg}"/>` + text(120, 31, String(n), { size: 20, fill: bg, weight: 'bold' })
      + text(10, 26, top.acked ? 'ack' : 'HITL', { size: 14, fill: fg, anchor: 'start', weight: 'bold' })
      + text(72, 130, `${fit(top.project, 10)} ${fmtDur(now - top.waitingSince)}${nag ? '🔔' : ''}`, { size: 14, fill: fg, weight: 'bold' });
    return svg(body, { bg });
  }
  const caption = {
    idle: ['ALL CLEAR', C.ok], working: ['working…', C.working], done: [`${counts.done || 0} your turn`, C.done],
    celebrate: ['nice work!', C.done], love: ['thanks!', '#ff4d6d'], error: ['error', C.error],
  }[mood] || ['', C.dim];
  const body = mascot(mood, frame, { cx: 72, top: 50, p: 7, fg: C.dim }) + text(72, 132, caption[0], { size: 16, fill: caption[1], weight: 'bold' });
  return svg(body);
}

/** Wide (2x1) HITL banner: mascot/count + the waiting sessions by name. */
function hitlWide(waiting, counts, { phase, frame, now, nag, style, event }) {
  const w = W * 2, n = waiting.length;
  const useMascot = style === 'mascot';
  if (n === 0) {
    const mood = mascotMood(waiting, counts, event, now);
    const icon = useMascot ? mascot(mood, frame, { cx: 50, top: 46, p: 6, fg: C.dim })
      : `<circle cx="44" cy="72" r="26" fill="none" stroke="${C.ok}" stroke-width="6"/><path d="M32 72 L41 81 L58 62" stroke="${C.ok}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    return svg(icon
      + text(104, 68, 'ALL CLEAR', { size: 24, fill: C.ok, anchor: 'start', weight: 'bold' })
      + text(104, 96, counts.done ? `${counts.done} your turn` : 'no one waiting', { size: 16, fill: counts.done ? C.done : C.dim, anchor: 'start' }), { w });
  }
  const top = waiting[0];
  const col = C[top.kind] || C.permission;
  const flash = phase % 2 === 1;
  const bg = flash ? '#ffffff' : col, fg = flash ? col : '#ffffff';
  let body = useMascot
    ? mascot('waiting', frame, { cx: 48, top: 64, p: 6, accent: fg, fg }) + text(48, 136, `${n} waiting${nag ? ' 🔔' : ''}`, { size: 14, fill: fg, weight: 'bold' })
    : text(44, 96, String(n), { size: 72, fill: fg, weight: 'bold' }) + text(44, 126, nag ? 'HITL 🔔' : 'HITL', { size: 14, fill: fg, weight: 'bold' });
  waiting.slice(0, 3).forEach((s, i) => {
    body += text(100, 40 + i * 36, `S${s.slot ?? '?'} ${fit(s.project, 11)}`, { size: 18, fill: fg, anchor: 'start', weight: i === 0 ? 'bold' : 'normal' })
      + text(w - 10, 40 + i * 36, fmtDur(now - s.waitingSince), { size: 15, fill: fg, anchor: 'end' });
  });
  return svg(body, { w, bg });
}

export function usageKey(label, win, { now = Date.now(), staleMs = 15 * 60e3 } = {}) {
  if (!win || win.used_percentage == null) {
    return svg(ring(72, 72, 46, 0, C.faint) + text(72, 70, label, { size: 22, fill: C.dim, weight: 'bold' }) + text(72, 92, 'no data', { size: 13, fill: C.dim }));
  }
  const pct = win.used_percentage;
  const stale = now - (win.receivedAt || now) > staleMs;
  const col = stale ? C.dim : levelColor(pct);
  const reset = win.resets_at ? fmtDur(win.resets_at * 1000 - now) : '';
  const body = ring(72, 72, 46, pct, col)
    + text(72, 68, `${Math.round(pct)}%`, { size: 30, fill: stale ? C.dim : C.fg, weight: 'bold' })
    + text(72, 90, label, { size: 15, fill: C.dim, weight: 'bold' })
    + text(72, 132, stale ? `as of ${fmtDur(now - win.receivedAt)}` : reset ? `↻ ${reset}` : '', { size: 15, fill: stale ? C.dim : C.fg });
  return svg(body);
}

/** Wide (2x1) Claude fleet strip: sessions on the left, 5h/7d bars + burn rate on the right. */
export function usageWide(usage, sessions, { now = Date.now(), phase = 0 } = {}) {
  const w = W * 2;
  let body = '';
  // Left: up to 4 sessions.
  const list = sessions.slice(0, 4);
  if (!list.length) body += text(12, 30, 'Claude Code', { size: 17, anchor: 'start', weight: 'bold' }) + text(12, 56, 'no sessions', { size: 14, fill: C.dim, anchor: 'start' });
  list.forEach((s, i) => {
    const y = 10 + i * 32;
    const col = stateColor(s);
    const blinkOff = s.state === 'waiting' && phase % 2 === 1;
    body += `<rect x="8" y="${y + 4}" width="10" height="20" rx="3" fill="${blinkOff ? '#ffffff' : col}"/>`
      + text(24, y + 20, `S${s.slot ?? '?'}`, { size: 13, fill: C.dim, anchor: 'start', weight: 'bold' })
      + text(48, y + 20, fit(s.project, 10), { size: 15, anchor: 'start', fill: s.state === 'waiting' ? col : C.fg, weight: s.state === 'waiting' ? 'bold' : 'normal' })
      + text(158, y + 20, fmtDur(now - (s.waitingSince || s.since)), { size: 12, fill: C.dim, anchor: 'end' });
  });
  if (sessions.length > 4) body += text(158, 140, `+${sessions.length - 4}`, { size: 12, fill: C.dim, anchor: 'end' });
  body += `<rect x="166" y="10" width="1" height="124" fill="${C.faint}"/>`;
  // Right: usage bars.
  const row = (y, label, win) => {
    const pct = win?.used_percentage;
    return text(176, y, label, { size: 13, fill: C.dim, anchor: 'start', weight: 'bold' })
      + text(w - 8, y, pct == null ? '--' : `${Math.round(pct)}%`, { size: 15, anchor: 'end', weight: 'bold', fill: levelColor(pct) })
      + bar(176, y + 6, w - 184, 8, pct, levelColor(pct))
      + (win?.resets_at ? text(176, y + 28, `↻ ${fmtDur(win.resets_at * 1000 - now)}`, { size: 11, fill: C.dim, anchor: 'start' }) : '');
  };
  body += row(24, '5h', usage.five_hour) + row(76, '7d', usage.seven_day);
  const b = usage.burn;
  const burn = !b || b.status === 'unknown' ? ['pace …', C.dim]
    : b.status === 'danger' ? [`⚠ ${fmtDur(b.etaMs)} 到上限`, C.bad]
      : ['pace OK', C.ok];
  body += text(176, 136, burn[0], { size: 13, fill: burn[1], anchor: 'start', weight: 'bold' });
  return svg(body, { w });
}

// ---------------------------------------------------------------- other keys

export const trendColor = (change, colors) => (change > 0 ? (colors === 'us' ? C.twDown : C.twUp) : change < 0 ? (colors === 'us' ? C.twUp : C.twDown) : C.dim);
const upDown = (colors) => (colors === 'us' ? [C.twDown, C.twUp] : [C.twUp, C.twDown]);
const arrowOf = (change) => (change > 0 ? '▲' : change < 0 ? '▼' : '—');

export function stockKey(code, q, { colors = 'tw' } = {}) {
  if (!q) return svg(text(72, 60, fit(code, 9), { size: 24, weight: 'bold' }) + text(72, 92, 'loading…', { size: 14, fill: C.dim }));
  const col = trendColor(q.change, colors);
  const price = q.price == null ? '--' : fmtPrice(q.price) + (q.unit || '');
  const pct = `${q.pct > 0 ? '+' : ''}${(q.pct ?? 0).toFixed(2)}%`;
  let body = areaChart(0, 96, W, 42, q.series, col, 'sk', { baseline: q.prev }) // each key is its own SVG document, so a fixed id is safe;
  body += `<rect x="0" y="0" width="${W}" height="6" fill="${col}"/>`
    + text(10, 30, fit(q.name || code, 9), { size: 17, anchor: 'start', weight: 'bold' })
    + text(134, 30, q.open ? '' : '收', { size: 13, fill: C.dim, anchor: 'end' })
    + text(72, 66, price, { size: price.length > 7 ? 24 : 30, fill: col, weight: 'bold' })
    + text(72, 88, `${arrowOf(q.change)}${Math.abs(q.change ?? 0).toFixed(2)}  ${pct}`, { size: 15, fill: col, weight: 'bold' })
    + rangeBar(8, 139, W - 16, 3, q.dayLow, q.dayHigh, q.price, C.fg, C.faint);
  return svg(body);
}

/** Several quotes as rows (wide key: name · price · % · mini candlesticks). */
export function stockStrip(rows, { colors = 'tw', wide = true } = {}) {
  const w = wide ? W * 2 : W;
  const h = Math.min(48, (W - 4) / Math.max(1, rows.length));
  const [up, down] = upDown(colors);
  let body = '';
  rows.forEach((q, i) => {
    const top = 2 + i * h;
    const y = top + h / 2 + 6;
    const col = trendColor(q?.change, colors);
    const price = q?.price == null ? '--' : fmtPrice(q.price) + (q.unit || '');
    const pct = q?.pct == null ? '' : `${q.pct > 0 ? '+' : ''}${q.pct.toFixed(2)}%`;
    if (i) body += `<rect x="8" y="${top.toFixed(1)}" width="${w - 16}" height="1" fill="${C.faint}"/>`;
    body += `<rect x="0" y="${(top + 4).toFixed(1)}" width="5" height="${(h - 8).toFixed(1)}" fill="${col}"/>`;
    if (wide) {
      body += text(12, y - 8, fit(q?.name || q?.code, 8), { size: 15, anchor: 'start', weight: 'bold' })
        + text(12, y + 10, `${price} ${pct}`, { size: 13, fill: col, anchor: 'start', weight: 'bold' })
        + candles(132, top + 5, w - 140, h - 10, q?.candles, up, down);
    } else {
      body += text(12, y, fit(q?.name || q?.code, 6), { size: 14, anchor: 'start', weight: 'bold' })
        + text(W - 6, y, pct || price, { size: 14, fill: col, anchor: 'end', weight: 'bold' });
    }
  });
  return svg(body, { w });
}

const fmtPrice = (p) => (p >= 1000 ? p.toFixed(0) : p.toFixed(2)); // TW ticks: ≥1000 trade in whole dollars

export function sysKey(m) {
  if (!m) return svg(text(72, 76, 'SYS…', { size: 20, fill: C.dim }));
  const line = (y, label, pct, hist) => text(10, y, label, { size: 14, fill: C.dim, anchor: 'start', weight: 'bold' })
    + text(134, y, pct == null ? '--' : `${Math.round(pct)}%`, { size: 18, fill: levelColor(pct), anchor: 'end', weight: 'bold' })
    + bar(10, y + 6, 124, 6, pct, levelColor(pct))
    + sparkline(10, y - 26, 124, 22, hist, C.faint);
  let body = line(40, 'CPU', m.cpu, m.cpuHist) + line(84, 'RAM', m.mem, m.memHist);
  if (m.gpu != null) body += line(128, `GPU${m.gpuTemp != null ? ' ' + m.gpuTemp + '°' : ''}`, m.gpu, m.gpuHist);
  else body += text(72, 132, `${m.memUsedGb?.toFixed(1)}/${m.memTotalGb?.toFixed(0)} GB`, { size: 13, fill: C.dim });
  return svg(body);
}

export function wslKey(w, { confirm = false } = {}) {
  if (confirm) return svg(text(72, 56, 'wsl', { size: 18, fill: '#fff' }) + text(72, 84, '--shutdown?', { size: 18, fill: '#fff', weight: 'bold' }) + text(72, 116, 'press again', { size: 14, fill: '#fff' }), { bg: C.bad });
  if (!w) return svg(text(72, 76, 'WSL…', { size: 20, fill: C.dim }));
  const on = w.running?.length > 0;
  let body = `<circle cx="18" cy="24" r="7" fill="${on ? C.ok : C.idle}"/>`
    + text(32, 30, fit(w.distro || 'WSL', 10), { size: 15, anchor: 'start', weight: 'bold' });
  if (w.mem != null) {
    body += text(10, 62, 'MEM', { size: 13, fill: C.dim, anchor: 'start' }) + text(134, 62, `${Math.round(w.mem)}%`, { size: 16, anchor: 'end', fill: levelColor(w.mem), weight: 'bold' })
      + bar(10, 68, 124, 6, w.mem, levelColor(w.mem))
      + text(10, 100, 'LOAD', { size: 13, fill: C.dim, anchor: 'start' }) + text(134, 100, w.load?.toFixed(2) ?? '--', { size: 16, anchor: 'end', weight: 'bold' });
  } else {
    body += text(72, 84, on ? 'running' : 'stopped', { size: 18, fill: on ? C.ok : C.dim });
  }
  body += text(72, 132, `${w.running?.length || 0} running`, { size: 13, fill: C.dim });
  return svg(body);
}

export function iotKey(r) {
  if (!r) return svg(text(72, 76, 'IoT…', { size: 20, fill: C.dim }));
  const on = r.on;
  const col = on === true ? C.done : on === false ? C.idle : C.thinking;
  let body = `<rect x="0" y="0" width="${W}" height="8" fill="${col}"/>` + text(72, 36, fit(r.label, 12), { size: 15, fill: C.dim, weight: 'bold' });
  if (on !== undefined && r.value == null) body += text(72, 94, on ? 'ON' : 'OFF', { size: 36, fill: col, weight: 'bold' });
  else body += text(72, 92, `${r.value ?? '--'}${r.unit || ''}`, { size: 32, weight: 'bold' });
  if (r.sub) body += text(72, 126, r.sub, { size: 14, fill: C.dim });
  return svg(body);
}

/** Window-layout key: a mini screen with the target region highlighted. */
export function layoutKey(rects, label) {
  const sx = 18, sy = 22, sw = 108, sh = 70;
  let body = `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="6" fill="${C.panel}" stroke="${C.dim}" stroke-width="2"/>`;
  for (const r of rects) {
    const x = (sx + 4 + r.x * (sw - 8)).toFixed(1), y = (sy + 4 + r.y * (sh - 8)).toFixed(1);
    const ww = (r.w * (sw - 8) - 3).toFixed(1), hh = (r.h * (sh - 8) - 3).toFixed(1);
    if (C.style === 'neon') body += `<rect x="${x - 2}" y="${y - 2}" width="${+ww + 4}" height="${+hh + 4}" rx="4" fill="${C.working}" fill-opacity="0.25"/>`;
    body += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="3" fill="${C.working}"/>`;
  }
  body += text(72, 124, fit(label, 14), { size: 16, weight: 'bold' });
  return svg(body);
}

export function messageKey(title, sub, { bg = C.bg, fg = C.fg } = {}) {
  return svg(text(72, 70, fit(title, 12), { size: 20, fill: fg, weight: 'bold' }) + (sub ? text(72, 98, fit(sub, 16), { size: 14, fill: fg }) : ''), { bg });
}

// Shared drawing primitives for the extra pages (render-pages.js).
export { text, ring, bar, sparkline, esc };
