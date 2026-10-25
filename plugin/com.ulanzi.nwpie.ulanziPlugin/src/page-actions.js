// Actions for the extra pages (media, focus, hw, devops, prompt, target). deck.js delegates to this.
import { spawn } from 'node:child_process';
import * as P from './render-pages.js';
import { promptTargets, autoTarget, sendToSession } from './prompts.js';
import { IS_WIN, IS_MAC, openUrl, openFolder, openSystemMonitor, startDocker } from './platform.js';
import { osa } from './mac/osa.js';

export const PAGE_ACTIONS = ['media', 'focus', 'hw', 'devops', 'prompt', 'target'];

/** One actions object for deck.js from several (page actions, voice actions…): each action goes to whichever handles it. */
export function combineActions(...list) {
  const of = (action) => list.find(x => x.handles(action));
  return {
    handles: (a) => !!of(a),
    bind: (k) => of(k.action)?.bind(k),
    unbind: (k) => of(k.action)?.unbind(k),
    render: (k, opts) => of(k.action)?.render(k, opts) ?? null,
    animated: (k, half) => of(k.action)?.animated(k, half) || false,
    press: (k, ctx, long) => of(k.action)?.press(k, ctx, long),
    quiet: () => list.some(x => x.quiet?.()),
    sources: list.flatMap(x => x.sources || []),
    stop: () => { for (const x of list) x.stop?.(); },
  };
}

const DEFAULT_DISK = IS_WIN ? 'C:' : '/';

export function createPageActions({ media, hw, devops, pomodoro, sessions, toast, play = () => {}, log = () => {}, now = () => Date.now() }) {
  let pinnedTarget = null; // session id, or null = auto
  const flashUntil = new Map(); // ctx -> ms (pressed-key feedback)

  const target = () => {
    const list = promptTargets(sessions.list());
    return (pinnedTarget && list.find(s => s.id === pinnedTarget)) || autoTarget(sessions.list());
  };

  function bind(k) {
    if (k.action === 'devops' && k.settings.kind === 'http') devops.watchUrl(k.settings.url);
    if (k.action === 'devops' && k.settings.kind === 'gh-actions') devops.watchRepo(k.settings.repo);
  }
  function unbind(k) {
    if (k.action === 'devops' && k.settings.kind === 'http') devops.unwatchUrl(k.settings.url);
    if (k.action === 'devops' && k.settings.kind === 'gh-actions') devops.unwatchRepo(k.settings.repo);
  }

  function render(k, { phase, tick, ctx }) {
    const s = k.settings;
    const t = now();
    const wide = k.key === '3_2';
    switch (k.action) {
      case 'media': return P.mediaKey(s.part || (wide ? 'wide' : 'art'), { media: media.media, audio: media.audio, art: media.art }, { now: t, position: media.position(t), wide });
      case 'focus': return P.focusKey(s.part || (wide ? 'wide' : 'timer'), pomodoro, { now: t, frame: tick, wide });
      case 'hw': return P.hwKey(s.metric || (wide ? 'wide' : 'cpu'), hw.get(), { disk: s.disk || DEFAULT_DISK });
      case 'devops': return P.devopsKey(s.kind || (wide ? 'wide' : 'cr-mine'), devops.get(), { phase, label: s.label, url: s.url, slot: Number(s.slot) || 0, repo: s.repo || process.env.ULANZI_LAB_ACTIONS_REPO || '', now: t });
      case 'prompt': return P.promptKey(s.label || s.text || s.keys || '?', { target: target(), icon: s.icon || '', hold: s.hold === true || s.hold === 'on', needsWaiting: s.needsWaiting === true || s.needsWaiting === 'on', flash: (flashUntil.get(ctx) || 0) > t });
      case 'target': return P.targetKey(target(), { auto: !pinnedTarget, count: promptTargets(sessions.list()).length, phase });
      default: return null;
    }
  }

  /** Which page keys need re-rendering on the clock (`half` = every 500 ms). */
  function animated(k, half) {
    if (k.action === 'focus') return half;
    if (k.action === 'media') return half && ['wide', 'play', 'art'].includes(k.settings.part || (k.key === '3_2' ? 'wide' : 'art'));
    if (k.action === 'devops' || k.action === 'target') return half;
    if (k.action === 'prompt') return half;
    return false;
  }

  async function press(k, ctx, long) {
    const s = k.settings;
    switch (k.action) {
      case 'media': {
        const part = s.part || (k.key === '3_2' ? 'wide' : 'art');
        if (['art', 'play', 'wide'].includes(part)) return media.control('playpause');
        if (part === 'prev' || part === 'next') return media.control(part);
        if (part === 'vol') return media.setAudio({ what: 'mute' });
        if (part === 'voldown' || part === 'volup') return media.setAudio({ what: 'volume', delta: (part === 'volup' ? 1 : -1) * (Number(s.step) || 5) });
        if (part === 'mic') return media.setAudio({ what: 'mic' });
        if (part === 'output') return media.setAudio({ what: 'output' });
        if (part === 'spotify') return openUrl('spotify:');
        if (part === 'ytmusic') return openUrl('https://music.youtube.com/');
        return;
      }
      case 'focus': {
        const part = s.part || (k.key === '3_2' ? 'wide' : 'timer');
        if (part === 'timer' || part === 'wide' || part === 'mascot') return long ? pomodoro.reset() : pomodoro.toggle();
        if (part === 'reset') return pomodoro.reset();
        if (part === 'plus') return pomodoro.plus(5);
        if (part === 'length') return pomodoro.cycleLength();
        if (part === 'break') return pomodoro.startBreak(false);
        if (part === 'long') return pomodoro.startBreak(true);
        if (part === 'dnd') return pomodoro.toggleDnd();
        return;
      }
      case 'hw': {
        const m = s.metric || 'cpu';
        if (m === 'temps' && IS_WIN) return openUrl('http://127.0.0.1:8085/');
        if (m === 'disk') return openFolder(IS_WIN ? `${s.disk || 'C:'}\\` : s.disk || '/');
        return openSystemMonitor();
      }
      case 'devops': {
        const kind = P.KIND_ALIASES[s.kind] || s.kind || (k.key === '3_2' ? 'wide' : 'cr-mine');
        if (long || kind === 'wide') { toast('DevOps: refreshing…'); return devops.refreshAll(); }
        const st = devops.get();
        const f = st.forge || {};
        const github = f.kind === 'github';
        // Not logged in: the keys read through the glab / gh CLI (inside WSL on Windows), so a browser login doesn't help.
        // Open a terminal running the CLI login; the provider re-polls every 15 s until it succeeds.
        if (/^(cr|mr)-/.test(kind) && (f.auth === false || (!f.auth && f.error))) {
          const cli = github ? `gh auth login --hostname ${f.host || 'github.com'}` : f.host ? `glab auth login --hostname ${f.host}` : 'glab auth login';
          toast(`Run ${github ? 'gh' : 'glab'} auth login in the new terminal ${IS_WIN ? 'tab' : 'window'}`);
          if (IS_MAC) return osa('terminal', cli);
          return spawn('wt.exe', ['-w', '0', 'nt', '--title', 'forge login', 'wsl.exe', '-d', devops.distro, '-e', 'bash', '-lc', `${cli} || read -rp "Press Enter to close"`],
            { detached: true, stdio: 'ignore' }).on('error', () => toast('wt.exe not found')).unref();
        }
        const base = github ? `https://${f.host || 'github.com'}` : `https://${f.host || 'gitlab.com'}/dashboard/merge_requests`;
        const urls = github
          ? { 'cr-mine': `${base}/pulls`, 'cr-reviews': `${base}/pulls/review-requested` }
          : { 'cr-mine': base, 'cr-reviews': `${base}?reviewer_username=${f.login || ''}` };
        Object.assign(urls, { 'status-claude': 'https://status.claude.com', 'status-github': 'https://www.githubstatus.com', n8n: process.env.ULANZI_LAB_N8N_URL || 'http://localhost:5678' });
        if (kind.startsWith('mr-')) {
          const b = st.mrs || {};
          const pick = { 'mr-ci': b.problems?.find(m => m.ci === 'failed'), 'mr-conflict': b.problems?.find(m => m.conflict), 'mr-stale': b.stalest?.[0], 'mr-wide': b.problems?.[0] }[kind];
          if (pick) return openUrl(kind === 'mr-ci' ? `${pick.url}/${github ? 'checks' : 'pipelines'}` : pick.url);
          const repo = kind === 'mr-repo' ? b.repos?.[Number(s.slot) || 0] : null;
          return openUrl(repo ? `${repo.url}/${github ? 'pulls' : '-/merge_requests'}` : urls['cr-mine']);
        }
        if (kind === 'gh-actions') {
          const a = st.actions?.[s.repo] || Object.values(st.actions || {}).find(Boolean);
          return openUrl(a?.runs?.[0]?.url || (s.repo ? `https://${f.host || 'github.com'}/${s.repo}/actions` : urls['cr-mine']));
        }
        if (kind === 'http') return s.url && openUrl(s.url);
        if (kind === 'docker') {
          if (!st.docker?.up) { toast('Starting Docker Desktop…'); return startDocker(() => toast('Docker Desktop not found')); }
          return;
        }
        return urls[kind] && openUrl(urls[kind]);
      }
      case 'prompt': {
        const tgt = target();
        if (!tgt) return toast('No Claude session in tmux to send to');
        const hold = s.hold === true || s.hold === 'on';
        if (hold && !long) return toast(`Hold to send “${s.label || s.text}”`);
        if ((s.needsWaiting === true || s.needsWaiting === 'on') && tgt.state !== 'waiting') return toast(`S${tgt.slot} ${tgt.project} is not waiting`);
        const keys = String(s.keys || '').split(',').map(x => x.trim()).filter(Boolean);
        const enter = s.enter === undefined ? !!s.text : s.enter === true || s.enter === 'on';
        const r = await sendToSession(tgt, { text: s.text || '', keys, enter }, { log });
        if (!r.ok) return toast(`Send failed: ${r.error}`);
        flashUntil.set(ctx, now() + 600);
        if (tgt.state === 'waiting') sessions.ack(tgt.id);
        return;
      }
      case 'target': {
        const list = promptTargets(sessions.list());
        if (long || !list.length) { pinnedTarget = null; return toast('Prompt target: auto'); }
        const cur = target();
        const i = list.findIndex(x => x.id === cur?.id);
        const next = pinnedTarget && i === list.length - 1 ? null : list[(i + 1) % list.length];
        pinnedTarget = next ? next.id : null;
        return toast(`Prompt target: ${next ? `S${next.slot} ${next.project}` : 'auto'}`);
      }
      default:
    }
  }

  // Pomodoro clock: finish blocks, announce them.
  const pomoTimer = setInterval(() => {
    const evt = pomodoro.tick();
    if (evt?.type === 'focus-done') { toast(`🍅 Focus block done (${evt.today} today) — ${evt.long ? 'long break' : 'break'} started`); play('focusDone'); }
    if (evt?.type === 'break-done') { toast('Break over — ready for the next 🍅'); play('breakDone'); }
  }, 1000);

  return {
    handles: (a) => PAGE_ACTIONS.includes(a), bind, unbind, render, animated, press,
    quiet: () => pomodoro.quiet(),
    sources: [[media, 'media'], [hw, 'hw'], [devops, 'devops'], [pomodoro, 'focus']],
    stop: () => clearInterval(pomoTimer),
  };
}
