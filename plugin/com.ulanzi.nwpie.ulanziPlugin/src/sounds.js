// Alert sounds per event: defaults in config/sounds.<os>.json, overridden per machine by the JSON file named in
// ULANZI_LAB_SOUNDS (same keys; only the keys you set change). A value of "off" or "" mutes that event.
//   focusDone  Pomodoro focus block finished
//   breakDone  Pomodoro break finished
//   waiting    reminder while a session waits on you (the HITL nag, when enabled)
// Windows plays .wav only (System.Media.SoundPlayer); macOS plays anything afplay reads (.aiff, .wav, .mp3, .m4a).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, ENV_FILE } from './env.js';
import { chime } from './platform.js';

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config');
const OS_FILE = { win32: 'sounds.windows.json', darwin: 'sounds.mac.json' };
export const SOUND_EVENTS = ['focusDone', 'breakDone', 'waiting'];

const readJson = (file, log) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log('sounds: cannot read', file, e.message); return {}; }
};

/** { event: file | null } for this OS: shipped defaults, then the override file. */
export function loadSounds({ platform = process.platform, override = env('ULANZI_LAB_SOUNDS'), log = () => {} } = {}) {
  const defaults = OS_FILE[platform] ? readJson(path.join(CONFIG, OS_FILE[platform]), log) : {};
  // A relative override path is relative to the folder holding .env (the repo root), not Studio's working directory.
  const mine = override ? readJson(path.resolve(ENV_FILE ? path.dirname(ENV_FILE) : process.cwd(), override), log) : {};
  const out = {};
  for (const e of SOUND_EVENTS) {
    const v = String((e in mine ? mine[e] : defaults[e]) ?? '').trim();
    out[e] = v && v.toLowerCase() !== 'off' ? v : null;
  }
  return out;
}

/** Play the sound for `event` (see SOUND_EVENTS); a muted event or a missing file is skipped (and logged once). */
export function createSoundPlayer({ sounds = loadSounds(), log = () => {} } = {}) {
  const missing = new Set();
  return (event) => {
    const file = sounds[event];
    if (!file) return;
    if (!fs.existsSync(file)) { if (!missing.has(file)) { missing.add(file); log('sounds: file not found', event, file); } return; }
    chime(file);
  };
}
