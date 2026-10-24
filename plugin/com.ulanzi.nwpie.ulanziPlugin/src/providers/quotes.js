// Market quotes for TW and US keys.
// TW: TWSE MIS realtime (Chinese names), falling back to Yahoo (mis.twse.com.tw is unreachable from some networks).
// US / indices / futures / yields: Yahoo chart API.
import { EventEmitter } from 'node:events';

const NAMES = {
  '2330': '台積電', '0050': '元大台灣50', '0056': '元大高股息', '2317': '鴻海', '2454': '聯發科', t00: '加權指數',
  '^DJI': '道瓊', '^GSPC': 'S&P 500', '^IXIC': '那斯達克', '^SOX': '費半', 'GC=F': '黃金', 'SI=F': '白銀',
  '^TNX': '美債10Y', '^TYX': '美債30Y', '^FVX': '美債5Y', '^IRX': '美債13W', 'CL=F': 'WTI原油', 'DX-Y.NYB': '美元指數',
  'BZ=F': '布蘭特', 'HG=F': '銅', 'NG=F': '天然氣', '^N225': '日經', '^HSI': '恆生', '^VIX': 'VIX',
  'TWD=X': '美元/台幣', 'JPY=X': '美元/日圓', 'EURUSD=X': '歐元/美元', 'BTC-USD': '比特幣', 'ETH-USD': '以太幣',
};
// Yahoo quotes these yield indices in percent.
const PERCENT_UNIT = new Set(['^TNX', '^TYX', '^FVX', '^IRX']);

/**
 * User code → {key, market, mis?, yahoo}.
 * TW: 2330, 0050, 00878, t00/TAIEX/^TWII, otc:6488, 6488.TWO, 2330.TW
 * US / other (Yahoo symbol as-is): NVDA, QQQ, ^DJI, ^TNX, BRK-B
 * Near-24h (market 'x24': futures, FX, dollar index): GC=F, CL=F, TWD=X, DX-Y.NYB.  Crypto (24/7): BTC-USD
 */
export function normalizeCode(input) {
  const raw = String(input || '').trim();
  const s = raw.toLowerCase();
  if (!s) return null;
  if (['t00', 'taiex', '^twii', 'twii'].includes(s)) return { key: 't00', market: 'tw', mis: 'tse_t00.tw', yahoo: '^TWII' };
  let m = s.match(/^otc[:_]?(\w+)$/) || s.match(/^(\w+)\.two$/);
  if (m) return { key: `otc:${m[1].toUpperCase()}`, market: 'tw', mis: `otc_${m[1]}.tw`, yahoo: `${m[1].toUpperCase()}.TWO` };
  m = s.match(/^(\d\w*?)(\.tw)?$/);
  if (m) return { key: m[1].toUpperCase(), market: 'tw', mis: `tse_${m[1]}.tw`, yahoo: `${m[1].toUpperCase()}.TW` };
  const sym = raw.toUpperCase();
  if (!/^[\^A-Z0-9.=\-]+$/.test(sym)) return null;
  const market = /-USDT?$/.test(sym) ? 'crypto' : /(=F|=X|\.NYB)$/.test(sym) ? 'x24' : 'us';
  return { key: sym, market, yahoo: sym };
}

/** Quote page for a code: Yahoo奇摩股市 for Taiwan listings, Yahoo Finance for everything else. null if invalid. */
export function quoteUrl(input) {
  const n = normalizeCode(input);
  if (!n) return null;
  const sym = encodeURIComponent(n.yahoo);
  return n.market === 'tw' ? `https://tw.stock.yahoo.com/quote/${sym}` : `https://finance.yahoo.com/quote/${sym}/`;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Parse one TWSE MIS msgArray item. */
export function parseMis(m) {
  const prev = num(m.y);
  // z is '-' between matches; fall back to best bid, then ask, then open.
  const price = num(m.z) ?? num(String(m.b || '').split('_')[0]) ?? num(String(m.a || '').split('_')[0]) ?? num(m.o);
  const code = m.c === 't00' ? 't00' : m.ex === 'otc' ? `otc:${m.c}` : m.c;
  const q = quote(code, m.n || NAMES[m.c], price, prev, 'mis', m.d && m.t ? `${m.d} ${m.t}` : null);
  q.dayHigh = num(m.h);
  q.dayLow = num(m.l);
  return q;
}

/** Keep at most n points, evenly spaced, always including the last. */
export function downsample(arr, n) {
  if (!arr || arr.length <= n) return arr ? [...arr] : [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

/** Aggregate intraday bars (unix-second timestamps) into `bucketMin`-minute OHLC candles. */
export function toCandles(ts, o, h, l, c, bucketMin = 15) {
  const out = [];
  let cur = null;
  for (let i = 0; i < (ts || []).length; i++) {
    if (![o[i], h[i], l[i], c[i]].every(Number.isFinite)) continue;
    const b = Math.floor(ts[i] / (bucketMin * 60));
    if (!cur || cur.b !== b) { cur = { b, t: b * bucketMin * 60, o: o[i], h: h[i], l: l[i], c: c[i] }; out.push(cur); }
    else { cur.h = Math.max(cur.h, h[i]); cur.l = Math.min(cur.l, l[i]); cur.c = c[i]; }
  }
  return out.map(({ t, o: oo, h: hh, l: ll, c: cc }) => ({ t, o: oo, h: hh, l: ll, c: cc }));
}

/** Parse a Yahoo /v8/finance/chart result. US tickers show their symbol (shortName is too long for a key). */
export function parseYahoo(key, json, market = 'tw') {
  const res = json?.chart?.result?.[0];
  const meta = res?.meta;
  if (!meta) return null;
  const prev = num(meta.chartPreviousClose ?? meta.previousClose);
  const name = NAMES[key.replace(/^otc:/, '')] || (market !== 'tw' ? key.replace(/^\^/, '') : meta.shortName);
  const q = quote(key, name, num(meta.regularMarketPrice), prev, 'yahoo',
    meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null);
  if (PERCENT_UNIT.has(key)) q.unit = '%';
  const k = res.indicators?.quote?.[0];
  if (k && res.timestamp?.length) {
    q.series = downsample((k.close || []).filter(Number.isFinite), 48);
    q.candles = toCandles(res.timestamp, k.open || [], k.high || [], k.low || [], k.close || [], 15).slice(-32);
  }
  q.dayHigh = num(meta.regularMarketDayHigh);
  q.dayLow = num(meta.regularMarketDayLow);
  return q;
}

function quote(code, name, price, prev, src, at) {
  const change = price != null && prev != null ? +(price - prev).toFixed(2) : null;
  const pct = change != null && prev ? +((change / prev) * 100).toFixed(2) : null;
  return { code, name: name || code, price, prev, change, pct, src, at };
}

/** Wall-clock parts in a time zone (handles DST for New York). */
function zoned(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), mins: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Regular sessions (holidays not handled). TW 09:00–13:30 Asia/Taipei; US 09:30–16:00 America/New_York;
 * x24 (futures/FX) Sun 18:00 → Fri 17:00 New York; crypto always.
 */
export function isMarketOpen(date = new Date(), market = 'tw') {
  if (market === 'crypto') return true;
  const { day, mins } = zoned(date, market === 'tw' ? 'Asia/Taipei' : 'America/New_York');
  if (market === 'x24') return (day >= 1 && day <= 4) || (day === 0 && mins >= 18 * 60) || (day === 5 && mins < 17 * 60);
  if (day < 1 || day > 5) return false;
  return market === 'us' ? mins >= 9 * 60 + 30 && mins <= 16 * 60 + 5 : mins >= 9 * 60 && mins <= 13 * 60 + 35;
}

export class QuoteProvider extends EventEmitter {
  constructor({ log = () => {}, fetchImpl = fetch } = {}) {
    super();
    this.log = log;
    this.fetch = fetchImpl;
    this.codes = new Map(); // key -> {norm, refs}
    this.quotes = new Map();
    this.misOk = true;
    this.timer = null;
    this.histAt = new Map(); // key -> last Yahoo history fetch (for TW keys priced by MIS)
  }

  subscribe(code) {
    const n = normalizeCode(code);
    if (!n) return null;
    const e = this.codes.get(n.key) || { norm: n, refs: 0 };
    e.refs++;
    this.codes.set(n.key, e);
    if (!this.quotes.has(n.key)) this.refreshSoon();
    return n.key;
  }

  unsubscribe(key) {
    const e = this.codes.get(key);
    if (e && --e.refs <= 0) this.codes.delete(key);
  }

  get(key) { return this.quotes.get(key); }

  refreshSoon() { clearTimeout(this._soon); this._soon = setTimeout(() => this.refresh(), 300); }

  start() {
    const loop = async () => {
      await this.refresh();
      const now = new Date();
      const live24 = [...this.codes.values()].some(e => e.norm.market !== 'tw' && e.norm.market !== 'us' && isMarketOpen(now, e.norm.market));
      this.timer = setTimeout(loop, isMarketOpen(now, 'tw') ? 15e3 : isMarketOpen(now, 'us') ? 30e3 : live24 ? 60e3 : 10 * 60e3);
    };
    loop();
  }

  stop() { clearTimeout(this.timer); clearTimeout(this._soon); }

  refresh() {
    // Coalesce concurrent callers (poll loop + key presses + new subscriptions).
    if (!this._inflight) this._inflight = this._refresh().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _refresh() {
    const list = [...this.codes.values()].map(e => e.norm);
    if (!list.length) return;
    const now = new Date();
    const tw = list.filter(n => n.market === 'tw');
    const yahoo = list.filter(n => n.market !== 'tw');
    let twOk = false;
    if (tw.length && this.misOk) {
      try {
        const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(tw.map(n => n.mis).join('|'))}&json=1&delay=0`;
        const r = await this.fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Mozilla/5.0' } });
        const j = await r.json();
        for (const m of j.msgArray || []) { const q = parseMis(m); this.quotes.set(q.code, { ...q, market: 'tw', open: isMarketOpen(now, 'tw') }); }
        twOk = (j.msgArray || []).length > 0;
      } catch (e) {
        this.log('quotes: TWSE MIS failed, using yahoo', String(e.cause?.code || e.message));
        this.misOk = false;
        setTimeout(() => { this.misOk = true; }, 30 * 60e3); // retry MIS later
      }
    }
    if (!twOk) yahoo.push(...tw);
    // TW keys priced by MIS still need Yahoo for the intraday chart (at most every 2 min).
    const histOnly = twOk ? tw.filter(n => Date.now() - (this.histAt.get(n.key) || 0) > 120e3) : [];
    await Promise.all([...yahoo.map(n => [n, false]), ...histOnly.map(n => [n, true])].map(async ([n, onlyHistory]) => {
      try {
        const r = await this.fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(n.yahoo)}?interval=5m&range=1d`,
          { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
        const q = parseYahoo(n.key, await r.json(), n.market);
        if (!q) return;
        this.histAt.set(n.key, Date.now());
        if (onlyHistory) {
          const cur = this.quotes.get(n.key);
          if (cur) this.quotes.set(n.key, { ...cur, series: q.series, candles: q.candles, dayHigh: cur.dayHigh ?? q.dayHigh, dayLow: cur.dayLow ?? q.dayLow });
        } else {
          this.quotes.set(n.key, { ...q, market: n.market, open: isMarketOpen(now, n.market) });
        }
      } catch (e) { this.log('quotes: yahoo failed', n.yahoo, String(e.message)); }
    }));
    this.emit('change');
  }
}
