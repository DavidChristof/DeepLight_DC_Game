// systems/expedition.js —— W18-G1/G2 远征 HUD、返程软引导与前哨准备投影
//
// 这是一个只读的提示层：它不搬运资源、不结算前哨、不改蚀潮预算。
// 正式规则仍由 chunks.js / storage.js / buildings.js 各自负责；这里
// 只把当前区块和玩家手上的准备度翻译成能立即行动的状态。
import { DUSK_START, TIDE_START, TIDE_END, DAY_SECS } from '../core/time.js';
import { BUILD } from '../data/buildings.js';
import { EXPEDITION } from '../data/expedition.js';
import { CARRY } from '../data/combat.js';
import { CAMP_CAP, PACK_CAP } from '../data/storage.js';
import { SURVIVAL } from '../data/survival.js';
import { directiveFromSave } from '../data/tasks.js';

const keyOf = (state) => `${state.chunkX | 0},${state.chunkY | 0}`;
const aliveBeacon = (b) => !!b && (b.hp == null || b.hp > 0);
const stockOf = (ref) => (ref && ref.stock && typeof ref.stock === 'object') ? ref.stock : {};
const nonNegative = (v) => Math.max(0, Number(v) || 0);

export function isAway(state) {
  return !!(state && state.started && state.layerId === 'surface'
    && ((state.chunkX | 0) !== EXPEDITION.HOME_CHUNK.x || (state.chunkY | 0) !== EXPEDITION.HOME_CHUNK.y));
}

function currentChunkOf(state) {
  if (!state || state.layerId !== 'surface') return null;
  return (state.chunkStore && state.chunkStore[keyOf(state)]) || (state.layers && state.layers.surface) || null;
}

// 当前区块的本地容器/光源摘要。数组只属于当前活跃区块，不扫描其它区块。
export function localOutpostOf(state) {
  const chunk = currentChunkOf(state);
  const beacons = chunk ? (chunk.beacons || []) : (state && state.beacons || []);
  const buildings = chunk ? (chunk.buildings || []) : (state && state.buildings || []);
  const containers = [];
  for (const b of beacons) if (aliveBeacon(b)) containers.push({ ref: b, cap: CAMP_CAP, kind: 'camp' });
  for (const b of buildings) {
    const d = b && BUILD[b.type];
    if (d && d.store && !b.site) containers.push({ ref: b, cap: d.store, kind: 'store' });
  }
  const stock = {};
  let used = 0, cap = 0;
  for (const c of containers) {
    cap += c.cap;
    for (const [k, n] of Object.entries(stockOf(c.ref))) {
      const v = nonNegative(n);
      stock[k] = (stock[k] || 0) + v;
      used += v;
    }
  }
  const lights = [];
  for (const b of beacons) if (aliveBeacon(b)) lights.push({ kind: 'camp', power: nonNegative(b.power), active: true });
  for (const b of buildings) {
    const d = b && BUILD[b.type];
    if (!d || !(d.power > 0) || d.decoy || b.site) continue;
    lights.push({ kind: b.type, power: nonNegative(d.power), active: b.fuel > 0 && !b.off });
  }
  const lit = lights.filter((x) => x.active);
  const pack = state && state.pack;
  const packStock = stockOf(pack);
  const lost = state && state.carried ? CARRY.PACK_SLOTS : 0;
  const packCap = Math.max(0, (pack && Number.isFinite(pack.cap) ? pack.cap : PACK_CAP) - lost);
  const packUsed = Object.values(packStock).reduce((sum, n) => sum + nonNegative(n), 0);
  return {
    containers: containers.length,
    used,
    cap,
    free: Math.max(0, cap - used),
    stock,
    hasStore: containers.some((c) => c.kind === 'store'),
    hasLight: lit.length > 0,
    lights: { total: lights.length, lit: lit.length, power: lit.reduce((sum, x) => sum + x.power, 0) },
    food: nonNegative(stock.food),
    fuel: nonNegative(stock.fuel),
    pack: { used: packUsed, cap: packCap, free: Math.max(0, packCap - packUsed), food: nonNegative(packStock.food), fuel: nonNegative(packStock.fuel) },
  };
}

export function returnDirectionOf(state) {
  const dx = EXPEDITION.HOME_CHUNK.x - (state && state.chunkX | 0);
  const dy = EXPEDITION.HOME_CHUNK.y - (state && state.chunkY | 0);
  const out = [];
  if (dx) out.push(dx > 0 ? '东' : '西');
  if (dy) out.push(dy > 0 ? '南' : '北');
  return out;
}

function assignedToHereOf(state) {
  const cx = state.chunkX | 0, cy = state.chunkY | 0;
  const workers = [], seen = new Set();
  const add = (w) => { if (!w || seen.has(w)) return; seen.add(w); workers.push(w); };
  for (const w of state.workers || []) add(w);
  for (const chunk of Object.values(state.chunkStore || {})) for (const w of chunk.workers || []) add(w);
  return workers.some((w) => {
    if (w.alive === false || w.hollow || w.downed) return false;
    const d = directiveFromSave(w.directive);
    return !!(d.outpost && (d.outpost.x | 0) === cx && (d.outpost.y | 0) === cy);
  });
}

// G2 的唯一现场准备投影。面板、HUD 和调试报告都应以当前区块的
// localOutpostOf() 为基础，不复制“箱/灯/补给”的判定。
export function outpostReadinessOf(state) {
  const local = localOutpostOf(state);
  const steps = [
    { id: 'store', label: '储物箱', ok: local.hasStore },
    { id: 'light', label: '人工光', ok: local.hasLight },
    { id: 'food', label: '食物', ok: local.food > 0 },
    { id: 'fuel', label: '燃料', ok: local.fuel > 0 },
  ];
  const readyCount = steps.reduce((n, step) => n + (step.ok ? 1 : 0), 0);
  return { local, steps, readyCount, ready: readyCount === steps.length, assigned: assignedToHereOf(state) };
}

function timePartOf(state) {
  const t = Math.max(0, Number(state && state.t) || 0);
  if (t < DUSK_START) return `黄昏${Math.max(0, Math.ceil(DUSK_START - t))}s`;
  if (t < TIDE_END) return `潮夜${Math.max(0, Math.ceil(TIDE_END - t))}s`;
  return `天亮${Math.max(0, Math.ceil(DAY_SECS - t))}s`;
}

function lowHealthOf(state) {
  const maxHp = Math.max(1, state.playerMaxHp || SURVIVAL.PLAYER.BASE_MAX_HP);
  return state.playerInjury > 0 || state.playerHp <= maxHp * SURVIVAL.PLAYER.INJURY.HEAVY_AT;
}

export function expeditionHud(state) {
  if (!isAway(state)) return null;
  const readiness = outpostReadinessOf(state);
  const local = readiness.local;
  const directions = returnDirectionOf(state);
  const direction = directions.join('·') || '营地';
  const text = `回营 ${direction} · ${timePartOf(state)} · 食${local.food} 燃${local.fuel} · 前哨${readiness.readyCount}/4 · 包${local.pack.free}`;
  const full = local.hasStore && local.free <= 0;
  const warn = state.t >= DUSK_START || !local.hasStore || !local.hasLight || local.food <= 0 || local.fuel <= 0 || full || lowHealthOf(state);
  const title = `回营方向：${direction} · ${timePartOf(state)}\n` +
    `当地：储物箱${local.hasStore ? '✓' : '×'} · 人工光${local.hasLight ? '✓' : '×'} · 食物${local.food} · 燃料${local.fuel}${full ? ' · 仓库已满' : ''}\n` +
    `背包：${local.pack.used}/${local.pack.cap}（余 ${local.pack.free}） · 背包食物${local.pack.food} · 背包燃料${local.pack.fuel}\n` +
    `前哨：${readiness.assigned ? '已派拓荒者' : '尚未派人'}`;
  return { text, title, warn, local, directions, readiness, full };
}

function guideKindsOf(state, local) {
  const out = [];
  if (state.t >= DUSK_START && state.t < TIDE_START) out.push('dusk');
  if (lowHealthOf(state)) out.push('lowHp');
  if (!local.hasStore) out.push('noStore');
  if (!local.hasLight) out.push('noLight');
  if (local.hasStore && local.free <= 0) out.push('noRoom');
  if (local.food <= 0) out.push('noFood');
  if (local.fuel <= 0) out.push('noFuel');
  const readiness = outpostReadinessOf(state);
  if (readiness.ready && !readiness.assigned) out.push('ready');
  return out;
}

// 每个区块一次设施/补给提醒；黄昏按天一次。_expGuideSeen 与冷却都是会话态，
// 不进存档，避免它们污染存档格式或让旧档带着过期提示。
export function tickExpeditionGuide(state, show, dt = 0) {
  if (!isAway(state) || typeof show !== 'function') return false;
  state._expGuideCooldown = Math.max(0, (state._expGuideCooldown || 0) - Math.max(0, Number(dt) || 0));
  if (state._expGuideCooldown > 0) return false;
  const local = localOutpostOf(state);
  state._expGuideSeen ||= {};
  for (const kind of guideKindsOf(state, local)) {
    const suffix = kind === 'dusk' ? `:${state.day | 0}` : '';
    const key = `${keyOf(state)}:${kind}${suffix}`;
    if (state._expGuideSeen[key]) continue;
    state._expGuideSeen[key] = true;
    state._expGuideCooldown = EXPEDITION.GUIDE_COOLDOWN_SEC;
    show(EXPEDITION.GUIDE[kind]);
    return true;
  }
  return false;
}
