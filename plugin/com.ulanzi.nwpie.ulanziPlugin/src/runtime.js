// Wires stores, providers, Win32 helpers, the deck controller and the hub together.
// Used by app.js (inside Ulanzi Studio) and by `node src/runtime.js` (standalone dev + browser preview).
import './env.js'; // load .env before any module reads process.env
import { pathToFileURL } from 'node:url';
import { log } from './log.js';
import { createStores, startHub, startLiveness } from './hub.js';
import { createDeck } from './deck.js';
import { QuoteProvider } from './providers/quotes.js';
import { SysProvider } from './providers/sys.js';
import { WslProvider } from './providers/wsl.js';
import { IotProvider } from './providers/iot.js';
import { createLayoutEngine, MODES, PRESETS } from './layout.js';
import { createFocuser } from './focus.js';
import * as win32 from './win32.js';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR } from './log.js';
import { createWinHelper } from './winhelper.js';
import { MediaProvider } from './providers/media.js';
import { HwProvider } from './providers/hw.js';
import { DevopsProvider } from './providers/devops.js';
import { Pomodoro } from './pomodoro.js';
import { createPageActions } from './page-actions.js';

import { PAGES, PLUGIN_UUID } from './pages.js';
import { defaultDistro } from './distro.js';

export function createRuntime({ port } = {}) {
  const { sessions, usage } = createStores({ log });
  const quotes = new QuoteProvider({ log });
  const sys = new SysProvider({ log });
  const wsl = new WslProvider({ log, distro: defaultDistro() });
  const iot = new IotProvider({ log });
  const layout = createLayoutEngine(win32, { gap: Number(process.env.ULANZI_LAB_GAP) || 0, log });
  const focuser = createFocuser(win32, { log });
  const helper = createWinHelper({ log });
  const media = new MediaProvider({ helper, log });
  const hw = new HwProvider({ helper, log });
  const devops = new DevopsProvider({ distro: defaultDistro(), log });
  const pomodoro = new Pomodoro({ file: path.join(DATA_DIR, 'pomodoro.json') });
  const chime = (wav) => execFile('powershell.exe', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], { windowsHide: true }, () => {});
  let deck = null;
  const pages = createPageActions({ media, hw, devops, pomodoro, sessions, toast: (m) => deck?.toast(m, { force: true }), chime, log });
  deck = createDeck({ sessions, usage, quotes, sys, wsl, iot, layout, focuser, pages, log });

  // Browser preview sink: icons are read back from deck.svgOf() by the hub.
  deck.addSink('preview', { setIcon() {}, toast: (m) => log('toast', m) });
  PAGES.forEach((page, i) => {
    for (const [key, action, settings] of page.keys) deck.add('preview', `preview___p${i + 1}___${key}`, `${PLUGIN_UUID}.${action}`, settings, key);
  });

  quotes.start(); sys.start(); wsl.start(); iot.start(); media.start(); hw.start(); devops.start();
  const stopLiveness = startLiveness({ sessions, wsl, log });
  const hub = startHub({ sessions, usage, deck, focuser, providers: { sys, wsl, pageNames: PAGES.map(p => p.name) }, port, log });

  return {
    sessions, usage, deck, hub, layout, focuser, MODES, PRESETS,
    stop() { deck.stop(); quotes.stop(); sys.stop(); wsl.stop(); iot.stop(); media.stop(); hw.stop(); devops.stop(); helper.stop(); stopLiveness(); hub.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.ULANZI_LAB_STDOUT = '1';
  createRuntime();
  log('standalone runtime — open http://127.0.0.1:' + (process.env.ULANZI_LAB_PORT || 39300));
}
