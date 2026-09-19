// world/chunks.js —— 地表区块的确定性载入与切换（W15-B S08）
import { genMap } from './gen.js';
import { ensureNightOps } from '../systems/nightops.js';
import { isTide } from '../core/time.js';
import { BUILD } from '../data/buildings.js';
import { SURVIVAL } from '../data/survival.js';
import { biomeOf, ECOLOGY } from '../data/ecology.js';
import { directiveFromSave, DIRECTIVES, makeTask } from '../data/tasks.js';
import { depositToChunk, withdrawFromChunk, syncRes } from '../systems/storage.js';
import { seedBlightFrontInChunk } from '../systems/blight.js';
import { T } from './map.js';
import { STARVE } from '../data/traits.js';
import { downWorker } from '../entities/worker.js';

const W = SURVIVAL.CHUNK.WIDTH, H = SURVIVAL.CHUNK.HEIGHT;
const keyOf = (x, y) => `${x},${y}`;
function seedOf(seed, cx, cy) {
  const h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((cx | 0) + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul((cy | 0) + 0x165667b1, 0x27d4eb2f);
  return (h ^ (h >>> 16)) >>> 0;
}

function carveExit(m) {
  const mx = m.w / 2 | 0, my = m.h / 2 | 0;
  const edge = Math.max(2, SURVIVAL.CHUNK.EXIT_CORRIDOR | 0);
  for (let d = -3; d <= 3; d++) {
    for (let x = 0; x < edge; x++) { const y = my + d; m.set(x, y, 0); m.nodeAmt[y * m.w + x] = 0; }
    for (let x = m.w - edge; x < m.w; x++) { const y = my + d; m.set(x, y, 0); m.nodeAmt[y * m.w + x] = 0; }
    for (let y = 0; y < edge; y++) { const x = mx + d; m.set(x, y, 0); m.nodeAmt[y * m.w + x] = 0; }
    for (let y = m.h - edge; y < m.h; y++) { const x = mx + d; m.set(x, y, 0); m.nodeAmt[y * m.w + x] = 0; }
  }
}

export function ensureSurfaceChunk(state, cx = 0, cy = 0) {
  state.chunkStore ||= {};
  const key = keyOf(cx, cy);
  if (state.chunkStore[key]) {
    // 旧存档可能带着边界岩壁或过窄出口；载入时补齐通道，保证往返规则一致。
    carveExit(state.chunkStore[key].map);
    return state.chunkStore[key];
  }
  const biome = biomeOf(cx, cy);
  const map = genMap(W, H, seedOf(state.seed, cx, cy), biome.id);
  carveExit(map);
  const chunk = { id: key, cx, cy, biome: biome.id, map, discovered: new Uint8Array(W * H), buildings: [], beacons: [], enemies: [], workers: [], nightops: null, outpost: null, modified: false };
  ensureNightOps(chunk, seedOf(state.seed ^ 0x51ed270b, cx, cy));
  state.chunkStore[key] = chunk;
  return chunk;
}

function ensureOutpostState(chunk) {
  if (!chunk) return null;
  const o = chunk.outpost && typeof chunk.outpost === 'object' ? chunk.outpost : {};
  o.nextT = Number.isFinite(o.nextT) ? Math.max(0, Math.min(ECOLOGY.OUTPOST_SETTLE_SEC, o.nextT)) : ECOLOGY.OUTPOST_SETTLE_SEC;
  o.ticks = Number.isFinite(o.ticks) ? Math.max(0, o.ticks | 0) : 0;
  o.lastYield = o.lastYield && typeof o.lastYield === 'object' ? { ...o.lastYield } : {};
  o.lastNeeds = o.lastNeeds && typeof o.lastNeeds === 'object' ? { ...o.lastNeeds } : {};
  o.lightPressure = Number.isFinite(o.lightPressure) ? Math.max(0, o.lightPressure) : 0;
  o.frontDebt = Number.isFinite(o.frontDebt) ? Math.max(0, Math.min(ECOLOGY.OUTPOST_FRONT_DEBT_MAX, o.frontDebt | 0)) : 0;
  o.lastEcology = o.lastEcology && typeof o.lastEcology === 'object' ? { ...o.lastEcology } : {};
  o.alerts = Array.isArray(o.alerts) ? o.alerts.slice(-ECOLOGY.OUTPOST_MAX_ALERTS).map((a) => ({
    id: String(a && a.id || ''), kind: String(a && a.kind || 'eco'), day: Math.max(1, a && a.day | 0),
    t: Number.isFinite(a && a.t) ? +a.t : 0, workerId: a && a.workerId ? String(a.workerId) : null,
    workerName: a && a.workerName ? String(a.workerName) : '', message: String(a && a.message || ''), status: a && a.status === 'resolved' ? 'resolved' : 'open',
    // N6b-2e 迁移：旧告警没有待救援字段时，只把仍未处理且带稳定成员 ID 的蚀痕告警视作待兑现。
    rescuePending: typeof (a && a.rescuePending) === 'boolean' ? a.rescuePending : !!(a && a.status !== 'resolved' && a.kind === 'blight' && a.workerId),
  })) : [];
  o.lastReason = typeof o.lastReason === 'string' ? o.lastReason : '等待有人驻守';
  chunk.outpost = o;
  return o;
}

export function bindSurfaceChunk(state, chunk) {
  const old = state.layers && state.layers.surface;
  if (old && old !== chunk) {
    old.map = state.map; old.discovered = state.discovered; old.buildings = state.buildings;
    old.beacons = state.beacons; old.enemies = state.enemies; old.workers = state.workers || [];
    for (const w of old.workers) { w.chunkX = old.cx || 0; w.chunkY = old.cy || 0; }
  }
  state.chunkStore[chunk.id] = chunk;
  state.layers.surface = chunk;
  state.map = chunk.map; state.discovered = chunk.discovered; state.buildings = chunk.buildings;
  state.beacons = chunk.beacons; state.enemies = chunk.enemies; state.workers = chunk.workers || [];
  state.chunkX = chunk.cx; state.chunkY = chunk.cy;
  state.light = null; state._chunkTransition = (state._chunkTransition || 0) + 1;
  // 区块各自持有建筑/篝火容器；切换后必须立刻重算全局账本，避免回到旧区块时 res 仍停留在新区块的快照。
  syncRes(state);
  activatePendingOutpostRescue(state, chunk);
}

// N6b-2e：告警兑现只发生在玩家真正进入目标区块后。这里不创建新的救援会话，
// 只把一个待处理告警交给既有 downWorker()；下一次 updateWorkers() 会按原规则
// 选择 NPC 或等待玩家按 E。每次切区块最多兑现一条，避免多条历史告警叠加倒地。
function activatePendingOutpostRescue(state, chunk) {
  if (!state || !chunk || state.layerId !== 'surface' || !Array.isArray(chunk.workers)) return;
  const o = ensureOutpostState(chunk);
  const alert = o.alerts.find((a) => a.status === 'open' && a.rescuePending);
  if (!alert) return;
  const worker = chunk.workers.find((w) => w && w.alive && !w.downed && (!alert.workerId || (w.crew && w.crew.id === alert.workerId)));
  if (!worker) return;
  alert.rescuePending = false;
  alert.status = 'resolved';
  downWorker(state, worker);
  state.floaties.push({ x: worker.x, y: worker.y - 0.85, txt: '远端告警兑现 · 需要救援', color: '#ffcf8a', t: 0, life: 1.8 });
  state._sidebarSig = null;
}

export function artificialLightPresent(state) {
  if ((state.beacons || []).length) return true;
  if ((state.buildings || []).some((b) => { const d = b && BUILD[b.type]; return d && d.power && b.fuel > 0 && !b.off; })) return true;
  return !!(state.player && state.player.lamp && state.player.lamp.power > 0);
}

export function chunkActive(state) {
  const p = state.player;
  if (p && state.chunkX === (p.chunkX ?? state.chunkX) && state.chunkY === (p.chunkY ?? state.chunkY)) return true;
  return (state.workers || []).some((w) => w.alive && !w.hollow);
}

// 活跃区块调度：玩家所在区块优先，最多再保留两个有拓荒者的前哨。
export function activeSurfaceChunks(state) {
  const all = Object.values(state.chunkStore || {});
  const out = [];
  const here = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
  if (here) out.push(here);
  for (const c of all) {
    if (out.includes(c)) continue;
    if ((c.workers || []).some((w) => w.alive && !w.hollow)) out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

function surfaceWorkers(state) {
  const out = [], seen = new Set();
  const add = (w) => { if (!w || seen.has(w)) return; seen.add(w); out.push(w); };
  for (const w of state.workers || []) add(w);
  for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) add(w);
  return out;
}

function residentChunkKeys(state, ignore = null) {
  const keys = new Set([`${state.chunkX || 0},${state.chunkY || 0}`]);
  for (const c of Object.values(state.chunkStore || {})) {
    if ((c.workers || []).some((w) => w && w !== ignore && w.alive && !w.hollow)) keys.add(c.id || keyOf(c.cx, c.cy));
  }
  return keys;
}

function outpostTargetKey(d) { return d && d.outpost ? keyOf(d.outpost.x, d.outpost.y) : null; }

function travelMatches(w, target) {
  const tr = w && w.outpostTravel;
  return !!(tr && tr.to && tr.to.x === target.x && tr.to.y === target.y);
}

function clearTravel(w, reason = null) {
  if (!w) return;
  w.outpostTravel = null;
  w.path = [];
  w.target = null; w.crop = null; w.site = null; w.furnace = null; w.smelter = null;
  if (reason) w.task = makeTask('idle', null, 'idle', reason, w.crew && w.crew.id ? w.crew.id : w.name || '');
}

function arriveAtOutpost(state, w, target, source) {
  const chunk = ensureSurfaceChunk(state, target.x, target.y);
  const sx = source ? source.cx : target.x;
  const sy = source ? source.cy : target.y;
  const dx = target.x - sx, dy = target.y - sy;
  const inset = SURVIVAL.CHUNK.EXIT_SPAWN_INSET;
  let x = chunk.map.w / 2 + 0.5, y = chunk.map.h / 2 + 0.5;
  if (dx > 0) x = inset; else if (dx < 0) x = chunk.map.w - inset;
  else if (dy > 0) y = inset; else if (dy < 0) y = chunk.map.h - inset;
  // 同一入口可能已有建筑/实体；在出口走廊的有限邻域内找一个可站格，不做全图搜索。
  const candidates = [[x, y], [x, y - 2], [x, y + 2], [x, y - 1], [x, y + 1], [x + (dx ? 0 : 2), y], [x - (dx ? 0 : 2), y]];
  const ok = (px, py) => {
    const tx = Math.max(1, Math.min(chunk.map.w - 2, Math.floor(px)));
    const ty = Math.max(1, Math.min(chunk.map.h - 2, Math.floor(py)));
    return chunk.map.isWalk(tx, ty) && !(chunk.map.occBuild && chunk.map.occBuild[ty * chunk.map.w + tx]);
  };
  const spot = candidates.find(([px, py]) => ok(px, py)) || [x, y];
  const fromList = source && source.workers;
  if (fromList) {
    const i = fromList.indexOf(w);
    if (i >= 0) fromList.splice(i, 1);
  }
  if (!chunk.workers.includes(w)) chunk.workers.push(w);
  w.chunkX = target.x; w.chunkY = target.y;
  w.x = spot[0]; w.y = spot[1];
  w.layerId = 'surface';
  clearTravel(w, '已抵达前哨，等待下一次工作决策');
  // 当前区块的 state.workers 与 chunk.workers 是同一引用；这里只需确保旧区块移除后不留孤儿引用。
  if (state.chunkX === target.x && state.chunkY === target.y) state.workers = chunk.workers;
  if (state.chunkX === (source && source.cx) && state.chunkY === (source && source.cy)) state.workers = source.workers;
  if (state.chunkX === target.x && state.chunkY === target.y) state.floaties.push({ x: spot[0], y: spot[1] - 0.7, txt: `${w.name} 抵达前哨`, color: '#7fe0ff', t: 0, life: 1.6 });
}

// N6b：跨区迁移只推进计时与区块归属，不跑离屏寻路；目标区块有人后才成为活跃前哨。
// 这是一条事件驱动的低成本边界；远端生产与光压脉冲另在结算入口处理。
export function updateOutpostTravel(state, dt) {
  if (!state || state.layerId !== 'surface' || !state.chunkStore) return;
  for (const w of surfaceWorkers(state)) {
    if (!w || !w.alive) continue;
    const d = directiveFromSave(w.directive);
    w.directive = d;
    const target = d.outpost;
    const here = { x: w.chunkX | 0, y: w.chunkY | 0 };
    if (!target || w.hollow || w.downed) { if (w.outpostTravel) clearTravel(w, '前哨迁移已暂停'); continue; }
    if (here.x === target.x && here.y === target.y) { if (w.outpostTravel) clearTravel(w, '已抵达前哨，等待下一次工作决策'); continue; }
    const source = ensureSurfaceChunk(state, here.x, here.y);
    const targetKey = outpostTargetKey(d);
    const active = residentChunkKeys(state, w);
    const blocked = !active.has(targetKey) && active.size >= ECOLOGY.MAX_ACTIVE_OUTPOSTS;
    if (!travelMatches(w, target)) {
      w.outpostTravel = { from: { x: here.x, y: here.y }, to: { x: target.x, y: target.y }, t: ECOLOGY.OUTPOST_TRAVEL_SEC, blocked };
    } else {
      w.outpostTravel.blocked = blocked;
    }
    if (w.outpostTravel.blocked) {
      w.outpostTravel.t = ECOLOGY.OUTPOST_TRAVEL_SEC;
      w.job = 'outpost';
      w.task = makeTask('outpost', null, 'blocked', '等待活跃区块名额', w.crew && w.crew.id ? w.crew.id : w.name || '');
      continue;
    }
    w.outpostTravel.t = Math.max(0, (w.outpostTravel.t || ECOLOGY.OUTPOST_TRAVEL_SEC) - Math.max(0, dt || 0));
    w.job = 'outpost';
    if (w.outpostTravel.t <= 0) arriveAtOutpost(state, w, target, source);
  }
}

function stationedOutpostWorkers(chunk) {
  return (chunk && chunk.workers || []).filter((w) => {
    if (!w || !w.alive || w.downed || w.hollow || w.outpostTravel) return false;
    const d = directiveFromSave(w.directive);
    return d.outpost && (w.chunkX | 0) === (chunk.cx | 0) && (w.chunkY | 0) === (chunk.cy | 0);
  });
}

function nextRemoteNode(chunk) {
  const m = chunk && chunk.map;
  if (!m || !m.nodeAmt) return null;
  // 只从生态斑块提示的有限候选取点，不做远端全图扫描。
  for (const p of (chunk.ecoPatches || []).slice(0, ECOLOGY.MAX_PATCHES_PER_CHUNK)) {
    const x = p.x | 0, y = p.y | 0;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    const i = y * m.w + x, tile = m.tiles[i];
    if (m.nodeAmt[i] > 0 && (tile === T.ORE || tile === T.VINE || tile === T.ROCK)) {
      return { x, y, i, res: tile === T.ORE ? 'ore' : (tile === T.VINE ? 'vine' : 'stone') };
    }
  }
  return null;
}

function consumeRemoteNode(chunk, node) {
  const m = chunk.map;
  m.nodeAmt[node.i] = Math.max(0, (m.nodeAmt[node.i] || 0) - 1);
  if (m.nodeAmt[node.i] <= 0 && node.res !== 'stone') m.set(node.x, node.y, T.FLOOR);
  chunk.modified = true;
}

// 远端只算“光源总量”，不生成 6912 格光照图；这条路径只在前哨结算脉冲触发。
function chunkLightPressure(chunk) {
  let total = 0;
  for (const b of chunk && chunk.buildings || []) {
    if (!b || b.site || b.off || !(b.fuel > 0)) continue;
    const d = BUILD[b.type];
    if (d && d.power > 0 && !d.decoy) total += d.power;
  }
  return total;
}

function remoteFrontAnchor(chunk) {
  const fronts = chunk && chunk.map && chunk.map.blightFronts || [];
  if (fronts.length) return { x: fronts[0].x, y: fronts[0].y };
  const patch = (chunk && chunk.ecoPatches || []).find((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (patch) return { x: patch.x, y: patch.y };
  const m = chunk && chunk.map;
  return m ? { x: (m.w / 2) | 0, y: (m.h / 2) | 0 } : null;
}

function settleRemoteEcology(state, chunk, outpost) {
  const pressure = chunkLightPressure(chunk);
  const tide = isTide(state);
  const ratio = pressure / Math.max(1, ECOLOGY.LIGHT_PRESSURE_BASE);
  let debt = outpost.frontDebt | 0;
  let event = '';
  if (tide && pressure < ECOLOGY.LIGHT_PRESSURE_BASE) {
    debt = Math.min(ECOLOGY.OUTPOST_FRONT_DEBT_MAX, debt + 1);
    if (debt >= ECOLOGY.OUTPOST_FRONT_DEBT_MAX) {
      const anchor = remoteFrontAnchor(chunk);
      const seeded = anchor && seedBlightFrontInChunk(chunk, anchor.x, anchor.y, 'outpost-tide');
      if (seeded && seeded.ok) {
        event = seeded.created ? '远端蚀潮留下新的蚀痕前线' : '远端蚀潮强化了既有前线';
        debt = 0;
      } else if (chunk.map && (chunk.map.blightFronts || []).length >= ECOLOGY.MAX_FRONTS_PER_CHUNK) {
        event = '远端前线已达区块上限';
      }
    }
  } else if (!tide && pressure >= ECOLOGY.LIGHT_PRESSURE_BASE) {
    debt = Math.max(0, debt - ECOLOGY.OUTPOST_FRONT_DEBT_DECAY);
  }
  outpost.lightPressure = +pressure.toFixed(2);
  outpost.frontDebt = debt;
  outpost.lastEcology = {
    tide,
    pressure: outpost.lightPressure,
    ratio: +ratio.toFixed(2),
    debt,
    event,
  };
  return outpost.lastEcology;
}

function recordRemoteAlert(state, chunk, outpost, workers, ecology) {
  if (!ecology || !ecology.event) return;
  const open = outpost.alerts.find((a) => a.status === 'open' && a.kind === 'blight');
  if (open) return;
  const w = workers[0] || null;
  const id = `${chunk.id || keyOf(chunk.cx, chunk.cy)}:eco:${outpost.ticks | 0}`;
  outpost.alerts.push({
    id, kind: 'blight', day: state.day | 0, t: +Number(state.t || 0).toFixed(1),
    workerId: w && w.crew && w.crew.id ? w.crew.id : null,
    workerName: w && w.name || '', message: ecology.event, status: 'open', rescuePending: !!w,
  });
  if (outpost.alerts.length > ECOLOGY.OUTPOST_MAX_ALERTS) outpost.alerts.splice(0, outpost.alerts.length - ECOLOGY.OUTPOST_MAX_ALERTS);
}

function settleRemoteNeeds(state, chunk, w) {
  const sec = ECOLOGY.OUTPOST_SETTLE_SEC;
  const glutton = w.traits && w.traits.bad === 'glutton' ? SURVIVAL.WORKER.GLUTTON_MUL : 1;
  w.hunger = Math.max(0, (Number.isFinite(w.hunger) ? w.hunger : SURVIVAL.WORKER.START_HUNGER) - SURVIVAL.WORKER.HUNGER_PER_SEC * glutton * sec);
  const needsFood = w.hunger <= SURVIVAL.WORKER.EAT_AT;
  let fed = false;
  if (needsFood && withdrawFromChunk(state, chunk, { food: 1 }, w.x, w.y) === null) {
    w.hunger = Math.min(SURVIVAL.WORKER.HUNGER_MAX, w.hunger + SURVIVAL.WORKER.EAT_GAIN);
    fed = true;
  }
  if (w.hunger <= 0 && !fed) {
    w.starveT = Math.min(STARVE.graceSecs + sec, (w.starveT || 0) + sec);
  } else {
    w.starveT = 0;
  }
  return { fed, foodShort: needsFood && !fed, starving: w.hunger <= 0 && !fed };
}

// N6b-2a：远端驻守的低频结算。它只处理已抵达、仍活跃的区块；
// 玩家当前区块继续走原有 AI，远端“采掘”每 12 秒最多处理 3 名成员，
// 只消费真实节点并写入目标区块容器。没有容器/节点就记录阻塞，不凭空产出。
export function updateOutpostSettlement(state, dt) {
  if (!state || state.layerId !== 'surface' || !state.chunkStore) return;
  const currentKey = keyOf(state.chunkX || 0, state.chunkY || 0);
  for (const chunk of activeSurfaceChunks(state)) {
    if (!chunk || chunk.id === currentKey) continue;
    const workers = stationedOutpostWorkers(chunk);
    const o = ensureOutpostState(chunk);
    if (!workers.length) { o.lastReason = '等待有人驻守'; continue; }
    o.nextT = Math.max(0, o.nextT - Math.max(0, dt || 0));
    if (o.nextT > 0) continue;
    o.nextT = ECOLOGY.OUTPOST_SETTLE_SEC;
    o.ticks = Math.min(0x7fffffff, o.ticks + 1);
    const ecology = settleRemoteEcology(state, chunk, o);
    recordRemoteAlert(state, chunk, o, workers, ecology);
    const yieldByRes = {};
    const reasons = [];
    const needs = { fed: 0, hungry: 0, foodShort: 0, fuel: 0 };
    let worked = 0;
    for (const w of workers.slice(0, ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK)) {
      const d = directiveFromSave(w.directive);
      const need = settleRemoteNeeds(state, chunk, w);
      if (need.fed) needs.fed++;
      if (need.foodShort) { if (need.starving) needs.hungry++; needs.foodShort++; reasons.push(`${w.name || '拓荒者'}：食物不足，需要补给`); continue; }
      if (d.outpostMode !== 'gather') { reasons.push(`${w.name || '拓荒者'}：${d.outpostMode === 'silent' ? '静默撤离' : '守灯'}`); continue; }
      const node = nextRemoteNode(chunk);
      if (!node) { reasons.push('没有可采资源'); break; }
      const stored = depositToChunk(state, chunk, node.res, 1, node.x + 0.5, node.y + 0.5);
      if (stored <= 0) { reasons.push('前哨没有可用容器'); break; }
      consumeRemoteNode(chunk, node);
      yieldByRes[node.res] = (yieldByRes[node.res] || 0) + stored;
      worked++;
    }
    // 守灯是主动维持前哨光源的选择，每名守灯者每轮消耗一份本地燃料。
    // 守灯燃料只影响本轮任务状态；远端光压/前线反馈已在本轮结算前记账，
    // 不直接改动蚀潮预算，也不额外生成敌人。
    for (const w of workers.slice(0, ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK)) {
      const d = directiveFromSave(w.directive);
      if (d.outpostMode !== 'guard' || (w.hunger <= 0 && w.starveT > STARVE.graceSecs)) continue;
      if (withdrawFromChunk(state, chunk, { fuel: ECOLOGY.OUTPOST_GUARD_FUEL_PER_TICK }, w.x, w.y) !== null) {
        needs.fuel++;
        reasons.push(`${w.name || '拓荒者'}：燃料不足，守灯暂停`);
      }
    }
    o.lastNeeds = needs;
    o.lastYield = yieldByRes;
    const blockedReason = reasons.find((r) => /食物不足|燃料不足|没有可用容器/.test(r));
    o.lastReason = worked ? `完成 ${worked} 次远端采掘` : (blockedReason || reasons[0] || '本轮无工作');
    if (ecology.event) o.lastReason += ` · ${ecology.event}`;
    for (const w of workers.slice(0, ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK)) {
      const d = directiveFromSave(w.directive);
      const job = d.outpostMode === 'gather' ? 'gather' : (d.outpostMode === 'guard' ? 'guard' : 'outpost');
      w.job = job;
      w.task = makeTask(job, null, blockedReason ? 'blocked' : 'active', o.lastReason, w.crew && w.crew.id ? w.crew.id : w.name || '');
    }
  }
}

// N6a：只读前哨观测。目标区块尚未接入迁移前，不把“登记意图”冒充成已驻守，
// 也不因此唤醒无人区块；这样可以先验证调度数据，再安全接入跨区块移动。
export function outpostReport(state) {
  const members = [], seen = new Set();
  const add = (w) => { if (!w || seen.has(w)) return; seen.add(w); members.push(w); };
  for (const w of state.workers || []) add(w);
  for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) add(w);
  const active = activeSurfaceChunks(state);
  const currentChunk = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
  const assignments = members.filter((w) => w.alive && w.directive && w.directive.outpost).map((w) => {
    const d = directiveFromSave(w.directive);
    const current = { x: w.chunkX | 0, y: w.chunkY | 0 };
    const target = d.outpost;
    const stationed = current.x === target.x && current.y === target.y;
    const travel = w.outpostTravel;
    return {
      id: w.crew && w.crew.id || null, name: w.name, current, target,
      mode: d.outpostMode || 'guard', modeLabel: DIRECTIVES.OUTPOST[d.outpostMode || 'guard'],
      status: stationed ? 'stationed' : (travel && travel.blocked ? 'capacity' : (travel ? 'traveling' : 'pending')),
      travelSec: travel ? +Math.max(0, travel.t || 0).toFixed(2) : 0,
      settlement: stationed ? (() => {
        const c = state.chunkStore && state.chunkStore[keyOf(current.x, current.y)];
        const o = c && c.outpost;
        return o ? { ticks: o.ticks | 0, nextSec: +Math.max(0, o.nextT || 0).toFixed(2), yield: { ...(o.lastYield || {}) }, needs: { ...(o.lastNeeds || {}) }, ecology: { ...(o.lastEcology || {}) }, alerts: (o.alerts || []).map((a) => ({ ...a })), reason: o.lastReason || '' } : null;
      })() : null,
    };
  });
  const statusCount = (status) => assignments.filter((a) => a.status === status).length;
  return {
    capacity: ECOLOGY.MAX_ACTIVE_OUTPOSTS,
    active: active.map((c) => ({ x: c.cx | 0, y: c.cy | 0, id: c.id, residents: ((c === currentChunk ? state.workers : c.workers) || []).filter((w) => w.alive && !w.hollow).length })),
    assignments,
    counts: { assigned: assignments.length, stationed: statusCount('stationed'), traveling: statusCount('traveling'), capacity: statusCount('capacity'), pending: statusCount('pending') },
  };
}

export function tryCrossSurfaceExit(state) {
  if (state.layerId !== 'surface' || !state.map || !state.player) return false;
  const p = state.player, m = state.map, mid = m.h / 2;
  let dx = 0, dy = 0;
  const half = SURVIVAL.CHUNK.EXIT_HALF;
  const trigger = SURVIVAL.CHUNK.EXIT_TRIGGER;
  if (p.x < trigger && Math.abs(p.y - mid) < half) dx = -1;
  else if (p.x > m.w - trigger && Math.abs(p.y - mid) < half) dx = 1;
  else if (p.y < trigger && Math.abs(p.x - m.w / 2) < half) dy = -1;
  else if (p.y > m.h - trigger && Math.abs(p.x - m.w / 2) < half) dy = 1;
  if (!dx && !dy) return false;
  const chunk = ensureSurfaceChunk(state, (state.chunkX || 0) + dx, (state.chunkY || 0) + dy);
  bindSurfaceChunk(state, chunk);
  // 出口触发带宽约 1.6 格；落点必须离另一侧触发带留出缓冲，避免下一帧立刻反向穿区块。
  const safe = SURVIVAL.CHUNK.EXIT_SPAWN_INSET;
  p.x = dx < 0 ? m.w - safe : dx > 0 ? safe : m.w / 2 + 0.5;
  p.y = dy < 0 ? m.h - safe : dy > 0 ? safe : m.h / 2 + 0.5;
  p.chunkX = chunk.cx; p.chunkY = chunk.cy; p.clearPath(); state.dest = null;
  state.camera.x = p.x; state.camera.y = p.y;
  state.floaties.push({ x: p.x, y: p.y - 1, txt: `进入区块 ${chunk.cx},${chunk.cy}`, color: '#7fe0ff', t: 0, life: 1.2 });
  return true;
}
