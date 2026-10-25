// Actions for the Voice profile keys (action "voice", setting `part`). Same interface as page-actions.js;
// runtime.js joins both with combineActions so deck.js stays unchanged.
import { voiceKey } from './render-voice.js';
import { openFile, openFolder, revealFile } from './platform.js';

export const VOICE_PARTS = ['rec', 'save', 'finish', 'cancel', 'last', 'copy', 'retry', 'status', 'lang', 'folder', 'wide'];

export function createVoiceActions({ voice, toast = () => {}, now = () => Date.now() }) {
  const partOf = (k) => k.settings.part || (k.key === '3_2' ? 'wide' : 'rec');
  const say = (msg) => { if (msg) toast(`Voice: ${msg}`); };

  async function openLast(long) {
    await voice.ready;
    const f = voice.lastTranscript();
    if (long || !f) return f ? revealFile(f) : voice.dirs && openFolder(voice.dirs.transcripts);
    return openFile(f);
  }

  return {
    handles: (a) => a === 'voice',
    bind() {}, unbind() {},
    render: (k, { phase }) => voiceKey(partOf(k), voice.get(), { phase, wide: k.key === '3_2', now: now() }),
    /** Live keys while recording / transcribing (timer, level meter, progress), and blinking confirmations. */
    animated(k, half) {
      const v = voice.get();
      const p = partOf(k);
      if (['recording', 'saving', 'transcribing'].includes(v.phase) && ['rec', 'wide', 'status'].includes(p)) return true;
      if (p === 'cancel' && v.confirmCancelUntil) return half;
      if (p === 'status' && v.asr?.state === 'starting') return half;
      return false;
    },
    async press(k, _ctx, long) {
      const v = voice.get();
      switch (partOf(k)) {
        case 'rec': return say(await voice.toggle());
        case 'save': return say(await voice.finish({ transcribe: false }));
        case 'finish': return say(await voice.finish({ transcribe: true }));
        case 'cancel': return say(await voice.cancel());
        case 'last': return openLast(long);
        case 'copy': return say(await voice.copyLast());
        case 'retry': return say(await voice.retry());
        case 'status': return say(await voice.warmUp());
        case 'lang': return say(voice.cycleLang());
        case 'folder': await voice.ready; return voice.dirs && openFolder(long ? voice.dirs.root : voice.dirs.recordings);
        case 'wide':
        default:
          if (v.phase === 'recording' || v.phase === 'paused') return say(await voice.toggle());
          return openLast(long);
      }
    },
    quiet: () => false,
    sources: [[voice, 'voice']],
    stop: () => voice.stop(),
  };
}
