// systems/logistics.js —— W11 后勤：补给站把燃料分给附近的光源
// 设计意图：深渊里光衰减得更快，你不可能来回跑给每盏灯加油 ——
// 把燃料囤进补给站，它自己分发；而噬光虫闻得到油味（会来啃补给站）
import { BUILD } from '../data/buildings.js';

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
