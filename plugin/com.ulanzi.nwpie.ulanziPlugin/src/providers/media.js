// Now playing (Windows media session: Spotify, YouTube Music in a browser, ...) + Core Audio.
import { EventEmitter } from 'node:events';

export class MediaProvider extends EventEmitter {
  constructor({ helper, log = () => {}, mediaMs = 1000, audioMs = 2000 } = {}) {
    super();
    this.helper = helper;
    this.log = log;
    this.mediaMs = mediaMs;
    this.audioMs = audioMs;
    this.media = { active: false };
    this.audio = null;
    this.art = null; // { key, dataUrl, accent }
  }

  async pollMedia() {
    const m = await this.helper.request('media', false);
    if (!m) return;
    if (m.active && m.artKey && m.artKey !== this.art?.key) {
      const full = await this.helper.request('media', true);
      this.art = { key: m.artKey, dataUrl: full?.art || null, accent: full?.accent || null };
    }
    const before = JSON.stringify([this.media.title, this.media.status, this.media.active, Math.round(this.media.position || 0)]);
    this.media = { ...m, at: Date.now() };
    if (before !== JSON.stringify([m.title, m.status, m.active, Math.round(m.position || 0)])) this.emit('change');
  }

  async pollAudio() {
    const a = await this.helper.request('audio');
    if (a && JSON.stringify(a) !== JSON.stringify(this.audio)) { this.audio = a; this.emit('change'); }
  }

  /** Playback position now (seconds), extrapolated while playing. */
  position(now = Date.now()) {
    const m = this.media;
    if (!m.active || !m.duration) return null;
    let pos = m.position || 0;
    if (m.status === 'Playing' && m.updatedAt) pos += (now - m.updatedAt) / 1000;
    return Math.max(0, Math.min(m.duration, pos));
  }

  async control(what) { await this.helper.request('media.ctl', what); setTimeout(() => this.pollMedia(), 300); }

  async setAudio(arg) {
    const a = await this.helper.request('audio.set', arg);
    if (a) { this.audio = a; this.emit('change'); }
  }

  start() {
    this.t1 = setInterval(() => this.pollMedia().catch(e => this.log('media', e.message)), this.mediaMs);
    this.t2 = setInterval(() => this.pollAudio().catch(e => this.log('audio', e.message)), this.audioMs);
    this.pollMedia(); this.pollAudio();
  }

  stop() { clearInterval(this.t1); clearInterval(this.t2); }
}
