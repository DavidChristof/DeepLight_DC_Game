// data/fire.js —— 火种表：炉子烧什么，由玩家定
//
// 设计意图（用户要求「火种可配置，质量不一样」）：
//   · 藤木 / 木炭 / 燃料 都能当火种，但**质量**不同：
//       - burnSec：1 个火种能烧多久（耐烧度）
//       - heat   ：火越旺，炉子出活越快（自动批次间隔 = 配方 sec ÷ heat；手做节奏也乘这个）
//   · 这同时解掉了「开局没燃料什么都干不了」的死锁：
//     要木炭才能烧木炭 = 死循环 → 所以最低档引火物必须是随手就能捡到的藤木。
//   · 于是「用藤木凑合烧」和「专门烧炭喂炉子」变成了一个真实的取舍：
//     藤木遍地都是但慢又费、木炭最划算（要先用熔炉烧）、燃料最快但你烧的是光的血。

export const FUELS = {
  vine: { name: '藤木', burnSec: 7, heat: 0.7, desc: '引火物：遍地都是，火力弱、不经烧（1 个只烧 7 秒）' },
  coal: { name: '木炭', burnSec: 20, heat: 1.0, desc: '标准火种：耐烧、火力足（自动熔炉「烧炭」配方烧出来的）' },
  fuel: { name: '燃料', burnSec: 30, heat: 1.35, desc: '奢侈：烧的是光的血，但火力最猛（炉子出活最快）' },
};

export const FUEL_ORDER = ['vine', 'coal', 'fuel'];

export const isFuel = (k) => !!FUELS[k];
export const fuelDef = (k) => FUELS[k] || FUELS.vine;
export const fuelName = (k) => fuelDef(k).name;

// 这台炉子用哪种火种：实例字段 > 定义默认 > 藤木兜底（永远有解，不会卡死）
export const fireMatOf = (b, def) => {
  const k = (b && b.fireMat) || (def && def.fireMat) || 'vine';
  return isFuel(k) ? k : 'vine';
};
// 燃烧节奏（秒 / 个）与火力倍率
export const burnSecOf = (b, def) => fuelDef(fireMatOf(b, def)).burnSec;
export const heatOf = (b, def) => fuelDef(fireMatOf(b, def)).heat;

// 「火还在烧」：工地不烧；`off` 只对带开关的自动熔炉有意义
export const fireOn = (b) => !!(b && !b.site && !b.off && (b.fuel || 0) > 0);
