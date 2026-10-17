import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, sanitizeHookEvent, projectName } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/sessions.js';

function store() {
  let t = 1000;
  const s = new SessionStore({ now: () => t });
  return { s, tick: (ms = 1000) => (t += ms), ev: (name, extra = {}) => s.ingest({ session_id: 'a', hook_event_name: name, cwd: '/home/u/proj', ...extra }) };
}

test('sanitize drops prompts and tool inputs', () => {
  const out = sanitizeHookEvent({ session_id: 'a', hook_event_name: 'PreToolUse', prompt: 'secret', tool_input: { command: 'rm -rf' }, transcript_path: '/x', tool_name: 'Bash', focus: { src: 'wsl', evil: 1 } });
  assert.deepEqual(Object.keys(out).sort(), ['focus', 'hook_event_name', 'session_id', 'tool_name']);
  assert.deepEqual(out.focus, { src: 'wsl' });
  assert.equal(JSON.stringify(out).includes('secret'), false);
});

test('projectName handles posix + windows paths', () => {
  assert.equal(projectName('/home/u/git/ulanzi_lab/'), 'ulanzi_lab');
  assert.equal(projectName('C:\\writable\\git\\nwpie\\ulanzi_lab'), 'ulanzi_lab');
});

test('state table', () => {
  const { s, ev } = store();
  const cases = [
    ['SessionStart', {}, 'idle'],
    ['UserPromptSubmit', {}, 'thinking'],
    ['PreToolUse', { tool_name: 'Edit' }, 'working'],
    ['PostToolUse', { tool_name: 'Edit' }, 'working'],
    ['PermissionRequest', { tool_name: 'Bash', tool_use_id: 't1' }, 'waiting'],
    ['PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' }, 'working'],
    ['Notification', { notification_type: 'permission_prompt' }, 'waiting'],
    ['UserPromptSubmit', {}, 'thinking'],
    ['Stop', {}, 'done'],
    ['Notification', { notification_type: 'idle_prompt' }, 'done'],
    ['StopFailure', {}, 'error'],
    ['PreCompact', {}, 'thinking'],
  ];
  for (const [name, extra, want] of cases) assert.equal(ev(name, extra).state, want, `${name} → ${want}`);
  assert.equal(s.list().length, 1);
  ev('SessionEnd');
  assert.equal(s.list().length, 0);
});

test('waiting kinds: permission / question / plan', () => {
  const { ev } = store();
  assert.equal(ev('PermissionRequest', { tool_name: 'Bash' }).kind, 'permission');
  ev('PostToolUse');
  assert.equal(ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q' }).kind, 'question');
  ev('PostToolUse', { tool_use_id: 'q' });
  assert.equal(ev('PreToolUse', { tool_name: 'ExitPlanMode' }).kind, 'plan');
  ev('PostToolUse');
  assert.equal(ev('Notification', { notification_type: 'elicitation_dialog' }).kind, 'question');
});

test('parallel tool finishing does not clear a pending permission', () => {
  const { ev } = store();
  ev('PermissionRequest', { tool_name: 'Bash', tool_use_id: 'pending' });
  assert.equal(ev('PostToolUse', { tool_name: 'Read', tool_use_id: 'other' }).state, 'waiting');
  assert.equal(ev('PreToolUse', { tool_name: 'Grep' }).state, 'waiting');
  assert.equal(ev('PostToolUse', { tool_use_id: 'pending' }).state, 'working');
});

test('waitingSince kept across duplicate signals; out-of-order events ignored', () => {
  const { ev, tick } = store();
  const first = ev('PermissionRequest', { ts: 100 }).waitingSince;
  tick(5000);
  assert.equal(ev('Notification', { notification_type: 'permission_prompt', ts: 200 }).waitingSince, first);
  assert.equal(ev('PostToolUse', { ts: 150 }).state, 'waiting'); // stale event
});

test('slots: first-seen order, reuse freed slot, waiting queue oldest first', () => {
  let t = 0;
  const s = new SessionStore({ now: () => ++t });
  for (const id of ['a', 'b', 'c']) s.ingest({ session_id: id, hook_event_name: 'SessionStart' });
  assert.deepEqual(s.list().map(x => [x.id, x.slot]), [['a', 1], ['b', 2], ['c', 3]]);
  s.ingest({ session_id: 'b', hook_event_name: 'SessionEnd' });
  s.ingest({ session_id: 'd', hook_event_name: 'SessionStart' });
  assert.equal(s.get('d').slot, 2);
  s.ingest({ session_id: 'c', hook_event_name: 'PermissionRequest' });
  s.ingest({ session_id: 'a', hook_event_name: 'PermissionRequest' });
  assert.deepEqual(s.waiting().map(x => x.id), ['c', 'a']);
  s.ack('c');
  assert.equal(s.get('c').acked, true);
  s.ingest({ session_id: 'c', hook_event_name: 'PostToolUse' });
  assert.equal(s.get('c').acked, false);
});

import { parseRegistry } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/providers/wsl.js';

test('registry discovery: live interactive sessions only, pid-reuse guard, tmux pane; seed fills gaps', () => {
  const rec = (o) => JSON.stringify({ kind: 'interactive', entrypoint: 'cli', ...o });
  const text = ['1000',
    `4645\t20606\tpts/0\t${rec({ pid: 4645, sessionId: 'a', cwd: '/home/u/web', procStart: '20606', status: 'busy', name: 'WEB', tmux: 'claude:@0.%3' })}`,
    `77\t999\tpts/1\t${rec({ pid: 77, sessionId: 'b', cwd: '/x', procStart: '123' })}`, // pid reused
    `88\t5\t?\t${rec({ pid: 88, sessionId: 'c', cwd: '/y', kind: 'bg' })}`, // background job
    `99\t6\t?\tnot json`,
  ].join('\n');
  const found = parseRegistry(text, 'Ubuntu');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { session_id: 'a', cwd: '/home/u/web', title: 'WEB', busy: true,
    focus: { src: 'wsl', distro: 'Ubuntu', pid: '4645', tty: 'pts/0', tmux_pane: '%3', tmux: '/tmp/tmux-1000/default,0,0' } });
  const s = new SessionStore();
  assert.equal(s.seed(found[0]), true);
  assert.equal(s.get('a').state, 'working');
  assert.equal(s.get('a').slot, 1);
  assert.equal(s.seed(found[0]), false); // already known
  s.ingest({ session_id: 'z', hook_event_name: 'SessionStart', focus: { src: 'wsl' } });
  s.seed({ session_id: 'z', focus: { pid: '5', src: 'other' } });
  assert.deepEqual(s.get('z').focus, { src: 'wsl', pid: '5' }); // only missing hints are filled
});
