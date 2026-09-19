// data/night.js —— 一夜三段 + 主题夜（W14-A 第 4 步）
//
// 【这一层解决什么】第 3 步把出怪构成变成了"按潮位分档的表"（data/enemies.js 的 BANDS），
//   但**每个夜晚长得都一样**：从潮起打到潮落，构成不变、压力不变 —— 玩家布置一次就能睡到天亮。
//   这一步在表上再叠两层：
//     · **时段**（一夜三段）：试探 0–20s / 加压 20–45s / 高潮 45–60s —— 压力有形状
//     · **主题**（按天轮转）：芽潮 / 蛾潮 / 壳潮 / 枭群 / 混合 —— 每晚要调整布置
//   两层都只是"给那张分档表加权"，**兵种表本身仍然只有 enemies.js 一份**（不许在这里再抄一遍）。
//
// 【纪律】
//   · 本文件是**纯数据 + 纯函数**：只读 state（不改），不碰 DOM，不写 HTML —— HUD 文案由 main.js 拼。
//   · 确定性：主题只看 `state.day`，时段只看 `state.t` —— 同一天同一秒必然是同一个 plan
//     （HUD 预告、检测器对账、玩家"看预告备战"全都依赖这一点）。
//   · 数值边界：潮位走 data/combat.js 的 `tideOf()`（唯一式子），蚀潮窗口走 core/time.js 的常量。
import { ENEMIES, bandOf, pickFrom } from './enemies.js';
import { tideOf, BOSS, WAVES } from './combat.js';
import { TIDE_START, TIDE_END, isTide } from '../core/time.js';

export const TIDE_SECS = TIDE_END - TIDE_START;        // 一夜时长（由窗口常量派生，不写 60）

// —— 一夜三段 ——
// `upTo` 是**累计**上界（相对蚀潮起点），所以"三段连续覆盖整夜"是结构保证的，不可能漏一段或重叠。
// 每一段给三个乘子：
//   intervalMul 刷怪间隔 ×（>1 = 更稀疏）
//   batchAdd    每批只数 +（高潮多来一只）
//   themeBias   主题特征在**这一段**的浓度（试探段 0.45 = 只是"隐约有那个味道"，加压起才明目张胆）
export const SEGMENTS = [
  { id: 'probe', name: '试探', upTo: 20, intervalMul: 1.35, batchAdd: 0, themeBias: 0.45 },
  { id: 'press', name: '加压', upTo: 45, intervalMul: 1.0, batchAdd: 0, themeBias: 1 },
  { id: 'climax', name: '高潮', upTo: TIDE_SECS, intervalMul: 0.75, batchAdd: 1, themeBias: 1 },
];

// —— 主题表 ——
// weights：给分档表里某些兵种加权（未列出的兵种 = ×1）；这就是"主题"的全部内容 —— 不新增兵种、不改数值。
//   ⚠️ 主题的"签名兵种"就是 weights 的键（`signatureOf`），文案里的"主力"只能取自它们，
//      绝不允许在别处再手写一份"蛾潮夜主力是噬光虫"（那必然与加权分家）。
export const THEMES = {
  swarm: { id: 'swarm', name: '芽潮夜', note: '又快又脆 · 成群涌来', weights: { bud: 1.9, charger: 1.7 } },
  moth: { id: 'moth', name: '蛾潮夜', note: '噬光虫扑灯 · 先把灯守稳', weights: { moth: 2.3, spitter: 1.6 } },
  shell: { id: 'shell', name: '壳潮夜', note: '碎墙开路 · 自爆壳跟在后头', weights: { shell: 2.2, bomber: 1.9 } },
  owl: { id: 'owl', name: '枭群夜', note: '越墙而来 · 只有对空能拦', weights: { owl: 2.7, charger: 1.3 } },
  mix: { id: 'mix', name: '混合夜', note: '什么都有 · 按潮位看牌面', weights: {} },
};

// 主题轮转：确定性的"今晚是什么夜"。
//   第 1 天 = 芽潮（最弱，且第 1 天本来就只出蚀芽）；大潮夜固定「混合」——
//   Boss 才是那晚的主角，不该再叠一层主题尖峰。
const ROTATION = ['swarm', 'moth', 'shell', 'mix', 'owl', 'mix'];

export const NIGHT = { PREVIEW_SECS: 5, ROTATION };

export function themeIdOf(state) {
  const day = (state && state.day) || 1;
  if (day % BOSS.EVERY === 0) return 'mix';
  return ROTATION[(day - 1) % ROTATION.length];
}

export function themeOf(state) {
  return THEMES[themeIdOf(state)] || THEMES.mix;
}

// 主题的签名兵种（= weights 的键，按权重从大到小；文案与断言都从这里取）
export function signatureOf(theme) {
  return Object.keys(theme.weights).sort((a, b) => theme.weights[b] - theme.weights[a]);
}

// 当前时段（按 state.t 在蚀潮窗口里的位置；窗口外给首段，HUD 靠 isTide 自己决定显示不显示）
export function segAtRel(rel) {
  if (rel <= 0) return SEGMENTS[0];
  for (const s of SEGMENTS) if (rel < s.upTo) return s;
  return SEGMENTS[SEGMENTS.length - 1];
}
export function segmentOf(state) {
  return segAtRel((state && state.t ? state.t : 0) - TIDE_START);
}

// —— 刷怪间隔（**唯一式子**）——
// 【为什么挪到这里】第 7 步的 HUD 要告诉玩家“本夜还剩几波”，而“还剩几波”必须用与刷怪器**同一个式子**：
//   两边各算一套，等玩家按预告做决定时数字就是骗人的。所以：公式住在本文件，waves.js 只调用。
//   三个乘子：潮位（越高越密）× 难度（diff.waveMul）× 当前时段（试探稀/高潮密）
export function spawnInterval(state, seg, dm) {
  const tide = tideOf(state);
  const d = dm || state.diff || { waveMul: 1 };
  return Math.max(WAVES.INTERVAL_MIN, WAVES.INTERVAL_MAX - tide * WAVES.INTERVAL_PER_TIDE)
    * (d.waveMul || 1) * (seg ? seg.intervalMul : 1) / (state.nightChallengeMul || 1);
}

// —— 本夜还剩几波（给 HUD 的“威胁预告”）——
// 【为什么是估数】同屏 cap 卡住时，刷怪器**不消耗**这一批（spawnT 归零就等着），所以这只是“上限意义的上还会来几批”；
//   HUD 文案里要带个“≈”字（不把估数说成承诺）。窗口外（白天/黎明）返回 null = HUD 不显示。
// ⚠️ 起点必须算两段：**宁静期**（noSpawnT，刷怪器整个 return、spawnT 冻结）+ **宁静结束后还要等的剩余间隔**。
//   只算其中一段 → 宁静期一大就得出“还剩 0 波”（真机上真踩过：HUD 报 0 而实际还有十几波）。
export function wavesLeft(state) {
  if (!isTide(state)) return null;
  const dm = state.diff || { waveMul: 1 };
  const quiet = Math.max(0, state.noSpawnT || 0);
  const wait = Math.max(0, state.spawnT == null ? 0 : state.spawnT);
  let t = state.t + quiet + wait;
  let n = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (t >= TIDE_END) break;
    n += 1;
    t += spawnInterval(state, segAtRel(t - TIDE_START), dm);
  }
  return n;
}

// —— 今晚的完整计划（单一入口）——
// 返回：潮位 / 主题 / 时段 / 加权后的兵种表 / 归一份额 / 两个节奏乘子。
//   `shares` 是给 HUD 与检测器看的（"这一夜到底什么最多"），也可用来做第 8 步的难度曲线。
export function planNight(state) {
  const tide = tideOf(state);
  const theme = themeOf(state);
  const seg = segmentOf(state);
  const bias = seg.themeBias;
  const band = bandOf(tide).map(([k, w]) => [k, w * (1 + ((theme.weights[k] || 1) - 1) * bias)]);
  let total = 0;
  for (const [, w] of band) total += w;
  const shares = {};
  for (const [k, w] of band) shares[k] = total > 0 ? w / total : 0;
  return { tide, theme, seg, band, shares, intervalMul: seg.intervalMul, batchAdd: seg.batchAdd };
}

// 带缓存的 plan：主循环每帧都会问一次（HUD 也要），但只有"天/时段"变了才需要重算。
//   缓存挂在 state 上（会话态，不进存档）—— 键里带上 tide 是为了安全（难度也可能改潮位上限）
export function nightPlan(state) {
  const sig = `${state.day}|${tideOf(state)}|${segmentOf(state).id}`;
  if (state._nightSig !== sig || !state._nightPlan) {
    state._nightPlan = planNight(state);
    state._nightSig = sig;
  }
  return state._nightPlan;
}

export function pickKind(plan, rnd) {
  return pickFrom(plan.band, rnd);
}

// 归一份额最高的兵种（HUD 里"下一波主力"就报它；份额是加权后的真实概率，不是猜的）
export function mainKindOf(plan) {
  let best = null, bw = -1;
  for (const k in plan.shares) if (plan.shares[k] > bw) { bw = plan.shares[k]; best = k; }
  return best;
}

// —— HUD 需要的一切（不拼 HTML，data 层不许知道 DOM）——
export function nightHud(state) {
  const plan = nightPlan(state);
  const main = mainKindOf(plan);
  const d = ENEMIES[main] || {};
  const secs = Math.max(0, state.spawnT == null ? 0 : state.spawnT);
  const tideLeft = Math.max(0, TIDE_END - (state.t || 0));
  return {
    themeId: plan.theme.id, theme: plan.theme.name, note: plan.theme.note,
    segId: plan.seg.id, seg: plan.seg.name,
    main, group: `${d.name || main}群`, tag: d.tag || '', color: d.color || '',
    signatures: signatureOf(plan.theme).map((k) => (ENEMIES[k] || {}).name || k),
    inTide: isTide(state), secs: +secs.toFixed(1), soon: isTide(state) && secs <= NIGHT.PREVIEW_SECS,
    tide: plan.tide, shares: plan.shares,
    // 第 7 步：本夜还剩多久 / 还剩几波（HUD 的“威胁预告”；白天给整夜估值，夜里给剩余估值）
    tideLeft: +tideLeft.toFixed(1),
    left: isTide(state) ? wavesLeft(state) : wavesInWindow(state),
  };
}

// 整夜一共有几波（白天/黄昏的预告用）：从窗口起点开始走一遍同一个循环
export function wavesInWindow(state) {
  const dm = state.diff || { waveMul: 1 };
  let t = TIDE_START, n = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (t >= TIDE_END) break;
    n += 1;
    t += spawnInterval(state, segAtRel(t - TIDE_START), dm);
  }
  return n;
}
