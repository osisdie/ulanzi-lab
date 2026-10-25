// Layout module for scripts/make-profile.mjs: the separate "ulanzi-lab Voice" profile (record → transcript).
//   npm run profile:voice      (= node scripts/make-profile.mjs --layout scripts/voice-profile.mjs)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_UUID, ACTION_NAMES } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/pages.js';
import { VOICE_PAGES } from '../plugin/com.ulanzi.nwpie.ulanziPlugin/src/voice-pages.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'com.ulanzi.nwpie.ulanziPlugin');

export const PROFILE = {
  name: 'ulanzi-lab Voice',
  icon: path.join(src, 'images', 'voice.svg'),
  pages: VOICE_PAGES,
  plugin: { uuid: PLUGIN_UUID, name: 'ulanzi-lab', folder: 'com.ulanzi.nwpie.ulanziPlugin', src, actionNames: ACTION_NAMES, iconFor: (a) => `images/${a}.svg` },
};
