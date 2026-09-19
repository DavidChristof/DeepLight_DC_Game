// core/time.js —— 蚀潮时钟（一天 400 秒，四阶段）
// 时间常量集中在这里，别处一律引用，避免散落的魔数导致改节奏时漏改
//
// 一天 = 白天 300 + 黄昏 20 + 蚀潮 60 + 黎明 20 = 400s（6 分 40 秒）
// 【为什么拉长】旧版 140s/天（白天只有 90s）太赶：刚铺两盏灯天就黑了，
// 想"建点东西 + 出去探一趟"根本不够。现在白天 5 分钟是主场，夜更长、也更有过程。
export const MORNING_SECS = 6;      // 清晨渐亮（天刚亮的过渡）
export const DAY_END = 300;         // 白天结束 → 黄昏开始
export const TIDE_START = 320;      // 黄昏结束 → 蚀潮（夜晚）开始
export const TIDE_END = 380;        // 蚀潮结束 → 黎明开始
export const DAY_SECS = 400;        // 黎明结束 → 次日
export const DAWN_SECS = DAY_SECS - TIDE_END;   // 20s：残留蚀兽逐个消解的阶段
export const DAWN_T = 390;          // 死亡重生落点（黎明中段：起来时蚀兽正在化）
export const DUSK_START = DAY_END;  // 黄昏起点（太阳开始下去，夜采从这时算起）

export const PHASES = [
  { name: '白天', to: DAY_END },       // 300s 白天：建造/采集/探索的主场
  { name: '黄昏', to: TIDE_START },    // 20s 黄昏：判断该不该出门
  { name: '蚀潮', to: TIDE_END },      // 60s 黑夜：蚀潮高潮
  { name: '黎明', to: DAY_SECS },      // 20s 黎明：蚀兽消解 + 抢收夜辉草
];

export function isTide(state) {
  return state.t >= TIDE_START && state.t < TIDE_END;
}
// 黎明：蚀潮退了、天还没亮 —— 残留蚀兽在这段时间里被逐个消解（Boss 除外）
export function isDawn(state) {
  return state.t >= TIDE_END && state.t < DAY_SECS;
}
// "夜里"的粗粒度判断（含黄昏与黎明）—— 心志 / 夜采 / 守夜人等用
export function isNight(state) {
  return state.t >= DUSK_START || state.t < MORNING_SECS;
}

// dt: 秒。onDay 在跨天结算时回调（用于存档/事件）。
export function updateTime(state, dt, onDay) {
  state.t += dt;
  while (state.t >= DAY_SECS) {
    state.t -= DAY_SECS;
    state.day += 1;
    if (onDay) onDay(state);
  }
}

export function phaseInfo(state) {
  let from = 0;
  for (const p of PHASES) {
    if (state.t < p.to) return { name: p.name, frac: (state.t - from) / (p.to - from) };
    from = p.to;
  }
  return { name: PHASES[0].name, frac: 0 };
}

// 当前处于第几阶段（0..3）—— 给"阶段变了才重建 DOM"那类签名用
export function phaseIndexOf(state) {
  let i = 0;
  for (const p of PHASES) {
    if (state.t < p.to) return i;
    i += 1;
  }
  return 0;
}

// 环境光（全图太阳光）0..1：清晨渐亮 → 白天全亮 → 黄昏渐暗 → 蚀潮全黑 → 黎明渐亮
// 只用于渲染亮度，不影响“光源照明的探索迷雾”
export function ambientOf(state) {
  if (state.layerId && state.layerId !== 'surface') return 0;   // 深潜层：永夜无环境光
  const t = state.t;
  if (t < MORNING_SECS) return 0.35 + 0.65 * (t / MORNING_SECS);            // 清晨渐亮
  if (t < DAY_END) return 1.0;                                             // 白天全图光
  if (t < TIDE_START) return 1.0 - (t - DAY_END) / (TIDE_START - DAY_END);  // 黄昏 1→0
  if (t < TIDE_END) return 0;                                              // 蚀潮·深夜
  return Math.min(0.55, ((t - TIDE_END) / DAWN_SECS) * 0.55);               // 黎明微光
}
