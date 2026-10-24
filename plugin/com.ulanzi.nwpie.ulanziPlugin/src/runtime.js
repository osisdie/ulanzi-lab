// Wires stores, providers, OS helpers (Win32 + WSL on Windows, JXA on macOS), the deck controller and the hub together.
// Used by src/main.js (inside Ulanzi Studio) and by `node src/runtime.js` (standalone dev + browser preview).
import './env.js'; // load .env before any module reads process.env
import { pathToFileURL } from 'node:url';
import { log } from './log.js';
import { createStores, startHub, startLiveness } from './hub.js';
import { createDeck } from './deck.js';
import { QuoteProvider } from './providers/quotes.js';
import { SysProvider } from './providers/sys.js';
import { WslProvider } from './providers/wsl.js';
import { LocalProvider } from './providers/local.js';
import { IotProvider } from './providers/iot.js';
import { createLayoutEngine, MODES, PRESETS } from './layout.js';
import { createFocuser } from './focus.js';
import path from 'node:path';
import { DATA_DIR } from './log.js';
import { createWinHelper } from './winhelper.js';
import { createMacHelper } from './mac/helper.js';
import { setOsaLog } from './mac/osa.js';
import { IS_WIN, IS_MAC } from './platform.js';
import { createSoundPlayer, loadSounds } from './sounds.js';
import { MediaProvider } from './providers/media.js';
import { HwProvider } from './providers/hw.js';
import { DevopsProvider } from './providers/devops.js';
import { Pomodoro } from './pomodoro.js';
import { createPageActions } from './page-actions.js';

import { PAGES, PLUGIN_UUID } from './pages.js';
import { defaultDistro } from './distro.js';

// Window control: user32 via koffi on Windows, System Events on macOS, none elsewhere (dev preview on Linux).
const windows = IS_WIN ? await import('./win32.js') : IS_MAC ? await import('./mac/windows.js') : null;
const noHelper = { request: async () => null, stop() {} };
const noLayout = { apply: () => ({ ok: false, why: `window layout is not supported on ${process.platform}` }) };

export function createRuntime({ port } = {}) {
  const { sessions, usage } = createStores({ log });
  const quotes = new QuoteProvider({ log });
  const sys = new SysProvider({ log });
  setOsaLog(log);
  // Where Claude Code runs: WSL distros on Windows, this machine on macOS.
  const host = IS_WIN ? new WslProvider({ log, distro: defaultDistro() }) : new LocalProvider({ log });
  const iot = new IotProvider({ log });
  const layout = windows ? createLayoutEngine(windows, { gap: Number(process.env.ULANZI_LAB_GAP) || 0, log }) : noLayout;
  const focuser = createFocuser(windows, { log });
  const helper = IS_WIN ? createWinHelper({ log }) : IS_MAC ? createMacHelper({ log }) : noHelper;
  const media = new MediaProvider({ helper, log, mediaMs: IS_MAC ? 2000 : 1000 });
  const hw = new HwProvider({ helper, log });
  const devops = new DevopsProvider({ distro: defaultDistro(), log });
  const pomodoro = new Pomodoro({ file: path.join(DATA_DIR, 'pomodoro.json') });
  let deck = null;
  const play = createSoundPlayer({ sounds: loadSounds({ log }), log });
  const pages = createPageActions({ media, hw, devops, pomodoro, sessions, toast: (m) => deck?.toast(m, { force: true }), play, log });
  deck = createDeck({ sessions, usage, quotes, sys, wsl: host, iot, layout, focuser, pages, play, log });

  // Browser preview sink: icons are read back from deck.svgOf() by the hub.
  deck.addSink('preview', { setIcon() {}, toast: (m) => log('toast', m) });
  PAGES.forEach((page, i) => {
    for (const [key, action, settings] of page.keys) deck.add('preview', `preview___p${i + 1}___${key}`, `${PLUGIN_UUID}.${action}`, settings, key);
  });

  quotes.start(); sys.start(); host.start(); iot.start(); media.start(); hw.start(); devops.start();
  const stopLiveness = startLiveness({ sessions, host, log });
  const hub = startHub({ sessions, usage, deck, focuser, providers: { sys, wsl: host, pageNames: PAGES.map(p => p.name) }, port, log });

  return {
    sessions, usage, deck, hub, layout, focuser, MODES, PRESETS,
    stop() { deck.stop(); quotes.stop(); sys.stop(); host.stop(); iot.stop(); media.stop(); hw.stop(); devops.stop(); helper.stop(); stopLiveness(); hub.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.ULANZI_LAB_STDOUT = '1';
  createRuntime();
  log('standalone runtime — open http://127.0.0.1:' + (process.env.ULANZI_LAB_PORT || 39300));
}
