// CI (Windows runner with WSL): the plugin side, running on Windows Node, must reach the default WSL distro
// the way it does in Ulanzi Studio: distro detection, status, session discovery, pid liveness, login shell.
//   node test/ci/wsl-bridge.mjs
import assert from 'node:assert/strict';
import { defaultDistro } from '../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/distro.js';
import { WslProvider } from '../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/wsl.js';
import { hostShell } from '../../plugin/com.ulanzi.nwpie.ulanziPlugin/src/platform.js';

const distro = defaultDistro();
const wsl = new WslProvider({ distro });

// A long-running process inside WSL, registered like a live interactive session (procStart = /proc start time).
const setup = await hostShell([
  'mkdir -p ~/.claude/sessions',
  'nohup setsid sleep 600 >/dev/null 2>&1 &',
  'p=$!',
  'st=$(cut -d" " -f22 /proc/$p/stat)',
  'printf \'{"sessionId":"ci-session","cwd":"/tmp/ci-project","kind":"interactive","status":"busy","procStart":"%s"}\' "$st" > ~/.claude/sessions/$p.json',
  'echo $p',
].join('\n'), { distro });
assert.ok(setup.ok, `setup failed: ${setup.err}`);
const pid = setup.out.trim();

try {
  await wsl.tick();
  assert.ok(wsl.get().running.includes(distro), `${distro} should be running: ${JSON.stringify(wsl.get())}`);
  assert.ok(wsl.get().mem > 0, 'memory from /proc/meminfo');

  const found = await wsl.discoverSessions();
  const s = found?.find(x => x.session_id === 'ci-session');
  if (!s) {
    const diag = await hostShell(`id; echo "HOME=$HOME"; ls -la ~/.claude/sessions; cat ~/.claude/sessions/${Number(pid)}.json; echo; `
      + `ps -o pid,stat,lstart,args -p ${Number(pid)}; cut -d" " -f22 /proc/${Number(pid)}/stat`, { distro });
    assert.fail(`session not discovered: ${JSON.stringify(found)}\n${diag.out}${diag.err}`);
  }
  assert.deepEqual([s.cwd, s.busy, s.focus.src, s.focus.distro, s.focus.pid], ['/tmp/ci-project', true, 'wsl', distro, pid]);

  const alive = await wsl.alivePids(distro, [pid, '999999']);
  assert.ok(alive.has(pid) && !alive.has('999999'), `liveness: ${[...alive]}`);

  const login = await hostShell('echo "$0 ok"', { distro, login: true });
  assert.ok(login.ok && /ok/.test(login.out), `login shell: ${login.err}`);
  console.log(`wsl bridge ok: ${distro}, session pid ${pid}`);
} finally {
  await hostShell(`kill ${Number(pid)} 2>/dev/null; rm -f ~/.claude/sessions/${Number(pid)}.json`, { distro });
}
