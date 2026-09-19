// systems/building.js —— 建造放置逻辑（合法性 + 落位）
import { BUILD, canAfford, DEMOLISH_REFUND, DEMOLISH_RANGE, workOf, towerHp, upgradeCostFor, TOWER_LV_MAX } from '../data/buildings.js';
import { payBuild, deposit, withdraw } from './storage.js';
import { RES_NAME } from '../data/storage.js';
import { T } from '../world/map.js';
import { hasTech } from './research.js';
import { LAYER_ORDER } from '../data/layers.js';
import { sfx } from '../core/audio.js';
import { SURVIVAL } from '../data/survival.js';
import { advanceFirstSlice } from './firstSlice.js';

export const PLACE_RANGE = 6;                 // 距玩家最大放置距离（tile）

// 研究锁：竖井还需按当前层判定（与 placeError 保持一致）
export function lockedByResearch(state, type) {
  const def = BUILD[type];
  if (def && def.locked && !hasTech(state, def.locked)) return true;
  if (type === 'shaft') {
    const li = LAYER_ORDER.indexOf(state.layerId);
    if (li >= LAYER_ORDER.length - 1) return true;
    if (li === 0 && !hasTech(state, 'deep')) return true;
    if (li >= 1 && !hasTech(state, 'deeper')) return true;
  }
  return false;
}

// 营地火与潮穴是地表的固定玩法点：可站、可交互，但绝不能被蓝图覆盖。
// 它们不写 occBuild，避免把篝火变成实体障碍；建造入口在这里统一拦截。
export function reservedTileError(state, tx, ty) {
  if ((state.beacons || []).some((b) => b.x === tx && b.y === ty)) return '营地火';
  if (state.layerId !== 'surface') return null;
  const ops = state.layers && state.layers.surface && state.layers.surface.nightops;
  if (ops && (ops.vents || []).some((v) => v.x === tx && v.y === ty)) return '潮穴';
  return null;
}

export function placeError(state, type, tx, ty, opts) {
  const o = opts || {};
  const m = state.map;
  const def = BUILD[type];
  if (def && def.locked && !hasTech(state, def.locked)) return '需研究解锁';
  if (def && def.deepOnly && state.layerId === 'surface') return '只能建在深渊';
  if (type === 'mycobed' && (state.buildings || []).filter((b) => b.type === 'mycobed' && !b.site).length >= SURVIVAL.REGEN.MAX_BEDS) return `菌床已达本图上限 ${SURVIVAL.REGEN.MAX_BEDS}`;
  if (type === 'shaft') {                     // 竖井：按所在层判定
    const li = LAYER_ORDER.indexOf(state.layerId);
    if (li >= LAYER_ORDER.length - 1) return '已在最深处';
    if (li === 0 && !hasTech(state, 'deep')) return '需研究「深潜学」';
    if (li >= 1 && !hasTech(state, 'deeper')) return '需研究「深层深潜」';
  }
  if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) return '边界';
  if (m.get(tx, ty) !== T.FLOOR) return '地形';        // 只能放平地
  const reserved = reservedTileError(state, tx, ty);
  if (reserved) return reserved;
  if (m.blight && m.blight[ty * m.w + tx] > 0) return '蚀痕：需先净化';
  const i = ty * m.w + tx;
  if (m.occBuild && m.occBuild[i]) return '被占';   // 该格已有建筑（农田/竖井也算）
  if (m.occWalk[i]) return '被占';                  // 双保险：实体占格
  const p = state.player;
  if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) return '脚下';
  const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
  if (d > PLACE_RANGE) return '太远';
  if (!o.ignoreCost && !canAfford(state.res, type)) return '资源不足';
  return null;
}

// 放置成功返回 null，否则返回原因字符串
// 放下去的是【工地/蓝图】：立即扣料 + 占住建筑格，但**不占行走格、不挡光** ——
// 人和蚀兽都能从工地走过去，建成了才会变成实体（见 completeBuilding）。
export function tryPlace(state, type, tx, ty) {
  const err = placeError(state, type, tx, ty);
  if (err) { sfx('deny'); return err; }
  const d = BUILD[type];
  payBuild(state, type);                   // 从最近的容器扣料
  const m = state.map;
  const i = ty * m.w + tx;
  if (m.occBuild) m.occBuild[i] = 1;      // 占「建筑格」：不能重复建、不刷怪、不刷游荡点（occWalk 不动）
  state.buildings.push({
    type, x: tx, y: ty,
    site: true, work: 0,                  // 工地：进度从 0 开始，等玩家/拓荒者来盖
    hp: 0, fuel: 0, level: 1,
    burnT: 0, cd: 0, growth: 0, purifyT: 0,
    recipe: d.recipe || null,             // 配方站（熔炉/自动熔炉）：实例自带默认配方
    fireMat: d.fireMat || null,           // 火种（烧什么由玩家定，见 data/fire.js）
    stock: d.store ? {} : null,           // 容器类建筑的存货（暂存箱也一样要有）
    mods: d.dmg ? [] : null,              // 塔的载荷（修饰器槽；W14-A 第 2 步：空载 = 今天的塔）
    open: d.gate ? d.openDefault !== false : undefined,
  });
  // 记一个「撤销点」：放错了 Ctrl+Z 可以整单退回（30 秒内、只能撤最近一次）
  state.undo = { x: tx, y: ty, type, at: performance.now() };
  sfx('place', { x: tx + 0.5, y: ty + 0.5 });
  return null;
}

// Ctrl+Z：撤销最近一次放置（**全额退料**，不是拆除折扣），限 30 秒内
export const UNDO_SECS = 30;
export function undoPlace(state) {
  const u = state.undo;
  if (!u) return '没有可撤销的放置';
  state.undo = null;
  if ((performance.now() - u.at) / 1000 > UNDO_SECS) return `撤销过期（限 ${UNDO_SECS} 秒内）`;
  const b = buildingAt(state, u.x, u.y);
  if (!b || b.type !== u.type) return '那里已经不是刚放下的建筑了';
  const def = BUILD[u.type];
  for (const k in def.cost) if (def.cost[k]) deposit(state, k, def.cost[k], u.x + 0.5, u.y + 0.5);
  removeBuilding(state, b);
  state.floaties.push({ x: u.x + 0.5, y: u.y - 0.3, txt: `已撤销 ${def.name}`, color: '#9fe8ff', t: 0, life: 1.1 });
  return null;
}

// 工人/玩家推进工期；返回 true 表示这一下正好建成
export function advanceBuild(state, b, amount) {
  if (!b || !b.site || amount <= 0) return false;
  const need = workOf(b.type);
  b.work = (b.work || 0) + amount;
  if (b.work < need) return false;
  b.work = need;
  completeBuilding(state, b);
  return true;
}

// 工地 → 正式建筑：这一刻才占行走格 / 挡光 / 有血有油
export function completeBuilding(state, b) {
  const def = BUILD[b.type];
  if (!def) return;
  const m = state.map;
  const i = b.y * m.w + b.x;
  b.site = false;
  const mh = towerHp(def, b.level || 1);    // 塔的血随等级（第 6 步）；null = 这类建筑没有结构（灯柱/工作台/储物箱）
  // ⚠️ 工地占位符一开始就是 hp:0 —— 没有结构的建筑必须把字段**清掉**，
  //    留着 0 会被仓库/小地图/添火那几处 `b.hp <= 0` 当成已毁（老行为就是 undefined）
  b.hp = mh == null ? undefined : mh;
  // 带火种的炉子建成时是【冷】的（得自己放火种）—— 不然火种经济就没意义了；
  // 灯柱/净光柱/诱饵灯等保持原来的“建成就有油”
  b.fuel = def.fireMat ? 0 : (def.maxFuel ? def.maxFuel : 0);
  if (def.fireMat) { b.fireMat = b.fireMat || def.fireMat; b.burnT = 0; }
  if (def.store && !b.stock) b.stock = {};     // 容器：确保有存货字段
  if (b.level == null) b.level = 1;
  if (def.solid || (def.gate && !b.open)) m.occWalk[i] = 1;
  if (def.block) m.blockLight[i] = 1;
  sfx('built', { x: b.x + 0.5, y: b.y + 0.5 });
  state.floaties.push({ x: b.x + 0.5, y: b.y - 0.3, txt: `${def.name} 建成`, color: '#9ef7d8', t: 0, life: 1.2 });
  if (b.type === 'lamp' || b.type === 'purifier') advanceFirstSlice(state, 'lit');
  ejectFromTile(state, b.x, b.y);          // 别把人封在墙里
}

// 栅门是唯一可切换的通行结构：开门立即释放占格，关门立即纳入寻路/碰撞。
export function toggleGate(state, b) {
  if (!b || b.site || b.type !== 'gate') return '这里不是栅门';
  b.open = !b.open;
  const i = b.y * state.map.w + b.x;
  state.map.occWalk[i] = b.open ? 0 : 1;
  state.map.blockLight[i] = 0;
  ejectFromTile(state, b.x, b.y);
  state.floaties.push({ x: b.x + 0.5, y: b.y - 0.25, txt: b.open ? '栅门已开启' : '栅门已关闭', color: '#d7b58a', t: 0, life: 0.9 });
  return null;
}

// 实体建筑落成时，把站在这一格里的单位赶到旁边可站立格（否则会被永久卡住）
export function ejectFromTile(state, tx, ty) {
  const m = state.map;
  const inside = (ex, ey) => Math.floor(ex) === tx && Math.floor(ey) === ty;
  let free = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
    if (m.isWalk(x, y)) { free = { x: x + 0.5, y: y + 0.5 }; break; }
  }
  if (!free) return;
  const p = state.player;
  if (p && inside(p.x, p.y)) { p.x = free.x; p.y = free.y; if (p.clearPath) p.clearPath(); }
  for (const w of state.workers || []) {
    if (w.layerId !== state.layerId || !inside(w.x, w.y)) continue;
    w.x = free.x; w.y = free.y; w.path = [];
  }
  for (const e of state.enemies || []) {
    if (!inside(e.x, e.y)) continue;
    e.x = free.x; e.y = free.y;
  }
}

// 这一格上的建筑（多重时取第一个）
export function buildingAt(state, tx, ty) {
  for (const b of state.buildings) if (b.x === tx && b.y === ty) return b;
  return null;
}

// 拆除：工地全额返还（还没开工），已建成返还一半成本（燃料不返还）
export function demolish(state, b) {
  const def = BUILD[b.type];
  if (!def) return '未知建筑';
  if (b.mounted) return '背在身上的塔不能拆 —— 先按 V 放下';   // 第 5 步 5b：它此刻跟着你走，位置不是它自己的
  if (b.natural) return '天然井口拆不掉（它是你下深渊的入口）';   // B37：井口属于地形，不是建筑
  const p = state.player;
  const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
  if (d > DEMOLISH_RANGE) return '太远';
  const frac = b.site ? 1 : DEMOLISH_REFUND;      // 蓝图还没开工 —— 材料原样退回
  sfx('demolish', { x: b.x + 0.5, y: b.y + 0.5 });
  const back = {};
  for (const k in def.cost) {
    const n = Math.floor(def.cost[k] * frac);
    if (n > 0) { deposit(state, k, n, b.x + 0.5, b.y + 0.5); back[k] = n; }   // 退回到最近的容器
  }
  removeBuilding(state, b);
  const txt = (b.site ? '撤销 ' : '') + (Object.keys(back).map((k) => `+${back[k]}`).join(' ') || '拆除');
  state.floaties.push({ x: b.x + 0.5, y: b.y - 0.3, txt, color: '#ffd76e', t: 0, life: 1.0 });
  return null;
}

// 容器（储物箱/缓存…）被拆掉或被打碎时，里面的库存**不能凭空消失**（B30）。
//   ① 能放下的先退回最近的容器（deposit 自己会正确记账）；
//   ② 实在没地方放的那部分才算損失 —— 并且必须**同步从总账里扣掉**：
//      state.res 的定义就是「所有容器 + 背包」之和，丢在地上的东西既不在容器里、就不该还记在账上。
//      否则账面 185、箱子只有 155：后续建造会“扣得掉但拿不出”，存档写盘还会把错账固化。
// 返回真正损失的数量（供浮字与测试断言用）。
// ❗千万不要在这里手写 state.res —— res 是**派生值**（deposit/withdraw 结尾都会 syncRes 重算），
//    再手扣一次会造成反向不平（实测：总账 254→234，而容器里是 244）。
export function spillStock(state, b, reason) {
  const st = b.stock;
  if (!st) return 0;
  let lost = 0;
  for (const k in st) {
    const n = st[k] | 0;
    if (n <= 0) continue;
    st[k] = 0;
    lost += n - deposit(state, k, n, b.x + 0.5, b.y + 0.5);   // deposit 只存本层，放不下的会报警并同步 res
  }
  if (lost > 0) state.floaties.push({ x: b.x + 0.5, y: b.y - 0.9, txt: `${reason || '损毁'}损失 ${lost}`, color: '#ff9a8a', t: 0, life: 1.4 });
  return lost;
}

// —— 塔的就地升级（W14-A 第 6 步）——
// 升级 = 花料把**这一座**塔练上去（单发/射程/血上限），满级 3。
// 【为什么不做成“升级解锁修饰槽”】槽位是研究（payload1/2/3）的活 —— 两条轴各管一件事（见 data/buildings.js 的 TOWER_LV 注释）。
// 【为什么升级要满血】否则玩家会遇到“升完反而更容易被打碎”（血上限涨了、当前血没涨）的诡异手感。
export function upgradeError(state, b) {
  if (!b) return '这里没有建筑';
  const def = BUILD[b.type];
  if (!def) return '未知建筑';
  if (!def.dmg) return `${def.name} 不是塔（只有塔能升级）`;
  if (b.site) return '工地还没盖完';
  if (b.mounted) return '背在身上的塔不能升级 —— 先放下';
  const lv = b.level || 1;
  if (lv >= TOWER_LV_MAX) return `${def.name} 已满级（Lv${TOWER_LV_MAX}）`;
  const cost = upgradeCostFor(b.type, lv);
  if (!cost) return '没有可升的等级';
  for (const k in cost) if ((state.res[k] || 0) < cost[k]) return `材料不足（需 ${costTextOf(cost)}）`;
  return null;
}

// 升级成功返回 null，否则返回原因（与 tryPlace/__place 同一套语义：错误字符串 = 失败）
export function upgradeBuilding(state, b) {
  const err = upgradeError(state, b);
  if (err) { sfx('deny'); return err; }
  const def = BUILD[b.type];
  const lv = b.level || 1;
  const cost = upgradeCostFor(b.type, lv);
  // 扣料：与建造同一套账本（从最近的容器扣；扣不出来就不升）
  if (withdraw(state, cost)) { sfx('deny'); return '材料不足'; }
  b.level = lv + 1;
  b.hp = towerHp(def, b.level);                 // 升完满血（理由见上；塔必有 hp，不会是 null）
  b._ps = null; b._psKey = null;                // 缓存的组合数值作废（等级变了）
  state._sidebarSig = null;
  state._panelSig = null;                       // 载荷面板也在显示等级：别让它留着旧数字
  sfx('built', { x: b.x + 0.5, y: b.y + 0.5 });
  state.floaties.push({ x: b.x + 0.5, y: b.y - 0.3, txt: `${def.name} → Lv${b.level}`, color: '#ffe9a8', t: 0, life: 1.4 });
  return null;
}

// 材→“辉髓 6 + 燃料 2”这种一句人话（错误文案与界面共用同一处，免得两处各写一遍）
export function costTextOf(cost) {
  return Object.keys(cost).map((k) => `${RES_NAME[k] || k} ${cost[k]}`).join(' + ');
}

// 摧毁/拆除共同路径：摩除记录并清掉占格/挡光
export function removeBuilding(state, b) {
  if (b && b.natural) return false;      // 天然结构（天然竖井）不可移除：既防拆也防蚀兽砸掉入口（B37）
  const m = state.map;
  if (b.mounted) {
    // 背着的时候它**没写过**占格/挡光（占格是原位清的、位置每帧跟着玩家跑）——
    // 所以这里绝对不能按 b.x/b.y 去清，否则会把玩家脚下那格别人的占格消掉
    if (state.carried === b) state.carried = null;
    const j = state.buildings.indexOf(b);
    if (j >= 0) state.buildings.splice(j, 1);
    spillStock(state, b, '损毁');
    return true;
  }
  const i = b.y * m.w + b.x;
  m.occWalk[i] = 0;
  if (m.occBuild) m.occBuild[i] = 0;
  m.blockLight[i] = 0;
  const k = state.buildings.indexOf(b);
  if (k >= 0) state.buildings.splice(k, 1);
  // ⚠️ 顺序很要紧：必须**先把它从 buildings 里摘掉，再洒库存**。
  //    否则 deposit 会把它自己当成"最近的容器"又塞回去（它此刻已被清空、看着还有空间），
  //    紧接着建筑消失 —— 东西照样丢，只是丢得更隐蔽。
  spillStock(state, b, '拆卸');
  return true;
}

// 被蚀兽摧毁
export function destroyBuilding(state, b) {
  removeBuilding(state, b);
  sfx('collapse', { x: b.x + 0.5, y: b.y + 0.5 });
  state.floaties.push({ x: b.x + 0.5, y: b.y, txt: '结构损毁', color: '#ffb3a0', t: 0, life: 0.9 });
}
