import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { parseNetstat, parseGpu, parseDiskBytes } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/mac/helper.js';
import { parseEtime, parsePs, localRecords, LocalProvider } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/local.js';
import { screenFor } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/mac/windows.js';
import { sanitizeHookEvent } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/sessions.js';

const BRIDGE = new URL('../plugin/com.ulanzi.nwpie.ulanziPlugin/src/mac/bridge.jxa', import.meta.url);

test('parseNetstat sums link-level bytes, skips loopback and address rows', () => {
  const text = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                         5000     0     900000     5000     0     900000     0
lo0        16384 127           127.0.0.1          5000     -     900000     5000     -     900000     -
en0        1500  <Link#6>    a4:83:e7:00:00:01   120000     0  150000000    80000     0   20000000     0
en0        1500  192.168.1     192.168.1.20       100000     -  140000000    70000     -   19000000     -
utun0      1380  <Link#14>                           10     0       2000       12     0       3000     0`;
  assert.deepEqual(parseNetstat(text), { rx: 150002000, tx: 20003000 });
});

test('parseGpu / parseDiskBytes read ioreg dumps', () => {
  const gpu = '"PerformanceStatistics" = {"In use system memory"=1234567,"Device Utilization %"=37,"Renderer Utilization %"=30}';
  assert.deepEqual(parseGpu(gpu), { gpu: 37, vram: 1234567 });
  assert.deepEqual(parseGpu('nothing here'), { gpu: null, vram: null });
  const disk = '"Statistics" = {"Operations (Write)"=5,"Bytes (Read)"=1000,"Bytes (Write)"=200}\n"Statistics" = {"Bytes (Read)"=24,"Bytes (Write)"=6}';
  assert.deepEqual(parseDiskBytes(disk), { read: 1024, write: 206 });
  assert.equal(parseDiskBytes(''), null);
});

test('ps etime parsing and registry records with the pid-reuse guard', () => {
  assert.equal(parseEtime('05:07'), 307);
  assert.equal(parseEtime('02:05:07'), 7507);
  assert.equal(parseEtime('3-02:05:07'), 266707);
  assert.equal(parseEtime('bogus'), null);
  const ps = parsePs('  501   01:00:00 ttys003\n  777      00:10 ??\n');
  assert.deepEqual(ps.get('501'), { ageSec: 3600, tty: 'ttys003' });
  assert.deepEqual(ps.get('777'), { ageSec: 10, tty: '' });

  const now = 10_000_000_000;
  const entries = [
    { pid: '501', json: { sessionId: 'a', cwd: '/Users/me/api', name: 'api', status: 'busy', startedAt: now - 1800e3, kind: 'interactive', tmux: '%3' } },
    { pid: '777', json: { sessionId: 'b', cwd: '/Users/me/web', startedAt: now - 3600e3 } }, // process younger than the session: pid reused
    { pid: '900', json: { sessionId: 'c', cwd: '/x', startedAt: now } }, // not running
    { pid: '501', json: { sessionId: 'd', kind: 'sdk' } }, // not interactive
  ];
  const recs = localRecords(entries, ps, { now, tmuxSocket: '/tmp/tmux-501/default' });
  assert.deepEqual(recs, [{
    session_id: 'a', cwd: '/Users/me/api', title: 'api', busy: true,
    focus: { src: 'mac', pid: '501', tty: 'ttys003', tmux_pane: '%3', tmux: '/tmp/tmux-501/default,0,0' },
  }]);
});

test('LocalProvider groups only this Mac\'s sessions and checks pids locally', async () => {
  const p = new LocalProvider({ dir: '/nonexistent' });
  assert.equal(p.groupOf({ focus: { src: 'mac', pid: '1' } }), 'local');
  assert.equal(p.groupOf({ focus: { src: 'wsl', distro: 'Ubuntu', pid: '1' } }), null);
  assert.deepEqual(await p.discoverSessions(), []);
  const alive = await p.alivePids('local', [String(process.pid), '999999999']);
  assert.ok(alive.has(String(process.pid)) && !alive.has('999999999'));
});

test('screenFor picks the screen holding most of the window', () => {
  const screens = [
    { full: { x: 0, y: 0, w: 1512, h: 982 }, work: { x: 0, y: 33, w: 1512, h: 949 } },
    { full: { x: 1512, y: -200, w: 2560, h: 1440 }, work: { x: 1512, y: -175, w: 2560, h: 1415 } },
  ];
  assert.equal(screenFor({ x: 1400, y: 100, w: 800, h: 600 }, screens), screens[1]);
  assert.equal(screenFor({ x: 100, y: 100, w: 800, h: 600 }, screens), screens[0]);
  assert.equal(screenFor(null, screens), screens[0]);
  assert.equal(screenFor({ x: 0, y: 0, w: 1, h: 1 }, []), null);
});

test('hook focus keeps the tty (macOS tab focus)', () => {
  const ev = sanitizeHookEvent({ session_id: 's', hook_event_name: 'Stop', focus: { src: 'mac', tty: 'ttys004', secret: 'x' } });
  assert.deepEqual(ev.focus, { src: 'mac', tty: 'ttys004' });
});

test('JXA bridge parses as JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(BRIDGE, 'utf8'), { filename: 'bridge.jxa' }));
});

// On a Mac (CI runs macos-latest) the bridge runs for real: every command must answer a JSON envelope.
test('JXA bridge answers through osascript', { skip: process.platform !== 'darwin' }, () => {
  for (const cmd of ['screens', 'media', 'volume', 'nope']) {
    const out = execFileSync('osascript', ['-l', 'JavaScript', BRIDGE.pathname, cmd], { encoding: 'utf8', timeout: 20e3 });
    const r = JSON.parse(out.trim());
    assert.equal(typeof r.ok, 'boolean', `${cmd}: ${out}`);
    if (cmd === 'nope') assert.equal(r.ok, false);
    if (cmd === 'screens' && r.ok) assert.ok(Array.isArray(r.data));
  }
});
