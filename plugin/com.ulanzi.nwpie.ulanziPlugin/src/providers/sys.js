// Windows system health: CPU %, RAM %, optional NVIDIA GPU (nvidia-smi).
import os from 'node:os';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

const HIST = 30;
const push = (arr, v) => { if (v != null) { arr.push(v); if (arr.length > HIST) arr.shift(); } };

export class SysProvider extends EventEmitter {
  constructor({ intervalMs = 2000, log = () => {} } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.log = log;
    this.prev = os.cpus();
    this.hasGpu = null;
    this.m = { cpuHist: [], memHist: [], gpuHist: [] };
  }

  cpuPct() {
    const cur = os.cpus();
    let idle = 0, total = 0;
    cur.forEach((c, i) => {
      const p = this.prev[i]?.times || c.times;
      const d = (k) => c.times[k] - p[k];
      const t = d('user') + d('nice') + d('sys') + d('irq') + d('idle');
      idle += d('idle'); total += t;
    });
    this.prev = cur;
    return total > 0 ? (1 - idle / total) * 100 : null;
  }

  gpu() {
    if (this.hasGpu === false) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true }, (err, out) => {
        if (err) { this.hasGpu = false; return resolve(null); }
        this.hasGpu = true;
        const [u, t] = String(out).split('\n')[0].split(',').map(s => parseFloat(s));
        resolve({ gpu: u, gpuTemp: t });
      });
    });
  }

  async tick() {
    const cpu = this.cpuPct();
    const total = os.totalmem(), free = os.freemem();
    const mem = ((total - free) / total) * 100;
    const g = await this.gpu();
    push(this.m.cpuHist, cpu); push(this.m.memHist, mem); push(this.m.gpuHist, g?.gpu);
    Object.assign(this.m, { cpu, mem, memUsedGb: (total - free) / 2 ** 30, memTotalGb: total / 2 ** 30, gpu: g?.gpu ?? null, gpuTemp: g?.gpuTemp ?? null });
    this.emit('change');
  }

  get() { return this.m; }
  start() { this.timer = setInterval(() => this.tick().catch(e => this.log('sys', e.message)), this.intervalMs); this.tick(); }
  stop() { clearInterval(this.timer); }
}
