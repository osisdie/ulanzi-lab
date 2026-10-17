// DevOps / automation monitor. Code review comes from one "forge", chosen per machine:
//   GitLab (glab in WSL, self-hosted hosts supported) or GitHub (gh in WSL, GitHub Enterprise via host)
// Both feed the same shapes: my PRs/MRs, review requests, and the review board (every open PR/MR in scope,
// CI + conflicts + staleness, per repo). Plus GitHub Actions, status pages, HTTP checks, Docker, n8n.
// Settings: ULANZI_LAB_FORGE (auto|gitlab|github), ULANZI_LAB_GITLAB_HOST, ULANZI_LAB_GITHUB_HOST,
// ULANZI_LAB_BOARD_SCOPE (GitHub search qualifiers), ULANZI_LAB_ACTIONS_REPO — see .env.example.
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { env } from '../env.js';

export const STATUS_PAGES = {
  claude: 'https://status.claude.com/api/v2/status.json',
  github: 'https://www.githubstatus.com/api/v2/status.json',
};

/** First host `glab auth status` reports as logged in (e.g. a self-hosted GitLab), else null. */
export function glabHost(text) {
  return /Logged in to (\S+)/.exec(String(text))?.[1] || null;
}

/** Normalise CI states to one vocabulary: success | failed | running | canceled | none. */
export function normCi(s) {
  const v = String(s || '').toLowerCase();
  if (/^(success|passed)$/.test(v)) return 'success';
  if (/^(failure|failed|error|timed_out)$/.test(v)) return 'failed';
  if (/^(pending|expected|running|created|waiting_for_resource|preparing|scheduled|in_progress|queued)$/.test(v)) return 'running';
  if (/^(canceled|cancelled|skipped|manual)$/.test(v)) return 'canceled';
  return 'none';
}

export const STALE_DAYS = 7;
const CI_RANK = { failed: 4, canceled: 2, running: 3, success: 1, none: 0 };

/**
 * Open MRs/PRs (GitLab REST shape; GitHub PRs are converted to it) + latest pipeline status per item → the board:
 * totals, per-repo rollups (worst first), and the problem items (CI failed / merge conflict).
 * `ci` maps "project_id!iid" → CI status; missing = no pipeline.
 */
export function summarizeMrs(mrs, ci = {}, now = Date.now()) {
  const days = (iso) => Math.floor((now - Date.parse(iso)) / 864e5);
  const list = (mrs || []).map(m => {
    const repo = m.references?.full?.split('!')[0] || String(m.project_id);
    return {
      repo, name: repo.split('/').pop(), iid: m.iid, title: m.title, url: m.web_url, draft: !!m.draft,
      repoUrl: m.repo_url || String(m.web_url || '').split('/-/merge_requests')[0],
      ci: normCi(ci[`${m.project_id}!${m.iid}`]),
      conflict: !!m.has_conflicts || m.detailed_merge_status === 'conflict',
      age: days(m.created_at), idle: days(m.updated_at),
    };
  });
  for (const m of list) m.stale = m.idle >= STALE_DAYS;
  const byRepo = new Map();
  for (const m of list) {
    if (!byRepo.has(m.repo)) byRepo.set(m.repo, { repo: m.repo, name: m.name, url: m.repoUrl, mrs: [] });
    byRepo.get(m.repo).mrs.push(m);
  }
  const count = (xs, f) => xs.filter(f).length;
  const repos = [...byRepo.values()].map(r => ({
    ...r, open: r.mrs.length, ciFailed: count(r.mrs, m => m.ci === 'failed'), conflicts: count(r.mrs, m => m.conflict),
    stale: count(r.mrs, m => m.stale), oldest: Math.max(...r.mrs.map(m => m.age)),
    ci: r.mrs.reduce((w, m) => ((CI_RANK[m.ci] ?? 0) > (CI_RANK[w] ?? 0) ? m.ci : w), 'none'),
  })).sort((a, b) => (b.ciFailed + b.conflicts) - (a.ciFailed + a.conflicts) || b.open - a.open || b.oldest - a.oldest);
  const problems = list.filter(m => m.ci === 'failed' || m.conflict).sort((a, b) => (b.ci === 'failed') - (a.ci === 'failed') || b.age - a.age);
  return {
    total: list.length, ciFailed: count(list, m => m.ci === 'failed'), conflicts: count(list, m => m.conflict),
    stale: count(list, m => m.stale), drafts: count(list, m => m.draft), oldest: list.length ? Math.max(...list.map(m => m.age)) : 0,
    repos, problems, stalest: [...list].sort((a, b) => b.idle - a.idle).filter(m => m.stale),
  };
}

// ---------------------------------------------------------------- GitHub

const GH_MINE = `query {
  viewer { login pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
    number title url isDraft repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
  reviews: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 20) { nodes {
    ... on PullRequest { number title url isDraft repository { nameWithOwner } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
}`;

const GH_BOARD = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest {
    number title url isDraft createdAt updatedAt mergeable repository { nameWithOwner url }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
}`;

const ghCi = (n) => normCi(n?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state);
const ghItem = (n) => ({ id: `#${n.number}`, title: n.title, url: n.url, repo: n.repository?.nameWithOwner || '', ci: ghCi(n), draft: !!n.isDraft });

/** gh GraphQL "mine" reply → {login, mine, reviews} in the neutral item shape. */
export function parseGithubMine(j) {
  const v = j?.data?.viewer;
  if (!v) return null;
  return { login: v.login, mine: (v.pullRequests?.nodes || []).map(ghItem), reviews: (j.data.reviews?.nodes || []).filter(n => n?.number).map(ghItem) };
}

/** gh GraphQL board search → [mrs (GitLab shape), ci map] for summarizeMrs. */
export function githubBoard(j) {
  const nodes = (j?.data?.search?.nodes || []).filter(n => n?.number);
  const ci = {};
  const mrs = nodes.map((n) => {
    const repo = n.repository?.nameWithOwner || '';
    ci[`${repo}!${n.number}`] = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || '';
    return {
      project_id: repo, iid: n.number, title: n.title, web_url: n.url, repo_url: n.repository?.url, draft: n.isDraft,
      has_conflicts: n.mergeable === 'CONFLICTING', created_at: n.createdAt, updated_at: n.updatedAt, references: { full: `${repo}!${n.number}` },
    };
  });
  return [mrs, ci];
}

export function parseDocker(text) {
  const rows = String(text).split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { total: rows.length, running: rows.filter(r => /^Up/i.test(r.Status || '')).length, names: rows.map(r => r.Names) };
}

const q1 = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export class DevopsProvider extends EventEmitter {
  constructor({ distro = 'Ubuntu', log = () => {} } = {}) {
    super();
    this.distro = distro;
    this.log = log;
    this.s = { forge: null, mrs: null, actions: {}, status: {}, http: {}, docker: null, n8n: null };
    this.urls = new Map(); // url -> refs
    this.repos = new Map(); // repo -> refs (GitHub Actions keys)
    this.want = (env('ULANZI_LAB_FORGE', 'auto') || 'auto').toLowerCase();
    this.glHost = env('ULANZI_LAB_GITLAB_HOST') || null; // null = the host glab is logged in to
    this.ghHost = env('ULANZI_LAB_GITHUB_HOST', 'github.com');
    this.scope = env('ULANZI_LAB_BOARD_SCOPE', 'involves:@me');
    const repo = env('ULANZI_LAB_ACTIONS_REPO');
    if (repo) this.repos.set(repo, 1);
    this.timers = [];
  }

  wsl(cmd, timeout = 20000) {
    return new Promise((resolve) => {
      execFile('wsl.exe', ['-d', this.distro, '-e', 'bash', '-lc', cmd], { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
    });
  }

  /** Which forge this machine uses: ULANZI_LAB_FORGE, else whichever CLI is logged in (GitLab first). */
  async forgeKind() {
    if (this.want === 'gitlab' || this.want === 'github') return this.want;
    if (this._auto) return this._auto;
    const gl = glabHost((await this.wsl('command -v glab >/dev/null && glab auth status 2>&1')).out);
    if (gl) return (this._auto = 'gitlab');
    const gh = await this.wsl(`command -v gh >/dev/null && gh auth status --hostname ${q1(this.ghHost)} 2>&1`);
    if (/Logged in to/i.test(gh.out)) return (this._auto = 'github');
    return 'gitlab'; // nothing logged in: show the GitLab login hint (set ULANZI_LAB_FORGE=github to change)
  }

  async forge() {
    const kind = await this.forgeKind();
    return kind === 'github' ? this.github() : this.gitlab();
  }

  async gitlab() {
    const host = this.glHost || glabHost((await this.wsl('glab auth status 2>&1')).out);
    if (!host) { this.s.forge = { kind: 'gitlab', auth: false, error: 'glab: not logged in (glab auth login)', at: Date.now() }; return; }
    const api = (q) => this.wsl(`glab api --hostname ${q1(host)} ${q1(q)}`);
    const user = await api('user');
    let me;
    try { me = JSON.parse(user.out); } catch { me = null; }
    if (!me?.username) { this.s.forge = { kind: 'gitlab', auth: false, host, error: /401/.test(user.out + user.err) ? 'glab: token expired (glab auth login)' : 'glab unavailable', at: Date.now() }; return; }
    const get = async (q) => { const r = await api(q); try { return JSON.parse(r.out); } catch { return []; } };
    const mine = await get('merge_requests?state=opened&scope=created_by_me&per_page=20');
    const review = await get(`merge_requests?state=opened&scope=all&reviewer_username=${encodeURIComponent(me.username)}&per_page=20`);
    const pick = (m) => ({ id: `!${m.iid}`, title: m.title, url: m.web_url, repo: m.references?.full?.split('!')[0] || '', ci: normCi(m.head_pipeline?.status), draft: !!m.draft });
    this.s.forge = { kind: 'gitlab', auth: true, host, login: me.username, mine: (mine || []).map(pick), reviews: (review || []).map(pick), at: Date.now() };
    await this.gitlabBoard(api);
  }

  /** GitLab board: every open MR you can see, plus each one's latest pipeline (a few in parallel). */
  async gitlabBoard(api) {
    const r = await api('merge_requests?state=opened&scope=all&per_page=100');
    let mrs;
    try { mrs = JSON.parse(r.out); } catch { this.s.mrs = { forge: 'gitlab', error: 'glab api failed', at: Date.now() }; return; }
    const ci = {};
    const queue = [...mrs];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let m; (m = queue.shift());) {
        const p = await api(`projects/${m.project_id}/merge_requests/${m.iid}/pipelines?per_page=1`);
        try { const s = JSON.parse(p.out)[0]?.status; if (s) ci[`${m.project_id}!${m.iid}`] = s; } catch { /* no pipeline */ }
      }
    }));
    this.s.mrs = { forge: 'gitlab', ...summarizeMrs(mrs, ci), at: Date.now() };
  }

  async github() {
    const host = this.ghHost;
    const gql = (query, vars = {}) => this.wsl(`gh api graphql --hostname ${q1(host)} -f query=${q1(query)} ${Object.entries(vars).map(([k, v]) => `-f ${k}=${q1(v)}`).join(' ')}`);
    const r = await gql(GH_MINE);
    let mine = null;
    try { mine = parseGithubMine(JSON.parse(r.out)); } catch { /* not logged in / offline */ }
    if (!mine) {
      const auth = /auth|login|401|token/i.test(r.out + r.err);
      this.s.forge = { kind: 'github', ...(auth ? { auth: false } : {}), host, error: auth ? 'gh: not logged in (gh auth login)' : 'gh unavailable', at: Date.now() };
      return;
    }
    this.s.forge = { kind: 'github', auth: true, host, ...mine, at: Date.now() };
    // Actions: the configured repo, else the repos of your open PRs.
    if (!this.repos.size) for (const p of mine.mine) this.s.actions[p.repo] ||= null;
    const b = await gql(GH_BOARD, { q: `is:pr is:open archived:false ${this.scope}` });
    try { const [mrs, ci] = githubBoard(JSON.parse(b.out)); this.s.mrs = { forge: 'github', ...summarizeMrs(mrs, ci), at: Date.now() }; }
    catch { this.s.mrs = { forge: 'github', error: 'gh api failed', at: Date.now() }; }
    await this.actions();
  }

  async actions() {
    const repos = new Set([...this.repos.keys(), ...Object.keys(this.s.actions)]);
    for (const repo of repos) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue;
      const r = await this.wsl(`gh api --hostname ${q1(this.ghHost)} ${q1(`repos/${repo}/actions/runs?per_page=5`)}`);
      try {
        const runs = JSON.parse(r.out).workflow_runs || [];
        this.s.actions[repo] = { runs: runs.map(x => ({ name: x.name, status: x.status, conclusion: x.conclusion, branch: x.head_branch, url: x.html_url, at: x.created_at })), at: Date.now() };
      } catch { this.s.actions[repo] = { error: 'gh api failed', at: Date.now() }; }
    }
  }

  async statusPages() {
    for (const [k, url] of Object.entries(STATUS_PAGES)) {
      try {
        const j = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
        this.s.status[k] = { indicator: j.status?.indicator || 'unknown', description: j.status?.description || '', at: Date.now() };
      } catch (e) { this.s.status[k] = { indicator: 'unknown', description: 'unreachable', at: Date.now() }; }
    }
  }

  async httpChecks() {
    for (const url of this.urls.keys()) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000), redirect: 'follow' });
        // Reachable = the service answered; 5xx is down, auth errors (401/403) still mean "up".
        this.s.http[url] = { ok: r.status < 500, code: r.status, ms: Date.now() - t0, at: Date.now() };
      } catch (e) { this.s.http[url] = { ok: false, code: 0, ms: Date.now() - t0, error: e.cause?.code || e.name, at: Date.now() }; }
    }
  }

  async docker() {
    const out = await new Promise((resolve) => execFile('docker', ['ps', '-a', '--format', '{{json .}}'], { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout))));
    this.s.docker = out == null ? { up: false, at: Date.now() } : { up: true, ...parseDocker(out), at: Date.now() };
  }

  async n8n(url = env('ULANZI_LAB_N8N_URL', 'http://127.0.0.1:5678') + '/healthz') {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      this.s.n8n = { up: r.ok, code: r.status, at: Date.now() };
    } catch { this.s.n8n = { up: false, at: Date.now() }; }
  }

  watchUrl(url) { if (url) { this.urls.set(url, (this.urls.get(url) || 0) + 1); this.httpChecks(); } }
  unwatchUrl(url) { const n = (this.urls.get(url) || 0) - 1; if (n <= 0) this.urls.delete(url); else this.urls.set(url, n); }
  watchRepo(repo) { if (repo) { this.repos.set(repo, (this.repos.get(repo) || 0) + 1); this.s.actions[repo] ||= null; } }
  unwatchRepo(repo) { const n = (this.repos.get(repo) || 0) - 1; if (n <= 0) this.repos.delete(repo); else this.repos.set(repo, n); }

  get() { return this.s; }

  every(ms, fn) {
    const run = () => fn().then(() => this.emit('change')).catch(e => this.log('devops', fn.name, e.message));
    this.timers.push(setInterval(run, ms));
    setTimeout(run, 500 + Math.random() * 1500);
  }

  async refreshAll() {
    this._auto = null; // re-detect the forge (e.g. right after a CLI login)
    await Promise.all([this.forge(), this.statusPages(), this.httpChecks(), this.docker(), this.n8n()]);
    this.emit('change');
  }

  start() {
    // Tick every 15 s, but only re-poll on the full interval unless logged out (so a fresh login shows up quickly).
    const due = (v, ms) => !v || v.error || v.auth === false || Date.now() - v.at >= ms - 1000;
    this.every(15e3, async function forge() { if (due(this.s.forge, 180e3)) await this.forge(); }.bind(this));
    this.every(120e3, this.statusPages.bind(this));
    this.every(60e3, this.httpChecks.bind(this));
    this.every(30e3, this.docker.bind(this));
    this.every(60e3, () => this.n8n());
  }

  stop() { this.timers.forEach(clearInterval); }
}
