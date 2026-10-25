// Key templates for the Voice profile (page 1: record → transcript). `v` is VoiceProvider.get().
import { W, C, svg, fit, text } from './render.js';

const W2 = W * 2;
const REC = '#ff3b30';
const mmss = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const busy = (v) => v.phase === 'saving' || v.phase === 'transcribing';
const active = (v) => v.phase === 'recording' || v.phase === 'paused';

// ---------------------------------------------------------------- glyphs (paths, not emoji: the device may lack them)

const dot = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const pause = (cx, cy, s, fill) => `<rect x="${cx - s}" y="${cy - s * 1.2}" width="${s * 0.7}" height="${s * 2.4}" rx="2" fill="${fill}"/><rect x="${cx + s * 0.3}" y="${cy - s * 1.2}" width="${s * 0.7}" height="${s * 2.4}" rx="2" fill="${fill}"/>`;
const check = (cx, cy, s, color) => `<path d="M${cx - s} ${cy} l${s * 0.7} ${s * 0.7} l${s * 1.3} ${-s * 1.4}" stroke="${color}" stroke-width="${s * 0.32}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const cross = (cx, cy, s, color) => `<path d="M${cx - s} ${cy - s} L${cx + s} ${cy + s} M${cx + s} ${cy - s} L${cx - s} ${cy + s}" stroke="${color}" stroke-width="${s * 0.3}" stroke-linecap="round"/>`;
const doc = (cx, cy, s, color) => `<path d="M${cx - s * 0.8} ${cy - s} h${s * 1.1} l${s * 0.5} ${s * 0.5} v${s * 1.5} h${-s * 1.6} Z" fill="none" stroke="${color}" stroke-width="${s * 0.16}" stroke-linejoin="round"/>`
  + [-0.3, 0.1, 0.5].map(dy => `<path d="M${cx - s * 0.45} ${cy + s * dy} h${s * 0.9}" stroke="${color}" stroke-width="${s * 0.12}" stroke-linecap="round"/>`).join('');
const board = (cx, cy, s, color) => `<rect x="${cx - s * 0.75}" y="${cy - s * 0.85}" width="${s * 1.5}" height="${s * 1.85}" rx="${s * 0.15}" fill="none" stroke="${color}" stroke-width="${s * 0.16}"/>`
  + `<rect x="${cx - s * 0.35}" y="${cy - s * 1.05}" width="${s * 0.7}" height="${s * 0.4}" rx="${s * 0.1}" fill="${color}"/>`;
const folder = (cx, cy, s, color) => `<path d="M${cx - s} ${cy - s * 0.6} h${s * 0.7} l${s * 0.2} ${s * 0.25} h${s * 1.1} v${s * 1.35} h${-s * 2} Z" fill="${color}"/>`;
const globe = (cx, cy, s, color) => `<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${color}" stroke-width="${s * 0.12}"/>`
  + `<ellipse cx="${cx}" cy="${cy}" rx="${s * 0.45}" ry="${s}" fill="none" stroke="${color}" stroke-width="${s * 0.1}"/>`
  + `<path d="M${cx - s} ${cy} h${s * 2} M${cx - s * 0.85} ${cy - s * 0.5} h${s * 1.7} M${cx - s * 0.85} ${cy + s * 0.5} h${s * 1.7}" stroke="${color}" stroke-width="${s * 0.1}"/>`;
const again = (cx, cy, s, color) => `<path d="M${cx + s} ${cy} a${s} ${s} 0 1 1 ${-s * 0.3} ${-s * 0.7}" stroke="${color}" stroke-width="${s * 0.2}" fill="none" stroke-linecap="round"/>`
  + `<path d="M${cx + s * 0.95} ${cy - s * 1.05} v${s * 0.6} h${-s * 0.6}" stroke="${color}" stroke-width="${s * 0.2}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Level meter: bars for the last dB values (−60…0 dBFS). */
function meter(levels, x, y, w, h, color) {
  const n = Math.max(1, Math.floor(w / 6));
  const vals = levels.slice(-n);
  return vals.map((db, i) => {
    const v = Math.max(0.04, Math.min(1, (db + 60) / 60));
    const bh = Math.max(2, v * h);
    return `<rect x="${(x + (n - vals.length + i) * 6).toFixed(1)}" y="${(y + (h - bh) / 2).toFixed(1)}" width="4" height="${bh.toFixed(1)}" rx="2" fill="${color}"/>`;
  }).join('');
}

const unsupported = () => svg(text(72, 66, 'Voice', { size: 20, weight: 'bold', fill: C.dim }) + text(72, 94, '尚未支援', { size: 16, fill: C.dim }) + text(72, 118, 'Windows only', { size: 12, fill: C.dim }));

const ASR_LABEL = { off: '待命', starting: '啟動中…', ready: '就緒', error: '錯誤' };
const ASR_COLOR = () => ({ off: C.dim, starting: C.warn, ready: C.ok, error: C.bad });

export function voiceKey(part, v, { phase = 0, wide = false, now = Date.now() } = {}) {
  if (!v.supported) return wide ? svg(text(W, 70, 'Voice 尚未支援這個系統', { size: 20, fill: C.dim }) + text(W, 100, 'Windows only for now', { size: 14, fill: C.dim }), { w: W2 }) : unsupported();
  const blink = phase % 2 === 0;
  switch (part) {
    case 'rec': {
      if (v.needs.includes('ffmpeg')) return svg(dot(72, 54, 26, C.faint) + text(72, 112, '需要 ffmpeg', { size: 15, fill: C.warn, weight: 'bold' }) + text(72, 132, 'winget Gyan.FFmpeg', { size: 11, fill: C.dim }));
      if (v.needs.includes('mic')) return svg(dot(72, 54, 26, C.faint) + text(72, 116, '找不到麥克風', { size: 15, fill: C.warn, weight: 'bold' }));
      if (v.phase === 'recording') {
        return svg(dot(72, 52, 26, v.live && blink ? REC : '#7a1d18') + text(72, 108, mmss(v.elapsed), { size: 26, weight: 'bold' })
          + text(72, 132, v.live ? '按＝暫停' : '開麥克風…', { size: 13, fill: C.dim }), { bg: '#2a0d0d' });
      }
      if (v.phase === 'paused') return svg(pause(72, 52, 16, C.warn) + text(72, 108, mmss(v.elapsed), { size: 26, weight: 'bold', fill: C.warn }) + text(72, 132, '按＝繼續', { size: 13, fill: C.dim }));
      if (busy(v)) return svg(dot(72, 52, 26, C.faint) + text(72, 112, v.phase === 'saving' ? '存檔中…' : '轉寫中…', { size: 16, fill: C.dim }));
      return svg(dot(72, 54, 28, REC) + text(72, 60, 'REC', { size: 15, weight: 'bold', fill: '#fff' }) + text(72, 118, '開始錄音', { size: 15, weight: 'bold' }));
    }
    case 'save': {
      const on = active(v);
      return svg(check(72, 56, 22, on ? C.ok : C.faint) + text(72, 108, '完成', { size: 18, weight: 'bold', fill: on ? C.fg : C.faint }) + text(72, 130, '只存錄音', { size: 13, fill: C.dim }));
    }
    case 'finish': {
      const on = active(v);
      return svg(check(58, 56, 18, on ? C.ok : C.faint) + doc(98, 56, 18, on ? C.fg : C.faint) + text(72, 108, '完成', { size: 18, weight: 'bold', fill: on ? C.fg : C.faint }) + text(72, 130, '＋逐字稿', { size: 13, fill: C.dim }));
    }
    case 'cancel': {
      if (v.confirmCancelUntil > now) return svg(cross(72, 50, 18, '#fff') + text(72, 102, '再按一次', { size: 18, weight: 'bold', fill: '#fff' }) + text(72, 126, '丟棄錄音', { size: 14, fill: '#fff' }), { bg: C.bad });
      const on = active(v);
      return svg(cross(72, 56, 18, on ? C.bad : C.faint) + text(72, 108, '取消', { size: 18, weight: 'bold', fill: on ? C.fg : C.faint }) + text(72, 130, '按兩次', { size: 13, fill: C.dim }));
    }
    case 'last': {
      const p = v.last?.preview || '';
      if (!v.last?.txt) return svg(doc(72, 58, 24, C.faint) + text(72, 116, '還沒有逐字稿', { size: 14, fill: C.dim }));
      return svg(doc(26, 28, 12, C.fg) + text(44, 34, '最後逐字稿', { size: 14, anchor: 'start', weight: 'bold' })
        + text(10, 66, fit(p, 15), { size: 13, anchor: 'start' }) + text(10, 88, fit(p.slice(fit(p, 15).replace(/…$/, '').length), 15), { size: 13, anchor: 'start' })
        + text(72, 132, '長按＝資料夾', { size: 11, fill: C.dim }));
    }
    case 'copy': return svg(board(72, 58, 26, v.last?.txt ? C.fg : C.faint) + text(72, 116, '複製逐字稿', { size: 15, weight: 'bold', fill: v.last?.txt ? C.fg : C.faint }));
    case 'retry': {
      const ok = !!v.last?.recording && !active(v) && !busy(v);
      return svg(again(72, 58, 22, ok ? C.fg : C.faint) + text(72, 112, '重新轉寫', { size: 15, weight: 'bold', fill: ok ? C.fg : C.faint }) + text(72, 132, '上一段錄音', { size: 12, fill: C.dim }));
    }
    case 'status': {
      const a = v.asr || {};
      const col = ASR_COLOR()[a.state] || C.dim;
      const sub = v.phase === 'transcribing' ? '轉寫中…' : a.state === 'error' ? fit(a.error, 14) : '按＝啟動';
      return svg(text(72, 34, '語音辨識', { size: 15, weight: 'bold', fill: C.dim }) + dot(72, 68, 14, a.state === 'starting' && !blink ? C.faint : col)
        + text(72, 108, ASR_LABEL[a.state] || a.state, { size: 18, weight: 'bold', fill: col }) + text(72, 130, sub, { size: 12, fill: C.dim }));
    }
    case 'lang': return svg(globe(72, 52, 26, C.thinking) + text(72, 112, v.langLabel, { size: 20, weight: 'bold' }) + text(72, 132, '語言', { size: 12, fill: C.dim }));
    case 'folder': return svg(folder(72, 58, 30, C.done) + text(72, 116, '錄音資料夾', { size: 15, weight: 'bold' }));
    case 'wide':
    default: return wideKey(v, { blink, now });
  }
}

function wideKey(v, { blink, now }) {
  const right = (y, s, o = {}) => text(16, y, s, { anchor: 'start', ...o });
  if (v.phase === 'recording' || v.phase === 'paused') {
    const rec = v.phase === 'recording';
    return svg((rec ? dot(24, 30, 9, v.live && blink ? REC : '#7a1d18') : pause(24, 30, 6, C.warn))
      + text(42, 37, `${mmss(v.elapsed)}${rec ? '' : '  暫停中'}`, { size: 22, weight: 'bold', anchor: 'start', fill: rec ? C.fg : C.warn })
      + text(W2 - 14, 36, fit(v.mic, 18), { size: 12, anchor: 'end', fill: C.dim })
      + meter(v.levels, 16, 56, W2 - 32, 56, rec ? (v.live ? C.ok : C.faint) : C.faint)
      + text(W2 - 14, 134, `上限 ${Math.round(v.maxSec / 60)} 分`, { size: 11, anchor: 'end', fill: C.dim }), { w: W2 });
  }
  if (busy(v)) {
    return svg(right(40, v.phase === 'saving' ? '存檔中…' : '轉寫中…', { size: 22, weight: 'bold', fill: C.thinking })
      + right(72, v.message || `${v.langLabel} · ${v.last?.seconds ? mmss(v.last.seconds) : ''}`, { size: 15, fill: C.dim })
      + `<rect x="16" y="96" width="${W2 - 32}" height="6" rx="3" fill="${C.faint}"/><rect x="${16 + ((now / 40) % (W2 - 72))}" y="96" width="40" height="6" rx="3" fill="${C.thinking}"/>`, { w: W2 });
  }
  if (v.phase === 'error') {
    return svg(right(40, '出錯了', { size: 22, weight: 'bold', fill: C.bad }) + right(72, fit(v.error, 32), { size: 14 }) + right(100, fit(v.error.slice(fit(v.error, 32).replace(/…$/, '').length), 32), { size: 14 })
      + right(132, '按「重新轉寫」，或再錄一次', { size: 12, fill: C.dim }), { w: W2 });
  }
  const p = v.last?.preview || '';
  if (v.phase === 'done' && p) {
    const l1 = fit(p, 30);
    return svg(right(30, `逐字稿 ${v.message ? `· ${v.message}` : ''}`, { size: 14, weight: 'bold', fill: C.ok })
      + right(66, l1, { size: 17 }) + right(96, fit(p.slice(l1.replace(/…$/, '').length), 30), { size: 17 })
      + right(132, `${v.langLabel} · ${v.last?.seconds ? mmss(v.last.seconds) : ''}`, { size: 12, fill: C.dim }), { w: W2 });
  }
  return svg(right(40, '按 ● 開始錄音', { size: 22, weight: 'bold' })
    + right(72, v.message || `語言：${v.langLabel}`, { size: 15, fill: C.dim })
    + right(100, fit(v.mic ? `麥克風：${v.mic}` : '', 32), { size: 13, fill: C.dim })
    + right(130, fit(v.dir, 34), { size: 11, fill: C.faint }), { w: W2 });
}
