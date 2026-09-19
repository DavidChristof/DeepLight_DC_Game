// systems/research.js —— 研究树逻辑：人话原因 / 分区揭开 / 柔性分支成本 / 加成倍率
//
// 设计要点（W12-D）：
//   · researchError() 必须给出**人话原因**（面板直接显示）：缺前置？缺残页？缺观察？还是"这还是个谜"？
//   · req2 是非货币前置：obs（见过/挨过 N 次）/ relic（残页）/ body（身体换来的）/ human（人带来的）/ built / depth
//   · 柔性分支：branchOf 指向的节点已解锁 → 本条成本 ×3（两条都能拿，不做硬互斥）
//   · 知识节点（sect:'know'）只能在【解析台】旁解锁 —— 把"点菜单"变成"要先安好家"
import { RESEARCH } from '../data/research.js';
import { RELIC_SERIES, PARTS_NEED } from '../data/relics.js';
import { withdraw } from './storage.js';
import { seriesGot } from './relics.js';
import { PULSE, TOWER } from '../data/combat.js';   // 战斗乘子的数值唯一数据源（W14-A 第 0 步）
import { SLOT_TECHS, MAX_SLOTS } from '../data/payload.js';   // 载荷槽位的研究表（W14-A 第 2 步）

export function hasTech(state, id) {
  return !!(state.research && state.research.unlocked[id]);
}

// —— 载荷槽位数（W14-A 第 2b/2c 步）——
// 新局 0 槽；依次解锁 SLOT_TECHS 里的节点 → 1/2/3 槽（表在 data/payload.js，此处只读）。
// 【为什么放这里而不是 data/payload.js】判槽要读 hasTech（属 systems），
//   而 data → systems 是反向依赖。数据表在 data，判定放 systems —— 单一来源没变。
export function slotsOf(state) {
  let n = 0;
  for (const id of SLOT_TECHS) if (hasTech(state, id)) n++;
  return Math.min(n, MAX_SLOTS);
}

// —— 实际成本：柔性分支的第二条贵 ×3 ——
export function branchMulOf(state, id) {
  const r = RESEARCH[id];
  if (!r || !r.branchOf) return 1;
  return hasTech(state, r.branchOf) ? (r.branchMul || 3) : 1;
}
export function costOf(state, id) {
  const c = (RESEARCH[id] || {}).cost || {};
  const mul = branchMulOf(state, id);
  const out = {};
  for (const k in c) out[k] = Math.ceil(c[k] * mul);
  return out;
}

// —— 分区揭开：整个分区没揭开时，面板只显示一句线索 ——
export function sectOpen(state, sid) {
  if (sid === 'founder') return true;
  if (sid === 'deep') return !!(state.layers && state.layers.depth1);          // 下过深渊
  if (sid === 'night') return (state.res.night || 0) > 0 || !!state.nightOps;  // 摸过夜髓
  if (sid === 'know') return knowledgeSeen(state);                             // 有过任何线索
  return true;
}

// 观察 / 身体 / 人 三种计数的读取（req2 与"是否见过线索"共用）
export function obsCount(state, kind) {
  if (kind === 'seep') return ((state.observed && state.observed.seep) || 0);
  const e = state.codex && state.codex[kind];
  return e ? (e.kills || 0) : 0;
}
export const bodyCount = (state, kind) => ((state.body && state.body[kind]) || 0);
export const humanCount = (state) => ((state.mind && state.mind.soothed) || 0);

// 这条知识是否"已经露出线索"（决定面板显示名称还是 ？？？）
export function knowSeenId(state, id) {
  const r = RESEARCH[id];
  if (!r || r.sect !== 'know') return true;
  if (hasTech(state, id)) return true;
  for (const q of (r.req2 || [])) {
    if (q.relic) { if (seriesGot(state, q.relic).length > 0) return true; }
    else if (q.obs) { if (obsCount(state, q.obs) > 0) return true; }
    else if (q.body) { if (bodyCount(state, q.body) > 0) return true; }
    else if (q.human) { if (humanCount(state) > 0) return true; }
    else if (q.built || q.depth) return true;
  }
  return false;
}
export function knowledgeSeen(state) {
  if (state.relicTotal > 0) return true;
  if (state.observed && (state.observed.seep || 0) > 0) return true;
  if (state.body && (state.body.lava || 0) > 0) return true;
  if (humanCount(state) > 0) return true;
  for (const id of Object.keys(RESEARCH)) {
    if (RESEARCH[id].sect === 'know' && (hasTech(state, id) || knowSeenId(state, id))) return true;
  }
  return false;
}

// —— req2 的检查与人话 ——
// 返回 null（满足）或一句人话原因
export function req2Text(state, q) {
  if (q.relic) {
    const s = RELIC_SERIES[q.relic];
    const got = seriesGot(state, q.relic).length;
    if (got >= PARTS_NEED) return null;
    return `要集齐残页「${s ? s.name : q.relic}」（现在 ${got}/${PARTS_NEED} 页）${s ? ' —— ' + s.from : ''}`;
  }
  if (q.obs) {
    const n = obsCount(state, q.obs);
    if (n >= (q.n || 1)) return null;
    const what = q.obs === 'seep' ? '被蚀痕渗漏咬过' : `${q.label || '见过'} ${q.obs}`;
    return `${q.text || what} ×${q.n || 1}（现在 ${n}）`;
  }
  if (q.body) {
    const n = bodyCount(state, q.body);
    if (n >= (q.n || 1)) return null;
    return `${q.text || '身体得先吃过亏'} ×${q.n || 1}（现在 ${n}）`;
  }
  if (q.human) {
    const n = humanCount(state);
    if (n >= q.human) return null;
    return `需要安抚过一个蚀化的同伴（现在 ${n}）`;
  }
  if (q.built) {
    if ((state.buildings || []).some((b) => b.type === q.built && !b.site)) return null;
    return `需要先建成「${(state.buildings || []).length >= 0 ? BUILDNAME(q.built) : q.built}」`;
  }
  if (q.depth) {
    if (state.layers && state.layers['depth' + q.depth]) return null;
    return `需要下到第 ${q.depth} 阶深渊`;
  }
  return null;
}
function BUILDNAME(t) {
  const N = { analyzer: '解析台', smelter: '自动熔炉', bench: '制造台', furnace: '熔炉', shaft: '深潜竖井' };
  return N[t] || t;
}

// 「知识类研究要在解析台旁」：玩家挨着解析台即可
export function nearAnalyzer(state, x, y) {
  const px = x == null ? state.player.x : x;
  const py = y == null ? state.player.y : y;
  for (const b of state.buildings || []) {
    if (b.type !== 'analyzer' || b.site) continue;
    if (Math.hypot(b.x + 0.5 - px, b.y + 0.5 - py) <= 2.6) return b;
  }
  return null;
}

// —— 能不能研究：返回 null / 人话原因 ——
export function researchError(state, id) {
  const r = RESEARCH[id];
  if (!r) return '无此研究';
  if (hasTech(state, id)) return '已解锁';
  if (!sectOpen(state, r.sect)) return '这个分区还没揭开';
  if (r.sect === 'know' && !knowSeenId(state, id)) return '还是个谜';
  for (const q of (r.req || [])) {
    if (!hasTech(state, q)) return `需前置：${(RESEARCH[q] || {}).name || q}`;
  }
  for (const q of (r.req2 || [])) {
    const t = req2Text(state, q);
    if (t) return t;
  }
  if (r.sect === 'know' && !nearAnalyzer(state)) return '要把线索带回「解析台」才能解析';
  const c = costOf(state, id);
  if ((state.res.data || 0) < (c.data || 0)) return `档案点数不足（还差 ${Math.ceil((c.data || 0) - (state.res.data || 0))}）`;
  if ((state.res.core || 0) < (c.core || 0)) return `母髓不足（还差 ${(c.core || 0) - (state.res.core || 0)}）`;
  if ((state.res.night || 0) < (c.night || 0)) return `夜髓不足（还差 ${(c.night || 0) - (state.res.night || 0)}）`;
  return null;
}

export function unlockTech(state, id) {
  const err = researchError(state, id);
  if (err) return err;
  const c = costOf(state, id);
  if (Object.keys(c).length) {
    withdraw(state, { data: c.data || 0, core: c.core || 0, night: c.night || 0 }, state.player.x, state.player.y);
  }
  state.research.unlocked[id] = true;
  state.researchVersion = (state.researchVersion || 0) + 1;
  if (id === 'healing') { state.playerMaxHp += 40; state.playerHp += 40; }
  if (id === 'vitality2') { state.playerMaxHp += 60; state.playerHp += 60; }
  state.floaties.push({
    x: state.player.x, y: state.player.y - 1,
    txt: `研究完成：${RESEARCH[id].name}`, color: '#9ef7d8', t: 0, life: 1.6,
  });
  return null;
}

// —— 加成倍率 ——
// 注意：战斗类的**数值**放在 data/combat.js，这里只声明"哪个研究点亮它"
export const miningMul = (s) => (hasTech(s, 'mining') ? 0.625 : 1);       // 采集间隔缩短
export const lampBurnMul = (s) => (hasTech(s, 'lamp') ? 1.55 : 1) * (hasTech(s, 'lampSave2') ? 1.35 : 1);
export const darkMoraleMul = (s) => (hasTech(s, 'nightrun') ? 0.6 : 1);    // 黑暗中的士气流失

export const pulseMul = (s) => (hasTech(s, 'pulse') ? PULSE.MUL_RESEARCH : 1);
export const towerDmgMul = (s) => (hasTech(s, 'tower') ? TOWER.MUL_DMG : 1);
export const lampRadiusMul = (s) => (hasTech(s, 'lamp2') ? 1.3 : 1);      // 光照半径（属光照系统，不在 combat.js）
export const pulseRangeMul = (s) => (hasTech(s, 'pulse2') ? PULSE.MUL_RANGE : 1);     // 光爆范围
export const towerRateMul = (s) => (hasTech(s, 'towerRate') ? TOWER.MUL_RATE : 1);  // 塔射速

// —— W12-D 机制 / 知识加成 ——
export const smeltSpeedMul = (s) => (hasTech(s, 'smeltFast') ? 1.25 : 1) * (hasTech(s, 'relicForging') ? 1.2 : 1);
export const smeltBurnMul = (s) => (hasTech(s, 'smeltThrift') ? 1.25 : 1);   // 火种更耐烧
export const owlDmgMul = (s) => (hasTech(s, 'owlWard') ? TOWER.MUL_OWL : 1);           // 对空伤害
export const seepIntervalMul = (s) => (hasTech(s, 'blightWard') ? 2 : 1);    // 渗漏更少
export const lavaDmgMul = (s) => (hasTech(s, 'heatSkin') ? 0.4 : 1);         // 耐热
export const memoryGain = (s) => (hasTech(s, 'memory') ? 10 : 0);            // 安抚时的全队心志

