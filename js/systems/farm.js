// systems/farm.js —— 幽菌田生长：需要光照（呼应「光即生命」）；被蚀兽踩踏会减产
import { BUILD } from '../data/buildings.js';
import { hasFarmer } from './mind.js';
import { TRAMPLE } from '../data/traits.js';
import { destroyBuilding } from './building.js';
import { SURVIVAL } from '../data/survival.js';

export function updateFarm(state, dt) {
  const def = BUILD.farm;
  const bl = state.map.blight;
  const mul = hasFarmer(state) ? 1.3 : 1;        // 农人在场：全场生长 +30%
  for (const b of state.buildings) {
    if ((b.type !== 'farm' && b.type !== 'mycobed') || b.site) continue;
    const i = b.y * state.map.w + b.x;
    // —— 踩踏：按重量算（夜枭飞行 → weight 0，踩不到）——
    let trample = 0;
    for (const e of state.enemies || []) {
      if (!e.alive || e.air) continue;
      if (Math.floor(e.x) !== b.x || Math.floor(e.y) !== b.y) continue;
      trample += (e.def && e.def.weight != null) ? e.def.weight : 1;
    }
    if (trample > 0) {
      b.growth = Math.max(0, (b.growth || 0) - TRAMPLE.growth * trample * dt);
      b.hp = (b.hp || 0) - TRAMPLE.hp * trample * dt;
      if (Math.random() < dt * 0.9) {
        state.floaties.push({ x: b.x + 0.5, y: b.y - 0.2, txt: '被踩踏', color: '#c9a0ff', t: 0, life: 0.7 });
      }
      if (b.hp <= 0) {
        state.floaties.push({ x: b.x + 0.5, y: b.y, txt: '农田被踏毁', color: '#ff9d9d', t: 0, life: 1.4 });
        destroyBuilding(state, b);
        continue;
      }
    }
    if (bl && bl[i] > 0) continue;                 // 蚀痕：农田停产，必须先净化
    const lv = state.light ? state.light[i] : 0;
    if (b.type === 'mycobed') {
      if (lv >= SURVIVAL.REGEN.LIGHT_MIN && lv <= SURVIVAL.REGEN.LIGHT_MAX) b.growth = Math.min(1, (b.growth || 0) + dt / SURVIVAL.REGEN.GROW_SEC);
    } else if (lv >= def.lightMin) {
      b.growth = Math.min(1, (b.growth || 0) + (dt * mul) / def.growSec);
    }
  }
}
