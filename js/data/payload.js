// data/payload.js —— 载荷（修饰器）表 + 组合规则 + **唯一的组合数值函数**（W14-A 第 2 步）
//
// 【这个文件是什么】把"塔"拆成两层：**发射器 = 塔的种类**（数值仍在 data/buildings.js，不搬家、不复制）、
//   **修饰器 = 可装配的槽位**（本文件）。玩家通过"给塔装什么"来编程自己的武器。
//
// 【三条纪律】
//   1. **单一来源**：任何要显示或断言的组合数值都只能由 `payloadStats()` 产生 ——
//      面板 / 悬停 / HUD / `__lab()` / `__dps()` 全部走它。谁自己再算一遍就是 bug 的种子（B13 的教训）。
//   2. **不复制发射器数值**：塔的 dmg/cd/range/air/dmgType 只在 data/buildings.js 写一次，
//      这里只**读**（所以本文件不许被 buildings.js 反向 import —— 会成环）。
//   3. **零玩法变化**：0 槽载荷 = 今天的行为（伤害/射程/冷却一字不差，燃耗 0）。
//
// 【与《Noita》的取舍】要组合的「质」，不要组合的「量」：修饰器没有可调参数、没有脚本接口，
//   组合数**可穷举**（见 allLoads/allCombos），因此平衡能算清、界面能读懂、检测器能断言。
import { BUILD, TOWER_LV, TOWER_LV_MAX, lvOf } from './buildings.js';

export const FUEL_PER_MOD = 0.1;   // 每个修饰器 +0.1 燃料/发（塔内部累计小数债务，满 1 才真扣容器）
export const MAX_SLOTS = 3;        // 槽位上限
// 槽位研究（**单一来源**）：新局 0 槽，依次解锁本题里的三个节点 → 1/2/3 槽。
// data/research.js 里必须有这三个节点（且进 RESEARCH_ORDER，面板才看得到）；
// 判槽数的函数在 systems/research.js 的 slotsOf()（那边才有 hasTech）。
export const SLOT_TECHS = ['payload1', 'payload2', 'payload3'];

// 形状类互斥：一个向外摊、一个向前穿 —— 天生长矛盾，最多装一个（面板会拒绝第二个）
export const SHAPE_MODS = ['scatter', 'pierce'];

// —— 修饰器表（5 种）——
// dmg/range 是**乘子**；targets/line/slow/purify 是行为开关。
// 数值门（检测器 payload.bounds 守着）：单个修饰器的 dmg 乘子 ∈ [0.6, 1.6]
//   → 1~3 槽的总乘子 ∈ [0.357, 4.1] → 单靶 DPS 永远落在"基准 ×[0.3, 6]"区间内。
export const MODS = {
  focus: {
    name: '聚焦', dmg: 1.6, range: 0.7,
    desc: '伤害 ×1.6、射程 ×0.7 —— 把光压进一个点',
  },
  scatter: {
    name: '散射', dmg: 0.6, targets: 2, shape: true,
    desc: '主目标 2 格内再加 2 个目标、伤害 ×0.6 —— 打群',
  },
  pierce: {
    name: '穿透', dmg: 0.8, line: 3, shape: true,
    desc: '沿线最多 3 个敌人各吃 ×0.8 —— 打一串',
  },
  chill: {
    name: '迟滞', dmg: 0.85, slow: 0.5, slowT: 1.6,
    desc: '命中减速 50%（1.6 秒）、伤害 ×0.85',
  },
  purify: {
    name: '净化', dmg: 0.7, purify: 1.5,
    desc: '命中处蚀痕 −1 级（半径 1.5 格）、伤害 ×0.7 —— 边打边清地',
  },
};
export const MOD_ORDER = ['focus', 'scatter', 'pierce', 'chill', 'purify'];

// —— 塔（发射器）——从 BUILD 派生：只认"有 dmg 的建筑"，绝不另立一张会分家的表
export const towerTypes = () => Object.keys(BUILD).filter((k) => BUILD[k] && BUILD[k].dmg);
export const isTower = (def) => !!(def && def.dmg);

// 载荷合法性：返回错误说明（合法 → null）。面板/检测器/读档兜底共用这一处判断。
export function loadError(mods, slots = MAX_SLOTS) {
  if (!Array.isArray(mods)) return '载荷不是数组';
  if (mods.length > slots) return `槽位不够（装了 ${mods.length} 个，上限 ${slots}）`;
  const seen = new Set();
  for (const id of mods) {
    if (!MODS[id]) return `未知修饰器「${id}」`;
    if (seen.has(id)) return `重复装了「${MODS[id].name}」`;
    seen.add(id);
  }
  if (mods.filter((id) => MODS[id] && MODS[id].shape).length > 1) return '形状类最多装一个（散射 / 穿透）';
  return null;
}

// 把"可能来自旧档 / 被手改"的载荷洗成合法值：只留表里有的、去重、形状类只留第一个、截到槽数
// 永不抛异常（读档兜底用）；返回被丢弃的件数，上层据此提示玩家一次
export function normalizeMods(mods, slots = MAX_SLOTS) {
  if (!Array.isArray(mods)) return { mods: [], dropped: mods == null ? 0 : 1 };
  const out = [];
  let dropped = 0;
  for (const id of mods) {
    if (!MODS[id]) { dropped++; continue; }
    if (out.includes(id)) { dropped++; continue; }
    if (MODS[id].shape && out.some((x) => MODS[x].shape)) { dropped++; continue; }
    if (out.length >= slots) { dropped++; continue; }
    out.push(id);
  }
  return { mods: out, dropped };
}

// 组合名：修饰器名按表顺序拼 + 塔名（名字也来自表，不许另写一份）
export function loadName(def, mods) {
  const list = (mods || []).filter((m) => MODS[m]);
  if (!list.length) return def.name;
  return `${list.map((m) => MODS[m].name).join('·')} ${def.name}`;
}

// —— **唯一的组合数值函数** ——
// def = 塔的定义（dmg/cd/range/air/dmgType/aoe/slow…）；mods = 载荷（可缺省 = 空载）；level = 塔的等级（1~3）
// 【为什么等级也走这里】第 6 步的“就地升级”改的就是单发/射程 —— 如果它自己再算一遍，
//   面板/悬停/开火 三处就会出现两个数字（B13 的老毛病）。所以等级也是本函数的入参，乘子在 data/buildings.js 的 TOWER_LV。
// 【为什么顺序无关】所有修饰器都是**乘法**作用于同一发（dmg ×Π、range ×Π），
//   乘法交换 → 面板不强调顺序；行为开关（散射/穿透/迟滞/净化）互相独立或互斥。
export function payloadStats(def, mods = [], level = 1) {
  const list = (Array.isArray(mods) ? mods : []).filter((m) => MODS[m]);
  const lv = lvOf(level);
  let dmg = (def.dmg || 0) * lv.dmg, range = (def.range || 0) * lv.range, targets = 1, line = 0;
  let slow = def.slow || 0, slowT = def.slowT || 0, purify = 0;
  for (const id of list) {
    const m = MODS[id];
    dmg *= m.dmg == null ? 1 : m.dmg;
    range *= m.range == null ? 1 : m.range;
    if (m.targets) targets += m.targets;
    if (m.line) line = Math.max(line, m.line);
    if (m.slow) { slow = Math.max(slow, m.slow); slowT = Math.max(slowT, m.slowT || 0); }
    if (m.purify) purify = Math.max(purify, m.purify);
  }
  const cd = def.cd > 0 ? def.cd : 0;
  const dps = cd > 0 ? dmg / cd : 0;
  const 命中上限 = line > 1 ? line : targets;          // 同一发最多能打到几个（打群/打串二选一）
  // 形状必须**单独**报出来：连锁（2e）也会增加"这一发打到几个"，但它不是形状 ——
  //   塔的开火逻辑按 `形状` 决定要不要找环/线目标；若拿 `命中上限>1` 当开关，连锁塔会被当成散射而**双重命中**。
  const 形状 = line > 1 ? 'line' : (targets > 1 ? 'targets' : null);
  // 连锁（发射器自带，2e）：光弧从主目标继续跳向最近的敌人，每跳衰减一次
  const cch = def.chain || null;
  let 链倍率 = 1;                                       // 含主目标的潜在总倍率（有足够多敌人时）
  if (cch) { let m = 1; for (let k = 0; k < cch.max; k++) { m *= cch.mul; 链倍率 += m; } }
  return {
    name: loadName(def, list),
    tower: def.name,
    mods: list.slice(),
    等级: Math.min(TOWER_LV_MAX, Math.max(1, level | 0)),
    等级上限: TOWER_LV_MAX,
    单发: +dmg.toFixed(3),
    每秒: +dps.toFixed(3),
    多靶每秒: +(dps * (命中上限 + (cch ? 链倍率 - 1 : 0))).toFixed(3),
    cd,
    射程: +range.toFixed(3),
    目标数: targets,          // 散射：主目标 + targets-1
    线: line,                 // 穿透：沿射线最多 line 个
    命中上限,
    形状,                     // null | 'targets'（散射）| 'line'（穿透）——开火逻辑的唯一开关
    链: cch ? { 跳: cch.jump, 最多: cch.max, 每跳: cch.mul, 倍率: +链倍率.toFixed(3) } : null,
    每发燃耗: +(list.length * FUEL_PER_MOD).toFixed(3),
    燃耗每秒: +(cd > 0 ? (list.length * FUEL_PER_MOD) / cd : 0).toFixed(3),
    类型: def.dmgType || 'general',
    减速: slow ? { mul: slow, secs: slowT } : null,
    净化半径: purify || 0,
    冲突: loadError(list),
  };
}

// —— 组合空间（可穷举）——
// allLoads：0~slots 槽的全部**合法**载荷（升序取下标 → 天然去重、顺序无关）
export function allLoads(slots = MAX_SLOTS) {
  const out = [[]];
  const walk = (cur, start) => {
    for (let i = start; i < MOD_ORDER.length; i++) {
      const next = cur.concat(MOD_ORDER[i]);
      if (next.length > slots) continue;
      if (loadError(next, slots)) continue;
      out.push(next);
      walk(next, i + 1);
    }
  };
  walk([], 0);
  return out;
}

// allCombos：载荷 × 塔 = 全部组合（每项带 stats）—— 检测器与 __lab() 用它
export function allCombos(slots = MAX_SLOTS, level = 1) {
  const out = [];
  for (const t of towerTypes()) {
    for (const mods of allLoads(slots)) out.push({ type: t, def: BUILD[t], mods, stats: payloadStats(BUILD[t], mods, level) });
  }
  return out;
}

// 载荷的"每槽乘子"区间（数值门的来源；改表时先看这里，再看检测器）
export function dmgMulRange(slots = MAX_SLOTS) {
  const per = MOD_ORDER.map((m) => MODS[m].dmg);
  const lo = per.reduce((a, b) => Math.min(a, b), 1), hi = per.reduce((a, b) => Math.max(a, b), 1);
  return { per: [lo, hi], total: [Math.pow(lo, slots), Math.pow(hi, slots)] };
}

// 等级乘子区间（第 6 步）：数值门要用"满级 × 满槽"一起算，否则会漏掉“满级三槽”这个最坏情形
export function lvMulRange() {
  const d = TOWER_LV.map((x) => x.dmg), r = TOWER_LV.map((x) => x.range);
  return { dmg: [Math.min(...d), Math.max(...d)], range: [Math.min(...r), Math.max(...r)] };
}