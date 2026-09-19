// firstSlice.js —— W17-F0/F1/F2/F3：首局体验垂直切片的数据契约。
//
// F0 只保存/观测“首局走到了哪里”；F1/F2/F3 消费阶段表驱动短提示、锁夜观测和一次远征往返，不改波次预算。
// 后续步骤只能消费本表定义的阶段与标记，数值与文案也应集中在这里。

export const FIRST_SLICE = {
  VERSION: 1,
  MAX_HISTORY: 16,
  INITIAL_PHASE: 'wake',
  PHASES: ['wake', 'gather', 'light', 'dusk', 'tide', 'aftermath', 'expedition', 'complete'],
  GUIDE: {
    gather: '先采一点辉髓和藤木',
    light: '造一盏灯柱，守住营地',
    lit: '灯已亮 · 先熟悉营地周边',
    dusk: '黄昏 · 备好燃料，守住灯光',
    tide: '蚀潮来了 · 光压 0 · 守住灯',
    aftermath: '天亮了 · 查灯、修墙、清蚀痕',
    expedition: '离开营地 · 去相邻区块看一眼',
    complete: '远征完成 · 回营地整理补给',
  },
  METRIC_DEFAULTS: {
    duskLamps: 0, tidePressure: 0, tideChallengeMul: 1, aftermathBlight: 0,
    expeditionCx: 0, expeditionCy: 0, expeditionDay: 0, returnDay: 0,
  },
};

export function createFirstSlice(active = true, day = 1, t = 0) {
  return {
    version: FIRST_SLICE.VERSION,
    active: !!active,
    phase: FIRST_SLICE.INITIAL_PHASE,
    startedDay: Math.max(1, day | 0),
    startedT: Math.max(0, Number(t) || 0),
    flags: {},
    history: [],
    choice: null,
    metrics: { ...FIRST_SLICE.METRIC_DEFAULTS },
  };
}

export function normalizeFirstSlice(raw, activeDefault = false, day = 1, t = 0) {
  const base = createFirstSlice(activeDefault, day, t);
  if (!raw || typeof raw !== 'object') return base;
  const phase = FIRST_SLICE.PHASES.includes(raw.phase) ? raw.phase : base.phase;
  const flags = raw.flags && typeof raw.flags === 'object' && !Array.isArray(raw.flags)
    ? Object.fromEntries(Object.entries(raw.flags).filter(([k, v]) => /^[a-z][a-zA-Z0-9_]{0,31}$/.test(k) && typeof v === 'boolean'))
    : {};
  const history = Array.isArray(raw.history) ? raw.history.slice(-FIRST_SLICE.MAX_HISTORY).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !FIRST_SLICE.PHASES.includes(entry.phase)) return [];
    const eDay = Math.max(1, Number(entry.day) | 0 || 1);
    const eT = Math.max(0, Number(entry.t) || 0);
    return [{ phase: entry.phase, day: eDay, t: eT }];
  }) : [];
  const rawMetrics = raw.metrics && typeof raw.metrics === 'object' && !Array.isArray(raw.metrics) ? raw.metrics : {};
  const metrics = { ...FIRST_SLICE.METRIC_DEFAULTS };
  for (const k of Object.keys(metrics)) {
    const n = Number(rawMetrics[k]);
    if (Number.isFinite(n) && n >= 0) metrics[k] = Math.min(k === 'tideChallengeMul' ? 10 : 1e6, n);
  }
  return {
    version: FIRST_SLICE.VERSION,
    active: raw.active == null ? !!activeDefault : !!raw.active,
    phase,
    startedDay: Math.max(1, Number(raw.startedDay) | 0 || base.startedDay),
    startedT: Math.max(0, Number(raw.startedT) || base.startedT),
    flags,
    history,
    choice: typeof raw.choice === 'string' && raw.choice.length <= 32 ? raw.choice : null,
    metrics,
  };
}

export function firstSliceReport(state) {
  const slice = normalizeFirstSlice(state && state.firstSlice, false, state && state.day, state && state.t);
  return {
    version: slice.version,
    active: slice.active,
    phase: slice.phase,
    startedDay: slice.startedDay,
    startedT: +slice.startedT.toFixed(2),
    flags: { ...slice.flags },
    history: slice.history.map((entry) => ({ ...entry, t: +entry.t.toFixed(2) })),
    choice: slice.choice,
    metrics: { ...slice.metrics },
    current: state ? { day: state.day | 0, t: +(Number(state.t) || 0).toFixed(2) } : null,
  };
}
