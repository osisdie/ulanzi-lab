// Hardware monitor: per-core CPU, RAM, GPU (perf counters, any vendor), VRAM, disks, network, disk IO,
// uptime; temperatures/fans from LibreHardwareMonitor's web server when it is running (:8085).
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

const HIST = 40;
const push = (arr, v) => { if (Number.isFinite(v)) { arr.push(v); if (arr.length > HIST) arr.shift(); } };

/** Pull "CPU Package"-ish temperature, GPU temp and the hottest fan from LHM's data.json tree. */
export function parseLhm(tree) {
  const out = { cpuTemp: null, gpuTemp: null, fan: null };
  const walk = (n, parent = '') => {
    if (!n) return;
    const text = String(n.Text || '');
    const val = parseFloat(String(n.Value || '').replace(',', '.'));
    if (n.Type === 'Temperature' && Number.isFinite(val)) {
      if (/package|tctl|cpu/i.test(text) && /cpu|intel|amd|ryzen|core/i.test(parent + text) && out.cpuTemp == null) out.cpuTemp = val;
      if (/gpu/i.test(parent + text) && /core|gpu/i.test(text) && out.gpuTemp == null) out.gpuTemp = val;
    }
    if (n.Type === 'Fan' && Number.isFinite(val) && val > (out.fan ?? -1)) out.fan = val;
    for (const c of n.Children || []) walk(c, `${parent} ${text}`);
  };
  walk(tree);
  return out;
}

export class HwProvider extends EventEmitter {
  constructor({ helper, log = () => {}, intervalMs = 2000, lhmUrl = 'http://127.0.0.1:8085/data.json' } = {}) {
    super();
    this.helper = helper;
    this.log = log;
    this.intervalMs = intervalMs;
    this.lhmUrl = lhmUrl;
    this.prev = os.cpus();
    this.m = { cores: [], hist: { cpu: [], gpu: [], netIn: [], netOut: [], ram: [] }, disks: [], lhm: null };
    this.ticks = 0;
  }

  cores() {
    const cur = os.cpus();
    const pct = cur.map((c, i) => {
      const p = this.prev[i]?.times || c.times;
      const d = (k) => c.times[k] - p[k];
      const total = d('user') + d('nice') + d('sys') + d('irq') + d('idle');
      return total > 0 ? (1 - d('idle') / total) * 100 : 0;
    });
    this.prev = cur;
    return pct;
  }

  async disks() {
    const out = [];
    for (const letter of 'CDEFGH') {
      const root = `${letter}:\\`;
      if (!fs.existsSync(root)) continue;
      try {
        const s = await fs.promises.statfs(root);
        const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
        if (total > 0) out.push({ name: `${letter}:`, total, used: total - free, pct: ((total - free) / total) * 100 });
      } catch { /* not ready (card reader, DVD) */ }
    }
    return out;
  }

  async lhm() {
    try {
      const r = await fetch(this.lhmUrl, { signal: AbortSignal.timeout(1500) });
      return parseLhm(await r.json());
    } catch { return null; }
  }

  async tick() {
    this.ticks++;
    const cores = this.cores();
    const cpu = cores.reduce((a, b) => a + b, 0) / Math.max(1, cores.length);
    const total = os.totalmem(), free = os.freemem();
    const perf = await this.helper.request('perf');
    const m = this.m;
    Object.assign(m, {
      cores, cpu, ram: ((total - free) / total) * 100, ramUsed: total - free, ramTotal: total, uptime: os.uptime(),
      gpu: perf?.gpu ?? null, vram: perf?.vram ?? null, netIn: perf?.netIn ?? null, netOut: perf?.netOut ?? null,
      diskRead: perf?.diskRead ?? null, diskWrite: perf?.diskWrite ?? null, diskBusy: perf?.diskBusy ?? null,
    });
    push(m.hist.cpu, cpu); push(m.hist.ram, m.ram); push(m.hist.gpu, m.gpu); push(m.hist.netIn, m.netIn); push(m.hist.netOut, m.netOut);
    if (this.ticks % 15 === 1) m.disks = await this.disks();
    if (this.ticks % 3 === 1) m.lhm = await this.lhm();
    this.emit('change');
  }

  get() { return this.m; }
  start() { this.timer = setInterval(() => this.tick().catch(e => this.log('hw', e.message)), this.intervalMs); this.tick(); }
  stop() { clearInterval(this.timer); }
}
