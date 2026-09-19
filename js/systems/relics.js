// systems/relics.js —— 残页的收集与"集齐即解锁"（知识锁最考古的一条路）
//
// 规则：
//   · 采「遗迹碑」时夹带一页残页：**每座碑只掉一次**，掉哪一页是**确定性**的（seed + 坐标）
//   · 集齐一个系列 → 直接解锁 RELIC_SERIES[sid].research 指向的知识节点（不花点数）
//   · 残页是计数器，不是货币（不能买、不能卖、不掉在地上）
import { RELIC_SERIES, SERIES_ORDER, PARTS_NEED, partName } from '../data/relics.js';
import { sfx } from '../core/audio.js';

export function ensureRelics(state) {
  if (!state.relics) state.relics = {};          // { seriesId: [idx, ...] }
  if (!state.relicTiles) state.relicTiles = {};  // { "x,y": 1 } 已经掉过残页的碑
  return state.relics;
}
export const seriesGot = (state, sid) => (ensureRelics(state)[sid] || []).slice();
export const seriesFull = (state, sid) => seriesGot(state, sid).length >= PARTS_NEED;
export function relicTotal(state) {
  const r = ensureRelics(state);
  let n = 0;
  for (const s of SERIES_ORDER) n += (r[s] || []).length;
  return n;
}

// 确定性散列：同一局里同一座碑永远掉同一页（让每局都有一条走得通的路）
function hashIdx(state, x, y, n, salt) {
  let h = (state.seed | 0) ^ Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % Math.max(1, n);
}

// 收下一张残页（collect 也供调试 / 学者产出用）
export function grantRelic(state, sid, idx) {
  const def = RELIC_SERIES[sid];
  if (!def || idx < 0 || idx >= def.parts.length) return null;
  const got = ensureRelics(state);
  const list = got[sid] || (got[sid] = []);
  if (list.includes(idx)) return null;
  list.push(idx);
  state.relicTotal = relicTotal(state);
  state.floaties.push({
    x: state.player.x, y: state.player.y - 1.0,
    txt: `残页：${partName(sid, idx)}`, color: '#e0c9ff', t: 0, life: 2.2,
  });
  const full = list.length >= def.parts.length;
  sfx(full ? 'relic' : 'pick', {});
  if (full) {
    state.banner = {
      title: `残页集齐：${def.name}`,
      sub: `你读懂了他留下的东西（知识「${def.research === 'relicForging' ? '熔渊锻造' : def.research}」已可解析）`,
      t: 0, life: 5.5,
    };
  }
  state.relicVersion = (state.relicVersion || 0) + 1;
  state._panelSig = null;
  return { sid, idx, full };
}

// 采碑时调用：这座碑还没掉过 → 掉一张「这个系列还缺的」页
export function dropRelic(state, x, y) {
  const got = ensureRelics(state);
  const key = `${x},${y}`;
  if (state.relicTiles[key]) return null;
  const open = SERIES_ORDER.filter((s) => (got[s] || []).length < RELIC_SERIES[s].parts.length);
  if (!open.length) return null;
  const sid = open[hashIdx(state, x, y, open.length, 3)];
  const have = got[sid] || [];
  const missing = RELIC_SERIES[sid].parts.map((_, i) => i).filter((i) => !have.includes(i));
  if (!missing.length) return null;
  const idx = missing[hashIdx(state, x, y, missing.length, 7)];
  state.relicTiles[key] = 1;
  return grantRelic(state, sid, idx);
}

// 面板用：各系列的进度与"线索来源"
export function relicRows(state) {
  return SERIES_ORDER.map((sid) => {
    const def = RELIC_SERIES[sid];
    const have = seriesGot(state, sid);
    return {
      id: sid, name: def.name, from: def.from, desc: def.desc,
      have, need: def.parts.length, full: have.length >= def.parts.length,
      missing: def.parts.map((p, i) => (have.includes(i) ? null : p)).filter(Boolean),
    };
  });
}
