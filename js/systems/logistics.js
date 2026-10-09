// systems/logistics.js —— W11 后勤：补给站把燃料分给附近的光源
// 设计意图：深渊里光衰减得更快，你不可能来回跑给每盏灯加油 ——
// 把燃料囤进补给站，它自己分发；而噬光虫闻得到油味（会来啃补给站）
import { BUILD, LIGHT_LEVELS } from '../data/buildings.js';
import { burnSecOf } from '../data/fire.js';
import { lampBurnMul, smeltBurnMul } from './research.js';

// 生产与备战预报共用实际耗率；只读，不重算/推进燃烧计时。
export function buildingBurnSec(b, state) {
  const def = BUILD[b.type];
  if (!def || !def.burnSec) return null;
  const level = LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1];
  const fireMul = def.fireMat ? smeltBurnMul(state) : 1;
  return burnSecOf(b, def) * lampBurnMul(state) * fireMul / level.burn;
}

// 本地实时运行与前哨 12 秒结算共用同一燃烧公式，避免远端点灯成为免费光源。
export function burnBuildingFuel(buildings, state, dt) {
  const elapsed = Math.max(0, Number(dt) || 0);
  if (!elapsed) return;
  for (const b of buildings || []) {
    const def = BUILD[b.type];
    if (!def || !def.burnSec || b.site || !(b.fuel > 0) || b.off) continue;
    const burnSec = buildingBurnSec(b, state);
    b.burnT = (b.burnT || 0) + elapsed;
    while (b.fuel > 0 && b.burnT >= burnSec) {
      b.burnT -= burnSec;
      b.fuel--;
    }
    if (b.fuel <= 0) { b.fuel = 0; b.burnT = 0; } // 燃尽后不累积补油时的旧欠账
  }
}

export function updateLogistics(state, dt) {
  const cs = (state.buildings || []).filter((b) => b.type === 'cache' && b.fuel > 0 && !b.site);
  if (!cs.length) return;
  const def = BUILD.cache;
  for (const c of cs) {
    c.supplyT = (c.supplyT || 0) + dt;
    if (c.supplyT < def.supplySec) continue;
    // 找范围内最缺油的光源（灯柱 / 净光柱 / 另一个补给站）
    let best = null, bd = def.supplyRange;
    for (const b of state.buildings) {
      if (b === c || b.site) continue;
      const bd2 = BUILD[b.type];
      if (!bd2 || !bd2.maxFuel) continue;
      if (!(b.fuel < bd2.maxFuel)) continue;
      const d = Math.hypot(b.x + 0.5 - (c.x + 0.5), b.y + 0.5 - (c.y + 0.5));
      if (d <= bd) { bd = d; best = b; }
    }
    if (!best) { c.supplyT = def.supplySec; continue; }   // 没人需要就攒着
    c.supplyT = 0;
    c.fuel -= 1;
    best.fuel = Math.min(BUILD[best.type].maxFuel, (best.fuel || 0) + 1);
    c.supplyFx = (c.supplyFx || 0) + 1;
    if (c.supplyFx % 3 === 1) {
      state.floaties.push({ x: c.x + 0.5, y: c.y - 0.4, txt: '+补给', color: '#ffcf8a', t: 0, life: 0.8 });
    }
  }
}

// 侧栏用：补给站统计
export function cacheStats(state) {
  let n = 0, fuel = 0;
  for (const b of state.buildings || []) {
    if (b.type !== 'cache' || b.site) continue;
    n += 1; fuel += b.fuel || 0;
  }
  return { count: n, fuel };
}
