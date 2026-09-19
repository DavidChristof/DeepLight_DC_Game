// systems/hazard.js —— 环境伤害：岩浆灼伤（熔渊之心的法则）
// 岩浆是那层唯一的光，也是唯一不烧燃料的东西 —— 它烧的是生命与空间
import { T } from '../world/map.js';
import { applyDamage } from './combat.js';
import { lavaDmgMul } from './research.js';
import { hurtPlayer } from './survival.js';

export const LAVA = {
  player: 15,      // 玩家 HP/秒
  enemy: 13,       // 蚀兽 HP/秒
  worker: 11,      // 拓荒者 HP/秒
  morale: 3,       // 拓荒者士气/秒
};

function onLava(state, x, y) {
  const m = state.map;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
  return m.tiles[ty * m.w + tx] === T.LAVA;
}

export function updateHazard(state, dt) {
  const m = state.map;
  if (!m || !m.tiles) return;
  // 玩家
  const p = state.player;
  if (onLava(state, p.x, p.y)) {
    hurtPlayer(state, LAVA.player * lavaDmgMul(state) * dt);   // 知识「耐热皮膜」
    state.burning = 0.4;
    if (!state._wasOnLava) {                       // 身体换知识：每“踩进去”一次算一次教训
      if (!state.body) state.body = { lava: 0 };
      state.body.lava = (state.body.lava || 0) + 1;
      state._wasOnLava = true;
    }
    if (Math.random() < dt * 3) {
      state.floaties.push({ x: p.x, y: p.y - 0.8, txt: '灼伤！', color: '#ff9d5c', t: 0, life: 0.8 });
    }
  } else {
    state._wasOnLava = false;
    if (state.burning > 0) state.burning = Math.max(0, state.burning - dt);
  }

  // 蚀兽（熔渊里的守卫也会被自己家的岩浆烧到）
  for (const e of state.enemies || []) {
    if (!e.alive) continue;
    if (onLava(state, e.x, e.y)) applyDamage(state, e, LAVA.enemy * dt);
  }
  // 拓荒者
  for (const w of state.workers || []) {
    if (!w.alive || w.hollow) continue;
    if (w.layerId !== state.layerId) continue;
    if (onLava(state, w.x, w.y)) {
      w.hp -= LAVA.worker * dt;
      w.morale = Math.max(0, w.morale - LAVA.morale * dt);
      w.flash = 0.1;
    }
  }
}
