// ulanzi_lab plugin main service (started by Ulanzi Studio with: node app.js <address> <port> <language> <appVersion>).
import './src/env.js'; // load .env before any module reads process.env
import UlanziApi from './libs/ulanzi-api/index.js';
import { log } from './src/log.js';
import { createRuntime } from './src/runtime.js';

const UUID = 'com.ulanzi.ulanzistudio.nwpie';
log('plugin start', process.version, process.argv.slice(2));
// Ulanzi Studio closes our stdout when it quits; the SDK still console.logs. Exit quietly instead of EPIPE spam.
for (const stream of [process.stdout, process.stderr]) stream.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
process.on('uncaughtException', (e) => log('uncaughtException', e.stack));
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e?.stack || e)));

const rt = createRuntime();
const $UD = new UlanziApi();

rt.deck.addSink('ulanzi', {
  setIcon: (ctx, dataUrl) => $UD.setBaseDataIcon(ctx, dataUrl),
  toast: (msg) => $UD.toast(msg),
  saveSettings: (ctx, settings) => $UD.sendParamFromPlugin(settings, ctx),
});

const settingsOf = (m) => (m && typeof m.param === 'object' && m.param) || {};
const lastUp = new Map();

$UD.connect(UUID);
$UD.onConnected(() => { log('connected to Ulanzi Studio'); rt.deck.renderAll(true); });
$UD.onClose(() => log('ws closed'));
$UD.onAdd((m) => { log('add', m.uuid, m.key, m.param); rt.deck.add('ulanzi', m.context, m.uuid, settingsOf(m), m.key); });
$UD.onParamFromApp((m) => rt.deck.update(m.context, settingsOf(m)));
$UD.onParamFromPlugin((m) => rt.deck.update(m.context, settingsOf(m)));
$UD.onSetActive((m) => { log('setactive', m.key, m.active); rt.deck.setActive(m.context, m.active); });
$UD.onClear((m) => { for (const p of m.param || []) rt.deck.remove(p.context); });

// keydown/keyup give us long-press; 'run' is only used if the host sends it without a keyup.
$UD.onKeyDown((m) => rt.deck.keyDown(m.context));
$UD.onKeyUp((m) => { lastUp.set(m.context, Date.now()); rt.deck.keyUp(m.context); });
$UD.onRun((m) => {
  setTimeout(() => {
    if (Date.now() - (lastUp.get(m.context) || 0) > 1500) rt.deck.pressNow(m.context, false);
  }, 300);
});
