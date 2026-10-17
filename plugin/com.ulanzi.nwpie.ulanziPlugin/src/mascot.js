// Clawd-style pixel mascot for the HITL key. Pure SVG rects; animated by re-rendering frames.
// Moods: idle · working · waiting · done · celebrate · love · error

export const MOODS = ['idle', 'working', 'waiting', 'done', 'celebrate', 'love', 'error'];

const BODY = '#d97757';
const EYE = '#141414';

// 12×8 sprites. # body, E eye, A arm, L leg, . empty
const SPRITE = {
  base: [
    '..########..',
    '..########..',
    'AA#E####E#AA',
    'AA#E####E#AA',
    '..########..',
    '..########..',
    '..L.L..L.L..',
    '..L.L..L.L..',
  ],
  armsUp: [
    'AA########AA',
    'AA########AA',
    '..#E####E#..',
    '..#E####E#..',
    '..########..',
    '..########..',
    '..L.L..L.L..',
    '..L.L..L.L..',
  ],
};
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const BANG = ['##', '##', '##', '##', '..', '##'];

function pixels(rows, x, y, p, colors) {
  let out = '';
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const col = colors[row[c]];
      if (col) out += `<rect x="${x + c * p}" y="${y + r * p}" width="${p}" height="${p}" fill="${col}"/>`;
    }
  });
  return out;
}

/** Deterministic pseudo-random in [0,1). */
const rnd = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Draw the mascot. (cx, top) = center x and top y of the sprite; p = pixel size.
 * `frame` advances 4×/s; `accent` colors the waiting marks; `fg` is used for "…".
 */
export function mascot(mood, frame = 0, { cx = 72, top = 40, p = 7, accent = '#ff2d2d', fg = '#e6edf3', dim = false } = {}) {
  const w = 12 * p;
  let x = Math.round(cx - w / 2), y = top;
  let sprite = SPRITE.base;
  const body = dim ? '#8a8f98' : BODY;
  let eyes = EYE;
  let blink = false;
  let extra = '';

  switch (mood) {
    case 'working':
      y += frame % 2 ? -p / 2 : 0; // bob
      extra += [0, 1, 2].slice(0, (frame % 4)).map(i => `<rect x="${x + w + 4 + i * (p + 2)}" y="${top + 5 * p}" width="${p - 1}" height="${p - 1}" fill="${fg}"/>`).join('');
      break;
    case 'waiting': {
      const big = frame % 2 === 0;
      const hp = big ? p : Math.max(3, p - 2);
      extra += pixels(BANG, Math.round(cx - hp), top - 7 * hp - 4, hp, { '#': accent });
      break;
    }
    case 'done':
      sprite = SPRITE.armsUp;
      blink = true; // content, eyes closed
      break;
    case 'celebrate':
      sprite = frame % 2 ? SPRITE.armsUp : SPRITE.base;
      for (let i = 0; i < 16; i++) {
        const cxp = 6 + rnd(i, 1) * 132, fall = (rnd(i, 2) * 140 + frame * 9) % 140;
        const col = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#ffffff'][i % 5];
        extra += `<rect x="${cxp.toFixed(1)}" y="${fall.toFixed(1)}" width="4" height="6" fill="${col}" transform="rotate(${(i * 37 + frame * 20) % 360} ${cxp.toFixed(1)} ${fall.toFixed(1)})"/>`;
      }
      break;
    case 'love': {
      const hp = frame % 2 ? 4 : 5;
      extra += pixels(HEART, Math.round(cx - 3.5 * hp), top - 6 * hp - 6, hp, { '#': '#ff4d6d' });
      blink = true;
      break;
    }
    case 'error':
      eyes = '#ff2d2d';
      break;
    case 'idle':
    default:
      blink = frame % 14 === 0; // occasional blink
      break;
  }

  const rows = blink ? sprite.map((r, i) => (i === 2 ? r.replace(/E/g, '#') : r)) : sprite;
  return extra + pixels(rows, x, y, p, { '#': body, A: body, L: body, E: eyes });
}
