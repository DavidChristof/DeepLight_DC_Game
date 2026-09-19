// systems/tools.js —— 工具：装备 / 卸下 / 效果 / 拓荒者自动领用
//
// 关键约定：**工具是真物品**（存在容器的 stock 里，占格子）。
//   · 玩家装备 = 从容器里 withdrawOne 出来拿在手上（所以它不再计入仓库，也不会随层带走）
//   · 玩家卸下 / 阵亡 = deposit 回最近的容器
//   · 拓荒者领用同一套：从最近的容器拿，死后归还 —— 「仓库里还有几把镐」是真的要管的
import { TOOLS, toolDef, isTool } from '../data/tools.js';
import { withdrawOne, deposit } from './storage.js';
import { hasTech } from './research.js';

export const heldTool = (state) => (state.equip && state.equip.held) || null;
export const heldDef = (state) => toolDef(heldTool(state));

// —— 效果 ——
// 挖矿时间倍率（综合研究加成由 interact.js 叠乘）
// 徒手凿岩壁：慢 HAND_ROCK_MUL 倍（镐子才是“提速”工具，不是门槛）
export const HAND_ROCK_MUL = 2.2;
export function mineTimeMul(state, res) {
  const d = heldDef(state);
  if (!d) return res === 'stone' ? HAND_ROCK_MUL : 1;
  if (res === 'vine') return d.vineBonus ? (d.mineMul || 1) : 1;
  return d.mineMul || 1;
}
// 岩壁开凿：**只需研究「石工」**——徒手也能凿（慢），手持石镐快 40%。
// 【为什么不是“必须持镐”】岩壁是石头**唯一**的来源，而制造台（石头2）/石镐（石头3）/自动熔炉/解析台都要石头
//   → 一旦手里没有镐（开局的镐被工人拿走、或丢在另一层），就变成
//   “没石头→造不出镐→挖不动岩壁→没石头”的**真死循环**。
//   镐子自己的说明写的就是「开挖岩壁（需研究石工）；挖矿速度快 40%」——是提速件。代码以前把它写成了门槛。
export function canMineRock(state) {
  return hasTech(state, 'stonework');
}
export const vineBonus = (state) => (heldDef(state) || {}).vineBonus || 0;
export const harvestBonus = (state) => (heldDef(state) || {}).harvestBonus || 0;
export const buildMul = (state) => (heldDef(state) || {}).buildMul || 1;
// 拓荒者的施工加成（锤子）
export const workerBuildMul = (w) => (w && w.tool === 'hammer' ? TOOLS.hammer.workerBuild : 1);
// 拓荒者的采集加成：拿镐挖矿更快，拿斧伐木更快
export function workerMineMul(w, res) {
  if (!w || !w.tool) return 1;
  const d = TOOLS[w.tool];
  if (!d) return 1;
  if (res === 'vine') return d.vineBonus ? 1.4 : 1;
  if (res === 'stone') return w.tool === 'pick' ? 1.4 : 1;
  return d.mineMul ? 1.35 : 1;
}

// —— 玩家装备 ——
export function equipTool(state, k) {
  if (!isTool(k)) return '不是工具';
  if (heldTool(state)) return '先卸下手上的工具';
  if ((state.res[k] || 0) < 1) return '仓库里没有这件工具';
  withdrawOne(state, k, 1, state.player.x, state.player.y);
  state.equip.held = k;
  state._sidebarSig = null;
  state.floaties.push({ x: state.player.x, y: state.player.y - 0.6, txt: `装备 ${TOOLS[k].name}`, color: '#eafcff', t: 0, life: 1.1 });
  return null;
}

export function unequipTool(state) {
  const k = heldTool(state);
  if (!k) return '手上没有工具';
  const left = deposit(state, k, 1, state.player.x, state.player.y);
  if (left <= 0) {                      // 全都进不去容器 → 别丢了，先留在手上
    state.storeWarnT = 4;
    state.storeWarnTxt = `存储已满：${TOOLS[k].name} 卸不下来 —— 先在本层清出一格`;
    return '本层容器已满';
  }
  state.equip.held = null;
  state._sidebarSig = null;
  state.floaties.push({ x: state.player.x, y: state.player.y - 0.6, txt: `收好 ${TOOLS[k].name}`, color: '#aebdd0', t: 0, life: 1.1 });
  return null;
}

// —— 拓荒者：自动领用 / 归还 ——
// 想要什么：施工偏好锤子，其余优先镐（能挖石头）→ 斧 → 镰
function wanted(state, w) {
  const prefer = w.job === 'build' ? ['hammer', 'pick', 'axe', 'sickle'] : ['pick', 'axe', 'hammer', 'sickle'];
  for (const k of prefer) if ((state.res[k] || 0) > 0) return k;
  return null;
}

// 每帧调用：没工具的拓荒者会自己去最近的容器里拿一把（同一把不会被两个人用）
export function updateWorkerTools(state, dt) {
  for (const w of state.workers || []) {
    if (!w.alive || w.downed || w.rescueState === 'escort') continue;
    if (w.tool) { w.toolT = 0; continue; }
    w.toolT = (w.toolT || 0) + dt;
    if (w.toolT < 2.5) continue;              // 每 2.5 秒看一次，别每帧扫库存
    w.toolT = 0;
    if (w.hollow) continue;
    const k = wanted(state, w);
    if (!k) continue;
    withdrawOne(state, k, 1, w.x, w.y);
    w.tool = k;
    state.floaties.push({ x: w.x, y: w.y - 0.6, txt: `${w.name} 拿起${TOOLS[k].name}`, color: '#dfe9ff', t: 0, life: 1.2 });
    state._sidebarSig = null;
  }
}

// 归还（阵亡 / 蚀化离队时）
export function returnWorkerTool(state, w) {
  if (!w.tool) return;
  deposit(state, w.tool, 1, w.x, w.y);
  w.tool = null;
}
