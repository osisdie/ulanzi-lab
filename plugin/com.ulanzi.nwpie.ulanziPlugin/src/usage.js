// Account-wide Claude usage (rate limits) as reported by any session's statusLine.
import { EventEmitter } from 'node:events';

/**
 * Burn rate of the 5h window from {t, pct} samples (linear regression over the last 30 min).
 * status: 'danger' if the limit is reached before the window resets, 'ok' otherwise,
 * 'unknown' with < 3 samples or < 5 min of data.
 */
export function burnRate(samples, now, resetsAtSec) {
  const recent = (samples || []).filter(x => now - x.t <= 30 * 60e3);
  if (recent.length < 3 || recent[recent.length - 1].t - recent[0].t < 5 * 60e3) return { status: 'unknown', pctPerHour: null, etaMs: null };
  const n = recent.length;
  const mx = recent.reduce((a, x) => a + x.t, 0) / n, my = recent.reduce((a, x) => a + x.pct, 0) / n;
  let num = 0, den = 0;
  for (const x of recent) { num += (x.t - mx) * (x.pct - my); den += (x.t - mx) ** 2; }
  const perMs = den ? num / den : 0;
  const pctPerHour = +(perMs * 3600e3).toFixed(2);
  const last = recent[n - 1].pct;
  if (perMs <= 0) return { status: 'ok', pctPerHour, etaMs: null };
  const etaMs = Math.max(0, (100 - last) / perMs);
  const untilReset = resetsAtSec ? resetsAtSec * 1000 - now : Infinity;
  return { status: etaMs < untilReset ? 'danger' : 'ok', pctPerHour, etaMs };
}

const toEpochSec = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v ? Math.round(Date.parse(v) / 1000) || null : null);

export class UsageStore extends EventEmitter {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.now = now;
    this.five_hour = null;
    this.seven_day = null;
    this.spend_limit = null;
    this.last = null; // last session's {session_id, ctxPct, cost, model}
    this.samples = []; // five_hour {t, pct}, reset when the window changes
  }

  /** body = the payload posted by statusline/ulanzi-statusline.sh */
  ingest(body = {}) {
    const t = this.now();
    const rl = body.rate_limits || {};
    for (const k of ['five_hour', 'seven_day', 'spend_limit']) {
      const w = rl[k];
      if (w && w.used_percentage != null) {
        const resets = toEpochSec(w.resets_at);
        if (k === 'five_hour') {
          if (this.five_hour && this.five_hour.resets_at !== resets) this.samples = [];
          // Several sessions post the same account-wide number; keep at most one sample per 20 s.
          const lastS = this.samples[this.samples.length - 1];
          if (lastS && t - lastS.t < 20e3) this.samples.pop();
          this.samples.push({ t, pct: Number(w.used_percentage) });
          if (this.samples.length > 60) this.samples.shift();
        }
        this[k] = { used_percentage: Number(w.used_percentage), resets_at: resets, receivedAt: t };
      }
    }
    // Drop windows whose reset time has passed (Claude Code does the same).
    for (const k of ['five_hour', 'seven_day', 'spend_limit']) {
      if (this[k]?.resets_at && this[k].resets_at * 1000 < t) this[k] = null;
    }
    this.last = {
      session_id: body.session_id || null,
      ctxPct: body.context_window?.used_percentage ?? null,
      cost: body.cost?.total_cost_usd ?? null,
      model: body.model?.display_name || body.model?.id || null,
      at: t,
    };
    this.emit('change');
    return this.snapshot();
  }

  snapshot() {
    return {
      five_hour: this.five_hour, seven_day: this.seven_day, spend_limit: this.spend_limit,
      cost: this.last?.cost ?? null, ctxPct: this.last?.ctxPct ?? null, model: this.last?.model ?? null,
      burn: burnRate(this.samples, this.now(), this.five_hour?.resets_at),
    };
  }

  toJSON() { return { five_hour: this.five_hour, seven_day: this.seven_day, spend_limit: this.spend_limit, last: this.last, samples: this.samples }; }

  load(j = {}) {
    for (const k of ['five_hour', 'seven_day', 'spend_limit', 'last', 'samples']) if (j[k]) this[k] = j[k];
  }
}
