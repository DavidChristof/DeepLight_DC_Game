// systems/layer.js —— 多层世界（地表 / 深潜层 I / 深潜层 II …）
// 做法：每层各持一份 {map, discovered, buildings, beacons, enemies}，
// state 上的同名字段始终"指向当前层"，切换 = 重新指向（引用共享，无需拷贝）。
import { genDepth } from '../world/gen.js';
import { Enemy } from '../entities/enemy.js';
import { LAYER_ORDER, LAYER_NAMES, LAYER_META } from '../data/layers.js';
import { hasTech } from './research.js';

export const layerIndex = (state) => Math.max(0, LAYER_ORDER.indexOf(state.layerId));
export const layerName = (state) => LAYER_NAMES[state.layerId] || state.layerId;

// 把当前层的（可能被重新赋值过的）引用写回层容器
export function stashLayer(state) {
  const L = state.layers && state.layers[state.layerId];
  if (!L) return;
  L.map = state.map;
  L.discovered = state.discovered;
  L.buildings = state.buildings;
  L.beacons = state.beacons;
  L.enemies = state.enemies;
}

// 让 state 的字段指向目标层
export function bindLayer(state, id) {
  const L = state.layers[id];
  if (!L) return;
  // 第 5 步 5b：背在背上的结构体**跟着人换层**（它已经不在任何一层的“地上”了）
  //   —— 这是它最大的价值：把塔带进深潜层。所以要在换层这一刻把它从旧层的列表里搬到新层。
  const car = state.carried;
  if (car) {
    const old = state.buildings;
    const k = old ? old.indexOf(car) : -1;
    if (k >= 0) old.splice(k, 1);
  }
  state.layerId = id;
  state.map = L.map;
  state.discovered = L.discovered;
  state.buildings = L.buildings;
  state.beacons = L.beacons;
  state.enemies = L.enemies;
  if (car && state.buildings.indexOf(car) < 0) state.buildings.push(car);
}

// 懒生成某一深潜层（种子派生，保证同存档地貌稳定）
export function ensureLayer(state, id) {
  if (state.layers[id]) return state.layers[id];
  const idx = LAYER_ORDER.indexOf(id);
  const meta = LAYER_META[id] || LAYER_META.depth1;
  const seed = ((state.seed ^ (0x9e3779b9 * idx)) >>> 0);
  const map = genDepth(meta.w, meta.h, seed, idx);
  const L = {
    id, index: idx, map,
    discovered: new Uint8Array(meta.w * meta.h),
    buildings: [], beacons: [], enemies: [],
    returnPoint: null,               // 回到上一层时的落点（竖井位置）
  };
  const cx = (meta.w / 2) | 0, cy = (meta.h / 2) | 0;
  L.spawn = { x: cx + 1.5, y: cy + 0.5 };
  const i = cy * meta.w + cx;
  map.occBuild[i] = 1;                    // 井口：有建筑但不挡人（可站在竖井上按 E）
  L.buildings.push({ type: 'shaft', x: cx, y: cy, hp: 140, fuel: 0, burnT: 0, cd: 0, entry: true });

  // 常驻守卫：越深越凶（母脉层出现畏光盲蚀兽；熔渊之心有夜枭与盲兽）
  //   W14-A 第 3 步：深层也带上新行为（深渊本来就该比地表难）—— 冲锋/自爆/吐蚀/光环
  const kinds = idx >= 3
    ? ['blind', 'blind', 'owl', 'shell', 'bomber', 'charger']
    : idx >= 2
      ? ['blind', 'blind', 'shell', 'moth', 'spitter', 'charger']
      : ['bud', 'shell', 'moth', 'spitter'];
  for (let k = 0; k < meta.guards; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * Math.min(meta.w, meta.h) * 0.35;
    const tx = Math.round(cx + Math.cos(a) * r), ty = Math.round(cy + Math.sin(a) * r);
    if (tx > 1 && ty > 1 && tx < meta.w - 1 && ty < meta.h - 1
      && map.isWalk(tx, ty) && !map.occBuild[ty * meta.w + tx]) {
      L.enemies.push(new Enemy(kinds[k % kinds.length], tx + 0.5, ty + 0.5));
    }
  }
  state.layers[id] = L;
  state.floaties.push({
    x: state.player.x, y: state.player.y - 1,
    txt: `发现 ${LAYER_NAMES[id]}`, color: '#7fe0ff', t: 0, life: 1.6,
  });
  if (meta.ruleText) {                       // W11：进层时告诉玩家这一层的法则
    state.floaties.push({
      x: state.player.x, y: state.player.y - 1.8,
      txt: meta.ruleText, color: '#ffd76e', t: 0, life: 3.2,
    });
  }
  return L;
}

// 使用竖井：入口井 = 上升；自建井 = 下降
export function useShaft(state, shaft) {
  const idx = layerIndex(state);

  if (shaft && shaft.entry) {                 // —— 上升 ——
    if (idx <= 0) return '已在地表';
    const prev = LAYER_ORDER[idx - 1];
    const rp = state.layers[state.layerId].returnPoint;
    stashLayer(state);
    bindLayer(state, prev);
    state.player.x = rp ? rp.x + 0.5 : state.map.w / 2 + 0.5;
    state.player.y = rp ? rp.y + 1.5 : state.map.h / 2 + 0.5;
    state.player.clearPath(); state.dest = null;
    state.camera.x = state.player.x; state.camera.y = state.player.y;
    state.floaties.push({ x: state.player.x, y: state.player.y - 1, txt: `回到 ${layerName(state)}`, color: '#cfe6ff', t: 0, life: 1.2 });
    return null;
  }

  // —— 下降 ——
  const next = LAYER_ORDER[idx + 1];
  if (!next) return '已是最深处';
  // 天然竖井（地表那口）：它就是"深渊本来就开着"的体现 —— 第一潜不需要研究。
  // 【为什么必须这样】「深潜学」属于深潜分区，而分区开启条件是"已经下过一次深渊"；
  //   如果首潜也要研究，就是死循环（B37：新局永远下不去，深渊内容全不可达）。
  const firstDive = shaft && shaft.natural;
  if (idx === 0 && !hasTech(state, 'deep') && !firstDive) return '需研究「深潜学」';
  if (idx >= 1 && !hasTech(state, 'deeper')) return '需研究「深层深潜」';
  const L = ensureLayer(state, next);
  L.returnPoint = { x: shaft.x, y: shaft.y };  // 记下回来的位置
  stashLayer(state);
  bindLayer(state, next);
  state.player.x = L.spawn.x; state.player.y = L.spawn.y;
  state.player.clearPath(); state.dest = null;
  state.camera.x = state.player.x; state.camera.y = state.player.y;
  state.floaties.push({ x: state.player.x, y: state.player.y - 1, txt: `下潜至 ${layerName(state)}…`, color: '#7fe0ff', t: 0, life: 1.4 });
  return null;
}
