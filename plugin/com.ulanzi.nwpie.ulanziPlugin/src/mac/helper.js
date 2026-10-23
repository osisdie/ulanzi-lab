// macOS counterpart of winhelper.js: same request(cmd, arg) API and reply shapes.
// Media = Spotify / Music (AppleScript), audio = system volume (+ SwitchAudioSource for outputs, if installed),
// perf = netstat + ioreg (GPU utilization, unified memory in use, disk bytes). No sudo needed.
import { execFile } from 'node:child_process';
import { osa } from './osa.js';

const sh = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
});

/** `netstat -ibn` → total bytes in/out over non-loopback interfaces (link-level rows). */
export function parseNetstat(text) {
  let rx = 0, tx = 0;
  for (const line of String(text).split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8 || !/^<Link#\d+>$/.test(f[2]) || /^lo\d*$/.test(f[0])) continue;
    // Columns from the right: ... Ibytes Opkts Oerrs Obytes Coll
    const ib = Number(f[f.length - 5]), ob = Number(f[f.length - 2]);
    if (Number.isFinite(ib)) rx += ib;
    if (Number.isFinite(ob)) tx += ob;
  }
  return { rx, tx };
}

/** `ioreg` IOAccelerator dump → GPU busy % and memory in use (bytes); the busiest GPU wins. */
export function parseGpu(text) {
  let gpu = null, vram = null;
  for (const m of String(text).matchAll(/"(?:Device Utilization %|GPU Activity\(%\))"=(\d+)/g)) gpu = Math.max(gpu ?? 0, Number(m[1]));
  for (const m of String(text).matchAll(/"(?:In use system memory|vramUsedBytes)"=(\d+)/g)) vram = Math.max(vram ?? 0, Number(m[1]));
  return { gpu: gpu == null ? null : Math.min(100, gpu), vram };
}

/** `ioreg` IOBlockStorageDriver dump → cumulative bytes read/written over all disks. */
export function parseDiskBytes(text) {
  let read = 0, write = 0, seen = false;
  for (const m of String(text).matchAll(/"Bytes \(Read\)"=(\d+)/g)) { read += Number(m[1]); seen = true; }
  for (const m of String(text).matchAll(/"Bytes \(Write\)"=(\d+)/g)) write += Number(m[1]);
  return seen ? { read, write } : null;
}

const PERF_SH = 'netstat -ibn; echo @@; ioreg -r -d 1 -w 0 -c IOAccelerator; echo @@; ioreg -r -w 0 -c IOBlockStorageDriver';

export function createMacHelper({ log = () => {} } = {}) {
  let prev = null; // { at, net, disk }
  let micLevel = 75; // input volume to restore when un-muting the mic
  const art = { key: null, dataUrl: null };

  async function artwork(key, url) {
    if (key === art.key) return art.dataUrl;
    art.key = key; art.dataUrl = null;
    if (!url) return null;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      art.dataUrl = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    } catch (e) { log('machelper art', e.message); }
    return art.dataUrl;
  }

  async function media(withArt) {
    const m = await osa('media');
    if (!m?.active) return m ? { active: false } : null;
    const artKey = `${m.app}|${m.title}|${m.artist}`;
    return { ...m, updatedAt: Date.now(), artKey, art: withArt ? await artwork(artKey, m.artUrl) : null, accent: null };
  }

  async function outputs() {
    const [all, cur] = await Promise.all([sh('SwitchAudioSource', ['-a', '-t', 'output']), sh('SwitchAudioSource', ['-c', '-t', 'output'])]);
    if (all == null) return [];
    const now = (cur || '').trim();
    return all.split('\n').map(s => s.trim()).filter(Boolean).map(name => ({ id: name, name, isDefault: name === now }));
  }

  async function audio() {
    const v = await osa('volume');
    if (!v) return null;
    if (v.inputVolume > 0) micLevel = v.inputVolume;
    return {
      volume: Number.isFinite(v.outputVolume) ? Math.round(v.outputVolume) : null, muted: !!v.outputMuted,
      micMuted: Number.isFinite(v.inputVolume) ? v.inputVolume === 0 : null, outputs: await outputs(),
    };
  }

  async function audioSet(a = {}) {
    const v = await osa('volume');
    if (a.what === 'mute') await osa('setvolume', 'outputMuted', String(!v?.outputMuted));
    if (a.what === 'volume' && Number.isFinite(v?.outputVolume)) await osa('setvolume', 'outputVolume', Math.max(0, Math.min(100, v.outputVolume + Number(a.delta || 0))));
    if (a.what === 'mic' && Number.isFinite(v?.inputVolume)) await osa('setvolume', 'inputVolume', v.inputVolume > 0 ? 0 : micLevel);
    if (a.what === 'output') await sh('SwitchAudioSource', ['-n', '-t', 'output']);
    return audio();
  }

  async function perf() {
    const out = await sh('/bin/sh', ['-c', PERF_SH], 6000);
    if (out == null) return null;
    const [netText, gpuText, diskText] = out.split('@@');
    const cur = { at: Date.now(), net: parseNetstat(netText), disk: parseDiskBytes(diskText) };
    const { gpu, vram } = parseGpu(gpuText);
    const dt = prev ? (cur.at - prev.at) / 1000 : 0;
    const rate = (a, b) => (dt > 0 && a != null && b != null ? Math.max(0, (a - b) / dt) : null);
    const r = {
      gpu, vram, netIn: rate(cur.net.rx, prev?.net.rx), netOut: rate(cur.net.tx, prev?.net.tx),
      diskRead: rate(cur.disk?.read, prev?.disk?.read), diskWrite: rate(cur.disk?.write, prev?.disk?.write), diskBusy: null,
    };
    prev = cur;
    return r;
  }

  const handlers = {
    media: (withArt) => media(!!withArt),
    'media.ctl': async (what) => ({ ok: !!(await osa('mediactl', what)) }),
    audio: () => audio(),
    'audio.set': (a) => audioSet(a),
    perf: () => perf(),
  };

  /** Resolves with the reply's data, or null on error. */
  async function request(cmd, arg) {
    try { return await (handlers[cmd]?.(arg) ?? null); } catch (e) { log('machelper', cmd, e.message); return null; }
  }

  return { request, stop() {} };
}
