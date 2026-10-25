// CI smoke test: boot the whole plugin runtime (hub, providers, this OS's backends) without Ulanzi Studio,
// check the hub serves state for every preview key, then shut down.
//   node test/ci/smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ULANZI_LAB_ENV_FILE = path.join(os.tmpdir(), 'ulanzi-lab-smoke-has-no-env'); // ignore any real .env
process.env.ULANZI_LAB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-lab-smoke-')); // not the real log / state
const port = 39390;
const { createRuntime } = await import('../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/runtime.js');
const { PAGES } = await import('../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/pages.js');
const { VOICE_PAGES } = await import('../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice-pages.js');

const rt = createRuntime({ port });
try {
  await new Promise(r => setTimeout(r, 3000)); // providers' first ticks
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(5000) })).json();
  assert.equal((await get('/health')).ok, true);
  const state = await get('/state');
  const expected = [...PAGES, ...VOICE_PAGES].reduce((n, p) => n + p.keys.length, 0);
  assert.equal(state.keys.length, expected, 'one preview key per page key');
  for (const k of state.keys) assert.match(String(k.svg), /^<svg/, `${k.ctx} rendered`);
  console.log(`smoke ok on ${process.platform} (node ${process.version}): ${state.keys.length} keys, ${state.sessions.length} sessions`);
} finally {
  rt.stop();
}
process.exit(0); // provider timers / helper processes must not keep CI waiting
