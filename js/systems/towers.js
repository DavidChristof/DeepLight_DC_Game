// systems/towers.js —— 防守塔：需处于光照中才开火（光驱动）+ 载荷（修饰器）生效
import { BUILD } from '../data/buildings.js';
import { applyDamage } from './combat.js';
import { towerDmgMul, towerRateMul, owlDmgMul } from './research.js';
import { hasTinker } from './mind.js';
import { sfx } from '../core/audio.js';
import { TOWER, TYPES, CARRY } from '../data/combat.js';
import { payloadStats } from '../data/payload.js';   // 载荷：组合数值只能从这里来（W14-A 第 2 步）
import { withdraw } from './storage.js';            // 燃耗走容器账本（与光爆同一条纪律）
import { purify } from './blight.js';

const LIGHT_MIN = TOWER.LIGHT_MIN;      // 塔所在格最低光照
const TINKER_RATE = TOWER.TINKER_RATE;  // 技师在场：全场塔射速 +10%

// 玩家这一帧是不是在动（背上的塔射速拿它当档位）
// 【为什么不用 p.path/p.dest】手推 WASD 不写 path（那是鼠标寻路用的）→ 会漏判成“站着”
const playerMoving = (state) => !!(state.moveInput || (state.player && state.player.path && state.player.path.length));

// 组合数值只在载荷/等级变化时重算（每帧每塔重算 = 白烧 CPU）
// ⚠️ 缓存键必须带上 `level`：第 6 步的升级改的就是单发/射程，漏了它会出现“升完级面板/伤害还是旧的”
function statsOf(b, def) {
  const key = `${(b.mods || []).join(',')}|${b.level || 1}`;
  if (!b._ps || b._psKey !== key) { b._psKey = key; b._ps = payloadStats(def, b.mods || [], b.level || 1); }
  return b._ps;
}

// 光路炮的「接光」判定：相邻 8 格里有没有一面**被点亮的棱镜**。
// 【为什么用 relayHop 而不是自己再算一遍光照】`b.relayHop` 由 light.js 每帧重算（null = 没点亮），
//   它本身就是“这条光路到底通没通”的结论 —— 上游灯灭 / 中间一面镜子被砸 / 超出接力距离，都会让下游变回 null。
//   复用它，第 6 步的判据“断一环就失效”是**天然成立**的，不需要另写一套连通性检查。
export function beamNeighbor(state, b) {
  for (const nb of state.buildings) {
    if (nb === b || nb.type !== 'prism' || nb.site || nb.relayHop == null) continue;
    if (Math.abs(nb.x - b.x) <= 1 && Math.abs(nb.y - b.y) <= 1) return nb;
  }
  return null;
}

// 点到线段（A→B）的垂距 —— 穿透走「线」而不是无限直线，默认不打背后
function perpDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  if (L === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 这一发会打到谁：环（发射器自带 aoe）/ 散射（主目标周围）/ 穿透（射线延伸到射程尽头）/ 单体
function hitsOf(state, def, ps, cx, cy, target) {
  const out = [target];
  if (def.aoe) {                                   // 震荡塔：以主目标为中心
    for (const e of state.enemies) {
      if (!e.alive || e === target) continue;
      if (e.air && !def.air) continue;
      if (Math.hypot(e.x - target.x, e.y - target.y) <= def.aoe) out.push(e);
    }
    return out;
  }
  if (ps.形状) {
    const along = ps.形状 === 'line';               // 穿透（沿线打穿）还是散射（成圈摊开）
    // 【穿透为什么用"延伸射线"而不是"塔→主目标线段"】穿透的意思就是打穿：只算到主目标为止，
    //   主目标背后的同伴反而打不到（第一版实测 d=[14.72,0,0]）→ 必须沿方向延伸到射程尽头。
    let ax = cx, ay = cy, bx = target.x, by = target.y;
    if (along) {
      const dx = target.x - cx, dy = target.y - cy;
      const L = Math.hypot(dx, dy) || 1;
      bx = cx + (dx / L) * ps.射程; by = cy + (dy / L) * ps.射程;
    }
    const r = along ? 0.9 : 2.0;
    const cand = [];
    for (const e of state.enemies) {
      if (!e.alive || e === target) continue;
      if (e.air && !def.air) continue;
      if (Math.hypot(e.x - cx, e.y - cy) > ps.射程) continue;
      const dd = along ? perpDist(ax, ay, bx, by, e.x, e.y) : Math.hypot(e.x - target.x, e.y - target.y);
      if (dd <= r) cand.push({ e, d: Math.hypot(e.x - cx, e.y - cy) });
    }
    cand.sort((a, b2) => a.d - b2.d);
    for (const c of cand.slice(0, ps.命中上限 - 1)) out.push(c.e);
  }
  return out;
}

// 扣不出燃料就不开火（提示有全局节流，免得一排塔刷屏）
function warnFuel(state, def, cost) {
  if (state.towerWarnT > 0) return;
  state.towerWarnT = 6;
  state.storeWarnTxt = `燃料不足：${def.name} 炯火（每发要 ${cost.toFixed(1)} 燃料）`;
  state.storeWarnT = 4;
}

export function updateTowers(state, dt) {
  const m = state.map;
  const beams = state.beams;
  if (state.towerWarnT > 0) state.towerWarnT -= dt;
  for (const b of state.buildings) {
    const def = BUILD[b.type];
    if (!def || !def.dmg || b.site) continue;     // 只处理塔（工地不开火）
    b.cd = (b.cd || 0) - dt;

    const cx = b.x + 0.5, cy = b.y + 0.5;
    const i = b.y * m.w + b.x;
    const lv = state.light ? state.light[i] : 0;
    // 【两种开火条件，一格一身份】
    //   普通塔：自己脚下要有光（黑暗中熄火）—— 背在背上时不要求（你就是那束光，第 5 步）
    //   光路炮：不吃自己脚下的光，只要**旁边那面棱镜接上了光路** —— 把棱镜接力变成武器（第 6 步）
    if (def.needsBeam) {
      if (!beamNeighbor(state, b)) continue;   // 没接上光路（或光路断了）→ 焕火
    } else if (!b.mounted && lv < LIGHT_MIN) continue;
    if (b.cd > 0) continue;

    const ps = statsOf(b, def);                   // 载荷数值（0 槽 = 老的塔，一字不差）
    // 选目标（夜枭只能被对空塔打；射程来自载荷）
    let target = null, best = ps.射程;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (e.air && !def.air) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < best) { best = d; target = e; }
    }
    if (!target) continue;

    // —— 燃料债务：每发 = 修饰器数量 × FUEL_PER_MOD ——
    // 内部累计小数（0 槽塔 cost = 0，完全不走这条路 → 旧档塔行为与以前一致）
    // 背在身上时：每发 ×FUEL_MUL，且 0 槽也有底价 BAST_FUEL（否则“背上白射” ）
    let cost = ps.每发燃耗;
    if (b.mounted) cost = Math.max(cost, CARRY.BASE_FUEL) * CARRY.FUEL_MUL;
    if (cost > 0) {
      const want = Math.floor((b.fuelDebt || 0) + cost);   // 本次要真扣的数量（0 = 还没攒够 1 点）
      if (want > 0) {
        if (withdraw(state, { fuel: want })) { warnFuel(state, def, cost); continue; }   // 扣不出 → 不开火
        b.fuelDebt = (b.fuelDebt || 0) + cost - want;
      } else {
        b.fuelDebt = (b.fuelDebt || 0) + cost;
      }
    }

    b.cd = def.cd / (towerRateMul(state) * (hasTinker(state) ? TINKER_RATE : 1));
    // 背在身上时：移动中射速 ×RATE_MUL_MOVING（站桩才划算 → 阵地战仍然有意义）
    if (b.mounted && playerMoving(state)) b.cd /= CARRY.RATE_MUL_MOVING;
    const dmg = ps.单发 * towerDmgMul(state) * (target.air ? owlDmgMul(state) : 1);   // 知识「对空索」
    const dtype = def.dmgType || TYPES.GENERAL;   // 伤害类型写在塔的数据里（辉光=光 / 震荡=震荡）
    for (const e of hitsOf(state, def, ps, cx, cy, target)) {
      applyDamage(state, e, dmg, dtype);
      if (e.alive && ps.减速) e.slowT = Math.max(e.slowT || 0, ps.减速.secs);
    }
    // —— 连锁（2e）：光弧从主目标继续跳 ——
    // 规则：跳距按【敌人之间】算、每个目标一发只吃一次、每跳衰减 mul 倍。
    // 与散射/穿透叠加时：形状先打中一批，链只从**主目标**起跳（不重复计那一批）。
    if (def.chain) {
      const hit = new Set([target]);
      let from = target, cur = dmg, hops = 0;
      while (hops < def.chain.max) {
        let next = null, nd = def.chain.jump;
        for (const e of state.enemies) {
          if (!e.alive || hit.has(e)) continue;
          if (e.air && !def.air) continue;
          const d = Math.hypot(e.x - from.x, e.y - from.y);
          if (d < nd) { nd = d; next = e; }
        }
        if (!next) break;
        hops += 1;
        cur *= def.chain.mul;
        applyDamage(state, next, cur, dtype);
        if (next.alive && ps.减速) next.slowT = Math.max(next.slowT || 0, ps.减速.secs);
        beams.push({ x1: from.x, y1: from.y, x2: next.x, y2: next.y, t: 0, life: 0.18, color: '255,229,150' });
        hit.add(next);
        from = next;
      }
    }
    if (ps.净化半径 > 0) purify(state, target.x, target.y, ps.净化半径);   // 净化：边打边清地
    if (def.aoe) {
      beams.push({ x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, life: 0.4, ripple: def.aoe, color: '201,160,255' });
    } else {
      const col = def.chain ? '255,229,150' : '159,232,255';      // 连锁：暖黄光弧（和辉光塔的冷蓝分开认）
      beams.push({ x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, life: def.chain ? 0.2 : 0.14, color: col });
    }
    // 开火声：高频事件，靠 SFX_DEFS.shoot 的 dedupe(40ms) + 并发上限挡量，再按距离衰减
    sfx('shoot', { x: cx, y: cy, rate: 0.94 + Math.random() * 0.12 });
  }

  // 光束生命周期
  for (const bm of beams) bm.t += dt;
  state.beams = beams.filter((bm) => bm.t < bm.life);
}
