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

/** A JSON object from `file`, or {} (logged) when it is missing, invalid, or not an object: sounds never stop the plugin. */
const readJson = (file, log) => {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    log('sounds: not a JSON object, ignored', file);
  } catch (e) { log('sounds: cannot read', file, e.message); }
  return {};
};

/** { event: file | null } for this OS: shipped defaults, then the override file. */
export function loadSounds({ platform = process.platform, override = env('ULANZI_LAB_SOUNDS'), log = () => {} } = {}) {
  const defaults = OS_FILE[platform] ? readJson(path.join(CONFIG, OS_FILE[platform]), log) : {};
  // A relative override path is relative to the folder holding .env (the repo root), not Studio's working directory;
  // relative sound paths inside it are relative to the override file's own folder.
  const file = override ? path.resolve(ENV_FILE ? path.dirname(ENV_FILE) : process.cwd(), override) : null;
  const mine = file ? readJson(file, log) : {};
  const out = {};
  for (const e of SOUND_EVENTS) {
    const own = Object.hasOwn(mine, e);
    const v = String((own ? mine[e] : defaults[e]) ?? '').trim();
    const relative = own && !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(v);
    out[e] = !v || v.toLowerCase() === 'off' ? null : relative ? path.resolve(path.dirname(file), v) : v;
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
