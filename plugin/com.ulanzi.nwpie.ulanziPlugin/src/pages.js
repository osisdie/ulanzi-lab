// Default D200X pages (keys are "col_row"; 3_2 is the 2-column wide key; 0_3/1_3 are the page buttons).
// Shared by the browser preview (runtime.js) and the profile generator (scripts/make-profile.mjs).
// Per-machine choices come from .env (see .env.example): forge, home row, watchlist, HTTP checks, Actions repo.
import { env, envList } from './env.js';

export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.nwpie';

/** "SYM:label" → ['SYM', 'label'] (label optional; symbols may contain '=' or '^'; "otc:6488" is a code). */
export const symLabel = (item) => { const i = item.lastIndexOf(':'); return i > 0 && !/^otc$/i.test(item.slice(0, i)) ? [item.slice(0, i), item.slice(i + 1)] : [item, '']; };
const stock = (item) => { const [code, label] = symLabel(item); return ['stock', label ? { code, label } : { code }]; };
/** "a:A,b:B" strip spec → one stock key with comma lists. */
const strip = (items) => { const pairs = items.map(symLabel); return ['stock', { code: pairs.map(p => p[0]).join(','), label: pairs.map(p => p[1]).join(',') }]; };
/** "url|label" → http check settings. */
const http = (spec) => { const [url, label] = spec.split('|').map(s => s.trim()); return ['devops', { kind: 'http', url, label: label || '' }]; };

export function buildPages() {
  const forge = env('ULANZI_LAB_FORGE', 'auto').toLowerCase();
  const word = forge === 'github' ? 'PR' : forge === 'gitlab' ? 'MR' : 'Review';

  // DevOps page: HTTP checks from ULANZI_LAB_HTTP_CHECKS ("url|label,url|label"); default checks the Claude API.
  const checks = envList('ULANZI_LAB_HTTP_CHECKS').map(http);
  if (!checks.length) checks.push(['devops', { kind: 'http', url: 'https://api.anthropic.com/', label: 'Anthropic API' }]);
  const ciKey = forge === 'github' ? ['devops', { kind: 'gh-actions', repo: env('ULANZI_LAB_ACTIONS_REPO') }] : ['devops', { kind: 'mr-ci' }];

  const pages = [
    {
      // Focus-work home: Claude sessions + HITL, usage/health, then a pomodoro + CI/CD bottom row (stocks live on Markets/Watchlist).
      name: 'Claude',
      keys: [
        ['0_0', 'session', { slot: 1 }], ['1_0', 'session', { slot: 2 }], ['2_0', 'session', { slot: 3 }], ['3_0', 'session', { slot: 4 }], ['4_0', 'hitl', { nag: 'off', theme: 'classic', style: 'mascot' }],
        ['0_1', 'usage', { window: '5h' }], ['1_1', 'usage', { window: '7d' }], ['2_1', 'sys', {}], ['3_1', 'wsl', {}], ['4_1', 'iot', { device: 'mock.lamp' }],
        ['0_2', 'focus', { part: 'timer' }], ['1_2', 'focus', { part: 'count' }], ['2_2', ...ciKey], ['3_2', 'usage', { window: 'wide' }],
      ],
    },
    {
      name: 'Windows',
      keys: [
        ['0_0', 'layout', { mode: 'left' }], ['1_0', 'layout', { mode: 'right' }], ['2_0', 'layout', { mode: 'top' }], ['3_0', 'layout', { mode: 'bottom' }], ['4_0', 'layout', { mode: 'maximize' }],
        ['0_1', 'layout', { mode: 'tl' }], ['1_1', 'layout', { mode: 'tr' }], ['2_1', 'layout', { mode: 'bl' }], ['3_1', 'layout', { mode: 'br' }], ['4_1', 'layout', { mode: 'center' }],
        ['0_2', 'layout', { mode: 'third2' }], ['1_2', 'layout', { mode: 'split2' }], ['2_2', 'layout', { mode: 'grid4' }], ['3_2', 'hitl', { style: 'mascot' }],
      ],
    },
    {
      name: 'Markets',
      keys: [
        ['0_0', 'stock', { code: 't00', label: '加權指數' }], ['1_0', 'stock', { code: '^DJI' }], ['2_0', 'stock', { code: '^GSPC' }], ['3_0', 'stock', { code: '^IXIC' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'stock', { code: '^SOX' }], ['1_1', 'stock', { code: '^N225' }], ['2_1', 'stock', { code: 'TWD=X' }], ['3_1', 'stock', { code: 'DX-Y.NYB' }], ['4_1', 'stock', { code: 'JPY=X' }],
        ['0_2', 'stock', { code: 'GC=F' }], ['1_2', 'stock', { code: 'CL=F' }], ['2_2', 'stock', { code: 'BTC-USD' }],
        ['3_2', 'stock', { code: 'BZ=F,SI=F,HG=F', label: '布蘭特,白銀,銅' }],
      ],
    },
  ];

  // Optional watchlist page: up to 12 symbols (ULANZI_LAB_WATCHLIST) + a 3-row strip on the wide key (ULANZI_LAB_WATCHLIST_STRIP).
  const watch = envList('ULANZI_LAB_WATCHLIST').slice(0, 12);
  if (watch.length) {
    const slots = ['0_0', '1_0', '2_0', '3_0', '0_1', '1_1', '2_1', '3_1', '4_1', '0_2', '1_2', '2_2'];
    const keys = watch.map((item, i) => [slots[i], ...stock(item)]);
    keys.push(['4_0', 'hitl', { style: 'mascot' }]);
    const stripItems = envList('ULANZI_LAB_WATCHLIST_STRIP').slice(0, 3);
    keys.push(['3_2', ...(stripItems.length ? strip(stripItems) : ['hitl', { style: 'mascot' }])]);
    pages.push({ name: 'Watchlist', keys });
  }

  pages.push(
    {
      name: 'Media',
      keys: [
        ['0_0', 'media', { part: 'art' }], ['1_0', 'media', { part: 'prev' }], ['2_0', 'media', { part: 'play' }], ['3_0', 'media', { part: 'next' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'media', { part: 'vol' }], ['1_1', 'media', { part: 'voldown', step: 5 }], ['2_1', 'media', { part: 'volup', step: 5 }], ['3_1', 'media', { part: 'mic' }], ['4_1', 'media', { part: 'output' }],
        ['0_2', 'media', { part: 'spotify' }], ['1_2', 'media', { part: 'ytmusic' }], ['2_2', 'focus', { part: 'clock' }], ['3_2', 'media', { part: 'wide' }],
      ],
    },
    {
      name: 'Focus',
      keys: [
        ['0_0', 'focus', { part: 'timer' }], ['1_0', 'focus', { part: 'reset' }], ['2_0', 'focus', { part: 'plus' }], ['3_0', 'focus', { part: 'length' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'focus', { part: 'count' }], ['1_1', 'focus', { part: 'dnd' }], ['2_1', 'focus', { part: 'break' }], ['3_1', 'focus', { part: 'long' }], ['4_1', 'focus', { part: 'mascot' }],
        ['0_2', 'focus', { part: 'clock' }], ['1_2', 'focus', { part: 'week' }], ['2_2', 'media', { part: 'play' }], ['3_2', 'focus', { part: 'wide' }],
      ],
    },
    {
      name: 'Hardware',
      keys: [
        ['0_0', 'hw', { metric: 'cpu' }], ['1_0', 'hw', { metric: 'cores' }], ['2_0', 'hw', { metric: 'ram' }], ['3_0', 'hw', { metric: 'gpu' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'hw', { metric: 'vram' }], ['1_1', 'hw', { metric: 'disk', disk: 'C:' }], ['2_1', 'wsl', {}], ['3_1', 'hw', { metric: 'netdown' }], ['4_1', 'hw', { metric: 'netup' }],
        ['0_2', 'hw', { metric: 'diskio' }], ['1_2', 'hw', { metric: 'uptime' }], ['2_2', 'hw', { metric: 'temps' }], ['3_2', 'hw', { metric: 'wide' }],
      ],
    },
    {
      name: 'DevOps',
      keys: [
        ['0_0', 'devops', { kind: 'cr-mine' }], ['1_0', 'devops', { kind: 'cr-reviews' }], ['2_0', 'devops', { kind: 'status-claude' }],
        ['3_0', 'devops', { kind: 'docker' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'devops', { kind: 'n8n' }], ['1_1', ...checks[0]], ['2_1', ...ciKey], ['3_1', 'usage', { window: '5h' }], ['4_1', 'usage', { window: '7d' }],
        ['0_2', ...(checks[1] || ['wsl', {}])], ['1_2', 'devops', { kind: 'status-github' }], ['2_2', 'hw', { metric: 'cpu' }],
        ['3_2', 'devops', { kind: 'wide' }],
      ],
    },
    {
      name: `${word} Board`,
      keys: [
        ['0_0', 'devops', { kind: 'mr-total' }], ['1_0', 'devops', { kind: 'mr-ci' }], ['2_0', 'devops', { kind: 'mr-conflict' }], ['3_0', 'devops', { kind: 'mr-stale' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'devops', { kind: 'mr-repo', slot: 0 }], ['1_1', 'devops', { kind: 'mr-repo', slot: 1 }], ['2_1', 'devops', { kind: 'mr-repo', slot: 2 }],
        ['3_1', 'devops', { kind: 'mr-repo', slot: 3 }], ['4_1', 'devops', { kind: 'mr-repo', slot: 4 }],
        ['0_2', 'devops', { kind: 'mr-repo', slot: 5 }], ['1_2', 'devops', { kind: 'mr-repo', slot: 6 }], ['2_2', 'devops', { kind: 'mr-repo', slot: 7 }],
        ['3_2', 'devops', { kind: 'mr-wide' }],
      ],
    },
    {
      name: 'Claude Pad',
      keys: [
        ['0_0', 'prompt', { label: 'Approve', icon: '1', keys: '1', needsWaiting: 'on' }], ['1_0', 'prompt', { label: 'Always', icon: '2', keys: '2', needsWaiting: 'on' }],
        ['2_0', 'prompt', { label: 'Esc / stop', icon: 'Esc', keys: 'Escape' }], ['3_0', 'prompt', { label: 'Enter', icon: '↵', keys: 'Enter' }], ['4_0', 'hitl', { style: 'mascot' }],
        ['0_1', 'prompt', { label: 'continue', text: 'continue' }], ['1_1', 'prompt', { label: '/compact', text: '/compact' }],
        ['2_1', 'prompt', { label: 'run tests', text: 'Run the tests and fix any failures.' }], ['3_1', 'prompt', { label: 'commit', text: 'Commit the current changes with a clear message.' }],
        ['4_1', 'prompt', { label: 'review diff', text: 'Review the current diff for bugs and risky changes.' }],
        ['0_2', 'prompt', { label: '/clear', text: '/clear', hold: 'on' }], ['1_2', 'prompt', { label: 'explain error', text: 'Explain the last error and propose a fix.' }],
        ['2_2', 'prompt', { label: 'plan first', text: 'Make a plan first; do not edit files yet.' }], ['3_2', 'target', {}],
      ],
    },
  );
  return pages;
}

export const PAGES = buildPages();

export const ACTION_NAMES = {
  session: 'Claude Session', hitl: 'Claude HITL', usage: 'Claude Usage', stock: 'Stock Quote',
  sys: 'System Health', wsl: 'WSL', iot: 'AIoT', layout: 'Window Layout',
  media: 'Media & Audio', focus: 'Focus Timer', hw: 'Hardware', devops: 'DevOps', prompt: 'Claude Prompt', target: 'Claude Target',
};
