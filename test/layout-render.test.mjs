import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPixels, nextCycleIndex, MODES, PRESETS, previewRects } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/layout.js';
import * as R from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/render.js';

const work = { x: -1920, y: 79, w: 1920, h: 1032 };

test('toPixels halves/quarters on an offset monitor', () => {
  assert.deepEqual(toPixels(MODES.left.cycle[0], work), { x: -1920, y: 79, w: 960, h: 1032 });
  assert.deepEqual(toPixels(MODES.br.cycle[0], work), { x: -960, y: 595, w: 960, h: 516 });
  const g = toPixels(MODES.right.cycle[0], work, 8);
  assert.equal(g.x + g.w, work.x + work.w - 8);
});

test('cycle advances only when repeated on the same window in place', () => {
  const last = { mode: 'left', hwnd: 'h1', idx: 0, at: 1000, rect: { x: 0, y: 0, w: 960, h: 1000 } };
  assert.equal(nextCycleIndex('left', last, 'h1', 2000, { x: 0, y: 0, w: 960, h: 1000 }), 1);
  assert.equal(nextCycleIndex('left', last, 'h1', 2000, { x: 50, y: 0, w: 960, h: 1000 }), 0);
  assert.equal(nextCycleIndex('left', last, 'h2', 2000, { x: 0, y: 0, w: 960, h: 1000 }), 0);
  assert.equal(nextCycleIndex('left', { ...last, idx: 2 }, 'h1', 2000, last.rect), 0);
});

test('presets tile the full area', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    const area = p.rects.reduce((a, r) => a + r.w * r.h, 0);
    assert.ok(Math.abs(area - 1) < 1e-9, name);
  }
  assert.equal(previewRects('grid4').length, 4);
});

test('every key template renders a clean SVG', () => {
  const now = Date.now();
  const sess = { id: 'a', slot: 1, project: '測試專案-very-long-name', state: 'waiting', kind: 'permission', since: now - 5000, waitingSince: now - 5000, tool: 'Bash', ctxPct: 40 };
  const svgs = [
    R.sessionKey(1, null), R.sessionKey(1, sess, { phase: 0 }), R.sessionKey(1, sess, { phase: 1 }),
    R.sessionKey(2, { ...sess, state: 'working', kind: null }),
    R.hitlKey([], { done: 1 }), R.hitlKey([sess], {}, { phase: 1, nag: true }),
    R.usageKey('5h', null), R.usageKey('5h', { used_percentage: 83, resets_at: now / 1000 + 3600, receivedAt: now }),
    R.usageWide({ five_hour: { used_percentage: 12, resets_at: now / 1000 + 100 }, seven_day: null, cost: 1.2, ctxPct: 30 }, [sess]),
    R.stockKey('2330', null), R.stockKey('2330', { name: '台積電', price: 1010, change: 10, pct: 1, open: true }),
    R.sysKey({ cpu: 12, mem: 70, cpuHist: [1, 50, 20], memHist: [], memUsedGb: 8, memTotalGb: 32 }),
    R.wslKey({ distro: 'Ubuntu', running: ['Ubuntu'], mem: 30, load: 0.5 }), R.wslKey(null, { confirm: true }),
    R.iotKey({ label: '檯燈', on: true }),
    R.stockKey('^TNX', { name: '美債10Y', price: 5.249, unit: '%', change: 0.03, pct: 0.61, open: false }, { colors: 'us' }),
    R.stockStrip([{ name: '黃金', price: 4101.8, change: -75.5, pct: -1.81 }, { code: 'SI=F', name: 'SI=F' }, { name: '美債10Y', price: 5.249, unit: '%', change: 0.03, pct: 0.61 }]),
    R.hitlKey([sess], { done: 0 }, { wide: true, phase: 1 }), R.hitlKey([], { done: 2 }, { wide: true }), R.layoutKey(previewRects('main3'), 'Main + 2'),
  ];
  for (const s of svgs) {
    assert.match(s, /^<svg [^>]+>.*<\/svg>$/s);
    assert.doesNotMatch(s, /undefined|NaN/);
  }
  assert.match(R.toDataUrl(svgs[0]), /^data:image\/svg\+xml;base64,/);
  assert.equal(R.fit('台積電台積電', 6), '台積電…');
});

import { mascot, MOODS } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/mascot.js';
import { keyPos } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/deck.js';

test('waveOpacity peaks at the wavefront and fades', () => {
  assert.ok(R.waveOpacity(0, 0) > 0.8);
  assert.equal(R.waveOpacity(3, 0), 0);
  assert.ok(R.waveOpacity(3, 4) > 0.8); // radius 3 at frame 4
  assert.equal(R.waveOpacity(0, 8), 0);
  const s = R.withOverlay(R.messageKey('x'), '#ff0000', 0.5);
  assert.match(s, /fill-opacity="0.50"\/><\/svg>$/);
  assert.equal(R.withOverlay('<svg></svg>', '#f00', 0), '<svg></svg>');
  assert.deepEqual(keyPos('3_2'), { x: 3.5, y: 2 });
  assert.deepEqual(keyPos('4_0'), { x: 4, y: 0 });
  assert.equal(keyPos('preview'), null);
});

test('all mascot moods × themes × new templates render clean SVG', () => {
  const now = Date.now();
  const sess = (slot, state, kind = null) => ({ id: 's' + slot, slot, project: 'proj' + slot, state, kind, since: now - 9e4, waitingSince: state === 'waiting' ? now - 3e4 : null, ctxPct: 55 });
  const q = { name: 'NVDA', price: 221.8, prev: 228.5, change: -6.7, pct: -2.93, open: true, dayLow: 221.1, dayHigh: 226, series: [228, 226, 224, 223, 222, 221.8],
    candles: [{ o: 228, h: 229, l: 226, c: 226.5 }, { o: 226.5, h: 227, l: 222, c: 222.5 }, { o: 222.5, h: 223, l: 221, c: 221.8 }] };
  for (const theme of Object.keys(R.THEMES)) {
    R.setTheme(theme);
    const svgs = [
      ...MOODS.flatMap(m => [0, 1, 2, 3].map(f => R.svg(mascot(m, f)))),
      R.hitlKey([], { working: 1 }, { style: 'mascot', frame: 3 }),
      R.hitlKey([sess(1, 'waiting', 'question')], {}, { style: 'mascot', phase: 1 }),
      R.hitlKey([], { done: 1 }, { style: 'mascot', event: { mood: 'celebrate', until: now + 1000 } }),
      R.hitlKey([sess(2, 'waiting', 'plan')], {}, { style: 'mascot', wide: true }),
      R.usageWide({ five_hour: { used_percentage: 64, resets_at: now / 1000 + 4000 }, seven_day: { used_percentage: 30 }, burn: { status: 'danger', etaMs: 6e6 } },
        [sess(1, 'working'), sess(2, 'waiting', 'permission'), sess(3, 'done'), sess(4, 'idle'), sess(5, 'error')], { phase: 1 }),
      R.usageWide({ five_hour: null, seven_day: null, burn: { status: 'unknown' } }, []),
      R.stockKey('NVDA', q), R.stockKey('NVDA', { ...q, series: undefined, candles: undefined, dayLow: null }),
      R.stockStrip([q, { code: 'SI=F', name: 'SI=F' }, q], { colors: 'us' }),
      R.sessionKey(1, sess(1, 'working')), R.usageKey('5h', { used_percentage: 70, receivedAt: now }), R.layoutKey([{ x: 0, y: 0, w: 0.5, h: 1 }], 'Left'),
    ];
    for (const s of svgs) {
      assert.match(s, /^<svg [^>]+>.*<\/svg>$/s, theme);
      assert.doesNotMatch(s, /undefined|NaN|Infinity/, theme);
    }
  }
  R.setTheme('classic');
  assert.equal(R.mascotMood([], { working: 2 }, null), 'working');
  assert.equal(R.mascotMood([{}], { working: 2 }, null), 'waiting');
  assert.equal(R.mascotMood([], { done: 1 }, { mood: 'love', until: Date.now() + 1000 }), 'love');
});
