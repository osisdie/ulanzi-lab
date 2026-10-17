#!/usr/bin/env node
// Show every Claude session look on the top row (S1–S4 + HITL) using the hub's demo mode.
// Real sessions are untouched and return automatically when the demo ends.
//   node scripts/demo-states.mjs [--round-seconds 10] [--loops 2] [--hub http://127.0.0.1:39300]
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HUB = arg('hub', process.env.ULANZI_HUB || 'http://127.0.0.1:39300');
const ROUND = Number(arg('round-seconds', 10));
const LOOPS = Number(arg('loops', 2));

const ROUNDS = [
  {
    title: '一般狀態：閒置 / 思考 / 工作 / 錯誤（底部細條 = context 用量 綠<50 橘50-80 紅≥80）',
    slots: {
      1: { project: '閒置', state: 'idle', ctxPct: 20, ageSec: 300 },
      2: { project: '思考中', state: 'thinking', ctxPct: 45, ageSec: 8 },
      3: { project: '工作中', state: 'working', tool: 'Edit', ctxPct: 62, ageSec: 30 },
      4: { project: '錯誤', state: 'error', ctxPct: 88, ageSec: 12 },
    },
  },
  {
    title: 'HITL：紅=批准權限 / 紫=Claude 提問 / 橘=計畫審核（閃爍）+ 琥珀=換你了（不閃）',
    slots: {
      1: { project: '等你批准', state: 'waiting', kind: 'permission', tool: 'Bash', ageSec: 95 },
      2: { project: 'Claude提問', state: 'waiting', kind: 'question', tool: 'AskUserQuestion', ageSec: 40 },
      3: { project: '計畫審核', state: 'waiting', kind: 'plan', tool: 'ExitPlanMode', ageSec: 10 },
      4: { project: '換你了', state: 'done', ctxPct: 85, ageSec: 60 },
    },
  },
  {
    title: '單一等待：其他都在忙，HITL 顯示 1 + 最久等待的專案',
    slots: {
      1: { project: '工作中', state: 'working', tool: 'Bash', ctxPct: 30, ageSec: 5 },
      2: { project: '思考中', state: 'thinking', ctxPct: 51, ageSec: 3 },
      3: { project: '等你批准', state: 'waiting', kind: 'permission', tool: 'WebFetch', ageSec: 130 },
      4: { project: '換你了', state: 'done', ctxPct: 12, ageSec: 20 },
    },
  },
];

const post = (body) => fetch(`${HUB}/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

process.on('SIGINT', async () => { await post({ stop: true }); process.exit(0); });
for (let loop = 0; loop < LOOPS; loop++) {
  for (const [i, r] of ROUNDS.entries()) {
    console.log(`[${new Date().toLocaleTimeString()}] round ${i + 1}/${ROUNDS.length}: ${r.title}`);
    await post({ slots: r.slots, seconds: ROUND + 2 });
    await sleep(ROUND * 1000);
  }
}
await post({ stop: true });
console.log('demo ended; real sessions are back');
