#!/usr/bin/env node
// Generate an Ulanzi Studio profile for the D200X.
//
//   node scripts/make-profile.mjs [--layout <module>] [--activate] [--no-restart] [--dry-run]
//
// Default layout: the "ulanzi-lab" profile from plugin/.../src/pages.js.
// --layout <module> builds another plugin's profile instead.
// A layout module exports PROFILE = { name, icon, pages, plugin: { uuid, name, folder, src, actionNames, iconFor(action) } }
// and optionally legacy: { name, marker }, an older generated profile of the same layout that it replaces in place.
//
// - Writes a NEW profile folder into %APPDATA%\Ulanzi\UlanziDeck\ProfilesV2 (macOS: ~/Library/Application Support/
//   Ulanzi/UlanziDeck/ProfilesV2); existing profiles are untouched.
//   Re-running replaces only the profile this script generated under the same name (marked with .ulanzi-lab).
// - Ulanzi Studio is stopped while writing and restarted afterwards (it caches profiles in memory).
// - --activate also makes it the current profile (Config\setting_source.json and setting.json; first backups kept).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const has = (f) => process.argv.includes(f);
const MAC = process.platform === 'darwin';
const ROOT = MAC ? path.join(os.homedir(), 'Library', 'Application Support', 'Ulanzi', 'UlanziDeck') : path.join(process.env.APPDATA, 'Ulanzi', 'UlanziDeck');
const PROFILES = path.join(ROOT, 'ProfilesV2');
const SETTING = path.join(ROOT, 'Config', 'setting.json');
const SETTING_SOURCE = path.join(ROOT, 'Config', 'setting_source.json');
const EXE = 'C:\\Program Files (x86)\\Ulanzi Studio\\UlanziDeck.exe';
const MAC_APP = '/Applications/Ulanzi Studio.app';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '.ulanzi-lab';
const fwd = (p) => p.replace(/\\/g, '/');

async function loadLayout() {
  const i = process.argv.indexOf('--layout');
  if (i > 0) return (await import(pathToFileURL(path.resolve(process.argv[i + 1])).href)).PROFILE;
  const src = path.join(REPO, 'plugin', 'com.ulanzi.nwpie.ulanziPlugin');
  const { PAGES, PLUGIN_UUID, ACTION_NAMES } = await import(pathToFileURL(path.join(src, 'src', 'pages.js')).href);
  return {
    name: 'ulanzi-lab', icon: path.join(src, 'images', 'plugin.svg'), pages: PAGES,
    legacy: { name: 'ulanzi_lab', marker: '.ulanzi_lab' }, // before the rename; other layouts must never take it over
    plugin: { uuid: PLUGIN_UUID, name: 'ulanzi-lab', folder: 'com.ulanzi.nwpie.ulanziPlugin', src, actionNames: ACTION_NAMES, iconFor: (a) => `images/${a}.svg` },
  };
}

const LAYOUT = await loadLayout();
const NAME = LAYOUT.name;
const PLUGIN = LAYOUT.plugin;
const PLUGIN_INSTALLED = path.join(ROOT, 'Plugins', PLUGIN.folder);
const pluginVersion = JSON.parse(fs.readFileSync(path.join(PLUGIN.src, 'manifest.json'), 'utf8')).Version;

// Reuse the device identity from an existing D200X profile.
const existing = fs.readdirSync(PROFILES).filter(d => d.endsWith('.ulanziProfile'));
const manifests = existing.map(d => ({ dir: d, m: JSON.parse(fs.readFileSync(path.join(PROFILES, d, 'manifest.json'), 'utf8')) }));
const ref = manifests.find(x => x.m.Device?.Model === 'D200X');
if (!ref) throw new Error('no existing D200X profile to copy the device identity from');
const device = ref.m.Device;

/** First folder named `name` under `dir` (shallow search), or null. */
function findDir(dir, name, depth = 5) {
  if (depth < 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isDirectory() && e.name === name) return path.join(dir, e.name);
  for (const e of entries) if (e.isDirectory()) { const hit = findDir(path.join(dir, e.name), name, depth - 1); if (hit) return hit; }
  return null;
}
// Ulanzi's built-in Pages plugin: under the data folder on Windows, possibly inside the app bundle on macOS.
const PAGE_PLUGIN = [path.join(ROOT, 'System', 'Plugins', 'com.ulanzi.deck.page')].find(d => fs.existsSync(d))
  || (MAC && findDir(path.join(MAC_APP, 'Contents'), 'com.ulanzi.deck.page')) || path.join(ROOT, 'System', 'Plugins', 'com.ulanzi.deck.page');

// Page-button entries (0_3 / 1_3) copied from Ulanzi's own Pages plugin.
const pageButton = (action, img) => ({
  Action: `com.ulanzi.ulanzideck.page.${action}`, ActionID: crypto.randomUUID(), ActionParam: {}, LinkedTitle: true,
  Name: action === 'prev' ? 'Previous Page' : 'Next Page',
  Plugin: { Name: 'Pages', UUID: 'com.ulanzi.deck.page', Version: '1.0' },
  ViewParam: [{ Icon: fwd(path.join(PAGE_PLUGIN, 'Images', img)), IconRel: '' }],
});

const action = (name, settings) => ({
  Action: `${PLUGIN.uuid}.${name}`, ActionID: crypto.randomUUID(), ActionParam: settings, LinkedTitle: true,
  Name: PLUGIN.actionNames[name] || name,
  Plugin: { Name: PLUGIN.name, UUID: PLUGIN.uuid, Version: pluginVersion },
  ViewParam: [{ Icon: fwd(path.join(PLUGIN_INSTALLED, PLUGIN.iconFor(name))), IconRel: '' }],
});

// Replace the profile this script generated for this layout (same name, or the layout's legacy name), never a user-made
// one or another layout's.
const LEGACY = LAYOUT.legacy;
const prev = manifests.find(x => x.m.Name === NAME && fs.existsSync(path.join(PROFILES, x.dir, MARKER)))
  || (LEGACY && manifests.find(x => x.m.Name === LEGACY.name && fs.existsSync(path.join(PROFILES, x.dir, LEGACY.marker))));
const clash = manifests.find(x => x.m.Name === NAME && x !== prev);
if (clash) throw new Error(`a profile named "${NAME}" already exists (${clash.dir}) and was not made by this script`);
const profileId = prev ? prev.dir.replace('.ulanziProfile', '') : crypto.randomUUID();
const dir = path.join(PROFILES, `${profileId}.ulanziProfile`);

const pageIds = LAYOUT.pages.map(() => crypto.randomUUID());
const pages = LAYOUT.pages.map((page, i) => {
  const actions = Object.fromEntries(page.keys.map(([key, name, settings]) => [key, action(name, settings)]));
  if (LAYOUT.pages.length > 1) {
    actions['0_3'] = pageButton('prev', 'btn_previousPage.png');
    actions['1_3'] = pageButton('next', 'btn_nextPage.png');
  }
  return { id: pageIds[i], manifest: { Controllers: [{ Type: 'Encoder', Actions: {} }, { Type: 'Keypad', Actions: actions }], Icon: '', Name: '' } };
});
const iconFile = 'icon' + path.extname(LAYOUT.icon);
const profileManifest = { Device: device, Icon: iconFile, Name: NAME, Pages: { Current: pageIds[0], Pages: pageIds }, Version: 2 };

if (has('--dry-run')) {
  // What a real run would replace, and whether it would change Studio's current profile.
  const replaces = prev ? { dir: prev.dir, name: prev.m.Name, matchedBy: prev.m.Name === NAME ? 'name' : 'legacy name' } : null;
  const selects = has('--activate') ? 'always' : prev && prev.m.Name !== NAME ? `where "${prev.m.Name}" is selected` : 'no';
  console.log(JSON.stringify({ dir, replaces, selects, profileManifest, page1: pages[0].manifest }, null, 2));
  process.exit(0);
}

const running = () => {
  try {
    if (MAC) { execFileSync('pgrep', ['-f', `${MAC_APP}/Contents/MacOS/`], { stdio: 'ignore' }); return true; } // exit 1 = not running
    return execFileSync('tasklist', ['/FI', 'IMAGENAME eq UlanziDeck.exe', '/NH']).toString().includes('UlanziDeck.exe');
  } catch { return false; }
};
const pause = () => (MAC ? execFileSync('sleep', ['0.25']) : execFileSync('powershell', ['-NoProfile', '-c', 'Start-Sleep -Milliseconds 250']));
const wasRunning = running();
if (wasRunning) {
  if (MAC) {
    try { execFileSync('osascript', ['-e', 'quit app "Ulanzi Studio"'], { stdio: 'ignore', timeout: 10e3 }); } catch { /* not scriptable: killed below */ }
    for (let i = 0; i < 20 && running(); i++) pause();
    if (running()) try { execFileSync('pkill', ['-f', `${MAC_APP}/Contents/MacOS/`], { stdio: 'ignore' }); } catch { /* exited meanwhile */ }
  } else {
    execFileSync('taskkill', ['/IM', 'UlanziDeck.exe', '/F'], { stdio: 'ignore' });
  }
  for (let i = 0; i < 20 && running(); i++) pause();
}

if (prev) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, MARKER), `generated by ulanzi-lab/scripts/make-profile.mjs (${NAME})\n`);
fs.copyFileSync(LAYOUT.icon, path.join(dir, iconFile));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(profileManifest));
for (const p of pages) {
  const pd = path.join(dir, 'Profiles', p.id);
  fs.mkdirSync(path.join(pd, 'Files'), { recursive: true });
  fs.mkdirSync(path.join(pd, 'Images'), { recursive: true });
  fs.writeFileSync(path.join(pd, 'manifest.json'), JSON.stringify(p.manifest, null, 4));
}
console.log(`${prev ? 'updated' : 'created'} profile "${NAME}" → ${dir}`);

// Studio selects the current profile by name: Studio 3.4 per device in setting_source.json, older builds in setting.json.
// --activate selects this profile. Without it, a replaced profile that was selected under its old name follows the
// rename, or Studio creates an empty profile under the old name on its next start. The first backup of each file is kept.
const SELECTIONS = [
  { file: SETTING_SOURCE, set: (s, from) => { for (const d of s.Devices || []) if ((d.CurrentDevice === device.UUID || d.DeviceType === device.Model) && (from === null || d.CurrentProfile === from)) d.CurrentProfile = NAME; } },
  { file: SETTING, set: (s, from) => { if (from === null || s.CurrentProfile === from) s.CurrentProfile = NAME; } },
];
function select(from) {
  for (const { file, set } of SELECTIONS) {
    let raw, s;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; } // this Studio build doesn't use it
    try { s = JSON.parse(raw); } catch { console.warn(`${path.basename(file)} is not JSON: left alone`); continue; }
    const before = JSON.stringify(s);
    set(s, from);
    if (JSON.stringify(s) === before) continue;
    if (![`${file}.bak.ulanzi-lab`, `${file}.bak.ulanzi_lab`].some(f => fs.existsSync(f))) fs.writeFileSync(`${file}.bak.ulanzi-lab`, raw);
    fs.writeFileSync(file, JSON.stringify(s, null, raw.includes('\n') ? 4 : 0)); // keep Studio's own layout
    console.log(`${path.basename(file)}: CurrentProfile = ${NAME}`);
  }
}
if (has('--activate')) select(null);
else if (prev && prev.m.Name !== NAME) select(prev.m.Name);

if (wasRunning && !has('--no-restart')) {
  if (MAC) spawn('open', ['-a', MAC_APP], { detached: true, stdio: 'ignore' }).unref();
  else spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
  console.log('Ulanzi Studio restarted');
}
