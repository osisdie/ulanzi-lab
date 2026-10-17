#!/usr/bin/env node
// Simulate N Claude Code sessions cycling through states, posting to the hub like the real hooks.
//   node scripts/fake-sessions.mjs [--n 4] [--hub http://127.0.0.1:39300] [--seconds 120] [--usage]
// Sessions are prefixed "fake-" and send SessionEnd on exit (Ctrl+C).
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? true : d; };
const HUB = arg('hub', process.env.ULANZI_HUB || 'http://127.0.0.1:39300');
const N = Number(arg('n', 4));
const SECONDS = Number(arg('seconds', 120));
const USAGE = process.argv.includes('--usage');

const projects = ['web-app', 'ulanzi_lab', 'ai-winform-ui', 'infra', 'docs-site', 'mobile', 'ml-pipeline', 'api'];
const post = (path, body) => fetch(HUB + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
const sessions = Array.from({ length: N }, (_, i) => ({ id: `fake-${i + 1}-${Math.random().toString(36).slice(2, 6)}`, cwd: `/home/dev/${projects[i % projects.length]}` }));
const ev = (s, name, extra = {}) => post('/hook', { session_id: s.id, hook_event_name: name, cwd: s.cwd, ts: Date.now(), focus: { src: 'fake' }, ...extra });

// Weighted random walk that spends most time working and regularly asks for a human.
const STEPS = [
  [30, (s) => ev(s, 'PreToolUse', { tool_name: ['Read', 'Edit', 'Bash', 'Grep'][Math.floor(Math.random() * 4)] })],
  [10, (s) => ev(s, 'UserPromptSubmit')],
  [8, (s) => ev(s, 'PermissionRequest', { tool_name: 'Bash', tool_use_id: 'tu_' + Date.now() })],
  [3, (s) => ev(s, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q_' + Date.now() })],
  [12, (s) => ev(s, 'PostToolUse', {})],
  [8, (s) => ev(s, 'Stop')],
];
const total = STEPS.reduce((a, [w]) => a + w, 0);
const pick = () => { let r = Math.random() * total; for (const [w, f] of STEPS) if ((r -= w) < 0) return f; return STEPS[0][1]; };

async function main() {
  console.log(`hub ${HUB} · ${N} fake sessions · ${SECONDS}s`);
  for (const s of sessions) await ev(s, 'SessionStart');
  const end = Date.now() + SECONDS * 1000;
  const timer = setInterval(() => {
    const s = sessions[Math.floor(Math.random() * N)];
    pick()(s);
    if (USAGE) post('/usage', { session_id: s.id, rate_limits: { five_hour: { used_percentage: 20 + Math.random() * 70, resets_at: Date.now() / 1000 + 5400 }, seven_day: { used_percentage: 35, resets_at: Date.now() / 1000 + 400000 } }, context_window: { used_percentage: Math.round(Math.random() * 80) }, cost: { total_cost_usd: Math.random() * 3 }, model: { display_name: 'Opus 5.5' } });
    if (Date.now() > end) stop();
  }, 1500);
  const stop = async () => { clearInterval(timer); for (const s of sessions) await ev(s, 'SessionEnd'); console.log('done'); process.exit(0); };
  process.on('SIGINT', stop);
}
main();
