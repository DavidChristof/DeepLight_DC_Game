// data/traits.js —— D4「人的重量」：专长 / 短处 / 心志分级 / 安抚成本（纯数据，无依赖）
// 专长：每人 1 长 1 短，开局随机，不可刷 —— 排班从"谁有空"变成"谁合适"

export const TRAITS = {
  // —— 专长 ——
  miner: { name: '矿工', good: true, desc: '采矿速度 +40%，挖空矿脉时 15% 概率发现第二层' },
  farmer: { name: '农人', good: true, desc: '幽菌田生长 +30%（全场），抢收多得 1 食物' },
  nightwatch: { name: '守夜人', good: true, desc: '夜里士气不减反增（+0.4/s），是唯一熬夜不崩的人' },
  tinker: { name: '技师', good: true, desc: '维修速度 ×2，全场防守塔射速 +10%' },
  scholar: { name: '学者', good: true, desc: '遗迹解析 +50%；灯下讲故事，全队心志缓慢回复' },
  // —— 短处 ——
  darkfear: { name: '怕黑', good: false, desc: '黑暗中士气与心志流失 ×1.6' },
  glutton: { name: '贪食', good: false, desc: '饥饿速度 ×1.3' },
  slowhand: { name: '慢手', good: false, desc: '移速 −15%' },
  coward: { name: '怯战', good: false, desc: '视野内出现蚀巢核心时士气 −20' },
  frail: { name: '孱弱', good: false, desc: '生命上限 −20' },
};

export const GOODS = ['miner', 'farmer', 'nightwatch', 'tinker', 'scholar'];
export const BADS = ['darkfear', 'glutton', 'slowhand', 'coward', 'frail'];

export function traitName(id) { return (TRAITS[id] && TRAITS[id].name) || '—'; }
export function traitDesc(id) { return (TRAITS[id] && TRAITS[id].desc) || ''; }

// 抽专长（1 长 1 短，尽量不重复抽到同一个短处组合——纯随机即可）
export function rollTraits(rnd = Math.random) {
  const good = GOODS[Math.floor(rnd() * GOODS.length) % GOODS.length];
  const bad = BADS[Math.floor(rnd() * BADS.length) % BADS.length];
  return { good, bad };
}

// —— 心志 Sanity：把"士气"升级为长期状态（天级）——
export const SANITY_MAX = 100;
export const SANITY_TIERS = [
  { id: 'lucid', min: 80, name: '清醒', color: '#7dffb0', workMul: 1, note: '' },
  { id: 'insomnia', min: 60, name: '失眠', color: '#ffd166', workMul: 0.8, note: '工作效率 −20%' },
  { id: 'dread', min: 30, name: '疑惧', color: '#ff9d5c', workMul: 0.7, note: '不再响应指令切换，偶尔发呆' },
  { id: 'prehollow', min: 1, name: '蚀化前兆', color: '#ff6b6b', workMul: 0.6, note: '会偷吃食物、夜里擅自外出' },
  { id: 'hollow', min: 0, name: '蚀化', color: '#c07bff', workMul: 0, note: '她走进了黑暗里——只朝着光走' },
];

export function sanityTier(s) {
  const v = s == null ? 100 : s;
  for (const t of SANITY_TIERS) if (v >= t.min) return t;
  return SANITY_TIERS[SANITY_TIERS.length - 1];
}
export function sanityWorkMul(w) { return w.hollow ? 0 : sanityTier(w.sanity).workMul; }

// —— 羁绊 ——
export const BOND = { range: 8, lv1: 120, lv2: 300, lv3: 600, workBonus: 0.10, death: 30, hurt: 15, hurtRange: 8, hurtCd: 3 };
export const GRIEF_DAYS = 3;            // 葬友：三天不工作

// —— 蚀化与安抚 ——
export const SOOTHE = {
  fuel: 8,            // 每次安抚消耗燃料（"大量燃料"）
  gain: 15,           // 每次回复心志
  back: 30,           // 回到人间所需心志
  cd: 0.9,            // 按住 E 的节拍
  autoSec: 15,        // 站在净光柱里自动被安抚所需时间
  autoGain: 15,
  radius: 2.4,
};

// 墓碑：半径 2 起步，随天数变亮，上限 5 —— 他们化作了光
export function graveRadius(days) {
  return Math.min(5, 2 + 0.05 * Math.max(0, days));
}
export function gravePower() { return 3.4; }

// —— 引路篝火（招募新拓荒者）——
// 食物与燃料换一个人：给食物一个真正长线的去处，也给“队减员”一条回升的路
export const RECRUIT_COST = { food: 8, fuel: 4 };
export const RECRUIT_MAX = 6;
// 热食：吃饭时额外烧 1 燃料，心志/士气回得更多（留油底线见 worker.js）
export const HOT_MEAL = { keepFuel: 5, fuel: 1, sanityHot: 6, sanityCold: 2, moraleHot: 6 };
export const RECRUIT_LETTERS = ['E', 'F', 'G', 'H', 'I', 'J'];

// —— 工人炼油（熔炉）——
// 燃料见底时，工人会主动把辉髓送进熔炉；技师快一倍
export const REFINE = { wantFuel: 20, secs: 3.5, tinker: 2, range: 1.8 };

// —— 蚀兽踩踏作物：看重量 ——
export const TRAMPLE = { growth: 0.30, hp: 1.6 };

// —— 饥饿的“缓冲”（W14-A 第 8 步：B18 挂机饿死）——
// 【问题】原来 `hunger <= 0` 就直接 3 hp/s 掉血：断粮 → 玩家没注意到 → 人已经死了。
//   回放台（第 8 步）能量到：不做事的一天里工人会成批死掉，玩家连“什么时候开始的”都看不到。
// 【改法】把“饿”分成两段：**空槽**（先缓一档 + 明确提示，给玩家反应时间）→ **饥饿透支**（才开始真掉血）。
//   两段都保留代价（掉血 + 士气），只是把“立即处死”改成“逐步衰败”。
//   GRACE_SECS 是从“空槽”到“开始掉血”的缓冲时长（无食物时仍会走完）。
export const STARVE = { graceSecs: 25, hpPerSec: 1.2, moralePerSec: 2.5, hintId: 'starving' };
