// systems/blight.js —— 蚀痕：长期无光的土地会被黑暗「腐蚀」
// 设计意图：黑暗不再只是"看不见"，而是会侵蚀领土 —— 玩家必须决定把光给谁
import { T } from '../world/map.js';
import { BUILD } from '../data/buildings.js';
import { ambientOf } from '../core/time.js';
import { ECOLOGY } from '../data/ecology.js';

export const BLIGHT_MAX = 3;
// —— W14-A 第 8 步：蚀痕定档（B33）——
// 【问题】回放台（固定种子 × 7 天）量到：**3 级蚀痕 6000 / 6912 格（8 7%）** ——
//   玩家守住的那一盏灯周围全烂了，而“烂地”本身又降低建造/农田/夜间可见性，形成不可逆的死螺旋。
// 【为什么改这两个数】DOMAIN 管“哪些地会被腐蚀”（领地半径）、BASE_SECS 管“多久长一级”。
//   两个一起收一档：领地只盖“你真在用的那圈”，且一级需要 45 秒连续无光 ——
//   这样“一晚不管就长一级”仍然是压力，但不再是一夜之后全图沦陷。
const BASE_SECS = 45;          // 连续无光 45 秒 → +1 级（受难度缩放）
const LIGHT_SAFE = 0.5;        // 光照 ≥ 此值即视为"被照亮"
const LIT_DECAY_SECS = 120;    // 被照亮时每 120 秒 −1 级（刻意慢于侵蚀，所以淡层仍需要玩家处理）
const LEAK_SECS = 20;          // 3 级蚀痕夜里每 20 秒渗出 1 只小蚀兽
const DOMAIN = 12;             // 势力范围：信标/建筑外 12 格内才会被腐蚀（第 8 步：22 → 12）
                               // 注：不要把玩家算进去，否则蚀痕圈会跟着镜头移动（看起来"只在屏幕内"）
// 导出成一个表：断言（blight.budget）要读它 —— 这几个数直接决定"一夜之后地图还剩多少"
export const BLIGHT = { DOMAIN, BASE_SECS, LIGHT_SAFE, LIT_DECAY_SECS, LEAK_SECS };
const srcs = [];               // 复用（每轮重填）：x,y 交替存储，避免每帧新建数组

// 只有地表层会积累蚀痕（深层本来就是永夜，避免退化体验）
export function blightActive(state) {
  return state.layerId === 'surface';
}

export function ensureBlight(map) {
  if (!map.blight) map.blight = new Uint8Array(map.w * map.h);
  if (!map.blightFronts) map.blightFronts = [];
  return map.blight;
}

export function blightAt(state, x, y) {
  const m = state.map;
  if (!m.blight) return 0;
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) return 0;
  return m.blight[iy * m.w + ix] | 0;
}

// 净化：光爆 / 净光柱 —— 范围内蚀痕 −1
export function purify(state, x, y, r) {
  const m = state.map;
  const bl = ensureBlight(m);
  const R = Math.ceil(r);
  let n = 0;
  for (let ty = Math.max(0, Math.floor(y) - R); ty <= Math.min(m.h - 1, Math.floor(y) + R); ty++) {
    for (let tx = Math.max(0, Math.floor(x) - R); tx <= Math.min(m.w - 1, Math.floor(x) + R); tx++) {
      if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > r) continue;
      const i = ty * m.w + tx;
      if (bl[i] > 0) {
        bl[i] -= 1; n++;
        for (let f = m.blightFronts.length - 1; f >= 0; f--) {
          const front = m.blightFronts[f];
          const at = front.cells ? front.cells.indexOf(i) : -1;
          if (at >= 0) { front.cells.splice(at, 1); front.pressure = Math.max(0, (front.pressure || 0) - 1); if (!front.cells.length) m.blightFronts.splice(f, 1); break; }
        }
      }
    }
  }
  return n;
}

// 蚀潮登陆点：创建/强化一处局部侵蚀前线。前线是稀疏状态，不能替代标准波次额外刷怪。
// 返回细节给远端前哨结算使用；旧的 state 入口仍只返回 boolean，避免影响波次调用方。
function seedFrontOnMap(m, x, y, source = 'tide') {
  if (!m) return { ok: false, created: false, reinforced: false };
  const bl = ensureBlight(m), tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1 || m.get(tx, ty) === T.ROCK) return { ok: false, created: false, reinforced: false };
  const i = ty * m.w + tx;
  let near = null;
  for (const f of m.blightFronts) if (Math.abs(f.x - tx) <= 6 && Math.abs(f.y - ty) <= 6) { near = f; break; }
  if (near) { near.level = Math.min(BLIGHT_MAX, (near.level || 1) + 1); near.pressure = Math.min(12, (near.pressure || 0) + 1); near.source = source; return { ok: true, created: false, reinforced: true }; }
  if (m.blightFronts.length >= ECOLOGY.MAX_FRONTS_PER_CHUNK) return { ok: false, created: false, reinforced: false };
  const front = { x: tx, y: ty, core: i, cells: [i], level: 1, growT: 0, pressure: 1, source };
  m.blightFronts.push(front); bl[i] = Math.max(bl[i], 1);
  return { ok: true, created: true, reinforced: false };
}

export function seedBlightFrontInChunk(chunk, x, y, source = 'tide') {
  if (!chunk || !chunk.map) return { ok: false, created: false, reinforced: false };
  const m = chunk.map;
  if (!m.blightFronts && !m.blight) ensureBlight(m);
  const result = seedFrontOnMap(m, x, y, source);
  if (result.ok) chunk.modified = true;
  return result;
}

export function seedBlightFront(state, x, y, source = 'tide') {
  if (!state || !blightActive(state)) return false;
  const result = seedFrontOnMap(state.map, x, y, source);
  if (result.ok) state._blightAny = true;
  return !!result.ok;
}

function growFront(state, front, dt) {
  const m = state.map, bl = m.blight, light = state.light;
  const ci = front.core, cl = light ? light[ci] || 0 : 0;
  if (cl >= LIGHT_SAFE) { front.growT = 0; return; }
  front.growT = (front.growT || 0) + dt;
  if (front.growT < ECOLOGY.FRONT_GROW_SEC || front.level >= BLIGHT_MAX || front.cells.length >= ECOLOGY.MAX_FRONT_CELLS) return;
  front.growT = 0;
  const added = [];
  for (const base of front.cells.slice()) {
    const bx = base % m.w, by = (base / m.w) | 0;
    for (let dy = -1; dy <= 1 && added.length < 3; dy++) for (let dx = -1; dx <= 1 && added.length < 3; dx++) {
      const nx = bx + dx, ny = by + dy;
      if (!dx && !dy || nx < 1 || ny < 1 || nx >= m.w - 1 || ny >= m.h - 1) continue;
      const ni = ny * m.w + nx;
      if (m.get(nx, ny) === T.ROCK || bl[ni] > 0 || (light && light[ni] >= LIGHT_SAFE)) continue;
      bl[ni] = Math.max(bl[ni], front.level); front.cells.push(ni); added.push(ni);
    }
    if (added.length >= 3) break;
  }
  if (added.length) front.pressure = Math.min(12, (front.pressure || 0) + added.length);
  if (front.cells.length >= ECOLOGY.FRONT_NEST_CELLS && front.level < BLIGHT_MAX) {
    front.level += 1;
    for (const i of front.cells) bl[i] = Math.max(bl[i], front.level);
  }
}

export function updateBlight(state, dt) {
  const m = state.map;
  ensureBlight(m);
  const fronts = m.blightFronts;
  if (!blightActive(state)) return 0;
  for (const front of fronts) growFront(state, front, dt);
  return 0;
}

// 净光柱：耗油定期净化周围蚀痕（也会作为普通光源参与照明）
export function updatePurifiers(state, dt) {
  for (const b of state.buildings) {
    if (b.type !== 'purifier') continue;
    b.purifyT = (b.purifyT || 0) + dt;
    const def = BUILD.purifier;
    if (b.purifyT < def.purifySec) continue;
    b.purifyT = 0;
    if (!blightActive(state)) continue;
    if ((b.fuel || 0) <= 0) continue;
    const n = purify(state, b.x + 0.5, b.y + 0.5, def.purifyR);
    if (n > 0 && state.player) {
      state.floaties.push({ x: b.x, y: b.y - 0.4, txt: `净光 ${n}`, color: '#d8c6ff', t: 0, life: 0.9 });
    }
  }
}

export function blightStats(state) {
  const m = state.map;
  if (!m.blight) return { tiles: 0, level3: 0 };
  let tiles = 0, level3 = 0;
  for (let i = 0; i < m.blight.length; i++) {
    if (m.blight[i] > 0) tiles++;
    if (m.blight[i] >= BLIGHT_MAX) level3++;
  }
  return { tiles, level3 };
}

// 调试：蚀痕系统的内部状态
export function blightDebug(state) {
  const m = state.map;
  if (!m.blight) return null;
  const amb = ambientOf(state);
  const srcs = [];
  for (const b of state.beacons) srcs.push([b.x, b.y]);
  for (const b of state.buildings) { if (!b.site) srcs.push([b.x, b.y]); }
  let dark = 0, darkInDomain = 0, maxAcc = 0, acc30 = 0;
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i] === T.ROCK) continue;
    const lv = Math.max(state.light ? state.light[i] : 0, amb);
    if (lv >= LIGHT_SAFE) continue;
    dark++;
    const acc = m.blightAcc ? m.blightAcc[i] : 0;
    if (acc > maxAcc) maxAcc = acc;
    if (acc >= 25) acc30++;
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [sx, sy] of srcs) {
      if (Math.abs(sx - x) <= DOMAIN && Math.abs(sy - y) <= DOMAIN) { darkInDomain++; break; }
    }
  }
  return { t: +state.t.toFixed(1), amb: +amb.toFixed(2), dark, darkInDomain, maxAcc: +maxAcc.toFixed(1), acc30, ...blightStats(state) };
}
