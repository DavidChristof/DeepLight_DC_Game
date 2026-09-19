// systems/nightops.js —— 夜行玩法：夜辉草（夜髓）/ 潮穴（喷发+掉落）/ 巡逻驱散 / 守卫维修
import { T } from '../world/map.js';
import { Enemy } from '../entities/enemy.js';
import { isTide, isDawn } from '../core/time.js';
import { NIGHTBLOOM, VENTS, PATROL } from '../data/nightops.js';
import { BUILD } from '../data/buildings.js';
import { deposit } from './storage.js';
import { roleIs } from '../data/colonists.js';

// 确定性伪随机（同种子同地图）
function rnd(seed) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

// 生成夜行节点（夜辉草点位 + 潮穴）：随层生成一次
export function ensureNightOps(layer, seed) {
  if (layer.nightops) return layer.nightops;
  const m = layer.map;
  const cx = m.w / 2, cy = m.h / 2;
  const blooms = [];
  const vents = [];

  const pickSpot = (minD, maxD, k) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rnd(seed + k * 7.7 + tries) * Math.PI * 2;
      const d = minD + rnd(seed + k * 3.1 + tries * 2) * (maxD - minD);
      const x = Math.floor(cx + Math.cos(a) * d);
      const y = Math.floor(cy + Math.sin(a) * d);
      if (x < 2 || y < 2 || x >= m.w - 2 || y >= m.h - 2) continue;
      const i = y * m.w + x;
      if (!m.isWalk(x, y) || (m.occBuild && m.occBuild[i])) continue;
      if (m.tiles[i] !== T.FLOOR) continue;
      // 不与已有节点太近
      const tooClose = [...blooms, ...vents].some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 6);
      if (tooClose) continue;
      return { x, y };
    }
    return null;
  };

  const nB = NIGHTBLOOM.base + NIGHTBLOOM.maxExtra;
  for (let k = 0; k < nB; k++) {
    const p = pickSpot(NIGHTBLOOM.minDist, NIGHTBLOOM.maxDist, k + 1);
    if (p) blooms.push({ x: p.x, y: p.y, charges: 0, alive: false, born: -1 });
  }
  for (let k = 0; k < VENTS.count; k++) {
    const p = pickSpot(VENTS.minDist, VENTS.maxDist, 40 + k);
    if (p) vents.push({ x: p.x, y: p.y, t: VENTS.firstDelay + k * 11, burst: 0 });
  }
  layer.nightops = { blooms, vents, day: 0 };
  return layer.nightops;
}

// 夜幕降临：在黑暗处点起夜辉草，数量随天数增长
function bloomAtDusk(state) {
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  if (!ops) return;
  const m = state.map;
  const n = Math.min(ops.blooms.length, NIGHTBLOOM.base + Math.floor(state.day / 3));
  let shown = 0;
  for (let k = 0; k < ops.blooms.length; k++) {
    const b = ops.blooms[k];
    const want = k < n;
    if (!want) { b.alive = false; continue; }
    const i = b.y * m.w + b.x;
    const lv = state.light ? state.light[i] : 0;
    const dark = lv < NIGHTBLOOM.darkMax;
    if (!dark || m.tiles[i] === T.ROCK) { b.alive = false; continue; }   // 被照亮/被挖掉就不长
    if (!b.alive) {                                     // 重新长出
      b.alive = true;
      b.charges = NIGHTBLOOM.charges;
    }
    shown++;
  }
  ops.shown = shown;
}

export function nightbloomAt(state, tx, ty) {
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  if (!ops) return null;
  return ops.blooms.find((b) => b.alive && b.charges > 0 && b.x === tx && b.y === ty) || null;
}

// 采集一株夜辉草
export function harvestNightbloom(state, b) {
  b.charges -= 1;
  const gain = NIGHTBLOOM.yield;
  const stored = deposit(state, 'night', gain, b.x + 0.5, b.y + 0.5);   // 走容器账本（满则丢失）
  if (stored > 0) state.floaties.push({ x: b.x, y: b.y - 0.4, txt: '+夜髓', color: '#b9a6ff', t: 0, life: 1.0 });
  if (b.charges <= 0) b.alive = false;
  return stored;
}

// 巡逻是否生效：指令为巡逻，且真的有人留在该方向的点位上（退缩/倒下就失去驱散效果）
export function patrolActive(state) {
  if ((state.order || 'auto') !== 'patrol') return false;
  const p = state.patrol;
  if (!p || p.day !== state.day) return false;
  const cx = state.map.w / 2, cy = state.map.h / 2;
  const px = cx + p.dx * PATROL.range, py = cy + p.dy * PATROL.range;
  for (const w of state.workers || []) {
    if (!w.alive || w.hollow) continue;
    if (Math.hypot(w.x - px, w.y - py) <= 6) return true;
  }
  return false;
}

// 巡逻扇区判定：某点是否落在被巡逻的方向上
export function inPatrolSector(state, x, y) {
  const p = state.patrol;
  if (!p || p.day !== state.day) return false;
  if (!patrolActive(state)) return false;
  const cx = state.map.w / 2, cy = state.map.h / 2;
  const dx = x - cx, dy = y - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return false;
  const cos = (dx * p.dx + dy * p.dy) / len;
  return cos >= PATROL.sectorMin;
}

// 潮穴喷发：刷怪 + 掉落母髓（夜里只有这里能白捡母髓，代价是被围）
function eruptVent(state, v) {
  const m = state.map;
  v.burst = 1.4;
  const n = VENTS.spawnMin + Math.floor(Math.random() * (VENTS.spawnMax - VENTS.spawnMin + 1));
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    const x = Math.floor(v.x + Math.cos(a) * r), y = Math.floor(v.y + Math.sin(a) * r);
    if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
    const i = y * m.w + x;
      if (!m.isWalk(x, y) || (m.occBuild && m.occBuild[i])) continue;
    state.layers.surface.enemies.push(new Enemy('bud', x + 0.5, y + 0.5));
  }
  state.pickups = state.pickups || [];
  state.pickups.push({ x: v.x + 0.5, y: v.y + 0.5, kind: VENTS.lootKind, t: 0, life: VENTS.lootLife });
  state.floaties.push({ x: v.x, y: v.y - 0.6, txt: '潮穴喷发！', color: '#ffb0e0', t: 0, life: 1.4 });
}

// 掉落物拾取（走过去自动捡）
function updatePickups(state, dt) {
  const list = state.pickups;
  if (!list || !list.length) return;
  const p = state.player;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    it.t += dt;
    if (it.t >= 0 && Math.hypot(it.x - p.x, it.y - p.y) < 1.0) {
      const got = deposit(state, it.kind, 1, it.x, it.y);          // 走容器账本（满则丢失 + 警告）
      if (got > 0) {
        state.floaties.push({ x: it.x, y: it.y - 0.4, txt: it.kind === 'core' ? '+母髓' : '+拾取', color: it.kind === 'core' ? '#ffd76e' : '#dfe9ff', t: 0, life: 1.0 });
      }
      list.splice(i, 1);
      continue;
    }
    if (it.t >= it.life) list.splice(i, 1);
  }
}

// 守卫：维修身边的建筑与信标（留守营地的收益；技师又快一倍）
function updateGuards(state, dt) {
  const workers = state.workers || [];
  for (const w of workers) {
    if ((state.order || 'auto') !== 'guard' || !w.alive || w.hollow) continue;
    const rate = 2.5 * (roleIs(w, 'tinker') ? 2 : 1);
    // 信标
    for (const b of state.beacons) {
      if (b.hp == null || b.hp >= (b.maxHp || 300)) continue;
      if (Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y) > 4) continue;
      b.hp = Math.min(b.maxHp || 300, b.hp + rate * dt);
      w.repairFx = (w.repairFx || 0) + dt;
      if (w.repairFx > 1.2) {
        w.repairFx = 0;
        state.floaties.push({ x: b.x, y: b.y - 0.5, txt: '维修 +', color: '#9ef7d8', t: 0, life: 0.8 });
      }
    }
    // 建筑
    for (const b of state.buildings) {
      const maxHp = BUILD[b.type] ? (BUILD[b.type].hp || 0) : 0;
      if (!maxHp || b.hp == null || b.hp <= 0 || b.hp >= maxHp) continue;
      if (Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y) > 4) continue;
      b.hp = Math.min(maxHp, b.hp + rate * dt);
    }
  }
}

export function updateNightOps(state, dt) {
  const surf = state.layers && state.layers.surface;
  if (!surf || !surf.nightops) return;
  if (state.layerId !== 'surface') return;         // 只在地表生效

  const tide = isTide(state);
  const dawn = isDawn(state);
  const ops = surf.nightops;

  // 黄昏→夜幕：夜辉草长出来；黎明：*先留着*（趁蚀兽消解抢收）；到白天才一起凋谢
  // 注意：不能用 state.wasTide 做边沿（updateWaves 跑在前面已经把它置为 true）
  if (tide && !ops.tideOn) bloomAtDusk(state);
  ops.tideOn = tide;
  if (!tide && !dawn) for (const b of ops.blooms) b.alive = false;

  // 潮穴：蚀潮期间周期性喷发
  if (tide) {
    for (const v of ops.vents) {
      v.burst = Math.max(0, v.burst - dt * 0.7);
      v.t -= dt;
      if (v.t <= 0) { v.t = VENTS.interval; eruptVent(state, v); }
    }
  } else {
    for (const v of ops.vents) v.burst = Math.max(0, v.burst - dt);
  }

  updatePickups(state, dt);
  updateGuards(state, dt);
}
