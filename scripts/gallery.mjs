#!/usr/bin/env node
// Render README screenshots of every deck page from DEMO data (no .env, no network, no real sessions).
//   node scripts/gallery.mjs            → docs/images/*.png  (needs Chrome or Edge for the PNG step)
// Keys go through the plugin's real render path (deck + render templates), laid out like a D200X.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.ULANZI_LAB_ENV_FILE = path.join(process.env.TEMP || '/tmp', 'ulanzi-lab-demo-has-no-env'); // ignore the real .env
Object.assign(process.env, {
  ULANZI_LAB_FORGE: 'github',
  ULANZI_LAB_WATCHLIST: '^DJI:Dow,QQQ,NVDA:Nvidia,AAPL:Apple,GOOGL:Google,AMZN:Amazon,ASML,MSFT:Microsoft,TSLA:Tesla,META:Meta,AMD,AVGO:Broadcom',
  ULANZI_LAB_WATCHLIST_STRIP: 'GC=F:Gold,SI=F:Silver,^TNX:US10Y',
  ULANZI_LAB_HTTP_CHECKS: 'https://api.example.com/health|Public API', ULANZI_LAB_ACTIONS_REPO: 'acme/api',
});

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = pathToFileURL(path.join(REPO, 'plugin', 'com.ulanzi.nwpie.ulanziPlugin', 'src') + '/').href;
const imp = (m) => import(new URL(m, SRC).href);
const { buildPages, PLUGIN_UUID } = await imp('pages.js');
const { createDeck } = await imp('deck.js');
const { createPageActions } = await imp('page-actions.js');
const { SessionStore } = await imp('sessions.js');
const { UsageStore } = await imp('usage.js');
const { Pomodoro } = await imp('pomodoro.js');
const { summarizeMrs } = await imp('providers/devops.js');
const { normalizeCode } = await imp('providers/quotes.js');
const R = await imp('render.js');

const NOW = Date.parse('2026-10-14T13:42:00+08:00');
const on = () => {};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------- demo providers

const NAMES = { '2330': '台積電', '0050': '元大台灣50', t00: '加權指數', '^DJI': 'Dow', '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^SOX': '費半', '^N225': '日經', 'TWD=X': '美元/台幣', 'DX-Y.NYB': '美元指數', 'JPY=X': '美元/日圓', 'GC=F': '黃金', 'CL=F': 'WTI原油', 'BTC-USD': '比特幣', 'BZ=F': '布蘭特', 'SI=F': '白銀', 'HG=F': '銅' };
const BASE = { '2330': 1035, '0050': 188.4, t00: 23418, '^DJI': 51480, '^GSPC': 6712, '^IXIC': 22870, '^SOX': 6240, '^N225': 48230, 'TWD=X': 30.62, 'DX-Y.NYB': 98.7, 'JPY=X': 151.4, 'GC=F': 4102, 'CL=F': 61.8, 'BTC-USD': 112400, 'BZ=F': 65.2, 'SI=F': 55.8, 'HG=F': 4.92, '^TNX': 4.21, QQQ: 612, NVDA: 182, AAPL: 247, GOOGL: 244, AMZN: 221, ASML: 978, MSFT: 512, TSLA: 438, META: 712, AMD: 214, AVGO: 342 };
const quoteCache = new Map();
function demoQuote(key) {
  if (quoteCache.has(key)) return quoteCache.get(key);
  const prev = BASE[key] ?? 100;
  const drift = (rnd() - 0.45) * 0.04;
  const series = [];
  let p = prev;
  for (let i = 0; i < 48; i++) { p *= 1 + drift / 48 + (rnd() - 0.5) * 0.004; series.push(+p.toFixed(2)); }
  const candles = [];
  for (let i = 0; i < 24; i++) {
    const s = series.slice(i * 2, i * 2 + 3);
    candles.push({ o: s[0], c: s[s.length - 1], h: Math.max(...s) * (1 + rnd() * 0.002), l: Math.min(...s) * (1 - rnd() * 0.002) });
  }
  const price = series[series.length - 1];
  const q = { code: key, name: NAMES[key] || key.replace(/^\^/, ''), price, prev, change: +(price - prev).toFixed(2), pct: +(((price - prev) / prev) * 100).toFixed(2),
    series, candles, dayLow: Math.min(...series), dayHigh: Math.max(...series), open: true, unit: key === '^TNX' ? '%' : undefined };
  quoteCache.set(key, q);
  return q;
}
const quotes = { subscribe: (c) => normalizeCode(c)?.key, unsubscribe: on, get: demoQuote, on, refreshSoon: on };

const sys = { get: () => ({ cpu: 23, mem: 61, cpuHist: [12, 18, 25, 40, 22, 19, 30, 23], memHist: [58, 59, 60, 61], memUsedGb: 19.4, memTotalGb: 32, gpu: null }), on };
const wsl = { distro: 'Ubuntu', get: () => ({ distro: 'Ubuntu', running: ['Ubuntu'], mem: 34, load: 0.42 }), on, tick: on };
const iot = { get: () => ({ label: 'Desk lamp', on: true, sub: 'press to toggle' }), on, toggle: async () => false, refresh: async () => {} };

const album = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="0.5" stop-color="#c2185b"/><stop offset="1" stop-color="#311b92"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="92" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="18"/><circle cx="150" cy="150" r="30" fill="#fff" fill-opacity="0.85"/></svg>`).toString('base64');
const media = {
  media: { active: true, title: 'Midnight Commit', artist: 'The Refactors', status: 'Playing', position: 96, duration: 214, app: 'Spotify.exe', updatedAt: NOW },
  audio: { volume: 42, muted: false, micMuted: true, outputs: [{ name: 'Headphones (USB)', isDefault: true }, { name: 'Speakers' }] },
  art: { dataUrl: album, accent: '#c2185b' }, position: () => 96, on, control: async () => {}, setAudio: async () => {},
};

const cores = Array.from({ length: 16 }, () => Math.round(5 + rnd() * 85));
const hw = { get: () => ({
  cpu: 31, cores, ram: 64, ramUsed: 20.5 * 2 ** 30, ramTotal: 32 * 2 ** 30, gpu: 18, vram: 2.1 * 2 ** 30, netIn: 3.4 * 2 ** 20, netOut: 412 * 1024,
  diskRead: 18 * 2 ** 20, diskWrite: 6 * 2 ** 20, diskBusy: 14, uptime: 3 * 86400 + 7 * 3600 + 22 * 60,
  disks: [{ name: 'C:', total: 1e12, used: 6.1e11, pct: 61 }],
  hist: { cpu: Array.from({ length: 40 }, (_, i) => 20 + 15 * Math.sin(i / 4) + rnd() * 10), gpu: Array.from({ length: 40 }, () => 10 + rnd() * 20),
    netIn: Array.from({ length: 40 }, (_, i) => (i % 9 < 3 ? 3e6 : 4e5) * (0.6 + rnd())), netOut: Array.from({ length: 40 }, () => 3e5 * (0.5 + rnd())), ram: [62, 63, 64] },
  lhm: { cpuTemp: 58, gpuTemp: 46, fan: 1140 },
}), on };

const iso = (d) => new Date(NOW - d * 864e5).toISOString();
const pr = (repo, iid, title, extra = {}) => ({ project_id: repo, iid, title, web_url: `https://github.com/${repo}/pull/${iid}`, repo_url: `https://github.com/${repo}`,
  references: { full: `${repo}!${iid}` }, created_at: iso(extra.age ?? 2), updated_at: iso(extra.idle ?? 1), has_conflicts: !!extra.conflict, draft: !!extra.draft });
const boardMrs = [
  pr('acme/api', 412, 'Rate-limit the export endpoint', { age: 3 }), pr('acme/api', 415, 'Retry webhooks with backoff', { conflict: true, age: 5 }),
  pr('acme/web', 233, 'New onboarding flow', { age: 1 }), pr('acme/web', 236, 'Dark mode tokens', { age: 9, idle: 8 }),
  pr('acme/infra', 88, 'Terraform: split staging state'), pr('acme/mobile', 51, 'Offline cache', { age: 12, idle: 10 }),
  pr('acme/docs', 19, 'Quick start rewrite'), pr('acme/worker', 140, 'Batch size from env'), pr('acme/sdk', 77, 'Typed errors'),
];
const ci = { 'acme/api!412': 'FAILURE', 'acme/api!415': 'SUCCESS', 'acme/web!233': 'PENDING', 'acme/web!236': 'SUCCESS', 'acme/infra!88': 'SUCCESS', 'acme/mobile!51': 'FAILURE', 'acme/docs!19': 'SUCCESS', 'acme/worker!140': 'SUCCESS', 'acme/sdk!77': 'SUCCESS' };
const item = (repo, n, title, ci2) => ({ id: `#${n}`, title, url: '', repo, ci: ci2, draft: false });
const devopsState = {
  forge: { kind: 'github', auth: true, host: 'github.com', login: 'me',
    mine: [item('acme/api', 412, 'Rate-limit the export endpoint', 'failed'), item('acme/web', 233, 'New onboarding flow', 'running'), item('acme/docs', 19, 'Quick start rewrite', 'success')],
    reviews: [item('acme/infra', 88, 'Terraform: split staging state', 'success'), item('acme/sdk', 77, 'Typed errors', 'success')] },
  mrs: { forge: 'github', ...summarizeMrs(boardMrs, ci, NOW) },
  actions: { 'acme/api': { runs: [{ name: 'CI', status: 'completed', conclusion: 'success', branch: 'main', at: new Date(NOW - 12 * 60e3).toISOString() }] } },
  status: { claude: { indicator: 'none' }, github: { indicator: 'none' } },
  http: { 'https://api.example.com/health': { ok: true, code: 200, ms: 84 } }, docker: { up: true, running: 3, total: 4, names: [] }, n8n: { up: true },
};
const devops = { distro: 'Ubuntu', get: () => devopsState, on, watchUrl: on, unwatchUrl: on, watchRepo: on, unwatchRepo: on, refreshAll: async () => {} };

const pomodoro = new Pomodoro({ now: () => NOW });
Object.assign(pomodoro.s, { phase: 'focus', running: true, lengthMs: 25 * 60e3, endsAt: NOW + 14 * 60e3 + 32e3, dnd: true, goal: 8 });
for (let i = 0; i < 7; i++) { const d = new Date(NOW - i * 864e5); pomodoro.s.days[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = [5, 7, 4, 6, 8, 3, 2][i]; }

// Sessions: one waiting, one working, one done, one thinking.
const sessions = new SessionStore({ now: () => NOW });
const ev = (id, name, extra = {}) => sessions.ingest({ session_id: id, hook_event_name: name, ...extra });
ev('a', 'SessionStart', { cwd: '/home/dev/api-server', focus: { src: 'wsl', tmux_pane: '%1', tmux: '/tmp/tmux-1000/default,0,0' } });
ev('b', 'SessionStart', { cwd: '/home/dev/web-frontend' });
ev('c', 'SessionStart', { cwd: '/home/dev/infra' });
ev('d', 'SessionStart', { cwd: '/home/dev/docs-site' });
ev('a', 'PermissionRequest', { tool_name: 'Bash', tool_use_id: 't1' });
ev('b', 'PreToolUse', { tool_name: 'Edit' });
ev('c', 'Stop');
ev('d', 'UserPromptSubmit');
for (const [id, ctxPct] of [['a', 34], ['b', 58], ['c', 83], ['d', 12]]) Object.assign(sessions.get(id), { ctxPct, since: NOW - (2 + rnd() * 20) * 60e3 });
sessions.get('a').waitingSince = NOW - 95e3;

let t = NOW - 30 * 60e3;
const usage = new UsageStore({ now: () => t });
for (const pct of [41, 46, 50, 55, 59, 63]) { usage.ingest({ rate_limits: { five_hour: { used_percentage: pct, resets_at: NOW / 1000 + 74 * 60 }, seven_day: { used_percentage: 38, resets_at: NOW / 1000 + 3.2 * 86400 } }, cost: { total_cost_usd: 4.82 }, context_window: { used_percentage: 34 } }); t += 6 * 60e3; }
t = NOW;

// ---------------------------------------------------------------- render

const pages = createPageActions({ media, hw, devops, pomodoro, sessions, toast: on, now: () => NOW });
const deck = createDeck({ sessions, usage, quotes, sys, wsl, iot, layout: { apply: () => ({ ok: true }) }, focuser: { focus: async () => true }, pages, now: () => NOW });
deck.addSink('g', { setIcon: on, toast: on });
const PAGES = buildPages({ platform: 'win32' }); // the README shows the Windows deck (WSL key)
PAGES.forEach((page, i) => { for (const [key, action, settings] of page.keys) deck.add('g', `g___p${i}___${key}`, `${PLUGIN_UUID}.${action}`, settings, key); });

const OUT = path.join(REPO, 'docs', 'images');
const TMP = path.join(REPO, 'tmp', 'gallery');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const KEY = 132, GAP = 16;
function deviceHtml(i, title) {
  const keys = PAGES[i].keys.map(([key]) => {
    const [c, r] = key.split('_').map(Number);
    const wide = key === '3_2';
    const svg = deck.svgOf(`g___p${i}___${key}`) || '';
    return `<div class="key${wide ? ' wide' : ''}" style="grid-column:${c + 1}${wide ? ' / span 2' : ''};grid-row:${r + 1}"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  .wrap{padding:28px;display:inline-block}
  .device{background:linear-gradient(160deg,#30343b,#1b1d22);border-radius:30px;padding:30px 30px 22px;box-shadow:0 18px 50px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08)}
  .grid{display:grid;grid-template-columns:repeat(5,${KEY}px);grid-template-rows:repeat(3,${KEY}px);gap:${GAP}px}
  .key{border-radius:16px;overflow:hidden;background:#0d1117;box-shadow:0 0 0 2px #0a0b0e,0 4px 10px rgba(0,0,0,.5)}
  .key img{width:100%;height:100%;display:block}
  .label{font:600 15px "Segoe UI",sans-serif;color:#8b949e;text-align:center;margin-top:16px;letter-spacing:.08em}
  .brand{font:700 13px "Segoe UI",sans-serif;color:#6e7681;text-align:center;margin-bottom:14px;letter-spacing:.3em}
  </style></head><body><div class="wrap"><div class="device"><div class="brand">ULANZI</div><div class="grid">${keys}</div><div class="label">${title}</div></div></div></body></html>`;
}

const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(p => fs.existsSync(p));
const W = 28 * 2 + 30 * 2 + KEY * 5 + GAP * 4, H = 28 * 2 + 30 + 22 + 30 + KEY * 3 + GAP * 2 + 36;
function shot(html, name) {
  const file = path.join(TMP, `${name}.html`);
  fs.writeFileSync(file, html);
  if (!browser) { console.log('no Chrome/Edge found; wrote', file); return; }
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000',
    `--window-size=${W},${H}`, `--screenshot=${path.join(OUT, `${name}.png`)}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log('wrote', path.relative(REPO, path.join(OUT, `${name}.png`)));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
PAGES.forEach((p, i) => shot(deviceHtml(i, `${i + 1} · ${p.name.toUpperCase()}`), `page-${i + 1}-${slug(p.name)}`));
for (const theme of ['neon', 'glass']) {
  R.setTheme(theme);
  deck.renderAll(true);
  shot(deviceHtml(0, `THEME · ${theme.toUpperCase()}`), `theme-${theme}`);
}
R.setTheme('classic');
deck.stop();
pages.stop();
