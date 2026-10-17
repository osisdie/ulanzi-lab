// AIoT provider slot. Interface: { id, label, read(): Promise<{label,value?,unit?,on?,sub?}>, toggle?(): Promise }
// Only a mock ships in v1; Home Assistant / MQTT adapters plug in behind the same interface.
import { EventEmitter } from 'node:events';

export function createMockDevices() {
  let lamp = false;
  const t0 = Date.now();
  const wave = (base, amp, periodMin) => +(base + amp * Math.sin(((Date.now() - t0) / 60e3) * (2 * Math.PI / periodMin))).toFixed(1);
  return {
    'mock.temp': { label: '客廳溫度', read: async () => ({ label: '客廳溫度', value: wave(26, 1.5, 10), unit: '°C', sub: 'mock sensor' }) },
    'mock.humidity': { label: '濕度', read: async () => ({ label: '濕度', value: Math.round(wave(62, 6, 15)), unit: '%', sub: 'mock sensor' }) },
    'mock.lamp': {
      label: '檯燈',
      read: async () => ({ label: '檯燈', on: lamp, sub: 'press to toggle' }),
      toggle: async () => { lamp = !lamp; },
    },
  };
}

export class IotProvider extends EventEmitter {
  constructor({ devices = createMockDevices(), intervalMs = 5000, log = () => {} } = {}) {
    super();
    this.devices = devices;
    this.intervalMs = intervalMs;
    this.log = log;
    this.values = new Map();
  }

  ids() { return Object.keys(this.devices); }
  get(id) { return this.values.get(id); }

  async refresh(id) {
    const ids = id ? [id] : this.ids();
    for (const i of ids) {
      try { this.values.set(i, await this.devices[i].read()); } catch (e) { this.log('iot', i, e.message); }
    }
    this.emit('change');
  }

  async toggle(id) {
    const d = this.devices[id];
    if (d?.toggle) { await d.toggle(); await this.refresh(id); return true; }
    return false;
  }

  start() { this.timer = setInterval(() => this.refresh(), this.intervalMs); this.refresh(); }
  stop() { clearInterval(this.timer); }
}
