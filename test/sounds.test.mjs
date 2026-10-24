import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSounds, createSoundPlayer, SOUND_EVENTS } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/sounds.js';

const CONFIG = new URL('../plugin/com.ulanzi.nwpie.ulanziPlugin/config/', import.meta.url);

test('shipped sound configs: valid JSON with a value for every event', () => {
  for (const f of ['sounds.windows.json', 'sounds.mac.json']) {
    const j = JSON.parse(fs.readFileSync(new URL(f, CONFIG), 'utf8'));
    for (const e of SOUND_EVENTS) assert.ok(typeof j[e] === 'string' && j[e], `${f}: ${e}`);
  }
  assert.deepEqual(loadSounds({ platform: 'win32', override: '' }), {
    focusDone: 'C:\\Windows\\Media\\Alarm01.wav', breakDone: 'C:\\Windows\\Media\\Alarm01.wav', waiting: 'C:\\Windows\\Media\\chimes.wav',
  });
  assert.equal(loadSounds({ platform: 'darwin', override: '' }).waiting, '/System/Library/Sounds/Glass.aiff');
  assert.deepEqual(loadSounds({ platform: 'linux', override: '' }), { focusDone: null, breakDone: null, waiting: null });
});

test('the default sound files exist on this OS', { skip: !['win32', 'darwin'].includes(process.platform) }, () => {
  for (const [e, f] of Object.entries(loadSounds({ override: '' }))) assert.ok(fs.existsSync(f), `${e}: ${f}`);
});

test('override file changes only the keys it sets; "off" and "" mute', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-sounds-'));
  const file = path.join(dir, 'sounds.json');
  fs.writeFileSync(file, JSON.stringify({ focusDone: 'D:\\sounds\\gong.wav', waiting: 'off', breakDone: '' }));
  assert.deepEqual(loadSounds({ platform: 'win32', override: file }), { focusDone: 'D:\\sounds\\gong.wav', breakDone: null, waiting: null });
  fs.writeFileSync(file, JSON.stringify({ breakDone: '/Users/me/ding.mp3' }));
  assert.deepEqual(loadSounds({ platform: 'darwin', override: file }), {
    focusDone: '/System/Library/Sounds/Glass.aiff', breakDone: '/Users/me/ding.mp3', waiting: '/System/Library/Sounds/Glass.aiff',
  });
  const logs = [];
  assert.equal(loadSounds({ platform: 'win32', override: path.join(dir, 'missing.json'), log: (...a) => logs.push(a.join(' ')) }).waiting, 'C:\\Windows\\Media\\chimes.wav');
  assert.match(logs[0], /cannot read/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an override that is valid JSON but not an object is ignored, never thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-sounds-'));
  for (const body of ['null', '"C:/x.wav"', '42', '["a"]']) {
    const file = path.join(dir, 'sounds.json');
    fs.writeFileSync(file, body);
    const logs = [];
    assert.deepEqual(loadSounds({ platform: 'win32', override: file, log: (...a) => logs.push(a.join(' ')) }), loadSounds({ platform: 'win32', override: '' }), body);
    assert.match(logs[0], /not a JSON object/, body);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relative sound paths in the override resolve from its own folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-sounds-'));
  const file = path.join(dir, 'sounds.json');
  fs.writeFileSync(file, JSON.stringify({ focusDone: 'media/gong.wav' }));
  assert.equal(loadSounds({ platform: 'darwin', override: file }).focusDone, path.join(dir, 'media', 'gong.wav'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('player skips muted events and missing files, logging each missing file once', () => {
  const logs = [];
  const play = createSoundPlayer({ sounds: { focusDone: null, breakDone: '/nonexistent/x.wav', waiting: null }, log: (...a) => logs.push(a.join(' ')) });
  play('focusDone'); play('breakDone'); play('breakDone'); play('unknown');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /file not found breakDone/);
});
