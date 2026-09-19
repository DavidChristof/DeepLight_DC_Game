// systems/interact.js —— E 键交互：采集节点 / 岩壁 / 夜辉草 / 熔炉精炼 / 加油 / 施工 / 竖井 / 容器 / 制造台
import { T } from '../world/map.js';
import { BUILD, PLAYER_WORK, PLAYER_WORK_SECS, towerHp } from '../data/buildings.js';
import { SURVIVAL } from '../data/survival.js';
import { ROCK_SECS, RECIPE_OF } from '../data/tools.js';
import { nodeFallback } from '../data/nodes.js';
import { advanceBuild, buildingAt, toggleGate } from './building.js';
import { deposit, withdrawOne } from './storage.js';
import { allContainers } from './storage.js';
import { useShaft } from './layer.js';
import { nightbloomAt, harvestNightbloom } from './nightops.js';
import { hasTech, miningMul } from './research.js';
import { hasScholar, soothe } from './mind.js';
import { canMineRock, mineTimeMul, harvestBonus, buildMul, vineBonus, heldTool } from './tools.js';
import { workOnce, lightFire, fireOn } from './craft.js';
import { dropRelic } from './relics.js';
import { heatOf, fireMatOf, fuelName } from '../data/fire.js';
import { SOOTHE } from '../data/traits.js';
import { advanceFirstSlice } from './firstSlice.js';
import { sfx, everyN } from '../core/audio.js';
import { startPlayerRescue, reviveAtGrave } from '../entities/worker.js';

export const SPEED = { mine: 0.16, refine: 0.35, refuel: 0.2, shaft: 0.3, harvest: 0.25, bloom: 0.35, soothe: SOOTHE.cd, revive: 1, build: PLAYER_WORK_SECS, container: 0.35, station: 0.35, payload: 0.35 };
// 兜底：万一以后新加了 kind 忘了登记 SPEED，也别把 E 键一起搞死
export const speedOf = (kind) => (Number.isFinite(SPEED[kind]) ? SPEED[kind] : 0.3);
const NODE_RES = { [T.ORE]: 'ore', [T.VINE]: 'vine', [T.RELIC]: 'data', [T.MOTHER]: 'core', [T.ROCK]: 'stone' };

// 一次 E 结算后要等多久（挖矿受研究/工具影响；石头比矿石慢）
export function actionCooldown(state, a) {
  if (!a) return 0.3;
  if (a.kind === 'mine') {
    const base = a.res === 'stone' ? ROCK_SECS : SPEED.mine;
    return Math.max(0.06, base * miningMul(state) * mineTimeMul(state, a.res));
  }
  if (a.kind === 'station' && a.b) {                  // 配方站：手做的节奏看配方与火力（自动站只是开面板，快）
    const def = BUILD[a.b.type];
    if (def && def.work) {
      const r = RECIPE_OF[a.b.recipe || 'fuel'];
      if (r && r.hand) return r.hand / (heatOf(a.b, def) || 1);   // 火烧得越旺，手做越快
    }
  }
  return speedOf(a.kind);
}

// 找出玩家身边最近的可用交互（优先级：节点 > 熔炉 > 灯柱）
// 【prefer = 鼠标指着的那一格】多个可交互对象挤在一起时（炉子贴着矿脉、塔贴着农田、
//   两口井挨着…）自动选“最近”等于玩家选不了 —— 所以：光标指得到就用光标那个，指不到才退回最近优先。
//   半径与 E 的贴身范围一致（E_REACH），不会因此“隔空交互”。
export const E_REACH = 1.6;                       // E 的贴身范围（与下面 near() 同一个数）
export function resolveInteract(state, prefer) {
  const m = state.map;
  const p = state.player;
  const ptx = Math.floor(p.x), pty = Math.floor(p.y);
  if (prefer && Number.isFinite(prefer.tx) && Number.isFinite(prefer.ty)) {
    const a = resolveInteractAt(state, prefer.tx, prefer.ty, E_REACH);
    if (a) return a;
  }
  // 连续距离判定（以格心为准，避免站在格边时取整错位）
  const near = (cx, cy) =>
    Math.max(Math.abs(cx + 0.5 - p.x), Math.abs(cy + 0.5 - p.y)) <= E_REACH;
  const dp = state.deathPack;
  if (dp && dp.layerId === state.layerId && Math.hypot(dp.x - p.x, dp.y - p.y) <= 1.4) return { kind: 'deathPack', pack: dp };

  // 墓碑交互排在采集之前：未研究时也要明确告诉玩家“这里能做什么”，
  // 不能让按 E 在墓碑旁误变成挖矿。复苏的资源/次数校验在 tick 内统一处理。
  for (const g of state.graves || []) {
    if ((g.layerId || 'surface') !== state.layerId) continue;
    if (Math.hypot(g.x + 0.5 - p.x, g.y + 0.5 - p.y) <= SURVIVAL.REVIVE.RANGE) return { kind: 'revive', g };
  }

  // 倒地的拓荒者：救援优先于普通采集，但不抢走蚀化安抚与工地意图。
  for (const w of state.workers || []) {
    if (!w.downed || !w.alive || w.layerId !== state.layerId) continue;
    if (Math.hypot(w.x - p.x, w.y - p.y) <= SURVIVAL.RESCUE.PLAYER_RANGE) return { kind: 'rescue', w };
  }

  // 工地最优先：你刚放下的蓝图就是当前明确的意图（按住 E = 盖它）
  let site = null, sbest = 1e9;
  for (const b of state.buildings) {
    if (!b.site || !near(b.x, b.y)) continue;
    const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
    if (d < sbest) { sbest = d; site = b; }
  }
  if (site) return { kind: 'build', b: site };

  // 蚀化者：安抚是唯一把人拉回来的路（优先级最高——它比其他交互都重要）
  for (const w of state.workers || []) {
    if (!w.hollow || w.layerId !== state.layerId) continue;
    if (Math.hypot(w.x - p.x, w.y - p.y) <= SOOTHE.radius) return { kind: 'soothe', w };
  }

  // 配方站（熔炉 / 制造台 / 解析台 / 自动熔炉）：站到机器旁边本身就是明确意图。
  // ⚠️ 必须排在采集节点之前：炉子多半就建在矿脉/藤木旁边，否则按 E 会变成砍树、
  //    玩家以为“点不着火”（实测复现：旁边硬塞一格藤木，E 就从 furnace 变成 mine）。
  //    想砍旁边那一格 → **鼠标指着它**（光标优先）或右键点它；走开一格再按 E 也行。
  {
    let st = null, sbd = 1e9;
    for (const b of state.buildings) {
      const def = BUILD[b.type];
      if (b.site || !def || !def.station) continue;
      if (!near(b.x, b.y)) continue;
      const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
      if (d < sbd) { sbd = d; st = b; }        // 多台机器挨着时取最近的那台（不然会开错面板）
    }
    if (st) return { kind: 'station', b: st };
  }

  // 光塔（发射器）：站到塔旁边 = 要装/拆载荷 —— 与配方站同一条理由：
  // 塔多半就摆在矿脉边上，若排在采集之后，按 E 会变成砍树，玩家会以为"面板打不开"。
  // 想采旁边那一格 → **鼠标指着它**（光标优先）或右键点它；走开一格再按 E 也行。
  {
    let tw = null, twd = 1e9;
    for (const b of state.buildings) {
      const def = BUILD[b.type];
      if (b.site || !def || !def.dmg) continue;
      if (!near(b.x, b.y)) continue;
      const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
      if (d < twd) { twd = d; tw = b; }        // 两座塔挨着时取最近的（不然会开错塔的载荷）
    }
    if (tw) return { kind: 'payload', b: tw };
  }

  let node = null, best = 1e9;
  let rock = null, rbest = 1e9;
  const rockOpen = hasTech(state, 'stonework');            // 石工之前，岩壁只是地形
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = ptx + dx, ty = pty + dy;
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
      const i = ty * m.w + tx;
      const t = m.tiles[i];
      if (!near(tx, ty) || m.occWalk[i]) continue;
      const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
      if (t === T.ORE || t === T.VINE || t === T.RELIC || t === T.MOTHER) {
        if (d < best) { best = d; node = { kind: 'mine', i, res: NODE_RES[t], x: tx, y: ty }; }
      } else if (t === T.ROCK && rockOpen && d < rbest) {
        rbest = d; rock = { kind: 'mine', i, res: 'stone', rock: true, x: tx, y: ty };
      }
    }
  }
  // 石头没敲得动时（徒手很慢）先让给普通矿脉，免得挡手；真只有岩壁就带一句“有镐更快”
  if (node) return node;
  if (rock && (canMineRock(state) || !node)) return rock;

  // 夜辉草（只在蚀潮/黑暗中出现）：按 E 采撷夜髓
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const b = nightbloomAt(state, ptx + dx, pty + dy);
      if (b && near(b.x, b.y)) return { kind: 'bloom', b };
    }
  }

  // 加燃料（灯柱/净光柱/补给站/诱饵灯）
  // 注：多盏都要加油时取**最近的那盏**（与站台/采集节点保持一致）——
  //     原来是“数组里第一座”，两盏灯并排时会把油加给较远的那盏。
  {
    let need = null, nd = 1e9;
    for (const b of state.buildings) {
      const def = BUILD[b.type];
      if (!def || !def.maxFuel || b.site) continue;
      if (b.type !== 'lamp' && b.type !== 'purifier' && b.type !== 'cache' && b.type !== 'decoy') continue;
      if (!((b.fuel || 0) < def.maxFuel) || !(state.res.fuel > 0) || !near(b.x, b.y)) continue;
      const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
      if (d < nd) { nd = d; need = b; }
    }
    if (need) return { kind: 'refuel', b: need };
  }
  for (const b of state.buildings) {
    if (b.site) continue;
    if ((b.type === 'farm' || b.type === 'mycobed') && (b.growth || 0) >= 1 && near(b.x, b.y)) return { kind: 'harvest', b };
  }
  for (const b of state.buildings) {
    if (b.site) continue;
    if (b.type === 'shaft' && near(b.x, b.y)) return { kind: 'shaft', b };
  }
  // 容器（储物箱 / 营地篝火仓）：优先级最低，不抢采集/加油等交互
  let bestC = null, bdC = 1e9;
  for (const c of allContainers(state, true)) {
    if (!near(c.x, c.y)) continue;
    const d = Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y);
    if (d < bdC) { bdC = d; bestC = c; }
  }
  if (bestC) return { kind: 'container', c: bestC };
  return null;
}

// —— 指定格子上的交互（右键用：不必站在旁边，但**必须在够得着的范围内**）——
// 返回一个 tick() 能直接吃的 action，或 null
export const REACH = 2.6;                       // 右键能作用的范围（比 E 的贴身范围宽一点，但仍是"走过去才够得着"）

// 【注】这里曾经有过“鼠标指着敌人 → E 抢它”（近战，第 5 步 5a）—— 用户否决，已整体删除。
//   现在 resolveInteract* 只回答“指着什么就做什么”：矿脉/岩壁/炉子/塔/容器/竖井/农田。
//   敌人不参与交互解析（悬停看属性照样可以，那是纯展示）。
export function resolveInteractAt(state, tx, ty, reach = REACH) {
  const m = state.map;
  const p = state.player;
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return null;
  if (Math.max(Math.abs(tx + 0.5 - p.x), Math.abs(ty + 0.5 - p.y)) > reach) return null;
  const i = ty * m.w + tx;

  // 遗落包：死亡点的背包只能在原层、原地回收，避免借死跨层传送物资。
  const dp = state.deathPack;
  if (dp && dp.layerId === state.layerId && Math.floor(dp.x) === tx && Math.floor(dp.y) === ty) return { kind: 'deathPack', pack: dp };

  for (const g of state.graves || []) {
    if ((g.layerId || 'surface') !== state.layerId || g.x !== tx || g.y !== ty) continue;
    if (Math.hypot(g.x + 0.5 - p.x, g.y + 0.5 - p.y) <= reach) return { kind: 'revive', g };
  }

  for (const w of state.workers || []) {
    if (!w.downed || !w.alive || w.layerId !== state.layerId) continue;
    if (Math.floor(w.x) === tx && Math.floor(w.y) === ty && Math.hypot(w.x - p.x, w.y - p.y) <= SURVIVAL.RESCUE.PLAYER_RANGE) return { kind: 'rescue', w };
  }

  // 建筑：工地 → 施工；炉子/制造台/解析台 → 开面板（冷炉子顺手点火）；农田熟了 → 收；竖井 → 探深；灯类 → 加油
  const b = buildingAt(state, tx, ty);
  if (b && !b.site) {
    const def = BUILD[b.type] || {};
    if (def.gate) return { kind: 'gate', b };
    if (heldTool(state) === 'repair' && Number.isFinite(b.hp) && b.hp < (towerHp(def, b.level || 1) || def.hp || 0)) return { kind: 'repair', b };
    if (def.station) return { kind: 'station', b };
    if (def.restSlots) return { kind: 'rest', b };
    if (def.dmg) return { kind: 'payload', b };   // 塔：站旁边按 E 装配载荷（W14-A 第 2 步）
    if (def.growSec && (b.growth || 0) >= 1) return { kind: 'harvest', b };
    if (b.type === 'shaft') return { kind: 'shaft', b };
    // 加油只对「烧燃料的灯」有效；炉子烧的是火种（fireMat），加进去的燃料是错的
    if (def.maxFuel && !def.fireMat && (b.fuel || 0) < def.maxFuel && (state.res.fuel || 0) > 0) return { kind: 'refuel', b };
  }
  if (b && b.site) return { kind: 'build', b };

  // 2) 采集节点（矿脉 / 藤木 / 遗迹碑 / 母髓 / 岩壁）
  const t = m.tiles[i];
  if (!m.occWalk[i]) {
    if (t === T.ORE || t === T.VINE || t === T.RELIC || t === T.MOTHER) {
      return { kind: 'mine', i, res: NODE_RES[t], x: tx, y: ty };
    }
    if (t === T.ROCK && hasTech(state, 'stonework')) {
      return { kind: 'mine', i, res: 'stone', rock: true, x: tx, y: ty };
    }
  }
  // 3) 夜辉草
  const bloom = nightbloomAt(state, tx, ty);
  if (bloom) return { kind: 'bloom', b: bloom };
  // 4) 容器（储物箱 / 营地仓）
  let bestC = null, bdC = 1e9;
  for (const c of allContainers(state, true)) {
    if (c.x !== tx || c.y !== ty) continue;
    const d = Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y);
    if (d < bdC) { bdC = d; bestC = c; }
  }
  if (bestC) return { kind: 'container', c: bestC };
  return null;
}

function addFx(state, x, y, txt, color) {
  // 失败提示统一是橙色：顺手给出声（“做不成”必须听得见）
  if (color === '#ff9d5c') sfx('fail', { x: x + 0.5, y: y + 0.5 });
  state.floaties.push({ x: x + 0.5, y: y + 0.1, txt, color, t: 0, life: 0.9 });
}

export function tick(state, action) {
  if (!action) return;
  if (action.kind === 'rest') {
    state.playerRestT = SURVIVAL.REST.DURATION;
    state.floaties.push({ x: state.player.x, y: state.player.y - 0.5, txt: '开始休整', color: '#d7b58a', t: 0, life: 1 });
    return;
  }
  if (action.kind === 'deathPack') {
    const dp = state.deathPack;
    if (!dp || dp !== action.pack) return;
    for (const k in (dp.stock || {})) {
      const n = dp.stock[k] || 0;
      if (n > 0) deposit(state, k, n, state.player.x, state.player.y);
    }
    if (dp.held) {
      if (state.equip && !state.equip.held) state.equip.held = dp.held;
      else deposit(state, dp.held, 1, state.player.x, state.player.y);
    }
    state.deathPack = null;
    state.floaties.push({ x: state.player.x, y: state.player.y - 0.6, txt: '遗落包已回收', color: '#9ef7a8', t: 0, life: 1.2 });
    return;
  }
  if (action.kind === 'rescue') {
    const err = startPlayerRescue(state, action.w);
    if (err) addFx(state, Math.floor(action.w.x), Math.floor(action.w.y), err, '#ff9d5c');
    return;
  }
  if (action.kind === 'revive') {
    const err = reviveAtGrave(state, action.g);
    if (err) addFx(state, action.g.x, action.g.y, err, '#ff9d5c');
    return;
  }
  if (action.kind === 'gate') { toggleGate(state, action.b); return; }
  if (action.kind === 'repair') {
    const b = action.b; const def = BUILD[b.type] || {};
    const max = towerHp(def, b.level || 1) || def.hp || 0;
    if (!Number.isFinite(b.hp) || b.hp >= max) return;
    if (withdrawOne(state, 'stone', SURVIVAL.REPAIR.STONE, b.x + 0.5, b.y + 0.5) !== null) return;
    if (withdrawOne(state, 'vine', SURVIVAL.REPAIR.VINE, b.x + 0.5, b.y + 0.5) !== null) { deposit(state, 'stone', SURVIVAL.REPAIR.STONE, b.x + 0.5, b.y + 0.5); return; }
    b.hp = Math.min(max, b.hp + SURVIVAL.REPAIR.HP);
    state.floaties.push({ x: b.x + 0.5, y: b.y - 0.25, txt: `修缮 +${SURVIVAL.REPAIR.HP}`, color: '#9ef7d8', t: 0, life: 0.9 });
    return;
  }
  if (action.kind === 'refine') { workOnce(state, action.b); return; }   // 兼容旧调用
  if (action.kind === 'mine') {
    if (action.rock && !canMineRock(state)) return;      // 还没研究「石工」：岩壁只是墙（正常不该走到这里）
    // 徒手凿岩壁慢 2.2 倍：偶尔提一句“有镐更快”，但**不拦着** ——
    // 镐子是提速工具（desc: 挖矿与凿岩快 40%），不是门槛；拦着就会变成石头/工具死循环。
    if (action.rock && heldTool(state) !== 'pick' && (!state._rockWarnT || state._rockWarnT < performance.now())) {
      state._rockWarnT = performance.now() + 3000;
      addFx(state, action.x, action.y, '徒手凿岩壁 · 有石镐快 40%', '#9aa6b5');
    }
    const m = state.map;
    // 懒初始化：岩壁这类生成期没有初值的地形，用与生成器同一张表（地表/深层同一来源）
    if (m.nodeAmt[action.i] <= 0) m.nodeAmt[action.i] = nodeFallback(m.tiles[action.i]);
    const stored = deposit(state, action.res, 1, action.x + 0.5, action.y + 0.5);   // 自动进最近的容器
    m.nodeAmt[action.i]--;
    if (stored > 0 && (action.res === 'ore' || action.res === 'vine')) advanceFirstSlice(state, 'gather');
    const label = action.res === 'ore' ? '+辉髓'
      : action.res === 'vine' ? '+藤木'
        : action.res === 'stone' ? '+石头'
          : action.res === 'core' ? '+母髓' : '+档案';
    const col = action.res === 'ore' ? '#4be0c4'
      : action.res === 'vine' ? '#e0b96a'
        : action.res === 'stone' ? '#9aa6b5'
          : action.res === 'core' ? '#ffd76e' : '#c9a0ff';
    if (stored > 0) addFx(state, action.x, action.y, label, col);
    // 采集音：每 3 下响一次（每次结算都响会变成“机关枪”）；藤木是砍、岩石/矿脉是敲
    if (everyN(action.res, 3)) sfx(action.res === 'vine' ? 'chop' : action.res === 'stone' ? 'dig' : 'mine', { x: action.x + 0.5, y: action.y + 0.5 });
    // 石斧：每次伐籓木多 1
    if (action.res === 'vine' && vineBonus(state) > 0) {
      if (deposit(state, 'vine', vineBonus(state), action.x + 0.5, action.y + 0.5) > 0) {
        addFx(state, action.x, action.y - 0.35, `+${vineBonus(state)}（石斧）`, '#e0b96a');
      }
    }
    if (action.res === 'data' && hasScholar(state)) {         // 学者：遗迹解析 +50%
      if (deposit(state, 'data', 1, action.x + 0.5, action.y + 0.5) > 0) addFx(state, action.x, action.y, '+1（解析）', '#e0c9ff');
    }
    if (action.res === 'data') {
      const rel = dropRelic(state, action.x, action.y);        // 遗迹碑里夹着的残页（每座碑一张）
      if (rel && rel.full) addFx(state, action.x, action.y - 0.5, '残页集齐！', '#d8c6ff');
    }
    if (m.nodeAmt[action.i] <= 0) { m.nodeAmt[action.i] = 0; m.set(action.i % m.w, (action.i / m.w) | 0, T.FLOOR); }   // 走 map.set：渲染层才知道这一格要重烘
  } else if (action.kind === 'build') {
    advanceBuild(state, action.b, PLAYER_WORK * buildMul(state));      // 手动盖房：把工期往前推（石锤更快）
    if (everyN('build', 2)) sfx('build', { x: action.b.x + 0.5, y: action.b.y + 0.5 });
  } else if (action.kind === 'payload') {
    state._openPayload = action.b;        // 交给 main 打开载荷面板（与操作台同一条路）
  } else if (action.kind === 'station') {
    const def = BUILD[action.b.type] || {};
    state._openStation = action.b;        // 交给 main 打开操作台面板（避免 interact 反向依赖 UI）
    if (def.work) {
      // 炉子冷着的时候，这一下 E 就是【点火】（否则按住 E 只会反复提示“没火”，很挫）
      if (!fireOn(action.b)) {
        const err = lightFire(state, action.b);
        if (!err) addFx(state, action.b.x, action.b.y, `点火：${fuelName(fireMatOf(action.b, def))} +1`, '#ff9d5c');
        else addFx(state, action.b.x, action.b.y, err, '#ff9d5c');
      } else {
        const err = workOnce(state, action.b);   // 熔炉：顺手按选中配方手做一次（按住 E 就是连续做）
        if (err) addFx(state, action.b.x, action.b.y, err, '#ff9d5c');
        else sfx('craft', { x: action.b.x + 0.5, y: action.b.y + 0.5 });
      }
    }
    return;
  } else if (action.kind === 'soothe') {
    const err = soothe(state, action.w);
    if (err) addFx(state, Math.floor(action.w.x), Math.floor(action.w.y), err, '#ff9d5c');
    else sfx('soothe', { x: action.w.x, y: action.w.y });
  } else if (action.kind === 'refuel') {
    const def = BUILD[action.b.type];
    const room = def && def.maxFuel ? def.maxFuel - (action.b.fuel || 0) : 1;
    if (room <= 0) return;                    // 已满：不浪费燃料
    sfx('fuel', { x: action.b.x + 0.5, y: action.b.y + 0.5 });
    withdrawOne(state, 'fuel', 1, action.b.x + 0.5, action.b.y + 0.5);
    action.b.fuel = (action.b.fuel || 0) + 1;
    addFx(state, action.b.x, action.b.y, '+燃料', '#aee9ff');
  } else if (action.kind === 'harvest') {
    const gain = action.b.type === 'mycobed' ? SURVIVAL.REGEN.YIELD : BUILD.farm.yield + harvestBonus(state);
    const outRes = action.b.type === 'mycobed' ? 'vine' : 'food';
    sfx('harvest', { x: action.b.x + 0.5, y: action.b.y + 0.5 });
    deposit(state, outRes, gain, action.b.x + 0.5, action.b.y + 0.5);
    action.b.growth = 0;
    addFx(state, action.b.x, action.b.y, `${outRes === 'vine' ? '+藤木' : '+食物'} ${gain}`, outRes === 'vine' ? '#d7b58a' : '#9ef7a8');
  } else if (action.kind === 'bloom') {
    const b = action.b;
    const gain = harvestNightbloom(state, b);
    sfx('pick', { x: b.x + 0.5, y: b.y + 0.5 });
    if (hasTech(state, 'nightlamp')) {                    // 夜髓萃取：额外 +1
      const extra = deposit(state, 'night', 1, b.x, b.y);
      if (extra > 0) state.floaties.push({ x: b.x, y: b.y - 0.7, txt: '+1（萃取）', color: '#d8c6ff', t: 0, life: 0.9 });
    }
    return gain;
  } else if (action.kind === 'shaft') {
    const err = useShaft(state, action.b);
    if (err) addFx(state, action.b.x, action.b.y, err, '#ff9d5c');
  } else if (action.kind === 'container') {
    // 面板已经开在同一个容器上时不再重复请求（按住 E 不该每 0.35s 重建一次面板）
    if (state.activePanel === 'store' && state.storeRef && state.storeRef === action.c.ref) return;
    sfx('click', { x: action.c.x, y: action.c.y });
    state._openStore = action.c;          // 交给 main 打开容器面板（避免 interact 反向依赖 UI）
  }
}
