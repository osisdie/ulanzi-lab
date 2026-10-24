import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCode, quoteUrl, parseMis, parseYahoo, isMarketOpen } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/quotes.js';
import { parseProc } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/wsl.js';
import { UsageStore } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/usage.js';

test('normalizeCode', () => {
  assert.deepEqual(normalizeCode('2330'), { key: '2330', market: 'tw', mis: 'tse_2330.tw', yahoo: '2330.TW' });
  assert.deepEqual(normalizeCode('TAIEX'), { key: 't00', market: 'tw', mis: 'tse_t00.tw', yahoo: '^TWII' });
  assert.deepEqual(normalizeCode('otc:6488'), { key: 'otc:6488', market: 'tw', mis: 'otc_6488.tw', yahoo: '6488.TWO' });
  assert.deepEqual(normalizeCode('00878'), { key: '00878', market: 'tw', mis: 'tse_00878.tw', yahoo: '00878.TW' });
  assert.deepEqual(normalizeCode('nvda'), { key: 'NVDA', market: 'us', yahoo: 'NVDA' });
  assert.deepEqual(normalizeCode('^DJI'), { key: '^DJI', market: 'us', yahoo: '^DJI' });
  assert.deepEqual(normalizeCode('GC=F'), { key: 'GC=F', market: 'x24', yahoo: 'GC=F' });
  assert.equal(normalizeCode('TWD=X').market, 'x24');
  assert.equal(normalizeCode('DX-Y.NYB').market, 'x24');
  assert.equal(normalizeCode('btc-usd').market, 'crypto');
  assert.equal(normalizeCode('bad symbol!'), null);
  assert.deepEqual(normalizeCode('6488.TWO'), normalizeCode('otc:6488'));
  assert.equal(normalizeCode(''), null);
});

test('quoteUrl: Taiwan listings on Yahoo TW, the rest on Yahoo Finance, symbols encoded', () => {
  assert.equal(quoteUrl('2330'), 'https://tw.stock.yahoo.com/quote/2330.TW');
  assert.equal(quoteUrl('t00'), 'https://tw.stock.yahoo.com/quote/%5ETWII');
  assert.equal(quoteUrl('otc:6488'), 'https://tw.stock.yahoo.com/quote/6488.TWO');
  assert.equal(quoteUrl('nvda'), 'https://finance.yahoo.com/quote/NVDA/');
  assert.equal(quoteUrl('^DJI'), 'https://finance.yahoo.com/quote/%5EDJI/');
  assert.equal(quoteUrl('GC=F'), 'https://finance.yahoo.com/quote/GC%3DF/');
  assert.equal(quoteUrl('BTC-USD'), 'https://finance.yahoo.com/quote/BTC-USD/');
  assert.equal(quoteUrl('bad symbol!'), null);
});

test('parseMis: up/down and z="-" fallback to best bid', () => {
  const up = parseMis({ c: '2330', n: '台積電', z: '1010.00', y: '1000.00', ex: 'tse' });
  assert.equal(up.change, 10);
  assert.equal(up.pct, 1);
  assert.equal(up.name, '台積電');
  const noTick = parseMis({ c: '0050', n: '元大台灣50', z: '-', b: '189.50_189.45_', a: '189.60_', y: '190.00', ex: 'tse' });
  assert.equal(noTick.price, 189.5);
  assert.ok(noTick.change < 0);
  assert.equal(parseMis({ c: '6488', z: '500', y: '500', ex: 'otc' }).code, 'otc:6488');
});

test('parseYahoo', () => {
  const q = parseYahoo('t00', { chart: { result: [{ meta: { regularMarketPrice: 48625.83, chartPreviousClose: 49302, shortName: 'TSEC' } }] } });
  assert.equal(q.name, '加權指數');
  assert.equal(q.change, -676.17);
  assert.equal(q.pct, -1.37);
  assert.equal(parseYahoo('x', {}), null);
  const us = parseYahoo('NVDA', { chart: { result: [{ meta: { regularMarketPrice: 221.975, chartPreviousClose: 228.52, shortName: 'NVIDIA Corporation' } }] } }, 'us');
  assert.equal(us.name, 'NVDA');
  assert.ok(us.change < 0);
  const tnx = parseYahoo('^TNX', { chart: { result: [{ meta: { regularMarketPrice: 5.249, chartPreviousClose: 5.217 } }] } }, 'us');
  assert.equal(tnx.name, '美債10Y');
  assert.equal(tnx.unit, '%');
});

test('isMarketOpen: x24 (futures/FX) and crypto', () => {
  assert.equal(isMarketOpen(new Date('2026-10-14T06:00:00Z'), 'x24'), true); // Wed
  assert.equal(isMarketOpen(new Date('2026-10-17T16:00:00Z'), 'x24'), false); // Sat
  assert.equal(isMarketOpen(new Date('2026-10-18T23:00:00Z'), 'x24'), true); // Sun 19:00 NY
  assert.equal(isMarketOpen(new Date('2026-10-16T22:00:00Z'), 'x24'), false); // Fri 18:00 NY
  assert.equal(isMarketOpen(new Date('2026-10-17T16:00:00Z'), 'crypto'), true); // Sat
});

test('isMarketOpen (Asia/Taipei)', () => {
  assert.equal(isMarketOpen(new Date('2026-10-14T02:00:00Z')), true); // Wed 10:00 TPE
  assert.equal(isMarketOpen(new Date('2026-10-14T06:00:00Z')), false); // Wed 14:00 TPE
  assert.equal(isMarketOpen(new Date('2026-10-17T02:00:00Z')), false); // Sat
  assert.equal(isMarketOpen(new Date('2026-10-14T14:00:00Z'), 'us'), true); // Wed 10:00 EDT
  assert.equal(isMarketOpen(new Date('2026-10-14T21:00:00Z'), 'us'), false); // Wed 17:00 EDT
  assert.equal(isMarketOpen(new Date('2026-12-14T14:00:00Z'), 'us'), false); // Mon 09:00 EST (DST over)
  assert.equal(isMarketOpen(new Date('2026-12-14T15:00:00Z'), 'us'), true); // Mon 10:00 EST
});

test('parseProc', () => {
  const r = parseProc('0.52 0.40 0.30 1/500 123\nMemTotal:       16000000 kB\nMemAvailable:    4000000 kB\n');
  assert.equal(r.load, 0.52);
  assert.equal(Math.round(r.mem), 75);
});

test('usage store keeps rate limits, drops expired windows', () => {
  let t = 1_000_000_000;
  const u = new UsageStore({ now: () => t });
  u.ingest({ rate_limits: { five_hour: { used_percentage: 40, resets_at: t / 1000 + 60 }, seven_day: { used_percentage: 10, resets_at: t / 1000 + 9999 } }, cost: { total_cost_usd: 1.5 } });
  assert.equal(u.snapshot().five_hour.used_percentage, 40);
  t += 120e3;
  u.ingest({}); // a post without rate_limits must not erase data, but expiry applies
  assert.equal(u.five_hour, null);
  assert.equal(u.seven_day.used_percentage, 10);
});

import { nodeProblem } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/node-floor.js';

test('node security floor: EOL lines and unpatched releases are flagged', () => {
  assert.match(nodeProblem('v20.12.2'), /end of life/);
  assert.match(nodeProblem('v23.11.0'), /end of life/);
  assert.match(nodeProblem('v22.23.3'), /need 22\.23\.4/);
  assert.match(nodeProblem('v24.21.9'), /need 24\.22\.1/);
  for (const ok of ['v22.23.4', 'v22.24.0', 'v24.22.1', 'v26.12.1', 'v28.0.0']) assert.equal(nodeProblem(ok), null, ok);
});

import { toCandles, downsample } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/quotes.js';
import { burnRate } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/usage.js';

test('toCandles aggregates 5m bars into 15m OHLC and skips gaps', () => {
  const t0 = 1_800_000_000 - (1_800_000_000 % 900); // aligned to 15 min
  const ts = [0, 300, 600, 900, 1200].map(x => t0 + x);
  const o = [10, 11, 12, 20, 21], h = [11, 13, 12, 22, 25], l = [9, 10, 11, 19, 20], c = [11, 12, 11.5, 21, null];
  const k = toCandles(ts, o, h, l, c, 15);
  assert.equal(k.length, 2);
  assert.deepEqual(k[0], { t: t0, o: 10, h: 13, l: 9, c: 11.5 });
  assert.deepEqual(k[1], { t: t0 + 900, o: 20, h: 22, l: 19, c: 21 });
});

test('downsample keeps ends and length', () => {
  const a = Array.from({ length: 100 }, (_, i) => i);
  const d = downsample(a, 10);
  assert.equal(d.length, 10);
  assert.equal(d[0], 0);
  assert.equal(d[9], 99);
  assert.deepEqual(downsample([1, 2], 10), [1, 2]);
});

test('burnRate: unknown / ok / danger', () => {
  const now = 10_000_000;
  assert.equal(burnRate([], now, null).status, 'unknown');
  const flat = [0, 1, 2, 3].map(i => ({ t: now - (3 - i) * 3 * 60e3, pct: 40 }));
  assert.equal(burnRate(flat, now, now / 1000 + 3600).status, 'ok');
  // +10% per 10 min → 60%/h; at 50% the limit is 50 min away; reset in 2 h → danger
  const rising = [0, 1, 2].map(i => ({ t: now - (2 - i) * 5 * 60e3, pct: 40 + i * 5 }));
  const r = burnRate(rising, now, now / 1000 + 7200);
  assert.equal(r.status, 'danger');
  assert.equal(Math.round(r.pctPerHour), 60);
  assert.equal(Math.round(r.etaMs / 60e3), 50);
  // same pace but the window resets in 30 min → ok
  assert.equal(burnRate(rising, now, now / 1000 + 1800).status, 'ok');
});
