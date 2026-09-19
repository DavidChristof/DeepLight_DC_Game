// data/nightops.js —— 夜行（Night Ops）：夜辉草 / 潮穴 / 拓荒者夜间指令
// 设计意图：夜晚不只是"挨打"，而是"要不要出门"的取舍场

export const NIGHTBLOOM = {
  base: 3,            // 基础株数
  maxExtra: 3,        // 随天数最多追加（day/3）
  minDist: 8,         // 与营地的距离范围（不能离得太近，否则没有风险）
  maxDist: 26,
  darkMax: 0.4,       // 必须在黑暗中生长（光照 < 此值）
  yield: 1,           // 每采一次得 夜髓
  charges: 2,         // 一株可采次数
  harvestSec: 0.9,    // 单次采收耗时
  moraleDrain: 0.35,  // 夜采者额外士气流失 /s（黑暗中的恐惧）
};

export const VENTS = {
  count: 2,           // 地表潮穴数量
  minDist: 13,
  maxDist: 22,
  interval: 42,       // 每 42 秒喷发一次（蚀潮期间）
  firstDelay: 12,
  spawnMin: 3,
  spawnMax: 5,
  lootLife: 26,       // 掉落物存在时间
  lootKind: 'core',   // 母髓
};

export const PATROL = {
  range: 12,          // 巡逻点距营地距离
  moraleMul: 1.5,     // 巡逻中士气消耗倍率
  spawnCut: 0.34,     // 该方向出怪减少比例
  sectorMin: 0.35,    // 方向判定：cos 阈值（约 ±70°）
};

export const ORDERS = [
  { id: 'auto', name: '自动', desc: '白天采集、夜里回营避难（默认）' },
  { id: 'rest', name: '休整', desc: '夜里优先使用铺位，恢复生命与心志' },
  { id: 'forage', name: '夜采', desc: '夜里主动去采夜辉草（产夜髓，但要在黑暗中冒险）' },
  { id: 'guard', name: '守卫', desc: '全天留守营地并维修建筑/信标（放弃采集产出）' },
  { id: 'patrol', name: '巡逻', desc: '夜里推进到指定方向（该方向出怪 −34%，士气消耗 ×1.5；需要有人留在那里）' },
];
export const ORDER_NAME = Object.fromEntries(ORDERS.map((o) => [o.id, o.name]));
