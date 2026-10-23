import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nodeCandidates, findPatchedNode, supervise } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/supervisor.js';

test('node candidates: override first, then PATH, then installer locations', () => {
  const win = nodeCandidates({ ULANZI_LAB_NODE: 'D:\\node\\node.exe', Path: 'C:\\tools;C:\\Program Files\\nodejs', ProgramFiles: 'C:\\Program Files' }, 'win32');
  assert.deepEqual(win.slice(0, 3), ['D:\\node\\node.exe', 'C:\\tools\\node.exe', 'C:\\Program Files\\nodejs\\node.exe']);
  assert.equal(win.filter(f => f === 'C:\\Program Files\\nodejs\\node.exe').length, 1, 'deduplicated');
  const mac = nodeCandidates({ PATH: '/usr/bin' }, 'darwin');
  assert.deepEqual(mac.slice(0, 3), ['/usr/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node']);
});

test('findPatchedNode never picks the Node that is running it, or missing files', () => {
  assert.equal(findPatchedNode({ candidates: [process.execPath, '/nonexistent/node'] }), null);
});

test('supervise gives up after repeated fast exits so the plugin can run in-process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-sup-'));
  const entry = path.join(dir, 'crash.mjs');
  fs.writeFileSync(entry, 'process.exit(3);\n');
  const lines = [];
  const ok = await supervise({ file: process.execPath, version: process.version }, entry, [], { log: (...a) => lines.push(a.join(' ')), maxFastExits: 2 });
  assert.equal(ok, false);
  assert.equal(lines.filter(l => l.includes('child ended')).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('supervise exits with a child that stopped on purpose (exit 0) instead of restarting it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-sup-'));
  const entry = path.join(dir, 'done.mjs');
  fs.writeFileSync(entry, 'process.exit(0);\n');
  const lines = [];
  const code = await new Promise((resolve) => {
    supervise({ file: process.execPath, version: process.version }, entry, [], { log: (...a) => lines.push(a.join(' ')), exit: resolve })
      .then(() => resolve('resolved instead of exiting'));
  });
  assert.equal(code, 0);
  assert.equal(lines.filter(l => l.includes('supervisor: started')).length, 1, 'not restarted');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('node-floor runs as a script through a symlinked path too', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-floor-'));
  const link = path.join(dir, 'node-floor.js');
  fs.symlinkSync(path.resolve('plugin/com.ulanzi.nwpie.ulanziPlugin/src/node-floor.js'), link);
  const r = spawnSync(process.execPath, [link], { encoding: 'utf8' });
  assert.match(r.stdout + r.stderr, /security fixes|end of life/);
  fs.rmSync(dir, { recursive: true, force: true });
});
