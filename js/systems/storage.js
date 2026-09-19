// systems/storage.js —— 存储（L2「容器化库存」）
//
// 规则（与用户确认）：
//   · 采集产出【自动进入最近的容器】，容器放不下就进【背包】，两者都满才丢（提示会区分两种情况）
//   · 不做搬运 AI：容器之间 / 跨层搬运由玩家在容器面板里手动搬（背包也是跨层携带的唯一手段）
//   · 支付（建造/研究/加油/招募/炼油…）优先扣【最近的容器】，再扣其它层，最后才动背包
//
// 关键约定：`state.res` 是**所有容器 + 背包的聚合值**（派生数据，只读）。
//   任何写操作都必须走 deposit / withdraw / transfer，写完自动 syncRes。
//   这样既让旧的读取点（侧栏、阈值、canAfford）零改动，又不会出现两套账。
import { CAMP_CAP, PACK_CAP, RES_ORDER, RES_NAME, STORE_ALARM } from '../data/storage.js';
import { CARRY } from '../data/combat.js';   // 背负结构体要占背包格（第 5 步 5b）
import { BUILD } from '../data/buildings.js';
import { sfx } from '../core/audio.js';
import { pnow, pmark } from '../core/perf.js';

const sumOf = (o) => { let n = 0; for (const k in o) n += o[k] || 0; return n; };
// 容器内容物容器（防御性：新建的箱子 / 旧存档可能没这个字段）
const boxOf = (c) => (c.ref.stock || (c.ref.stock = {}));

// 容器描述对象：{ kind:'camp'|'store'|'pack', ref, cap, x, y, layerId }
export const usedOf = (c) => sumOf(c.ref.stock || {});export const spaceOf = (c) => Math.max(0, c.cap - usedOf(c));

// 懒初始化：给篝火 / 储物箱补上 stock 字段（存档兼容）
export function ensureStorage(state) {
  if (!state.pack) state.pack = { stock: {}, cap: PACK_CAP };
  if (!state.pack.stock) state.pack.stock = {};
  for (const id in (state.layers || {})) {
    const L = state.layers[id];
    for (const b of L.beacons || []) if (!b.stock) b.stock = {};
    for (const b of L.buildings || []) {
      const def = BUILD[b.type];
      if (def && def.store && !b.stock) b.stock = {};
    }
  }
  syncRes(state);
  return state;
}

// 所有容器；layerOnly=true 时只看当前层
export function allContainers(state, layerOnly) {
  const out = [];
  const seenLayers = new Set();
  const layers = state.layers || {};
  for (const id in layers) {
    if (layerOnly && id !== state.layerId) continue;
    const L = layers[id];
    seenLayers.add(L);
    for (const b of L.beacons || []) {
      if (b.hp != null && b.hp <= 0) continue;               // 营地灯被打掉 → 仓库也没了
      out.push({ kind: 'camp', ref: b, cap: CAMP_CAP, x: b.x, y: b.y, layerId: id });
    }
    for (const b of L.buildings || []) {
      const def = BUILD[b.type];
      if (!def || !def.store || b.site) continue;
      out.push({ kind: 'store', ref: b, cap: def.store, x: b.x, y: b.y, layerId: id });
    }
  }
  // 地表区块各自持有建筑/篝火容器；全局账本视图必须把休眠区块也算进来，
  // 但当前层视图（采集/就近入库）仍只看当前区块，避免跨区块自动搬运。
  if (!layerOnly) for (const c of Object.values(state.chunkStore || {})) {
    if (!c || seenLayers.has(c)) continue;
    const id = `surface:${c.id || `${c.cx || 0},${c.cy || 0}`}`;
    for (const b of c.beacons || []) {
      if (b.hp != null && b.hp <= 0) continue;
      out.push({ kind: 'camp', ref: b, cap: CAMP_CAP, x: b.x, y: b.y, layerId: id });
    }
    for (const b of c.buildings || []) {
      const def = BUILD[b.type];
      if (!def || !def.store || b.site) continue;
      out.push({ kind: 'store', ref: b, cap: def.store, x: b.x, y: b.y, layerId: id });
    }
  }
  return out;
}

export function packContainer(state) {
  const p = state.player || { x: 0, y: 0 };
  const pk = state.pack || (state.pack = { stock: {}, cap: PACK_CAP });
  // 容量以实例为准（旧存档可能没有 cap → 回退常量）：与储物箱/篝火同一套写法，避免两处各说各话
  // 背上结构体后再少 PACK_SLOTS 格（第 5 步 5b）：这是**派生值**，不进存档，读档不会不一致
  const lost = state.carried ? CARRY.PACK_SLOTS : 0;
  return { kind: 'pack', ref: pk, cap: Math.max(0, (pk.cap || PACK_CAP) - lost), x: p.x, y: p.y, layerId: state.layerId };
}

// 本层容器 + 背包总共还能放下 n 个吗？
// 产出（deposit）先存本层容器、再进背包，都放不下才会当场丢（+报警）——所以容量判定必须与它一致：
// 机器/手做在扣料前先问一句，放不下就别开工（不然“料被吃掉、成品当场丢”，玩家只会看到“炉子不出货”）。
export function hasRoomFor(state, n) {
  if (!n || n <= 0) return true;
  let room = 0;
  for (const c of allContainers(state, true)) room += spaceOf(c);
  room += spaceOf(packContainer(state));            // 背包也算容器
  return room >= n;
}

// —— 聚合账本（派生）——
export function syncRes(state) {
  const t0 = pnow();
  const out = {};
  for (const k of RES_ORDER) out[k] = 0;
  const add = (k, v) => { out[k] = (out[k] || 0) + (v || 0); };
  for (const c of allContainers(state, false)) for (const k in (c.ref.stock || {})) add(k, c.ref.stock[k]);
  if (state.pack) for (const k in state.pack.stock) add(k, state.pack.stock[k]);
  state.res = out;
  pmark('storage.syncRes', t0);
  return out;
}

const gameClock = (state) => (Number.isFinite(state.t) ? state.t : 0);

// 出库只记录“开始有空间”的时间，不立即解除报警锁。
// 炮塔/熔炉/拓荒者的自动消耗如果每几秒腾出一格，仍属于同一轮满仓事件。
function noteWarnRoom(state) {
  if (!state._warnSfx || state._warnFreeAt != null) return;
  const st = storageStats(state);
  if (st.total.used < st.total.cap) state._warnFreeAt = gameClock(state);
}

function settleWarnLock(state) {
  if (!state._warnSfx || state._warnFreeAt == null) return;
  if (gameClock(state) - state._warnFreeAt >= STORE_ALARM.CLEAR_AFTER_SECS) {
    state._warnSfx = false;
    state._warnFreeAt = null;
  }
}

// —— 入库：最近的容器优先 → 背包 → 都满才丢 ——
// 【为什么背包要算】采集物以前只进【本层容器】：玩家手里背着 24 格空包，在余烬层（本层 0 个容器）
//   采一颗辉髓就提示“存储已满”并丢掉 —— 玩家的背包本来就该是一个容器。
export function deposit(state, k, n, x, y) {
  if (!n || n <= 0) return 0;
  const t0 = pnow();
  const px = x == null ? state.player.x : x;
  const py = y == null ? state.player.y : y;
  const cs = allContainers(state, true);
  cs.sort((a, b) => d2(a, px, py) - d2(b, px, py));
  let left = n;
  for (const c of cs) {
    if (left <= 0) break;
    const room = spaceOf(c);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    boxOf(c)[k] = (boxOf(c)[k] || 0) + take;
    left -= take;
  }
  if (left > 0) {                                  // 本层容器装不下了：进背包
    const pk = packContainer(state);
    const room = spaceOf(pk);
    if (room > 0) {
      const take = Math.min(room, left);
      boxOf(pk)[k] = (boxOf(pk)[k] || 0) + take;
      left -= take;
    }
  }
  syncRes(state);
  if (left > 0) reportFull(state, k, left, px, py);
  pmark('storage.deposit', t0);
  return n - left;
}

// 远端前哨专用入库：只看目标区块自己的篝火/储物箱，不动玩家背包，
// 也不把“无人区块”当成全局自动搬运通道。没有本地容器或容器已满时返回 0，
// 调用方应保留节点量，让前哨进入“等容器/等补给”的可解释阻塞状态。
export function depositToChunk(state, chunk, k, n, x, y) {
  if (!chunk || !n || n <= 0) return 0;
  const px = x == null ? 0 : x;
  const py = y == null ? 0 : y;
  const cs = [];
  for (const b of chunk.beacons || []) {
    if (b.hp != null && b.hp <= 0) continue;
    cs.push({ kind: 'camp', ref: b, cap: CAMP_CAP, x: b.x, y: b.y, layerId: `surface:${chunk.id || '0,0'}` });
  }
  for (const b of chunk.buildings || []) {
    const def = BUILD[b.type];
    if (!def || !def.store || b.site) continue;
    cs.push({ kind: 'store', ref: b, cap: def.store, x: b.x, y: b.y, layerId: `surface:${chunk.id || '0,0'}` });
  }
  cs.sort((a, b) => d2(a, px, py) - d2(b, px, py));
  let left = n;
  for (const c of cs) {
    if (left <= 0) break;
    const room = spaceOf(c);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    boxOf(c)[k] = (boxOf(c)[k] || 0) + take;
    left -= take;
  }
  syncRes(state);
  return n - left;
}

// 远端前哨专用出库：只从目标区块容器扣料，成功返回 null，失败返回缺料表，
// 与普通 withdraw 的返回约定一致；不会把玩家当前区块或背包当作远程补给线。
export function withdrawFromChunk(state, chunk, cost, x, y) {
  if (!chunk || !cost || typeof cost !== 'object') return Object.assign({}, cost || {});
  const cs = [];
  for (const b of chunk.beacons || []) {
    if (b.hp != null && b.hp <= 0) continue;
    cs.push({ kind: 'camp', ref: b, cap: CAMP_CAP, x: b.x, y: b.y, layerId: `surface:${chunk.id || '0,0'}` });
  }
  for (const b of chunk.buildings || []) {
    const def = BUILD[b.type];
    if (!def || !def.store || b.site) continue;
    cs.push({ kind: 'store', ref: b, cap: def.store, x: b.x, y: b.y, layerId: `surface:${chunk.id || '0,0'}` });
  }
  const px = x == null ? 0 : x, py = y == null ? 0 : y;
  cs.sort((a, b) => d2(a, px, py) - d2(b, px, py));
  for (const k in cost) {
    let have = 0;
    for (const c of cs) have += Math.max(0, boxOf(c)[k] || 0);
    if (have < (cost[k] || 0)) return Object.assign({}, cost);
  }
  for (const k in cost) {
    let need = cost[k] || 0;
    for (const c of cs) {
      if (need <= 0) break;
      const box = boxOf(c), take = Math.min(need, Math.max(0, box[k] || 0));
      if (!take) continue;
      box[k] -= take;
      if (box[k] <= 0) delete box[k];
      need -= take;
    }
  }
  syncRes(state);
  return null;
}

function reportFull(state, k, lost, x, y) {
  settleWarnLock(state);
  const name = RES_NAME[k] || k;
  // 两种“放不下”说清楚：本层根本没容器 vs 容器+背包都满了（以前一律说“存储已满”，很误导）
  const noLocal = allContainers(state, true).length === 0;
  state.storeWarnT = 4;                                       // HUD 提示行（由 main 递减）
  state.storeWarnTxt = noLocal
    ? `本层没有容器：${name} ×${lost} 放不下（背包也满了）—— 建储物箱，或带回上一层`
    : `容器与背包都满了：${name} ×${lost} 已丢失 —— 建储物箱或先腾地方`;
  if (!state._warnSfx) { state._warnSfx = true; sfx('alarm'); }   // 满仓事件锁存：持续溢出期间只提醒一次
  state.floaties.push({ x: x + 0.5, y: y - 0.2, txt: `放不下 −${lost}`, color: '#ff8f6e', t: 0, life: 1.5 });
}

// —— 出库：最近容器 → 其它层容器 → 背包。总量不足时整体失败（返回缺的额度）——
export function withdraw(state, cost, x, y) {
  const px = x == null ? state.player.x : x;
  const py = y == null ? state.player.y : y;
  for (const k in cost) if ((state.res[k] || 0) < cost[k]) return Object.assign({}, cost);
  const local = allContainers(state, true).sort((a, b) => d2(a, px, py) - d2(b, px, py));
  const away = allContainers(state, false).filter((c) => c.layerId !== state.layerId).sort((a, b) => d2(a, px, py) - d2(b, px, py));
  const pools = local.concat(away, [packContainer(state)]);
  for (const k in cost) {
    let need = cost[k];
    for (const c of pools) {
      if (need <= 0) break;
      const box = boxOf(c);
      const have = box[k] || 0;
      if (have <= 0) continue;
      const take = Math.min(have, need);
      box[k] = have - take;
      need -= take;
    }
  }
  syncRes(state);
  noteWarnRoom(state);                             // 先记空间，持续空出一段时间后才结束本次事件
  return null;
}

export const withdrawOne = (state, k, n, x, y) => withdraw(state, { [k]: n }, x, y);
export function dropPack(state, k, n = 1) {
  const pk = packContainer(state), have = Math.max(0, pk.ref.stock[k] || 0);
  const move = Math.min(have, Math.max(0, n | 0));
  if (!move) return 0;
  pk.ref.stock[k] = have - move;
  if (pk.ref.stock[k] <= 0) delete pk.ref.stock[k];
  state.pickups = state.pickups || [];
  for (let i = 0; i < move; i++) state.pickups.push({ x: state.player.x, y: state.player.y, kind: k, t: -0.45, life: 30 });
  syncRes(state);
  state._warnSfx = false;
  state._warnFreeAt = null;
  return move;
}
export const payBuild = (state, type) => withdraw(state, BUILD[type].cost, undefined, undefined);
// 按比例扣（玩家阵亡时燃料减半）
export function withdrawFraction(state, k, frac) {
  const n = Math.floor((state.res[k] || 0) * frac);
  if (n > 0) withdraw(state, { [k]: n });
  return n;
}

// —— 容器之间搬运（手动，无 AI）——
export function transfer(state, from, to, k, n) {
  const fb = boxOf(from), tb = boxOf(to);
  const have = fb[k] || 0;
  const room = spaceOf(to);
  const move = Math.max(0, Math.min(have, room, n));
  if (move <= 0) return 0;
  fb[k] = have - move;
  tb[k] = (tb[k] || 0) + move;
  syncRes(state);
  return move;
}

// —— 统计（侧栏 / 容器面板）——
export function storageStats(state) {
  const agg = (list) => list.reduce((a, c) => ({ used: a.used + usedOf(c), cap: a.cap + c.cap }), { used: 0, cap: 0 });
  const local = allContainers(state, true);
  const all = allContainers(state, false);
  const pack = packContainer(state);
  const l = agg(local);
  const t = agg(all);
  t.used += usedOf(pack); t.cap += pack.cap;
  return {
    local: l, total: t, count: all.length, localCount: local.length,
    pack: { used: usedOf(pack), cap: pack.cap },
    localFull: local.length > 0 && l.used >= l.cap,          // 本层已满（再采就丢）
    noLocal: local.length === 0,                             // 本层没有容器（采了必丢）
  };
}

// 旧存档迁移：把旧的全局 res 倒进地表篝火仓库
export function migrateResToBeacon(state, res) {
  const L = state.layers && state.layers.surface;
  const b = L && (L.beacons || [])[0];
  if (!b || !res) return false;
  if (!b.stock) b.stock = {};
  let room = CAMP_CAP - usedOf({ ref: b, cap: CAMP_CAP });
  for (const k in res) {
    const v = res[k] || 0;
    if (v <= 0 || room <= 0) continue;
    const take = Math.min(v, room);
    b.stock[k] = (b.stock[k] || 0) + take;
    room -= take;
  }
  syncRes(state);
  return true;
}

function d2(c, x, y) { const dx = (c.x + 0.5) - x, dy = (c.y + 0.5) - y; return dx * dx + dy * dy; }
