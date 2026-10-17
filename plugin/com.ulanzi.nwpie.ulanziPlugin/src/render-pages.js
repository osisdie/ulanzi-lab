// Key templates for the extra pages: Media/Audio, Focus, Hardware, DevOps, Claude command pad.
import { W, C, svg, fit, fmtDur, levelColor, text, ring, bar, sparkline, esc } from './render.js';
import { areaChart } from './charts.js';
import { mascot } from './mascot.js';

const W2 = W * 2;

// ---------------------------------------------------------------- small glyphs

const tri = (x, y, s, dir, fill) => (dir > 0
  ? `<path d="M${x} ${y - s} L${x + s * 1.6} ${y} L${x} ${y + s} Z" fill="${fill}"/>`
  : `<path d="M${x} ${y - s} L${x - s * 1.6} ${y} L${x} ${y + s} Z" fill="${fill}"/>`);
const pauseGlyph = (cx, cy, s, fill) => `<rect x="${cx - s}" y="${cy - s * 1.2}" width="${s * 0.7}" height="${s * 2.4}" rx="2" fill="${fill}"/><rect x="${cx + s * 0.3}" y="${cy - s * 1.2}" width="${s * 0.7}" height="${s * 2.4}" rx="2" fill="${fill}"/>`;
const speaker = (x, y, s, fill) => `<path d="M${x} ${y - s * 0.45} h${s * 0.5} l${s * 0.7} ${-s * 0.6} v${s * 2.1} l${-s * 0.7} ${-s * 0.6} h${-s * 0.5} Z" fill="${fill}"/>`;
const micGlyph = (cx, cy, s, fill) => `<rect x="${cx - s * 0.45}" y="${cy - s * 1.2}" width="${s * 0.9}" height="${s * 1.6}" rx="${s * 0.45}" fill="${fill}"/>`
  + `<path d="M${cx - s * 0.85} ${cy - s * 0.1} a${s * 0.85} ${s * 0.85} 0 0 0 ${s * 1.7} 0" stroke="${fill}" stroke-width="${s * 0.18}" fill="none"/>`
  + `<rect x="${cx - s * 0.09}" y="${cy + s * 0.75}" width="${s * 0.18}" height="${s * 0.5}" fill="${fill}"/>`;
const slash = (cx, cy, s, color) => `<path d="M${cx - s} ${cy + s} L${cx + s} ${cy - s}" stroke="${color}" stroke-width="${s * 0.22}" stroke-linecap="round"/>`;
const badge = (x, y, label, fill, fg = '#fff') => `<rect x="${x}" y="${y}" width="${label.length * 9 + 14}" height="22" rx="11" fill="${fill}"/>` + text(x + (label.length * 9 + 14) / 2, y + 16, label, { size: 13, fill: fg, weight: 'bold' });
const mmss = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const image = (x, y, w, h, href) => `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" xlink:href="${esc(href)}" href="${esc(href)}"/>`;
const withXlink = (s) => s.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');

export function fmtRate(bps) {
  if (!Number.isFinite(bps)) return '--';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = bps, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)}${u[i]}/s`;
}
export const fmtBytes = (b) => (Number.isFinite(b) ? (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)}G` : `${(b / 2 ** 20).toFixed(0)}M`) : '--');
const appName = (id = '') => (/spotify/i.test(id) ? 'Spotify' : /chrome/i.test(id) ? 'Chrome' : /msedge|edge/i.test(id) ? 'Edge' : /firefox/i.test(id) ? 'Firefox' : (id.split(/[\\!.]/).filter(Boolean).pop() || 'Media'));

// ---------------------------------------------------------------- media / audio

export function mediaKey(part, st, { now = Date.now(), position = null, wide = false } = {}) {
  const m = st.media || {};
  const a = st.audio || {};
  const accent = st.art?.accent || C.working;
  const playing = m.status === 'Playing';
  switch (part) {
    case 'art': {
      if (!m.active) return svg(text(72, 70, '♪', { size: 56, fill: C.faint }) + text(72, 120, 'nothing playing', { size: 13, fill: C.dim }));
      const body = (st.art?.dataUrl ? image(0, 0, W, W, st.art.dataUrl) : text(72, 82, '♪', { size: 64, fill: accent }))
        + `<rect x="0" y="108" width="${W}" height="36" fill="#000" fill-opacity="0.55"/>` + text(72, 132, fit(m.title, 14), { size: 15, fill: '#fff', weight: 'bold' })
        + (playing ? '' : `<rect x="0" y="0" width="${W}" height="108" fill="#000" fill-opacity="0.35"/>` + pauseGlyph(72, 56, 14, '#fff'));
      return withXlink(svg(body));
    }
    case 'prev': return svg(tri(84, 66, 18, -1, C.fg) + tri(112, 66, 18, -1, C.fg) + `<rect x="34" y="48" width="6" height="36" fill="${C.fg}"/>` + text(72, 126, 'prev', { size: 14, fill: C.dim }));
    case 'next': return svg(tri(32, 66, 18, 1, C.fg) + tri(60, 66, 18, 1, C.fg) + `<rect x="104" y="48" width="6" height="36" fill="${C.fg}"/>` + text(72, 126, 'next', { size: 14, fill: C.dim }));
    case 'play': {
      const body = `<circle cx="72" cy="64" r="40" fill="${playing ? accent : C.panel}"/>` + (playing ? pauseGlyph(72, 64, 12, '#fff') : tri(62, 64, 18, 1, C.fg))
        + text(72, 128, m.active ? (playing ? 'playing' : 'paused') : 'idle', { size: 14, fill: C.dim });
      return svg(body);
    }
    case 'vol': {
      if (!a || a.volume == null) return svg(text(72, 76, 'VOL…', { size: 18, fill: C.dim }));
      const col = a.muted ? C.bad : accent;
      return svg(ring(72, 70, 44, a.muted ? 100 : a.volume, col, 10) + speaker(56, 62, 18, a.muted ? C.bad : C.fg)
        + (a.muted ? slash(72, 64, 22, C.bad) : '') + text(72, 132, a.muted ? 'MUTED' : `${a.volume}%`, { size: 18, fill: a.muted ? C.bad : C.fg, weight: 'bold' }));
    }
    case 'voldown':
    case 'volup': {
      const up = part === 'volup';
      return svg(speaker(36, 58, 22, C.fg) + text(104, 74, up ? '+' : '−', { size: 46, weight: 'bold' })
        + bar(16, 112, 112, 8, a?.volume ?? 0, accent) + text(72, 136, a?.volume != null ? `${a.volume}%` : '', { size: 12, fill: C.dim }));
    }
    case 'mic': {
      if (a?.micMuted == null) return svg(micGlyph(72, 58, 30, C.faint) + text(72, 126, 'no mic', { size: 14, fill: C.dim }));
      const off = a.micMuted;
      const bg = off ? C.bad : C.bg;
      return svg(micGlyph(72, 56, 30, off ? '#fff' : C.ok) + (off ? slash(72, 56, 30, '#fff') : '')
        + text(72, 126, off ? 'MIC OFF' : 'MIC LIVE', { size: 18, fill: off ? '#fff' : C.ok, weight: 'bold' }), { bg });
    }
    case 'output': {
      const def = (a?.outputs || []).find(o => o.isDefault);
      const head = /head|耳機|buds|airpods/i.test(def?.name || '');
      const glyph = head
        ? `<path d="M40 76 a32 32 0 0 1 64 0" stroke="${C.fg}" stroke-width="7" fill="none"/><rect x="32" y="72" width="16" height="26" rx="5" fill="${C.fg}"/><rect x="96" y="72" width="16" height="26" rx="5" fill="${C.fg}"/>`
        : speaker(52, 66, 24, C.fg) + `<path d="M96 52 a22 22 0 0 1 0 32" stroke="${C.fg}" stroke-width="5" fill="none"/>`;
      return svg(glyph + text(72, 124, fit((def?.name || 'output').replace(/\s*\(.*\)$/, ''), 14), { size: 14, weight: 'bold' })
        + text(72, 140, `${(a?.outputs || []).length} devices`, { size: 11, fill: C.dim }));
    }
    case 'spotify': return svg(`<circle cx="72" cy="62" r="38" fill="#1db954"/>` + [0, 1, 2].map(i => `<path d="M${50 + i * 3} ${50 + i * 12} q22 -8 44 2" stroke="#000" stroke-width="${6 - i}" fill="none" stroke-linecap="round"/>`).join('') + text(72, 128, 'Spotify', { size: 15, weight: 'bold' }));
    case 'ytmusic': return svg(`<circle cx="72" cy="62" r="38" fill="#ff0033"/><circle cx="72" cy="62" r="22" fill="none" stroke="#fff" stroke-width="4"/>` + tri(66, 62, 10, 1, '#fff') + text(72, 128, 'YT Music', { size: 15, weight: 'bold' }));
    case 'wide':
    default: {
      if (!m.active) return svg(text(24, 78, '♪  Nothing playing', { size: 22, fill: C.dim, anchor: 'start' }) + text(24, 104, 'Spotify · YouTube Music · any media app', { size: 13, fill: C.faint, anchor: 'start' }), { w: W2 });
      const pos = position ?? m.position ?? 0;
      const pct = m.duration ? (pos / m.duration) * 100 : 0;
      let body = st.art?.dataUrl ? image(0, 0, W, W, st.art.dataUrl) : `<rect width="${W}" height="${W}" fill="${C.panel}"/>` + text(72, 90, '♪', { size: 64, fill: accent });
      body += `<rect x="${W}" y="0" width="${W}" height="${W}" fill="${accent}" fill-opacity="0.16"/>`
        + text(W + 10, 30, appName(m.app), { size: 12, fill: accent, anchor: 'start', weight: 'bold' })
        + text(W + 10, 56, fit(m.title, 15), { size: 17, anchor: 'start', weight: 'bold' })
        + text(W + 10, 78, fit(m.artist, 17), { size: 14, fill: C.dim, anchor: 'start' })
        + bar(W + 10, 104, W - 20, 7, pct, accent)
        + text(W + 10, 130, m.duration ? mmss(pos) : '', { size: 12, fill: C.dim, anchor: 'start' })
        + text(W2 - 10, 130, m.duration ? mmss(m.duration) : '', { size: 12, fill: C.dim, anchor: 'end' })
        + (playing ? '' : pauseGlyph(W2 - 26, 30, 7, C.dim));
      return withXlink(svg(body, { w: W2 }));
    }
  }
}

// ---------------------------------------------------------------- focus / pomodoro

const PHASE = { idle: ['READY', '#ff6347'], focus: ['FOCUS', '#ff6347'], break: ['BREAK', '#2ea043'], long: ['LONG BREAK', '#1fa3b8'] };
const tomato = (cx, cy, r, fill = '#ff6347') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><path d="M${cx - r * 0.5} ${cy - r * 0.85} q${r * 0.5} ${r * 0.35} ${r} 0" stroke="#2ea043" stroke-width="${Math.max(2, r * 0.25)}" fill="none" stroke-linecap="round"/>`;

export function focusKey(part, p, { now = Date.now(), frame = 0, wide = false } = {}) {
  const s = p.s;
  const [label, col] = PHASE[s.phase] || PHASE.idle;
  const rem = p.remaining() / 1000;
  const live = s.running ? col : C.dim;
  switch (part) {
    case 'timer':
      return svg(ring(72, 66, 46, s.phase === 'idle' ? 0 : p.progress() * 100, live, 10)
        + text(72, 74, mmss(rem), { size: 28, weight: 'bold', fill: s.running ? C.fg : C.dim })
        + text(72, 132, s.phase === 'idle' ? '▶ start' : s.running ? label : '⏸ paused', { size: 15, fill: live, weight: 'bold' }));
    case 'reset': return svg(`<path d="M44 72 a28 28 0 1 0 8 -20" stroke="${C.fg}" stroke-width="7" fill="none" stroke-linecap="round"/>` + tri(46, 50, 9, -1, C.fg) + text(72, 130, 'reset', { size: 14, fill: C.dim }));
    case 'plus': return svg(text(72, 82, '+5', { size: 48, weight: 'bold', fill: s.phase === 'idle' ? C.faint : C.fg }) + text(72, 126, 'minutes', { size: 14, fill: C.dim }));
    case 'length': return svg(tomato(72, 52, 26) + text(72, 112, `${s.focusMin} min`, { size: 22, weight: 'bold' }) + text(72, 134, 'focus length', { size: 12, fill: C.dim }));
    case 'break': return svg(`<path d="M44 44 h48 v26 a24 24 0 0 1 -48 0 Z" fill="${PHASE.break[1]}"/><path d="M92 50 h8 a10 10 0 0 1 0 20 h-8" stroke="${PHASE.break[1]}" stroke-width="5" fill="none"/><path d="M56 26 q6 6 0 12 M70 24 q6 6 0 12" stroke="${C.dim}" stroke-width="3" fill="none"/>` + text(72, 116, `${s.breakMin} min`, { size: 20, weight: 'bold', fill: PHASE.break[1] }) + text(72, 136, 'break', { size: 12, fill: C.dim }));
    case 'long': return svg(`<path d="M84 30 a30 30 0 1 0 22 48 a24 24 0 1 1 -22 -48 Z" fill="${PHASE.long[1]}"/>` + text(72, 116, `${s.longMin} min`, { size: 20, weight: 'bold', fill: PHASE.long[1] }) + text(72, 136, 'long break', { size: 12, fill: C.dim }));
    case 'count': {
      const n = p.today();
      let body = text(72, 30, 'TODAY', { size: 14, fill: C.dim, weight: 'bold' });
      for (let i = 0; i < Math.min(8, Math.max(n, s.goal)); i++) body += tomato(22 + (i % 4) * 33, 56 + Math.floor(i / 4) * 32, 11, i < n ? '#ff6347' : C.faint);
      body += text(72, 134, `${n} / ${s.goal}`, { size: 18, weight: 'bold', fill: n >= s.goal ? C.ok : C.fg });
      return svg(body);
    }
    case 'dnd': {
      const on = s.dnd;
      const bell = `<path d="M50 88 v-22 a22 22 0 0 1 44 0 v22 l8 8 h-60 Z" fill="${on ? C.done : C.fg}"/><circle cx="72" cy="104" r="6" fill="${on ? C.done : C.fg}"/>`;
      return svg(bell + (on ? slash(72, 74, 30, C.bad) : '') + text(72, 132, on ? 'DND on focus' : 'DND off', { size: 14, fill: on ? C.done : C.dim, weight: 'bold' }));
    }
    case 'mascot': {
      const mood = s.phase === 'focus' && s.running ? 'working' : s.phase === 'break' || s.phase === 'long' ? 'done' : 'idle';
      return svg(mascot(mood, frame, { cx: 72, top: 46, p: 7, fg: C.dim }) + text(72, 132, mood === 'working' ? 'focusing…' : mood === 'done' ? 'stretch!' : 'ready', { size: 15, fill: col, weight: 'bold' }));
    }
    case 'clock': {
      const d = new Date(now);
      const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
      return svg(text(72, 70, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, { size: 38, weight: 'bold' })
        + text(72, 102, `${d.getMonth() + 1}/${d.getDate()} 週${wd}`, { size: 17, fill: C.dim }));
    }
    case 'week': {
      const w = p.week();
      const max = Math.max(s.goal, ...w.map(x => x.count));
      let body = text(72, 24, 'THIS WEEK', { size: 13, fill: C.dim, weight: 'bold' });
      w.forEach((x, i) => {
        const h = (x.count / max) * 80;
        body += `<rect x="${14 + i * 17}" y="${(116 - h).toFixed(1)}" width="12" height="${Math.max(2, h).toFixed(1)}" rx="3" fill="${i === 6 ? '#ff6347' : C.working}"/>`
          + text(20 + i * 17, 134, ['日', '一', '二', '三', '四', '五', '六'][new Date(x.day).getDay()], { size: 10, fill: C.dim });
      });
      return svg(body);
    }
    case 'wide':
    default: {
      let body = ring(72, 72, 54, s.phase === 'idle' ? 0 : p.progress() * 100, live, 14)
        + text(72, 82, mmss(rem), { size: 32, weight: 'bold', fill: s.running ? C.fg : C.dim })
        + text(W + 4, 40, label, { size: 24, weight: 'bold', fill: live, anchor: 'start' })
        + text(W + 4, 66, s.running ? `ends ${new Date(s.endsAt).toTimeString().slice(0, 5)}` : s.phase === 'idle' ? `${s.focusMin} min block` : 'paused', { size: 15, fill: C.dim, anchor: 'start' });
      const n = p.today();
      for (let i = 0; i < Math.min(8, Math.max(n, s.goal)); i++) body += tomato(W + 14 + i * 16, 98, 6, i < n ? '#ff6347' : C.faint);
      body += text(W + 4, 132, `${n}/${s.goal} today${p.quiet() ? ' · DND' : ''}`, { size: 14, anchor: 'start', fill: C.dim });
      return svg(body, { w: W2 });
    }
  }
}

// ---------------------------------------------------------------- hardware

export function hwKey(metric, m, { disk = 'C:' } = {}) {
  if (!m || m.cpu == null) return svg(text(72, 76, 'HW…', { size: 20, fill: C.dim }));
  const gauge = (label, pct, sub, hist) => svg(ring(72, 66, 44, pct, levelColor(pct), 10)
    + text(72, 64, pct == null ? '--' : `${Math.round(pct)}%`, { size: 26, weight: 'bold' }) + text(72, 86, label, { size: 13, fill: C.dim, weight: 'bold' })
    + (hist ? sparkline(14, 112, 116, 22, hist, C.faint) : '') + text(72, 136, sub || '', { size: 12, fill: C.dim }));
  switch (metric) {
    case 'cpu': return gauge('CPU', m.cpu, `${m.cores.length} threads`, m.hist.cpu);
    case 'ram': return gauge('RAM', m.ram, `${fmtBytes(m.ramUsed)} / ${fmtBytes(m.ramTotal)}`, m.hist.ram);
    case 'gpu': return gauge('GPU', m.gpu, m.lhm?.gpuTemp != null ? `${Math.round(m.lhm.gpuTemp)}°C` : '3D engine', m.hist.gpu);
    case 'cores': {
      const n = m.cores.length || 1, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cw = 124 / cols, ch = 96 / rows;
      let body = text(72, 22, `CORES · ${Math.round(m.cpu)}%`, { size: 13, fill: C.dim, weight: 'bold' });
      m.cores.forEach((v, i) => {
        const x = 10 + (i % cols) * cw, y = 32 + Math.floor(i / cols) * ch;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cw - 3).toFixed(1)}" height="${(ch - 3).toFixed(1)}" rx="3" fill="${levelColor(v)}" fill-opacity="${(0.25 + (v / 100) * 0.75).toFixed(2)}"/>`;
      });
      return svg(body);
    }
    case 'vram': return svg(text(72, 30, 'VRAM', { size: 14, fill: C.dim, weight: 'bold' }) + text(72, 82, fmtBytes(m.vram), { size: 32, weight: 'bold' }) + text(72, 120, 'dedicated in use', { size: 12, fill: C.dim }));
    case 'disk': {
      const d = m.disks.find(x => x.name.toLowerCase() === String(disk).toLowerCase()) || m.disks[0];
      if (!d) return svg(text(72, 76, 'no disk', { size: 16, fill: C.dim }));
      return svg(text(12, 30, `DISK ${d.name}`, { size: 15, anchor: 'start', weight: 'bold' }) + text(132, 30, `${Math.round(d.pct)}%`, { size: 15, anchor: 'end', fill: levelColor(d.pct), weight: 'bold' })
        + bar(12, 44, 120, 14, d.pct, levelColor(d.pct)) + text(72, 92, `${fmtBytes(d.total - d.used)} free`, { size: 18, weight: 'bold' }) + text(72, 116, `of ${fmtBytes(d.total)}`, { size: 13, fill: C.dim }));
    }
    case 'netdown':
    case 'netup': {
      const down = metric === 'netdown';
      const v = down ? m.netIn : m.netOut, hist = down ? m.hist.netIn : m.hist.netOut;
      const max = Math.max(1, ...hist);
      return svg(text(12, 30, down ? '▼ DOWN' : '▲ UP', { size: 14, anchor: 'start', weight: 'bold', fill: down ? C.ok : C.working })
        + text(72, 74, fmtRate(v), { size: 22, weight: 'bold' }) + areaChart(0, 92, W, 48, hist.map(x => (x / max) * 100), down ? C.ok : C.working, 'nw', { baseline: 0 }));
    }
    case 'diskio': return svg(text(12, 30, 'DISK I/O', { size: 14, anchor: 'start', weight: 'bold' }) + text(132, 30, `${Math.round(m.diskBusy ?? 0)}%`, { size: 14, anchor: 'end', fill: levelColor(m.diskBusy), weight: 'bold' })
      + text(12, 70, `R ${fmtRate(m.diskRead)}`, { size: 16, anchor: 'start' }) + text(12, 100, `W ${fmtRate(m.diskWrite)}`, { size: 16, anchor: 'start' }) + bar(12, 118, 120, 8, m.diskBusy, levelColor(m.diskBusy)));
    case 'uptime': {
      const s = m.uptime || 0;
      return svg(text(72, 34, 'UPTIME', { size: 14, fill: C.dim, weight: 'bold' }) + text(72, 82, `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`, { size: 30, weight: 'bold' }) + text(72, 112, `${Math.floor((s % 3600) / 60)} min`, { size: 14, fill: C.dim }));
    }
    case 'temps': {
      if (!m.lhm) return svg(`<rect x="66" y="20" width="12" height="44" rx="6" fill="none" stroke="${C.dim}" stroke-width="3"/><circle cx="72" cy="70" r="10" fill="${C.bad}"/><rect x="70" y="40" width="4" height="28" fill="${C.bad}"/>` + text(72, 98, 'temps need', { size: 13, fill: C.dim }) + text(72, 116, 'LibreHardware', { size: 13, fill: C.dim }) + text(72, 134, 'Monitor :8085', { size: 13, fill: C.dim }));
      const t = m.lhm.cpuTemp;
      return svg(text(72, 30, 'CPU TEMP', { size: 14, fill: C.dim, weight: 'bold' }) + text(72, 80, t != null ? `${Math.round(t)}°` : '--', { size: 40, weight: 'bold', fill: t > 85 ? C.bad : t > 70 ? C.warn : C.ok })
        + text(72, 112, m.lhm.gpuTemp != null ? `GPU ${Math.round(m.lhm.gpuTemp)}°` : '', { size: 14, fill: C.dim }) + text(72, 132, m.lhm.fan != null ? `fan ${Math.round(m.lhm.fan)} rpm` : '', { size: 12, fill: C.dim }));
    }
    case 'wide':
    default: {
      const maxNet = Math.max(1, ...m.hist.netIn, ...m.hist.netOut);
      const row = (y, label, val, hist, col, scale = 1) => text(10, y + 14, label, { size: 13, fill: C.dim, anchor: 'start', weight: 'bold' })
        + text(W2 - 8, y + 14, val, { size: 14, anchor: 'end', weight: 'bold', fill: col })
        + areaChart(54, y, W2 - 130, 30, hist.map(x => x * scale), col, `w${y}`, { baseline: 0 });
      return svg(row(8, 'CPU', `${Math.round(m.cpu)}%`, m.hist.cpu, levelColor(m.cpu))
        + row(52, 'GPU', m.gpu == null ? '--' : `${Math.round(m.gpu)}%`, m.hist.gpu, C.thinking)
        + row(96, 'NET', `${fmtRate(m.netIn)}`, m.hist.netIn, C.ok, 100 / maxNet), { w: W2 });
    }
  }
}

// ---------------------------------------------------------------- devops

const CI = { success: C.ok, failure: C.bad, error: C.bad, pending: C.warn, expected: C.warn, none: C.dim, running: C.warn, failed: C.bad, canceled: C.dim, skipped: C.dim, created: C.dim };
const ciColor = (s) => CI[String(s || 'none').toLowerCase()] || C.dim;
const STATUS = { none: ['OK', 'ok'], minor: ['MINOR', 'warn'], major: ['MAJOR', 'bad'], critical: ['DOWN', 'bad'], maintenance: ['MAINT', 'warn'], unknown: ['?', 'dim'] };

const GITLAB = `<path d="M22 40 L30 16 L36 34 L52 34 L58 16 L66 40 L44 56 Z" fill="#fc6d26"/>`;
const GITHUB = () => `<circle cx="38" cy="32" r="18" fill="${C.fg}"/><path d="M28 44 q10 -8 20 0 v6 h-20 Z" fill="${C.bg}"/><circle cx="32" cy="30" r="3" fill="${C.bg}"/><circle cx="44" cy="30" r="3" fill="${C.bg}"/>`;
const brandOf = (forge) => (forge === 'github' ? GITHUB() : GITLAB);
/** "MR" on GitLab, "PR" on GitHub. */
export const crWord = (forge) => (forge === 'github' ? 'PR' : 'MR');
const loginHint = (forge) => (forge === 'github' ? 'gh auth login' : 'glab auth login');

/** Old per-forge kind names still work (keys placed before the forge-neutral names). */
export const KIND_ALIASES = { 'gl-mrs': 'cr-mine', 'gh-prs': 'cr-mine', 'gl-reviews': 'cr-reviews', 'gh-reviews': 'cr-reviews' };

/** Review board keys: totals (mr-total/ci/conflict/stale), one repo per mr-repo slot, and the problem list (mr-wide). */
export function mrKey(kind, b, { slot = 0, phase = 0 } = {}) {
  const wide = kind === 'mr-wide';
  const w = wide ? W2 : W;
  const forge = b?.forge || 'gitlab';
  const word = crWord(forge);
  if (!b) return svg(GITLAB + text(w / 2, 100, 'loading…', { size: 14, fill: C.dim }), { w });
  if (b.error) return svg(brandOf(forge) + text(w / 2, 100, `${forge === 'github' ? 'gh' : 'glab'} failed`, { size: 14, fill: C.warn, weight: 'bold' }) + text(w / 2, 122, 'hold: retry', { size: 12, fill: C.dim }), { w });
  const counter = (title, n, col, sub, flash) => svg(`<rect x="0" y="0" width="${W}" height="8" fill="${n ? col : C.ok}"/>`
    + text(72, 34, title, { size: 13, fill: C.dim, weight: 'bold' })
    + text(72, 92, String(n), { size: 50, weight: 'bold', fill: n ? col : C.ok })
    + text(72, 126, fit(sub, 16), { size: 12, fill: C.dim }), { bg: flash ? '#3a0d0d' : C.bg });
  const ref = (m) => `${m.name} ${forge === 'github' ? '#' : '!'}${m.iid}`;
  switch (kind) {
    case 'mr-total':
      return svg(brandOf(forge) + text(132, 34, `OPEN ${word}s`, { size: 12, fill: C.dim, anchor: 'end', weight: 'bold' })
        + text(72, 98, String(b.total), { size: 50, weight: 'bold' })
        + text(72, 126, `${b.repos.length} repos · ${b.oldest}d oldest`, { size: 12, fill: C.dim }));
    case 'mr-ci': {
      const first = b.problems.find(m => m.ci === 'failed');
      return counter('CI FAILED', b.ciFailed, C.bad, first ? ref(first) : 'all green', b.ciFailed > 0 && phase % 2 === 1);
    }
    case 'mr-conflict': {
      const first = b.problems.find(m => m.conflict);
      return counter('CONFLICTS', b.conflicts, C.warn, first ? ref(first) : 'none', false);
    }
    case 'mr-stale': {
      const first = b.stalest[0];
      return counter(`IDLE ≥7d`, b.stale, C.warn, first ? `${first.name} · ${first.idle}d` : 'all active', false);
    }
    case 'mr-repo': {
      const r = b.repos[slot];
      if (!r) return svg(text(72, 80, '—', { size: 24, fill: C.faint }));
      const col = r.ciFailed ? C.bad : r.conflicts ? C.warn : r.ci === 'success' ? C.ok : C.dim;
      let chips = '', x = 10;
      const chip = (label, fill) => { chips += badge(x, 104, label, fill); x += label.length * 9 + 18; };
      if (r.ciFailed) chip(`CI✕${r.ciFailed}`, C.bad);
      if (r.conflicts) chip(`⚠${r.conflicts}`, C.warn);
      if (!r.ciFailed && !r.conflicts) chips += text(72, 120, `${r.oldest}d oldest`, { size: 12, fill: C.dim });
      return svg(`<rect x="0" y="0" width="${W}" height="8" fill="${col}"/>` + text(72, 34, fit(r.name, 13), { size: 14, weight: 'bold' })
        + text(72, 88, String(r.open), { size: 42, weight: 'bold', fill: col === C.dim ? C.fg : col }) + chips,
        { bg: r.ciFailed && phase % 2 === 1 ? '#3a0d0d' : C.bg });
    }
    case 'mr-wide':
    default: {
      if (!b.problems.length) return svg(text(W, 62, b.total ? `All open ${word}s clean ✓` : `No open ${word}s`, { size: 18, fill: C.ok, weight: 'bold' })
        + text(W, 92, `${b.total} open · ${b.repos.length} repos`, { size: 13, fill: C.dim }), { w: W2 });
      let body = '';
      b.problems.slice(0, 4).forEach((m, i) => {
        const y = 10 + i * 33, failed = m.ci === 'failed';
        body += `<circle cx="16" cy="${y + 13}" r="6" fill="${failed ? C.bad : C.warn}"/>`
          + text(28, y + 18, fit(m.name, 11), { size: 13, anchor: 'start', weight: 'bold' })
          + text(134, y + 18, `${forge === 'github' ? '#' : '!'}${m.iid}`, { size: 13, anchor: 'start', fill: C.dim })
          + text(W2 - 10, y + 18, [failed && 'CI✕', m.conflict && 'conflict'].filter(Boolean).join(' '), { size: 12, anchor: 'end', fill: failed ? C.bad : C.warn, weight: 'bold' });
      });
      return svg(body, { w: W2 });
    }
  }
}

export function devopsKey(kind, s, { phase = 0, label = '', url = '', slot = 0, repo = '', now = Date.now() } = {}) {
  kind = KIND_ALIASES[kind] || kind;
  if (kind.startsWith('mr-')) return mrKey(kind, s.mrs, { slot, phase });
  const f = s.forge;
  const forge = f?.kind || 'gitlab';
  switch (kind) {
    case 'cr-mine':
    case 'cr-reviews': {
      const title = kind === 'cr-reviews' ? 'REVIEW' : `MY ${crWord(forge)}s`;
      if (!f) return svg(brandOf(forge) + text(72, 100, 'loading…', { size: 14, fill: C.dim }));
      if (f.error || f.auth === false) return svg(brandOf(forge) + text(72, 92, title, { size: 15, fill: C.dim, weight: 'bold' }) + text(72, 116, loginHint(forge), { size: 13, fill: C.warn, weight: 'bold' }) + text(72, 134, 'needed', { size: 12, fill: C.dim }));
      const list = (kind === 'cr-reviews' ? f.reviews : f.mine) || [];
      const states = list.map(x => x.ci || 'none');
      const failing = states.includes('failed');
      const alert = (kind === 'cr-reviews' && list.length > 0) || failing;
      let body = brandOf(forge) + text(132, 34, title, { size: 12, fill: C.dim, anchor: 'end', weight: 'bold' })
        + text(72, 98, String(list.length), { size: 44, weight: 'bold', fill: failing ? C.bad : alert ? C.warn : C.fg });
      states.slice(0, 8).forEach((st, i) => { body += `<circle cx="${22 + i * 14}" cy="124" r="5" fill="${ciColor(st)}"/>`; });
      return svg(body, { bg: failing && phase % 2 === 1 ? '#3a0d0d' : C.bg });
    }
    case 'gh-actions': {
      const a = s.actions?.[repo] || Object.values(s.actions || {}).find(Boolean);
      const run = a?.runs?.[0];
      const st = run ? (run.status === 'completed' ? run.conclusion || 'none' : 'pending') : 'none';
      const col = ciColor(st);
      return svg(`<rect x="0" y="0" width="${W}" height="8" fill="${col}"/>` + text(72, 32, 'ACTIONS', { size: 13, fill: C.dim, weight: 'bold' })
        + `<circle cx="72" cy="66" r="18" fill="${col}"/>` + text(72, 72, st === 'success' ? '✓' : /fail/.test(st) ? '✕' : '…', { size: 20, fill: '#fff', weight: 'bold' })
        + text(72, 108, fit(run?.name || (repo || '').split('/').pop() || '—', 14), { size: 14, weight: 'bold' })
        + text(72, 128, fit(run ? `${run.branch} · ${fmtDur(now - Date.parse(run.at))}` : 'no runs', 16), { size: 12, fill: C.dim }));
    }
    case 'status-claude':
    case 'status-github': {
      const k = kind.split('-')[1];
      const st = s.status?.[k];
      const [word, tone] = STATUS[st?.indicator || 'unknown'] || STATUS.unknown;
      const col = C[tone];
      return svg(`<circle cx="72" cy="54" r="26" fill="${col}" fill-opacity="0.2"/><circle cx="72" cy="54" r="14" fill="${col}"/>`
        + text(72, 104, k === 'claude' ? 'Claude' : 'GitHub', { size: 16, weight: 'bold' }) + text(72, 128, word, { size: 15, fill: col, weight: 'bold' }));
    }
    case 'http': {
      const r = s.http?.[url];
      const col = !r ? C.dim : r.ok ? C.ok : C.bad;
      const flash = r && !r.ok && phase % 2 === 1;
      return svg(`<rect x="0" y="0" width="${W}" height="8" fill="${col}"/>` + text(72, 40, fit(label || String(url).replace(/^https?:\/\//, '').split('/')[0], 14), { size: 14, weight: 'bold' })
        + text(72, 86, !r ? '…' : r.ok ? 'UP' : 'DOWN', { size: 32, weight: 'bold', fill: col })
        + text(72, 116, r ? (r.code ? `HTTP ${r.code}` : r.error || 'no answer') : '', { size: 12, fill: C.dim }) + text(72, 134, r ? `${r.ms} ms` : '', { size: 12, fill: C.dim }), { bg: flash ? '#3a0d0d' : C.bg });
    }
    case 'docker': {
      const d = s.docker;
      const whale = `<rect x="34" y="58" width="76" height="26" rx="10" fill="#1d63ed"/>` + [0, 1, 2].map(i => `<rect x="${44 + i * 15}" y="44" width="12" height="12" fill="#1d63ed"/>`).join('') + `<rect x="59" y="30" width="12" height="12" fill="#1d63ed"/>`;
      if (!d) return svg(whale + text(72, 118, '…', { size: 16, fill: C.dim }));
      if (!d.up) return svg(whale + text(72, 112, 'daemon down', { size: 15, fill: C.dim, weight: 'bold' }) + text(72, 132, 'press: start', { size: 12, fill: C.dim }));
      return svg(whale + text(72, 114, `${d.running}/${d.total}`, { size: 22, weight: 'bold', fill: d.running ? C.ok : C.dim }) + text(72, 134, 'containers up', { size: 12, fill: C.dim }));
    }
    case 'n8n': {
      const n = s.n8n;
      const col = n?.up ? C.ok : C.dim;
      return svg(`<circle cx="40" cy="56" r="11" fill="none" stroke="#ea4b71" stroke-width="5"/><circle cx="72" cy="56" r="11" fill="none" stroke="#ea4b71" stroke-width="5"/><circle cx="104" cy="56" r="11" fill="none" stroke="#ea4b71" stroke-width="5"/><path d="M51 56 h10 M83 56 h10" stroke="#ea4b71" stroke-width="5"/>`
        + text(72, 104, 'n8n', { size: 18, weight: 'bold' }) + text(72, 128, n ? (n.up ? 'running' : 'not running') : '…', { size: 13, fill: col, weight: 'bold' }));
    }
    case 'wide':
    default: {
      const rows = [
        ...((f?.mine) || []).map(m => ({ src: 'MY', ...m })),
        ...((f?.reviews) || []).map(m => ({ src: 'RV', ...m })),
      ].slice(0, 4);
      if (!rows.length) return svg(text(14, 60, `No open ${crWord(forge)}s`, { size: 18, anchor: 'start', fill: C.dim }) + text(14, 88, f && (f.error || f.auth === false) ? `${loginHint(forge)} needed` : '', { size: 12, anchor: 'start', fill: C.warn }), { w: W2 });
      let body = '';
      rows.forEach((r, i) => {
        const y = 10 + i * 33;
        body += `<circle cx="16" cy="${y + 13}" r="6" fill="${ciColor(r.ci)}"/>` + text(28, y + 18, r.src, { size: 11, fill: r.src === 'RV' ? C.warn : C.dim, anchor: 'start', weight: 'bold' })
          + text(52, y + 18, r.id, { size: 13, anchor: 'start', weight: 'bold' }) + text(96, y + 18, fit(r.title, 22), { size: 13, anchor: 'start' });
      });
      return svg(body, { w: W2 });
    }
  }
}

// ---------------------------------------------------------------- Claude command pad

export function promptKey(label, { target = null, icon = '', hold = false, needsWaiting = false, flash = false } = {}) {
  const ok = target && (!needsWaiting || target.state === 'waiting');
  const col = needsWaiting ? (ok ? (target.kind ? C[target.kind] || C.permission : C.permission) : C.faint) : C.working;
  let body = '';
  if (icon) body += text(72, 62, icon, { size: 38, fill: needsWaiting && !ok ? C.faint : C.fg });
  body += text(72, icon ? 104 : 80, fit(label, 13), { size: icon ? 16 : 18, weight: 'bold', fill: ok || !needsWaiting ? C.fg : C.faint });
  body += text(72, 132, !target ? 'no tmux session' : hold ? 'hold to send' : `→ S${target.slot ?? '?'} ${fit(target.project, 9)}`, { size: 11, fill: hold ? C.warn : C.dim });
  return svg(`<rect x="0" y="0" width="${W}" height="6" fill="${col}"/>` + body, { bg: flash ? C.working : C.bg });
}

export function targetKey(target, { auto = true, count = 0, phase = 0 } = {}) {
  if (!target) return svg(text(14, 50, 'No Claude session in tmux', { size: 16, anchor: 'start', fill: C.dim }) + text(14, 78, 'prompt keys need a tmux pane', { size: 12, anchor: 'start', fill: C.faint }), { w: W2 });
  const col = target.state === 'waiting' ? C[target.kind] || C.permission : C[target.state] || C.idle;
  const blink = target.state === 'waiting' && phase % 2 === 1;
  return svg(`<rect x="0" y="0" width="10" height="${W}" fill="${blink ? '#ffffff' : col}"/>`
    + text(22, 30, auto ? 'TARGET · auto' : 'TARGET · pinned', { size: 12, fill: C.dim, anchor: 'start', weight: 'bold' })
    + text(22, 66, `S${target.slot ?? '?'} ${fit(target.project, 16)}`, { size: 22, anchor: 'start', weight: 'bold' })
    + text(22, 94, `${target.state}${target.kind ? ' · ' + target.kind : ''}${target.tool ? ' · ' + target.tool : ''}`, { size: 14, anchor: 'start', fill: col })
    + text(22, 128, `press: next of ${count} · hold: auto`, { size: 11, anchor: 'start', fill: C.dim }), { w: W2 });
}
