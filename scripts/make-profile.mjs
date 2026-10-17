#!/usr/bin/env node
// Generate an Ulanzi Studio profile for the D200X.
//
//   node scripts/make-profile.mjs [--layout <module>] [--activate] [--no-restart] [--dry-run]
//
// Default layout: the "ulanzi_lab" profile from plugin/.../src/pages.js.
// --layout <module> builds another plugin's profile instead.
// A layout module exports PROFILE = { name, icon, pages, plugin: { uuid, name, folder, src, actionNames, iconFor(action) } }.
//
// - Writes a NEW profile folder into %APPDATA%\Ulanzi\UlanziDeck\ProfilesV2 (existing profiles untouched).
//   Re-running replaces only the profile this script generated under the same name (marked with .ulanzi_lab).
// - Ulanzi Studio is stopped while writing and restarted afterwards (it caches profiles in memory).
// - --activate also sets it as the current profile in Config\setting.json (the first backup is kept).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const has = (f) => process.argv.includes(f);
const ROOT = path.join(process.env.APPDATA, 'Ulanzi', 'UlanziDeck');
const PROFILES = path.join(ROOT, 'ProfilesV2');
const SETTING = path.join(ROOT, 'Config', 'setting.json');
const EXE = 'C:\\Program Files (x86)\\Ulanzi Studio\\UlanziDeck.exe';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '.ulanzi_lab';
const fwd = (p) => p.replace(/\\/g, '/');

async function loadLayout() {
  const i = process.argv.indexOf('--layout');
  if (i > 0) return (await import(pathToFileURL(path.resolve(process.argv[i + 1])).href)).PROFILE;
  const src = path.join(REPO, 'plugin', 'com.ulanzi.nwpie.ulanziPlugin');
  const { PAGES, PLUGIN_UUID, ACTION_NAMES } = await import(pathToFileURL(path.join(src, 'src', 'pages.js')).href);
  return {
    name: 'ulanzi_lab', icon: path.join(src, 'images', 'plugin.svg'), pages: PAGES,
    plugin: { uuid: PLUGIN_UUID, name: 'ulanzi_lab', folder: 'com.ulanzi.nwpie.ulanziPlugin', src, actionNames: ACTION_NAMES, iconFor: (a) => `images/${a}.svg` },
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

// Page-button entries (0_3 / 1_3) copied from Ulanzi's own Pages plugin.
const pageButton = (action, img) => ({
  Action: `com.ulanzi.ulanzideck.page.${action}`, ActionID: crypto.randomUUID(), ActionParam: {}, LinkedTitle: true,
  Name: action === 'prev' ? 'Previous Page' : 'Next Page',
  Plugin: { Name: 'Pages', UUID: 'com.ulanzi.deck.page', Version: '1.0' },
  ViewParam: [{ Icon: fwd(path.join(ROOT, 'System', 'Plugins', 'com.ulanzi.deck.page', 'Images', img)), IconRel: '' }],
});

const action = (name, settings) => ({
  Action: `${PLUGIN.uuid}.${name}`, ActionID: crypto.randomUUID(), ActionParam: settings, LinkedTitle: true,
  Name: PLUGIN.actionNames[name] || name,
  Plugin: { Name: PLUGIN.name, UUID: PLUGIN.uuid, Version: pluginVersion },
  ViewParam: [{ Icon: fwd(path.join(PLUGIN_INSTALLED, PLUGIN.iconFor(name))), IconRel: '' }],
});

// Replace the profile this script generated under the same name, never a user-made one.
const prev = manifests.find(x => x.m.Name === NAME && fs.existsSync(path.join(PROFILES, x.dir, MARKER)));
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
  console.log(JSON.stringify({ dir, profileManifest, page1: pages[0].manifest }, null, 2));
  process.exit(0);
}

const running = () => { try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq UlanziDeck.exe', '/NH']).toString().includes('UlanziDeck.exe'); } catch { return false; } };
const wasRunning = running();
if (wasRunning) {
  execFileSync('taskkill', ['/IM', 'UlanziDeck.exe', '/F'], { stdio: 'ignore' });
  for (let i = 0; i < 20 && running(); i++) execFileSync('powershell', ['-NoProfile', '-c', 'Start-Sleep -Milliseconds 250']);
}

if (prev) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, MARKER), `generated by ulanzi_lab/scripts/make-profile.mjs (${NAME})\n`);
fs.copyFileSync(LAYOUT.icon, path.join(dir, iconFile));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(profileManifest));
for (const p of pages) {
  const pd = path.join(dir, 'Profiles', p.id);
  fs.mkdirSync(path.join(pd, 'Files'), { recursive: true });
  fs.mkdirSync(path.join(pd, 'Images'), { recursive: true });
  fs.writeFileSync(path.join(pd, 'manifest.json'), JSON.stringify(p.manifest, null, 4));
}
console.log(`${prev ? 'updated' : 'created'} profile "${NAME}" → ${dir}`);

if (has('--activate')) {
  const raw = fs.readFileSync(SETTING, 'utf8');
  if (!fs.existsSync(`${SETTING}.bak.ulanzi_lab`)) fs.writeFileSync(`${SETTING}.bak.ulanzi_lab`, raw); // keep the first (pre-lab) backup
  const s = JSON.parse(raw);
  s.CurrentProfile = NAME;
  fs.writeFileSync(SETTING, JSON.stringify(s, null, 4));
  console.log(`set CurrentProfile = ${NAME}`);
}

if (wasRunning && !has('--no-restart')) {
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
  console.log('Ulanzi Studio restarted');
}
