import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glabHost, parseDocker, summarizeMrs, normCi, parseGithubMine, githubBoard } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/devops.js';
import { parseLhm } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/hw.js';
import { Pomodoro } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/pomodoro.js';
import { tmuxScript, autoTarget, promptTargets } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/prompts.js';
import * as P from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/render-pages.js';
import { buildPages, symLabel } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/pages.js';
import { parseEnv } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/env.js';

test('glabHost picks the logged-in (self-hosted) host', () => {
  const out = 'gitlab.com\n  x gitlab.com: api call failed: 401\n  x No token provided\nexample.internal\n  ✓ Logged in to example.internal as me (/home/u/.config/glab-cli/config.yml)\n';
  assert.equal(glabHost(out), 'example.internal');
  assert.equal(glabHost('gitlab.com\n  x No token provided\n'), null);
});

test('summarizeMrs: per-repo rollup, CI failures, conflicts, stale', () => {
  const now = Date.parse('2026-10-16T00:00:00Z');
  const mr = (pid, iid, repo, extra = {}) => ({ project_id: pid, iid, title: 't', web_url: `https://h/${repo}/-/merge_requests/${iid}`,
    references: { full: `${repo}!${iid}` }, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-15T00:00:00Z', ...extra });
  const b = summarizeMrs([
    mr(1, 1, 'g/api'), mr(1, 2, 'g/api', { has_conflicts: true }), mr(2, 3, 'g/web', { detailed_merge_status: 'conflict', updated_at: '2026-09-01T00:00:00Z' }),
    mr(3, 4, 'g/ops', { draft: true }),
  ], { '1!1': 'failed', '2!3': 'success' }, now);
  assert.equal(b.total, 4);
  assert.equal(b.ciFailed, 1);
  assert.equal(b.conflicts, 2);
  assert.equal(b.stale, 1);
  assert.equal(b.drafts, 1);
  assert.equal(b.oldest, 15);
  assert.deepEqual(b.repos.map(r => [r.name, r.open, r.ciFailed, r.conflicts]), [['api', 2, 1, 1], ['web', 1, 0, 1], ['ops', 1, 0, 0]]);
  assert.equal(b.repos[0].url, 'https://h/g/api');
  assert.equal(b.repos[0].ci, 'failed');
  assert.deepEqual(b.problems.map(m => m.iid), [1, 2, 3]);
  assert.equal(b.stalest[0].iid, 3);
  assert.equal(summarizeMrs([]).total, 0);
});

test('parseDocker counts running containers', () => {
  const d = parseDocker('{"Names":"db","Status":"Up 2 hours"}\n{"Names":"old","Status":"Exited (0) 3 days ago"}\n');
  assert.deepEqual(d, { total: 2, running: 1, names: ['db', 'old'] });
});

test('parseLhm finds CPU/GPU temps and fan', () => {
  const tree = { Text: 'Sensor', Children: [
    { Text: 'Intel Core i7', Children: [{ Text: 'Temperatures', Children: [{ Text: 'CPU Package', Type: 'Temperature', Value: '61,0 °C' }] }] },
    { Text: 'NVIDIA GeForce', Children: [{ Text: 'GPU Core', Type: 'Temperature', Value: '48.0 °C' }] },
    { Text: 'Fans', Children: [{ Text: 'Fan #1', Type: 'Fan', Value: '1200 RPM' }] },
  ] };
  assert.deepEqual(parseLhm(tree), { cpuTemp: 61, gpuTemp: 48, fan: 1200 });
});

test('pomodoro: focus → break → idle, counts, pause, DND quiet', () => {
  let t = Date.parse('2026-10-15T09:00:00');
  const p = new Pomodoro({ now: () => t });
  p.toggle();
  assert.equal(p.s.phase, 'focus');
  assert.ok(p.quiet());
  t += 10 * 60e3; p.toggle(); // pause at 15 min left
  assert.equal(Math.round(p.remaining() / 60e3), 15);
  t += 60 * 60e3; assert.equal(p.tick(), null); // paused: nothing happens
  p.toggle(); t += 15 * 60e3 + 1;
  const evt = p.tick();
  assert.equal(evt.type, 'focus-done');
  assert.equal(p.today(), 1);
  assert.equal(p.s.phase, 'break');
  t += 5 * 60e3 + 1;
  assert.equal(p.tick().type, 'break-done');
  assert.equal(p.s.phase, 'idle');
  p.cycleLength(); assert.equal(p.s.focusMin, 50);
  // 4th block → long break
  p.s.streak = 3; p.toggle(); t += 50 * 60e3 + 1;
  assert.equal(p.tick().long, true);
  assert.equal(p.s.phase, 'long');
  assert.equal(p.week().at(-1).count, 2);
});

test('tmux send-keys script quotes text and filters keys', () => {
  const f = { tmux: '/tmp/tmux-1000/default,123,0', tmux_pane: '%3' };
  const sh = tmuxScript(f, { text: "it's done; rm -rf /", keys: ['Escape', 'evil;rm', 'Enter'], enter: true });
  assert.match(sh, /send-keys -t '%3' -l 'it'\\''s done; rm -rf \/'/);
  assert.match(sh, / Escape/);
  assert.doesNotMatch(sh, /evil/);
  assert.equal((sh.match(/Enter/g) || []).length, 2);
  const sessions = [
    { id: 'a', state: 'working', lastEvent: 5, focus: { tmux: 'x', tmux_pane: '%1' } },
    { id: 'b', state: 'waiting', waitingSince: 9, lastEvent: 1, focus: { tmux: 'x', tmux_pane: '%2' } },
    { id: 'c', state: 'waiting', waitingSince: 3, lastEvent: 1, focus: {} },
  ];
  assert.equal(promptTargets(sessions).length, 2);
  assert.equal(autoTarget(sessions).id, 'b');
  assert.equal(autoTarget([sessions[0]]).id, 'a');
});

/** Build pages with explicit settings (tests must not depend on the machine's .env). */
function pagesWith(vars) {
  const keys = ['ULANZI_LAB_FORGE', 'ULANZI_LAB_WATCHLIST', 'ULANZI_LAB_WATCHLIST_STRIP', 'ULANZI_LAB_HTTP_CHECKS', 'ULANZI_LAB_ACTIONS_REPO'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return buildPages(); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('pages: every layout is unique in-range keys; .env drives forge, home row, watchlist', () => {
  const gitlab = pagesWith({ ULANZI_LAB_FORGE: 'gitlab' });
  const github = pagesWith({
    ULANZI_LAB_FORGE: 'github',
    ULANZI_LAB_WATCHLIST: '^DJI:Dow,QQQ,NVDA:Nvidia', ULANZI_LAB_WATCHLIST_STRIP: 'GC=F:Gold,SI=F:Silver',
    ULANZI_LAB_HTTP_CHECKS: 'https://x.test/|X,https://y.test/', ULANZI_LAB_ACTIONS_REPO: 'o/r',
  });
  assert.deepEqual(gitlab.map(p => p.name), ['Claude', 'Windows', 'Markets', 'Media', 'Focus', 'Hardware', 'DevOps', 'MR Board', 'Claude Pad']);
  assert.deepEqual(github.map(p => p.name), ['Claude', 'Windows', 'Markets', 'Watchlist', 'Media', 'Focus', 'Hardware', 'DevOps', 'PR Board', 'Claude Pad']);
  for (const p of [...gitlab, ...github]) {
    const keys = p.keys.map(k => k[0]);
    assert.ok(keys.length <= 14 && new Set(keys).size === keys.length, p.name);
    for (const k of keys) assert.match(k, /^[0-4]_[0-2]$/, p.name);
    assert.ok(!keys.includes('4_2'), `${p.name}: 4_2 is covered by the wide key`);
  }
  // Page 1 bottom row is a fixed pomodoro + CI/CD row (no stocks); the CI/CD key follows the forge.
  const home = (pages) => pages[0].keys.filter(k => k[0].endsWith('_2') && k[0] !== '3_2').map(k => `${k[1]}:${k[2].part ?? k[2].kind}`);
  assert.deepEqual(home(gitlab), ['focus:timer', 'focus:count', 'devops:mr-ci']);
  assert.deepEqual(home(github), ['focus:timer', 'focus:count', 'devops:gh-actions']);
  const devops = (pages) => Object.fromEntries(pages.find(p => p.name === 'DevOps').keys.map(k => [k[0], k[2]]));
  assert.equal(devops(github)['2_1'].kind, 'gh-actions');
  assert.equal(devops(github)['2_1'].repo, 'o/r');
  assert.equal(devops(github)['1_1'].url, 'https://x.test/');
  assert.equal(devops(gitlab)['2_1'].kind, 'mr-ci');
  assert.equal(devops(gitlab)['1_1'].label, 'Anthropic API');
  const watch = github.find(p => p.name === 'Watchlist').keys;
  assert.deepEqual(watch.find(k => k[0] === '0_0')[2], { code: '^DJI', label: 'Dow' });
  assert.deepEqual(watch.find(k => k[0] === '3_2')[2], { code: 'GC=F,SI=F', label: 'Gold,Silver' });
  assert.deepEqual(symLabel('otc:6488'), ['otc:6488', '']);
  assert.deepEqual(symLabel('GC=F:金'), ['GC=F', '金']);
});

test('parseEnv: comments, quotes, export, trailing comments', () => {
  const text = ['# c', 'A=1', 'export B = "x y" ', "C='q # kept'", 'D=v # note', 'bad line', ''].join('\n');
  assert.deepEqual(parseEnv(text), { A: '1', B: 'x y', C: 'q # kept', D: 'v' });
});

test('GitHub → neutral items and review board', () => {
  assert.equal(normCi('SUCCESS'), 'success');
  assert.equal(normCi('FAILURE'), 'failed');
  assert.equal(normCi('PENDING'), 'running');
  assert.equal(normCi(undefined), 'none');
  const pr = (n, state, extra = {}) => ({
    number: n, title: 't' + n, url: `https://github.com/o/r/pull/${n}`, isDraft: false, repository: { nameWithOwner: 'o/r', url: 'https://github.com/o/r' },
    commits: { nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }] }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', ...extra,
  });
  const mine = parseGithubMine({ data: { viewer: { login: 'me', pullRequests: { nodes: [pr(1, 'FAILURE')] } }, reviews: { nodes: [pr(2, null), {}] } } });
  assert.deepEqual(mine.mine[0], { id: '#1', title: 't1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', ci: 'failed', draft: false });
  assert.equal(mine.reviews.length, 1);
  assert.equal(parseGithubMine({}), null);
  const [mrs, ci] = githubBoard({ data: { search: { nodes: [pr(5, 'FAILURE'), pr(6, 'SUCCESS', { mergeable: 'CONFLICTING' })] } } });
  const b = summarizeMrs(mrs, ci, Date.parse('2026-10-16T00:00:00Z'));
  assert.equal(b.total, 2);
  assert.equal(b.ciFailed, 1);
  assert.equal(b.conflicts, 1);
  assert.equal(b.stale, 2);
  assert.equal(b.repos[0].url, 'https://github.com/o/r');
});

test('all new page templates render clean SVG', () => {
  const now = Date.now();
  const pomo = new Pomodoro({ now: () => now });
  const hw = { cpu: 33, cores: [10, 90, 50, 5, 70, 20, 0, 100], ram: 64, ramUsed: 2 ** 34, ramTotal: 2 ** 35, gpu: 12, vram: 6e8, netIn: 123456, netOut: 2048, diskRead: 1e6, diskWrite: 3e5, diskBusy: 7, uptime: 93784,
    disks: [{ name: 'C:', total: 1e12, used: 6e11, pct: 60 }], hist: { cpu: [1, 2, 3], gpu: [4, 5], netIn: [0, 100, 50], netOut: [1, 1], ram: [60, 61] }, lhm: null };
  const mr = (iid, ci) => ({ id: `!${iid}`, title: `mr ${iid}`, url: 'u', repo: 'g/p', ci });
  const board = summarizeMrs([
    { project_id: 1, iid: 7, title: 'fix', web_url: 'https://h/g/api/-/merge_requests/7', references: { full: 'g/api!7' }, has_conflicts: true, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
    { project_id: 2, iid: 8, title: 'feat', web_url: 'https://h/g/web/-/merge_requests/8', references: { full: 'g/web!8' }, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' },
  ], { '2!8': 'failed' }, now);
  const dev = { mrs: board, forge: { kind: 'gitlab', auth: true, host: 'example.internal', login: 'me', mine: [mr(1, 'failed'), mr(2, 'success')], reviews: [mr(3, 'running')] },
    actions: { 'o/r': { runs: [{ name: 'CI', status: 'completed', conclusion: 'failure', branch: 'main', at: new Date().toISOString() }] } },
    status: { claude: { indicator: 'major' } }, http: { 'https://a.b/': { ok: false, code: 0, ms: 12, error: 'ENOTFOUND' } }, docker: { up: false }, n8n: { up: false } };
  const media = { media: { active: true, title: '夜に駆ける', artist: 'YOASOBI', status: 'Playing', position: 30, duration: 260, app: 'Spotify.exe' },
    audio: { volume: 40, muted: false, micMuted: true, outputs: [{ name: 'Headphones (USB)', isDefault: true }] }, art: { dataUrl: 'data:image/png;base64,AAAA', accent: '#aa3355' } };
  const target = { id: 't', slot: 2, project: 'ulanzi_lab', state: 'waiting', kind: 'permission', tool: 'Bash', focus: { tmux: 'x', tmux_pane: '%1' } };
  const svgs = [
    ...['art', 'prev', 'next', 'play', 'vol', 'voldown', 'volup', 'mic', 'output', 'spotify', 'ytmusic', 'wide'].map(p => P.mediaKey(p, media, { now, position: 31 })),
    P.mediaKey('art', { media: { active: false }, audio: null, art: null }), P.mediaKey('wide', { media: { active: false } }), P.mediaKey('mic', { audio: { micMuted: null } }),
    ...['timer', 'reset', 'plus', 'length', 'break', 'long', 'count', 'dnd', 'mascot', 'clock', 'week', 'wide'].map(p => P.focusKey(p, pomo, { now, frame: 3 })),
    ...['cpu', 'ram', 'gpu', 'cores', 'vram', 'disk', 'netdown', 'netup', 'diskio', 'uptime', 'temps', 'wide'].map(m => P.hwKey(m, hw)),
    P.hwKey('temps', { ...hw, lhm: { cpuTemp: 88, gpuTemp: 50, fan: 900 } }), P.hwKey('cpu', null),
    ...['cr-mine', 'cr-reviews', 'gl-mrs', 'gh-reviews', 'gh-actions', 'status-claude', 'status-github', 'docker', 'n8n', 'wide', 'mr-total', 'mr-ci', 'mr-conflict', 'mr-stale', 'mr-wide'].map(k => P.devopsKey(k, dev, { phase: 1, repo: 'o/r' })),
    ...['cr-mine', 'wide', 'mr-total', 'mr-wide'].map(k => P.devopsKey(k, { ...dev, forge: { ...dev.forge, kind: 'github' }, mrs: { ...board, forge: 'github' } }, { phase: 1 })),
    ...[0, 1, 9].map(slot => P.devopsKey('mr-repo', dev, { slot, phase: 1 })), P.devopsKey('mr-total', {}), P.devopsKey('mr-wide', { mrs: { error: 'x' } }),
    P.devopsKey('mr-wide', { mrs: summarizeMrs([]) }), P.devopsKey('mr-ci', { mrs: summarizeMrs([]) }),
    P.devopsKey('http', dev, { url: 'https://a.b/', label: 'API' }), P.devopsKey('cr-mine', {}), P.devopsKey('cr-reviews', { forge: { kind: 'gitlab', auth: false } }), P.devopsKey('wide', { forge: { kind: 'github', auth: false, error: 'x' } }), P.devopsKey('gh-actions', {}),
    P.promptKey('Approve', { target, icon: '1', needsWaiting: true }), P.promptKey('continue', { target: { ...target, state: 'working' } }), P.promptKey('/clear', { target, hold: true }), P.promptKey('x', {}),
    P.targetKey(target, { count: 2, phase: 1 }), P.targetKey(null),
  ];
  for (const s of svgs) {
    assert.match(s, /^<svg [^>]+>.*<\/svg>$/s);
    assert.doesNotMatch(s, /undefined|NaN|Infinity|\[object/);
  }
  assert.equal(P.fmtRate(123456), '121KB/s');
  assert.equal(P.fmtRate(12345), '12.1KB/s');
  assert.equal(P.fmtRate(500), '500B/s');
});
