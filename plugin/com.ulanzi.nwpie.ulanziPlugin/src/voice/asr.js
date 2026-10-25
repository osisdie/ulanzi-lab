// Speech-to-text client for the local voice-asr service (OpenAI-style /v1/audio/transcriptions, verbose_json),
// plus the transcript formats written next to each recording: punctuated .txt and .srt subtitles.
import { postMultipart, retryBusy } from './http.js';

// The 🌐 key cycles these. Taigi (Taiwanese Hokkien) speech goes to Breeze-ASR-26, which writes Mandarin text.
export const LANGUAGES = [
  { id: 'zh', label: '華語', model: 'breeze-asr-25', language: 'zh' },
  { id: 'en', label: 'English', model: 'breeze-asr-25', language: 'en' },
  { id: 'nan', label: '台語', model: 'breeze-asr-26', language: 'zh' },
  { id: 'auto', label: '自動', model: 'breeze-asr-25', language: 'auto' },
];
export const languageOf = (id) => LANGUAGES.find(l => l.id === id) || LANGUAGES[0];

/**
 * Transcribe `file`. Resolves { text, segments, duration, elapsed, model }; rejects with a short message.
 * `audioSec` sizes the timeout: transcription on a CPU runs at about real time, so allow the length plus a margin.
 */
export async function transcribe(file, { url, lang = 'zh', audioSec = 60, onWait, post = postMultipart } = {}) {
  const l = languageOf(lang);
  const timeoutMs = Math.max(120e3, (audioSec * 2 + 60) * 1000);
  const r = await retryBusy(() => post(`${url.replace(/\/$/, '')}/v1/audio/transcriptions`, {
    fields: { model: l.model, language: l.language, response_format: 'verbose_json' },
    file: { field: 'file', path: file, type: 'audio/wav' },
  }, { timeoutMs }), { onWait });
  let body = null;
  try { body = JSON.parse(r.body); } catch { /* not JSON */ }
  if (r.status !== 200) throw new Error(`ASR ${r.status}: ${body?.detail || body?.error || String(r.body).slice(0, 120)}`);
  if (!body || !Array.isArray(body.segments)) throw new Error('ASR: unexpected reply');
  return { text: body.text || '', segments: body.segments, duration: body.duration, elapsed: body.elapsed, model: body.model };
}

const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff';
const ENDS_PUNCT = /[，。！？、；：,.!?;:…」』）)]$/u;
const ASCII_ONLY = /^[\x20-\x7e]+$/;

/**
 * Punctuated text from timed segments. Breeze writes no punctuation, but its segments end where you paused:
 * each segment ends a clause; a long pause, a sentence-final particle or a long run of clauses ends a sentence.
 * A space between two Chinese characters (a short pause inside a segment) becomes a comma.
 */
export function punctuate(segments, { sentenceGap = 0.6, maxClauseChars = 60 } = {}) {
  let out = '';
  let sinceStop = 0;
  segments.forEach((s, i) => {
    let t = String(s.text || '').trim().replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'gu'), '$1，');
    if (!t) return;
    const next = segments[i + 1];
    const last = !next;
    const gap = next ? next.start - s.end : Infinity;
    sinceStop += t.length;
    const english = ASCII_ONLY.test(t);
    const switches = next && english !== ASCII_ONLY.test(String(next.text || '').trim()); // English ↔ Chinese
    if (!ENDS_PUNCT.test(t)) {
      let mark;
      if (/[嗎呢]$/u.test(t)) mark = '？';
      else if (last || switches || gap >= sentenceGap || /[喔啊啦吧耶囉唷哦]$/u.test(t) || sinceStop >= maxClauseChars) mark = '。';
      else mark = '，';
      if (english) mark = { '？': '?', '。': '.', '，': ',' }[mark];
      t += mark;
    }
    if (/[。？！.?!]$/u.test(t)) sinceStop = 0;
    // A space after Latin punctuation or between Latin words; Chinese runs on.
    out += (/[\x21-\x7e]$/.test(out) && (/^[\x21-\x7e]/.test(t) || /[.?!,]$/.test(out)) ? ' ' : '') + t;
  });
  return out;
}

const ts = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** SubRip subtitles, one cue per segment. */
export const toSrt = (segments) => segments.filter(s => String(s.text || '').trim())
  .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${String(s.text).trim()}\n`).join('\n');
