// Local hub: receives Claude Code hook/statusLine posts and serves state + a browser preview.
// Binds 127.0.0.1 only (WSL mirrored networking reaches it as localhost).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from './sessions.js';
import { UsageStore } from './usage.js';
import { DATA_DIR } from './log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = Number(process.env.ULANZI_LAB_PORT) || 39300;
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export function createStores({ log = () => {} } = {}) {
  const sessions = new SessionStore();
  const usage = new UsageStore();
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const fresh = (j.sessions || []).filter(s => Date.now() - s.lastEvent < 12 * 3600e3);
    sessions.load(fresh);
    usage.load(j.usage || {});
    log('state restored', fresh.length, 'sessions');
  } catch { /* first run */ }
  let t = null;
  const save = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try { fs.writeFileSync(STATE_FILE, JSON.stringify({ sessions: sessions.toJSON(), usage: usage.toJSON() })); } catch (e) { log('save failed', e.message); }
    }, 1000);
  };
  sessions.on('change', save);
  usage.on('change', save);
  return { sessions, usage };
}

/**
 * Prune sessions whose claude process is gone. `host` is where Claude Code runs: WslProvider on Windows
 * (pids checked in one wsl.exe call per distro) or LocalProvider on macOS.
 */
export function startLiveness({ sessions, host, log = () => {}, everyMs = 30e3 }) {
  // Sessions only report on their next hook; after a hub restart an idle session would stay invisible.
  // Claude Code's own registry lists every live session, so seed from it.
  const discover = async () => {
    const found = await host.discoverSessions?.();
    for (const rec of found || []) if (sessions.seed(rec)) log('discovered session', rec.cwd.split('/').pop(), rec.focus.pid);
  };
  const tick = async () => {
    await discover();
    const byGroup = new Map();
    for (const s of sessions.list()) {
      const g = host.groupOf?.(s);
      if (!g) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(s);
    }
    for (const [group, list] of byGroup) {
      if (host.isDown?.(group)) { list.forEach(s => sessions.remove(s.id)); continue; }
      const alive = await host.alivePids(group, list.map(s => s.focus.pid));
      if (!alive) continue;
      for (const s of list) if (!alive.has(String(s.focus.pid))) { log('liveness: drop', s.project, s.focus.pid); sessions.remove(s.id); }
    }
    sessions.expire(6 * 3600e3); // sessions without pid info
  };
  const timer = setInterval(() => tick().catch(e => log('liveness', e.message)), everyMs);
  setTimeout(() => discover().catch(e => log('discover', e.message)), 3000);
  return () => clearInterval(timer);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export function startHub({ sessions, usage, deck, focuser, providers = {}, port = DEFAULT_PORT, log = () => {} }) {
  const clients = new Set();
  const state = () => ({
    now: Date.now(),
    sessions: sessions.list(),
    waiting: sessions.waiting().map(s => s.id),
    counts: sessions.counts(),
    usage: usage.snapshot(),
    keys: deck ? deck.contexts().filter(c => c.sinkId === 'preview').map(c => ({ ...c, svg: deck.svgOf(c.ctx) })) : [],
    nag: deck?.nag?.enabled ?? false,
    theme: deck?.theme?.() ?? 'classic',
    pageNames: providers.pageNames || [],
    sys: providers.sys?.get() ?? null,
    wsl: providers.wsl?.get() ?? null,
  });

  let pending = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const data = `data: ${JSON.stringify(state())}\n\n`;
      for (const res of clients) res.write(data);
    }, 150);
  };
  sessions.on('change', broadcast);
  usage.on('change', broadcast);
  const tick = setInterval(broadcast, 1000);

  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST') {
        // CSRF guard: browsers can't send a cross-origin application/json POST without a preflight we never answer.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'json only' });
        const body = await readJson(req);
        if (url.pathname === '/hook') {
          const s = sessions.ingest(body);
          return json(res, 200, { ok: true, state: s?.state ?? null });
        }
        if (url.pathname === '/usage') {
          usage.ingest(body);
          sessions.updateMetrics({ session_id: body.session_id, ctxPct: body.context_window?.used_percentage, costUsd: body.cost?.total_cost_usd, model: body.model?.display_name });
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/press' && deck) {
          await deck.pressNow(body.ctx, !!body.long);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/focus' && focuser) {
          const s = sessions.get(body.id);
          if (s) sessions.ack(s.id);
          return json(res, s ? 200 : 404, { ok: s ? await focuser.focus(s) : false });
        }
        if (url.pathname === '/demo' && deck) {
          // { slots: { "1": {state, kind?, project?, tool?, ctxPct?, ageSec?} }, seconds } or { stop: true }
          if (body.stop) { deck.setDemo(null); return json(res, 200, { ok: true }); }
          const t = Date.now();
          const slots = {};
          for (const [slot, d] of Object.entries(body.slots || {})) {
            const since = t - (Number(d.ageSec) || 0) * 1000;
            slots[slot] = { id: `demo-${slot}`, slot: Number(slot), project: d.project || d.state, state: d.state || 'idle', kind: d.kind || null,
              tool: d.tool || null, ctxPct: d.ctxPct ?? null, since, waitingSince: d.state === 'waiting' ? since : null, acked: !!d.acked };
          }
          deck.setDemo(slots, (Number(body.seconds) || 30) * 1000);
          return json(res, 200, { ok: true, slots: Object.keys(slots).length });
        }
        if (url.pathname === '/theme' && deck) { deck.setTheme(String(body.name || 'classic')); broadcast(); return json(res, 200, { ok: true, theme: deck.theme() }); }
        if (url.pathname === '/mascot' && deck) { deck.mascotEvent(String(body.mood || 'celebrate'), Number(body.ms) || 3000); return json(res, 200, { ok: true }); }
        if (url.pathname === '/nag' && deck) { deck.nag.enabled = !!body.enabled; broadcast(); return json(res, 200, { ok: true }); }
        if (url.pathname === '/reset') { for (const s of sessions.list()) sessions.remove(s.id); return json(res, 200, { ok: true }); }
        return json(res, 404, { error: 'not found' });
      }
      if (url.pathname === '/state') return json(res, 200, state());
      if (url.pathname === '/health') return json(res, 200, { ok: true, sessions: sessions.list().length });
      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(state())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/' || url.pathname === '/preview') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(HERE, 'preview.html')));
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      log('hub error', req.method, url.pathname, e.message);
      json(res, 400, { error: e.message });
    }
  });
  // The previous plugin process may still hold the port for a moment (Studio restarts): retry for ~30 s.
  let tries = 0;
  server.on('error', (e) => {
    log('hub listen error', e.code, e.message);
    if (e.code === 'EADDRINUSE' && ++tries <= 15) setTimeout(() => server.listen(port, '127.0.0.1'), 2000);
  });
  server.on('listening', () => log(`hub listening on http://127.0.0.1:${port}`));
  server.listen(port, '127.0.0.1');
  return { server, broadcast, close: () => { clearInterval(tick); server.close(); } };
}
