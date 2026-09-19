// data/enemies.js —— 蚀兽定义（数据驱动，无依赖）
// 字段：hp 生命 / speed 速度 / dmg 伤害 / atkCd 攻击间隔 / hitR 碰撞半径
//      air 飞行(无视墙体) / breaker 破墙 / lampPref 优先啃灯 / fuelDmg 啃灯伤害
//      weight 重量：踩踏作物/颤动的力度（飞行单位 = 0，踩不到）
//      dawnFade 黎明消解：在黎明阶段的第几成处化完（0.3 = 6s 化完，0.9 = 18s 化完）
//               —— 脆的先化、硬的撑到最后，避免“天一亮满屏怪啪一下全没”
//      armor 抗性：受到的该类伤害 ×值（省略 = ×1）。类型见 data/combat.js：
//            light 光（光爆/辉光塔）· shock 震荡（震荡塔）· physical 物理（第 2 步接入）
//            —— 图鉴里那句"弱点"由这张表生成（不许两处写死）
//      ability 行为名（W14-A 第 3 步）：'spit'/'charge'/'bomb'/'aura'，数值在 data/combat.js 的 ABILITY
//      tag 群名/特征（第 4 步：主题夜与 HUD 预告用）
//      hard 硬目标：**随近战一起撤掉了**（D47 用户否决“工具能攻击”）—— 没消费者就别留字段，将来要用再加回来。
export const ENEMIES = {
  bud: {   // 蚀芽：快速、脆皮、成群
    name: '蚀芽', hp: 30, speed: 4.6, dmg: 8,
    atkCd: 0.6, hitR: 0.34, fuelDmg: 1, weight: 0.6,
    dawnFade: 0.30, tag: '成群',
    color: '#ff6b7d', glow: '255,105,125',
  },
  shell: { // 蚀壳：缓慢、高血、砸墙开路
    name: '蚀壳', hp: 95, speed: 2.7, dmg: 14,
    atkCd: 0.9, hitR: 0.42, fuelDmg: 1, weight: 2.2,
    breaker: true, dawnFade: 0.90, tag: '碎墙',
    armor: { shock: 0.75, light: 1.15 },   // 硬壳：扛震荡；壳怕光（光爆仍是 2 发，与旧版一致）
    color: '#b28dff', glow: '182,141,255',
  },
  moth: {  // 噬光虫：优先啃食光源，啃灯极快
    name: '噬光虫', hp: 45, speed: 3.6, dmg: 6,
    atkCd: 0.5, hitR: 0.30, fuelDmg: 3, weight: 0.4,
    lampPref: true, dawnFade: 0.45, tag: '啃灯',
    armor: { light: 0.85, shock: 1.25 },   // 以光为食：抗光（但仍是一发光爆带走）；薄躯怕震荡
    color: '#ffd166', glow: '255,209,102',
  },
  owl: {   // 夜枭：飞行越墙，无视地形阻挡
    name: '夜枭', hp: 60, speed: 4.0, dmg: 11,
    atkCd: 0.8, hitR: 0.36, fuelDmg: 1.5, weight: 0,   // 飞行：踩不到作物
    air: true, dawnFade: 0.60, tag: '越墙',
    color: '#8fd0ff', glow: '143,208,255',
  },
  core: {  // 蚀巢核心：BOSS（第 7 天及之后每 7 天的大潮）
    name: '蚀巢核心', hp: 1100, speed: 1.6, dmg: 22,
    atkCd: 1.0, hitR: 0.95, fuelDmg: 5, weight: 3.5,
    boss: true, breaker: true, summonCd: 9, beaconDmg: 20, tag: '孵化',
    armor: { shock: 0.8, light: 1.15 },    // 巢壳扛震荡；核心怕光（光爆 20 发 → 18 发）
    color: '#ff7ad9', glow: '255,122,217',
  },
  blind: { // 盲蚀兽：畏光——光照中灼伤并逃窜，只在黑暗里猎杀
    name: '盲蚀兽', hp: 70, speed: 3.2, dmg: 16,
    atkCd: 0.8, hitR: 0.4, fuelDmg: 2, weight: 1.2,
    lightFear: true, dawnFade: 0.70, tag: '畏光',
    armor: { light: 1.5 },                 // 畏光：光伤 +50%（光爆 2 发 → 1 发；灼烧走常规伤害、不重复乘）
    color: '#cfd8e8', glow: '207,216,232',
  },
  spitter: { // 吐蚀蛾（W14-A 第 3 步 / 噬光虫的近亲）：站在 6 格外隔墙吐蚀
    name: '吐蚀蛾', hp: 40, speed: 2.9, dmg: 6,
    atkCd: 0.9, hitR: 0.32, fuelDmg: 1, weight: 0.5,
    dawnFade: 0.40, ability: 'spit', tag: '远程',
    armor: { light: 0.9 },                 // 也是"以光为食"的近亲：轻微抗光
    color: '#c8ff8f', glow: '200,255,143',
  },
  charger: { // 冲锋芽（第 3 步 / 蚀芽的变体）：3 格内蓄力后突进
    name: '冲锋芽', hp: 46, speed: 3.4, dmg: 12,
    atkCd: 0.7, hitR: 0.38, fuelDmg: 1, weight: 1.0,
    dawnFade: 0.35, ability: 'charge', tag: '冲锋',
    color: '#ff9f6b', glow: '255,159,107',
  },
  bomber: { // 自爆壳（第 3 步 / 蚀壳的变体）：残血引信后自爆，惩罚贴脸点射
    name: '自爆壳', hp: 78, speed: 2.6, dmg: 10,
    atkCd: 1.0, hitR: 0.44, fuelDmg: 2, weight: 2.0,
    breaker: true, dawnFade: 0.85, ability: 'bomb', tag: '自爆',
    armor: { shock: 0.8, light: 1.15 },    // 壳类：扛震荡（与蚀壳同一族）
    color: '#ff8f6e', glow: '255,143,110',
  },
  warden: { // 庇护兽（第 3 步）：给自己周围的同族加速 —— “先打谁”成为决策
    name: '庇护兽', hp: 120, speed: 2.2, dmg: 9,
    atkCd: 1.1, hitR: 0.48, fuelDmg: 3, weight: 2.6,
    lampPref: true, dawnFade: 0.95, ability: 'aura', tag: '庇护',
    // 外壳当盾把光挡在外面：扛光（×0.85）。
    //   ⚠️ 不能写 >1：本作有断言 combat.counter —— “吃光伤加成”与“畏光逃窜（lightFear）”是一套的，
    //   只写 armor.light>1 而不给 lightFear，就会出现“图鉴说它怕光、但它迎着灯往前冲”的分家。
    armor: { light: 0.85 },
    color: '#a0f0e0', glow: '160,240,224',
  },
};

// 非 Boss 的全部兵种（从表里派生：新增兵种只改上面那张表，不会漏）
export const KINDS = Object.keys(ENEMIES).filter((k) => !ENEMIES[k].boss);

// 出怪构成表（每档潮位一张）
// 【为什么是表不是 if 链】旧版 `kindFor` 是一串阈值 if（tide≥4 → owl…），
//   加第 5 个兵种就得重排所有阈值；而第 4 步要做"主题夜"（蛾潮/壳潮/枭群），
//   本质就是换一张表 —— 所以先把它变成数据：每档是 [兵种, 权重]，按 r 的落点选。
// 【难度纪律】新兵种只从第 2 天起出现且占用的是**旧的份额**（总权重恒为 1），
//   所以“同屏数量/总血量”不会因为加内容而暴增；第 1 天仍然只有蚀芽（开局保持温和）。
// 注：对外只暴露 `bandOf()` / `pickFrom()`（这里导出 BANDS 是给检测器对账与 night.js 加权用）
export const BANDS = {
  1: [['bud', 1]],
  2: [['bud', 0.55], ['moth', 0.25], ['spitter', 0.20]],
  3: [['bud', 0.40], ['moth', 0.18], ['shell', 0.22], ['charger', 0.20]],
  4: [['bud', 0.32], ['moth', 0.16], ['shell', 0.18], ['charger', 0.14], ['spitter', 0.10], ['owl', 0.10]],
  5: [['bud', 0.26], ['moth', 0.14], ['shell', 0.16], ['charger', 0.14], ['spitter', 0.10], ['owl', 0.10], ['bomber', 0.10]],
  6: [['bud', 0.22], ['moth', 0.13], ['shell', 0.15], ['charger', 0.13], ['spitter', 0.11], ['owl', 0.11], ['bomber', 0.10], ['warden', 0.05]],
  7: [['bud', 0.20], ['moth', 0.12], ['shell', 0.14], ['charger', 0.13], ['spitter', 0.12], ['owl', 0.12], ['bomber', 0.11], ['warden', 0.06]],
  8: [['bud', 0.18], ['moth', 0.12], ['shell', 0.14], ['charger', 0.13], ['spitter', 0.12], ['owl', 0.12], ['bomber', 0.12], ['warden', 0.07]],
};

export const BAND_MIN = 1, BAND_MAX = 8;   // 潮位分档的上下限（W14-A 第 4 步：给 night.js 当边界，不许两处写 8）

// 取某一档的兵种表（返回浅拷，调用方可以安全地加权）
export function bandOf(tide) {
  const t = Math.max(BAND_MIN, Math.min(BAND_MAX, Math.round(tide)));
  return (BANDS[t] || BANDS[1]).map(([k, w]) => [k, w]);
}

// 从一张 [兵种, 权重] 表里按 r 抽样（**唯一**的抽样实现：kindFor 与主题夜都走它）
// 权重不必归一（按累加和取），所以主题加权后可以直接丢进来
export function pickFrom(band, rnd) {
  let total = 0;
  for (const [, w] of band) total += w > 0 ? w : 0;
  if (!(total > 0)) return band.length ? band[0][0] : 'bud';
  let r = rnd() * total, acc = 0;
  for (const [k, w] of band) { acc += w > 0 ? w : 0; if (r < acc) return k; }
  return band[band.length - 1][0];
}

// 基础构成（不含主题/时段）：夜测/旧调用点用。带主题的那套在 data/night.js 的 pickKind()
export function kindFor(tide, rnd) {
  return pickFrom(bandOf(tide), rnd);
}
