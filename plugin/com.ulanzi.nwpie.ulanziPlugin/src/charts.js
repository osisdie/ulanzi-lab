// Small chart primitives for key SVGs (SVG Tiny friendly: gradients + paths, no filters).

const f1 = (n) => n.toFixed(1);

function scale(values, y, h, pad = 0.08) {
  const v = values.filter(Number.isFinite);
  let lo = Math.min(...v), hi = Math.max(...v);
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * pad; hi += span * pad;
  return (val) => y + h - ((val - lo) / (hi - lo)) * h;
}

/** Area chart with a vertical gradient fill (color → transparent) and a 2px line. */
export function areaChart(x, y, w, h, series, color, id = 'ag', { baseline = null } = {}) {
  const s = (series || []).filter(Number.isFinite);
  if (s.length < 2) return '';
  const sy = scale(baseline != null ? [...s, baseline] : s, y, h);
  const pts = s.map((v, i) => `${f1(x + (w * i) / (s.length - 1))},${f1(sy(v))}`);
  let out = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${color}" stop-opacity="0.45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="M${f1(x)},${f1(y + h)} L${pts.join(' L')} L${f1(x + w)},${f1(y + h)} Z" fill="url(#${id})"/>`;
  if (baseline != null) out += `<rect x="${f1(x)}" y="${f1(sy(baseline))}" width="${f1(w)}" height="1" fill="${color}" fill-opacity="0.35"/>`;
  out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  return out;
}

/** Candlesticks: bars = [{o,h,l,c}], up/down colors chosen by caller. */
export function candles(x, y, w, h, bars, upColor, downColor) {
  const b = (bars || []).filter(k => [k.o, k.h, k.l, k.c].every(Number.isFinite));
  if (!b.length) return '';
  const sy = scale(b.flatMap(k => [k.h, k.l]), y, h, 0.04);
  const step = w / b.length;
  const bw = Math.max(1.5, Math.min(8, step * 0.62));
  let out = '';
  b.forEach((k, i) => {
    const cx = x + step * i + step / 2;
    const col = k.c >= k.o ? upColor : downColor;
    const top = sy(Math.max(k.o, k.c)), bot = sy(Math.min(k.o, k.c));
    out += `<rect x="${f1(cx - 0.6)}" y="${f1(sy(k.h))}" width="1.2" height="${f1(Math.max(1, sy(k.l) - sy(k.h)))}" fill="${col}"/>`
      + `<rect x="${f1(cx - bw / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(Math.max(1.2, bot - top))}" fill="${col}"/>`;
  });
  return out;
}

/** Day range track (low..high) with a marker at the current price. */
export function rangeBar(x, y, w, h, low, high, value, color, track) {
  if (![low, high, value].every(Number.isFinite) || !(high > low)) return '';
  const p = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="${h / 2}" fill="${track}"/>`
    + `<rect x="${f1(x + w * p - 2)}" y="${f1(y - 2)}" width="4" height="${h + 4}" rx="2" fill="${color}"/>`;
}
