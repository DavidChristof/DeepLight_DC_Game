// dev/observe.js —— 战斗观测台（W14-A 第 0 步）：把"感觉"换成"表"
//
// 三个口子（由 main.js 注册为 window 句柄）：
//   __combat()    —— 全部战斗数值 + **当前生效乘子**（调平衡前先看这张表）
//   __wave()      —— 当前波次状态：潮位 / 上限 / 间隔 / 下一批构成 / 场上构成
//   __dps()       —— 理论每秒伤害（玩家光爆 / 每座塔）+ 燃料成本 + 对每种敌人的有效伤害
//   __abilities() —— W14-A 第 3 步：四种敌人行为的现场计数（蓄力/突进/引信/光环）
//
// 【为什么先做"理论值"】实测 DPS 要等第 2 步的 `__lab()`（载荷组合打靶）；
//   这一步的目的是**让表与实现当场对质** —— 数值表写错、乘子漏乘，这里一眼就能看出来。
// 【纪律】这些函数只读不写：不许改 state（观测台把游戏改坏了就是最糟的 bug）。

import { PULSE, TOWER, WAVES, BOSS, TYPES, TYPE_ORDER, TYPE_NAME, armorMul, LIGHT_FEAR_BURN, ABILITY, tideOf } from '../data/combat.js';
import { BUILD, LIGHT_LEVELS } from '../data/buildings.js';
import { EXPEDITION } from '../data/expedition.js';
import { ENDGAME } from '../data/endgame.js';
import { CAMP_CAP, PACK_CAP, STORE_CAP } from '../data/storage.js';
import { CARRY } from '../data/combat.js';
import { ENEMIES, KINDS } from '../data/enemies.js';
import { nightPlan, signatureOf, mainKindOf, nightHud, pickKind } from '../data/night.js';
import { UNLOCK_BONUS, weakTextOf } from '../data/codex.js';
import { MODS, FUEL_PER_MOD, MAX_SLOTS, allLoads, allCombos, towerTypes, payloadStats, dmgMulRange } from '../data/payload.js';
import { pulseMul, pulseRangeMul, towerDmgMul, towerRateMul, owlDmgMul } from '../systems/research.js';
import { damageMul } from '../systems/codex.js';
import { hasTinker, bondLevel } from '../systems/mind.js';
import { isTide, isNight, TIDE_START, TIDE_END } from '../core/time.js';
import { SURVIVAL } from '../data/survival.js';
import { injuryName, restBeds, restCount } from '../systems/survival.js';
import { T } from '../world/map.js';
import { nodeMax } from '../data/nodes.js';
import { genMap, genDepth, surfaceChunkMapSeed, surfaceChunkNightOpsSeed } from '../world/gen.js';
import { LAYER_META } from '../data/layers.js';
import { ensureNightOps } from '../systems/nightops.js';
import { NIGHTBLOOM } from '../data/nightops.js';
import { RECIPES } from '../data/tools.js';
import { RESEARCH } from '../data/research.js';
import { ECOLOGY, biomeOf, frontStageOf } from '../data/ecology.js';
import { lightPressure } from '../systems/ecoPressure.js';
import { activeSurfaceChunks, outpostReport } from '../world/chunks.js';
import { visualSpec } from '../data/visual.js';
import { assetStats } from '../core/assets.js';
import { settings } from '../core/settings.js';
import { COLONISTS, crewCardOf, roleInfluence } from '../data/colonists.js';
import { taskFromSave, directiveFromSave } from '../data/tasks.js';
import { taskBoardStats } from '../systems/taskBoard.js';
import { compute as computeLight } from '../world/light.js';
import { liveResonanceStatus } from '../systems/resonance.js';

const alive = (arr) => (arr || []).filter((e) => e && e.alive);

export function visualReport() {
  const spec = visualSpec();
  const assets = assetStats();
  const v8Rows = (assets.rows || []).filter((r) => String(r.key || '').startsWith('v8_'));
  const humanRows = v8Rows.filter((r) => String(r.key || '').startsWith('v8_human_'));
  const hazardKeys = [spec.blightArt && spec.blightArt.spriteKey, spec.ventArt && spec.ventArt.spriteKey].filter(Boolean);
  const hazardRows = v8Rows.filter((r) => hazardKeys.includes(r.key));
  const drawModes = { direct: 0, crop: 0, 'nearest-cache': 0, fallback: 0 };
  for (const row of v8Rows) if (drawModes[row.drawMode] != null) drawModes[row.drawMode] += 1;
  const loadedByLayer = {};
  for (const row of v8Rows) {
    const layer = row.layer || 'untyped';
    loadedByLayer[layer] = (loadedByLayer[layer] || 0) + (row.ok ? 1 : 0);
  }
  const coverage = {};
  const groupOf = (row) => {
    const key = String(row.key || '');
    if (key.startsWith('v8_human_')) return 'human';
    if (key.startsWith('v8_terrain_')) return 'terrain';
    if (key.startsWith('v8_decor_')) return 'decor';
    if (key.startsWith('v8_node_')) return 'node';
    if (key === 'v8_blight' || key === 'v8_vent') return 'hazard';
    if (key.startsWith('v8_enemy_')) return 'creature';
    if (row.layer === 'building') return 'building';
    return 'other';
  };
  for (const row of v8Rows) {
    const group = groupOf(row);
    const slot = coverage[group] || (coverage[group] = { total: 0, loaded: 0, fallback: 0, dimensionErrors: 0 });
    slot.total += 1;
    if (row.ok && row.dimensionOk) slot.loaded += 1;
    if (row.drawMode === 'fallback') slot.fallback += 1;
    if (!row.dimensionOk) slot.dimensionErrors += 1;
  }
  return {
    ...spec,
    theme: settings.visualTheme,
    v8: {
      total: v8Rows.length,
      loaded: v8Rows.filter((r) => r.ok).length,
      missing: v8Rows.filter((r) => r.src && !r.ok).map((r) => r.key),
      unconfigured: v8Rows.filter((r) => !r.src).map((r) => r.key),
      pending: v8Rows.filter((r) => r.pending).map((r) => r.key),
      dimensionErrors: v8Rows.filter((r) => !r.dimensionOk).map((r) => ({ key: r.key, error: r.dimensionError })),
      drawModes,
      layers: [...(spec.layers || [])],
      layerCount: (spec.layers || []).length,
      loadedByLayer,
      coverage,
      humanLayers: {
        total: humanRows.length,
        loaded: humanRows.filter((r) => r.ok).map((r) => r.key),
        missing: humanRows.filter((r) => r.src && !r.ok).map((r) => r.key),
        pending: humanRows.filter((r) => r.pending).map((r) => r.key),
      },
      hazards: {
        keys: [...hazardKeys],
        loaded: hazardRows.filter((r) => r.ok).map((r) => r.key),
        missing: hazardRows.filter((r) => r.src && !r.ok).map((r) => r.key),
        pending: hazardRows.filter((r) => r.pending).map((r) => r.key),
        fallback: hazardRows.filter((r) => !r.ok).length,
      },
      fallback: v8Rows.filter((r) => !r.ok).length,
    },
    semanticCount: Object.values(spec.semantic || {}).reduce((sum, count) => sum + count, 0),
    assets,
  };
}

// —— W15-B 生存观测台（第 0 步：只读，不改变状态）——
export function survivalReport(state) {
  const workers = (state.workers || []).filter((w) => w && w.alive);
  const hungry = workers.filter((w) => w.hunger < SURVIVAL.WORKER.LOW_HUNGER);
  const starving = workers.filter((w) => w.hunger <= 0);
  const injured = workers.filter((w) => w.hp < w.maxHp);
  const nodes = { ore: 0, vine: 0, relic: 0, mother: 0, rock: 0, remaining: 0, capacity: 0 };
  const names = { [T.ORE]: 'ore', [T.VINE]: 'vine', [T.RELIC]: 'relic', [T.MOTHER]: 'mother', [T.ROCK]: 'rock' };
  const map = state.map;
  if (map && map.nodeAmt) {
    for (let i = 0; i < map.nodeAmt.length; i++) {
      const name = names[map.tiles[i]];
      if (!name) continue;
      const amount = map.nodeAmt[i] || 0;
      nodes[name] += amount;
      nodes.remaining += amount;
      nodes.capacity += nodeMax(map.tiles[i]);
    }
  }
  return {
    player: { hp: state.playerHp, maxHp: state.playerMaxHp || SURVIVAL.PLAYER.BASE_MAX_HP, hunger: state.playerHunger, injury: injuryName(state.playerInjury || 0), alive: !state.playerDead },
    workers: { alive: workers.length, hungry: hungry.length, starving: starving.length, injured: injured.length,
      hunger: workers.map((w) => ({ name: w.name, hunger: +w.hunger.toFixed(1), hp: +w.hp.toFixed(1), maxHp: w.maxHp })) },
    stores: { food: state.res.food || 0, fuel: state.res.fuel || 0 },
    rest: { beds: restBeds(state), occupied: restCount(state), overwork: workers.map((w) => ({ name: w.name, level: w.overwork || 0 })), playerRestT: state.playerRestT || 0 },
    deathPack: state.deathPack ? { layerId: state.deathPack.layerId, chunkX: state.deathPack.chunkX ?? null, chunkY: state.deathPack.chunkY ?? null, day: state.deathPack.day, items: Object.assign({}, state.deathPack.stock || {}), held: state.deathPack.held || null } : null,
    death: { fuelLoss: SURVIVAL.DEATH.FUEL_LOSS, fuelAtRisk: Math.floor((state.res.fuel || 0) * SURVIVAL.DEATH.FUEL_LOSS) },
    nodes,
    chunk: { x: 0, y: 0, active: !!map, width: map ? map.w : 0, height: map ? map.h : 0, persisted: 1 },
  };
}

export function expeditionReport(state) {
  const map = state.map;
  const chunks = state.chunkStore ? Object.values(state.chunkStore) : [];
  const cx = state.chunkX || 0, cy = state.chunkY || 0;
  const layerId = state.layerId || 'surface';
  const currentChunk = layerId === 'surface'
    ? ((state.chunkStore && state.chunkStore[`${cx},${cy}`]) || (state.layers && state.layers.surface) || null)
    : ((state.layers && state.layers[layerId]) || null);
  const stockOf = (ref) => (ref && ref.stock && typeof ref.stock === 'object') ? ref.stock : {};
  const sumStock = (stock) => Object.values(stock).reduce((sum, n) => sum + (Number.isFinite(n) ? Math.max(0, n) : 0), 0);
  const localContainers = [];
  for (const b of currentChunk && currentChunk.beacons || []) {
    if (b && (b.hp == null || b.hp > 0)) localContainers.push({ kind: 'camp', ref: b, cap: CAMP_CAP });
  }
  for (const b of currentChunk && currentChunk.buildings || []) {
    const def = b && BUILD[b.type];
    if (def && def.store && !b.site) localContainers.push({ kind: 'store', ref: b, cap: def.store });
  }
  const localStock = {};
  for (const c of localContainers) for (const [k, n] of Object.entries(stockOf(c.ref))) localStock[k] = (localStock[k] || 0) + Math.max(0, Number(n) || 0);
  const localUsed = localContainers.reduce((sum, c) => sum + sumStock(stockOf(c.ref)), 0);
  const localCap = localContainers.reduce((sum, c) => sum + c.cap, 0);
  const lightSources = [];
  for (const b of currentChunk && currentChunk.beacons || []) if (b && (b.hp == null || b.hp > 0)) lightSources.push({ kind: 'camp', power: b.power || 0, active: true });
  for (const b of currentChunk && currentChunk.buildings || []) {
    const def = b && BUILD[b.type];
    if (def && def.power > 0 && !def.decoy && !b.site) lightSources.push({ kind: b.type, power: def.power, active: !!(b.fuel > 0) && !b.off });
  }
  const litSources = lightSources.filter((s) => s.active);
  const packStock = stockOf(state.pack);
  const carriedSlots = state.carried ? CARRY.PACK_SLOTS : 0;
  const packCap = Math.max(0, (state.pack && Number.isFinite(state.pack.cap) ? state.pack.cap : PACK_CAP) - carriedSlots);
  const packUsed = sumStock(packStock);
  const needFor = (cost) => {
    const need = {}, missing = {};
    for (const [k, n] of Object.entries(cost || {})) {
      need[k] = Math.max(0, n | 0);
      const gap = Math.max(0, need[k] - (packStock[k] || 0));
      if (gap) missing[k] = gap;
    }
    return { need, missing, ready: Object.keys(missing).length === 0 };
  };
  const kit = { store: needFor(BUILD.store.cost), lamp: needFor(BUILD.lamp.cost) };
  const home = EXPEDITION.HOME_CHUNK;
  const dx = home.x - cx, dy = home.y - cy;
  const directions = [];
  if (dx) directions.push(dx > 0 ? '东' : '西');
  if (dy) directions.push(dy > 0 ? '南' : '北');
  const outpost = currentChunk && currentChunk.outpost;
  return { version: EXPEDITION.VERSION,
    schema: EXPEDITION.REPORT_SCHEMA.slice(),
    current: { x: cx, y: cy, biome: biomeOf(cx, cy).id, layer: layerId, width: map ? map.w : 0, height: map ? map.h : 0 },
    discoveredChunks: chunks.length, persistentChunks: chunks.filter((c) => c.modified || c.buildings?.length || c.beacons?.length).length || (map ? 1 : 0),
    activeChunks: chunks.filter((c) => c === (state.layers && state.layers.surface)).length,
    pack: { used: packUsed, cap: packCap, free: Math.max(0, packCap - packUsed), carriedStructure: !!state.carried },
    kit,
    local: { containers: localContainers.length, used: localUsed, cap: localCap, free: Math.max(0, localCap - localUsed), stock: localStock,
      lights: { total: lightSources.length, lit: litSources.length, power: +litSources.reduce((sum, s) => sum + s.power, 0).toFixed(2) },
      hasFood: (localStock.food || 0) > 0, hasFuel: (localStock.fuel || 0) > 0 },
    outpost: outpost ? { ticks: outpost.ticks | 0, reason: outpost.lastReason || '', needs: { ...(outpost.lastNeeds || {}) }, yield: { ...(outpost.lastYield || {}) }, alerts: (outpost.alerts || []).length } : null,
    returnHint: { atHome: cx === home.x && cy === home.y, home: { ...home }, distance: Math.max(Math.abs(dx), Math.abs(dy)), directions },
    status: '按需载入：无人区块休眠，人工光弱边缘刷怪' };
}

// —— W20-R R0：终局闭环可达性基线（只读，不生成/写入真实区块）——
function resourceProfile(map) {
  const keys = { [T.ORE]: 'ore', [T.VINE]: 'vine', [T.RELIC]: 'relic', [T.MOTHER]: 'core' };
  const out = { ore: 0, vine: 0, relic: 0, core: 0 };
  if (!map || !map.nodeAmt) return out;
  for (let i = 0; i < map.nodeAmt.length; i++) {
    const key = keys[map.tiles[i]];
    if (key) out[key] += Math.max(0, map.nodeAmt[i] || 0);
  }
  return out;
}

// 只把从层入口实际可走到、且有可达相邻采集站位的节点计入路线下界。
// RELIC/MOTHER 本身不可走，不能仅凭地图上有 nodeAmt 就把它算成可采供给。
function reachableResourceProfile(map) {
  const out = { ore: 0, vine: 0, relic: 0, core: 0 };
  if (!map || !map.nodeAmt || !map.isWalk) return out;
  const startX = map.w >> 1, startY = map.h >> 1, start = startY * map.w + startX;
  const seen = new Uint8Array(map.w * map.h), queue = new Int32Array(map.w * map.h);
  let head = 0, tail = 0;
  if (!map.isWalk(startX, startY)) return out;
  seen[start] = 1; queue[tail++] = start;
  const dx = [1, -1, 0, 0], dy = [0, 0, 1, -1];
  while (head < tail) {
    const i = queue[head++], x = i % map.w, y = (i / map.w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + dx[d], ny = y + dy[d];
      if (!map.isWalk(nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1; queue[tail++] = ni;
    }
  }
  const keys = { [T.ORE]: 'ore', [T.VINE]: 'vine', [T.RELIC]: 'relic', [T.MOTHER]: 'core' };
  for (let i = 0; i < map.nodeAmt.length; i++) {
    const key = keys[map.tiles[i]], amount = Math.max(0, map.nodeAmt[i] || 0);
    if (!key || !amount) continue;
    const x = i % map.w, y = (i / map.w) | 0;
    let hasReachableStand = !!seen[i];
    for (let oy = -1; !hasReachableStand && oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if ((!ox && !oy) || !map.isWalk(x + ox, y + oy)) continue;
      if (seen[(y + oy) * map.w + x + ox]) { hasReachableStand = true; break; }
    }
    if (hasReachableStand) out[key] += amount;
  }
  return out;
}

function auditSurfaceChunk(seed, cx, cy, biome) {
  const map = genMap(SURVIVAL.CHUNK.WIDTH, SURVIVAL.CHUNK.HEIGHT, surfaceChunkMapSeed(seed, cx, cy), biome);
  // 与 ensureSurfaceChunk 的出口清理保持一致，只对临时审计图执行，不碰 state。
  const mx = map.w / 2 | 0, my = map.h / 2 | 0, edge = SURVIVAL.CHUNK.EXIT_CORRIDOR;
  for (let d = -3; d <= 3; d++) {
    for (let x = 0; x < edge; x++) map.nodeAmt[(my + d) * map.w + x] = 0;
    for (let x = map.w - edge; x < map.w; x++) map.nodeAmt[(my + d) * map.w + x] = 0;
    for (let y = 0; y < edge; y++) map.nodeAmt[y * map.w + mx + d] = 0;
    for (let y = map.h - edge; y < map.h; y++) map.nodeAmt[y * map.w + mx + d] = 0;
  }
  const nightLayer = { map, nightops: null };
  ensureNightOps(nightLayer, surfaceChunkNightOpsSeed(seed, cx, cy));
  const blooms = nightLayer.nightops && nightLayer.nightops.blooms || [];
  const firstDuskPlants = Math.min(blooms.length, NIGHTBLOOM.base);
  return {
    ...resourceProfile(map),
    reachable: reachableResourceProfile(map),
    nightBloom: {
      plants: blooms.length,
      firstDuskYieldUpper: firstDuskPlants * NIGHTBLOOM.charges * NIGHTBLOOM.yield,
      allPlantsYieldUpper: blooms.length * NIGHTBLOOM.charges * NIGHTBLOOM.yield,
      note: '确定性点位上限；实际产出还受夜间光照与存活条件影响',
    },
  };
}

export function siteAnchorAudit(state, probe) {
  const id = `${probe.x},${probe.y}`;
  const stored = state.chunkStore && state.chunkStore[id];
  const map = stored && stored.map
    ? stored.map
    : genMap(SURVIVAL.CHUNK.WIDTH, SURVIVAL.CHUNK.HEIGHT, surfaceChunkMapSeed(state.seed, probe.x, probe.y), probe.biome);
  const chunk = stored || { map, buildings: [], beacons: [], nightops: null };
  const nightOpsView = chunk.nightops ? chunk : { map, nightops: null };
  if (!nightOpsView.nightops) ensureNightOps(nightOpsView, surfaceChunkNightOpsSeed(state.seed, probe.x, probe.y));
  const occupied = new Set();
  for (const b of [...(chunk.buildings || []), ...(chunk.beacons || [])]) if (b && Number.isInteger(b.x) && Number.isInteger(b.y)) occupied.add(`${b.x},${b.y}`);
  for (const v of nightOpsView.nightops && nightOpsView.nightops.vents || []) if (v) occupied.add(`${v.x},${v.y}`);
  for (const b of nightOpsView.nightops && nightOpsView.nightops.blooms || []) if (b) occupied.add(`${b.x},${b.y}`);
  const edge = SURVIVAL.CHUNK.EXIT_CORRIDOR;
  const mx = map.w / 2 | 0, my = map.h / 2 | 0;
  let legalAnchors = 0;
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (map.get(x, y) !== T.FLOOR || occupied.has(`${x},${y}`)) continue;
    if (map.occBuild && map.occBuild[y * map.w + x] || map.occWalk && map.occWalk[y * map.w + x]) continue;
    if (map.blight && map.blight[y * map.w + x] > 0) continue;
    if ((x < edge && Math.abs(y - my) <= 3) || (x >= map.w - edge && Math.abs(y - my) <= 3)
      || (y < edge && Math.abs(x - mx) <= 3) || (y >= map.h - edge && Math.abs(x - mx) <= 3)) continue;
    legalAnchors++;
  }
  return { legalAnchors, chunkState: stored ? '已保存区块（按现状避让）' : '未探索区块（确定性基图）', blocked: legalAnchors === 0 };
}

function auditResourceSeed(seed) {
  const total = { ore: 0, vine: 0, relic: 0, core: 0 };
  const nightBloomUpper = { firstDusk: 0, allPlants: 0 };
  const routes = {};
  const add = (profile) => {
    for (const key of Object.keys(total)) total[key] += profile[key] || 0;
    nightBloomUpper.firstDusk += profile.nightBloom && profile.nightBloom.firstDuskYieldUpper || 0;
    nightBloomUpper.allPlants += profile.nightBloom && profile.nightBloom.allPlantsYieldUpper || 0;
  };
  for (const site of ENDGAME.SITE_CHUNK_PROBES) {
    routes[site.id] = auditSurfaceChunk(seed, site.x, site.y, site.biome);
    add(routes[site.id]);
  }
  for (let index = 1; index <= 3; index++) {
    const id = `depth${index}`;
    const meta = LAYER_META[id];
    if (meta) {
      const map = genDepth(meta.w, meta.h, (seed ^ (0x9e3779b9 * index)) >>> 0, index);
      routes[id] = { ...resourceProfile(map), reachable: reachableResourceProfile(map) };
      add(routes[id]);
    }
  }
  // R4-A 真实首选路线从苔原原点沿相邻区块到碎岩台地；通道区块也能采档案，需计入共享研究/建站预算。
  const second = ENDGAME.SITE_CHUNK_PROBES.find((site) => site.id === 'second') || { x: 0, y: 0 };
  const corridor = [{ x: 0, y: 0 }];
  let cx = 0, cy = 0;
  while (cx !== second.x) { cx += Math.sign(second.x - cx); corridor.push({ x: cx, y: cy }); }
  while (cy !== second.y) { cy += Math.sign(second.y - cy); corridor.push({ x: cx, y: cy }); }
  const accessRoute = { chunks: corridor, resources: { ore: 0, vine: 0, relic: 0 } };
  for (const p of corridor) {
    const profile = auditSurfaceChunk(seed, p.x, p.y, biomeOf(p.x, p.y).id);
    for (const key of Object.keys(accessRoute.resources)) accessRoute.resources[key] += profile.reachable?.[key] || 0;
  }
  return { total, routes, nightBloomUpper, accessRoute };
}

export function resonanceSitePrepBudget(siteId) {
  const siteCost = ENDGAME.SITE_COSTS[siteId] || {};
  const lamp = BUILD.lamp || {};
  const furnace = BUILD.furnace || {};
  const fuelRecipe = RECIPES.find((recipe) => recipe.id === 'fuel' && recipe.out === 'fuel');
  const tideSeconds = Math.max(0, TIDE_END - TIDE_START);
  const fuelOut = fuelRecipe && fuelRecipe.n || 0;
  const fuelOre = fuelRecipe && fuelRecipe.cost && fuelRecipe.cost.ore || 0;
  const trialFuel = ENDGAME.TRIAL_START_COST.fuel || 0;
  const levels = LIGHT_LEVELS.map((level) => {
    const lampFuelForTide = lamp.burnSec > 0 ? Math.ceil(tideSeconds * level.burn / lamp.burnSec) : null;
    const totalFuel = lampFuelForTide == null ? null : trialFuel + lampFuelForTide;
    const fuelBatches = totalFuel != null && fuelOut > 0 ? Math.ceil(totalFuel / fuelOut) : null;
    const oreForFuel = fuelBatches == null ? null : fuelBatches * fuelOre;
    return {
      level: level.name,
      burnMultiplier: level.burn,
      secondsPerFuel: lamp.burnSec > 0 ? lamp.burnSec / level.burn : null,
      lampFuelForTide,
      trialFuel,
      totalFuel,
      fuelBatches,
      oreForFuel,
      minimumOre: oreForFuel == null ? null : (siteCost.ore || 0) + (lamp.cost?.ore || 0)
        + (furnace.cost?.ore || 0) + oreForFuel,
    };
  });
  return {
    tideSeconds,
    beaconProvidesLight: !!(BUILD.resonanceBeacon && BUILD.resonanceBeacon.power > 0),
    lampCost: { ...(lamp.cost || {}) },
    furnaceCost: { ...(furnace.cost || {}) },
    furnaceFireMat: furnace.fireMat || 'vine',
    furnaceIgnitionUnits: 1,
    fuelRecipe: fuelRecipe ? { input: { ...fuelRecipe.cost }, output: fuelOut } : null,
    importedFuelPlan: levels.map((level) => ({
      level: level.level,
      fuelToBring: level.totalFuel,
      fuelOnlyPackLoads: level.totalFuel == null ? null : Math.ceil(level.totalFuel / PACK_CAP),
      siteOreMinimum: (siteCost.ore || 0) + (lamp.cost?.ore || 0),
      upstreamOreEquivalent: level.oreForFuel,
      note: '燃料在出发前备好时，本站可省去熔炉与现场炼油；包数仅按燃料单独计算，不含其他物资',
    })),
    levels,
    note: '灯具燃料是从蚀潮起点计、burnT=0 的理论下界；真实预算须覆盖点灯时机/余烬计时、研究节油与防守消耗。信标本身不发光。',
  };
}

function resonanceMaterialBudget(resourceAudit = []) {
  const construction = Object.values(ENDGAME.SITE_COSTS);
  const total = {};
  for (const cost of construction) for (const [key, amount] of Object.entries(cost)) total[key] = (total[key] || 0) + amount;
  for (const [key, amount] of Object.entries(ENDGAME.TRIAL_START_COST)) total[key] = (total[key] || 0) + amount * ENDGAME.BEACON_COUNT;
  // 初始预算中的燃料可由既有炼油配方制作；这里只计算理论等价，不替代实地采集/加工验证。
  const fuelRecipe = RECIPES.find((recipe) => recipe.out === 'fuel' && recipe.id === 'fuel');
  const fuelOut = fuelRecipe && fuelRecipe.n || 0;
  const fuelInput = fuelRecipe && fuelRecipe.cost || {};
  const fuelInputPerOutput = fuelOut > 0 ? Object.fromEntries(Object.entries(fuelInput).map(([key, amount]) => [key, amount / fuelOut])) : {};
  const fuelBatches = fuelOut > 0 ? Math.ceil((total.fuel || 0) / fuelOut) : 0;
  const oreForFuel = fuelBatches * (fuelInput.ore || 0);
  const storeKitUnits = Object.values(BUILD.store.cost || {}).reduce((sum, n) => sum + n, 0);
  // Research sections are gated by actual layer access: mining is visible on the surface,
  // while deep/deeper are only available after entering depth1.
  const surfaceAccessResearch = RESEARCH.mining?.cost?.data || 0;
  const depth1AccessResearch = (RESEARCH.deep?.cost?.data || 0) + (RESEARCH.deeper?.cost?.data || 0);
  const siteDataCost = Object.values(ENDGAME.SITE_COSTS).reduce((sum, cost) => sum + (cost.data || 0), 0);
  const surfaceRouteDataRequired = surfaceAccessResearch + siteDataCost;
  const surfaceRouteDataMin = Math.min(...resourceAudit.map((row) => row.resources?.accessRoute?.resources?.relic ?? Infinity));
  const surfaceSiteIds = ENDGAME.SITE_CHUNK_PROBES.map((site) => site.id);
  const surfaceSupplyMin = Object.fromEntries(['ore', 'vine', 'relic'].map((key) => [key,
    Math.min(...resourceAudit.map((row) => surfaceSiteIds.reduce((sum, id) => sum + (row.resources?.routes?.[id]?.reachable?.[key] || 0), 0)))]));
  const depth1DataMin = Math.min(...resourceAudit.map((row) => row.resources?.routes?.depth1?.reachable?.relic ?? Infinity));
  const depth1SupplyMin = Object.fromEntries(['ore', 'vine', 'relic'].map((key) => [key,
    Math.min(...resourceAudit.map((row) => row.resources?.routes?.depth1?.reachable?.[key] ?? Infinity))]));
  const depth2CoreMin = Math.min(...resourceAudit.map((row) => row.resources?.routes?.depth2?.reachable?.core ?? Infinity));
  const depth2CoreNeeded = (ENDGAME.SITE_COSTS.second?.core || 0) + (ENDGAME.SITE_COSTS.third?.core || 0);
  const shaftCost = { ...(BUILD.shaft?.cost || {}) };
  const siteLogistics = Object.fromEntries(ENDGAME.SITE_CHUNK_PROBES.map((site) => {
    const cost = ENDGAME.SITE_COSTS[site.id] || {};
    const constructionUnits = Object.values(cost).reduce((sum, n) => sum + n, 0);
    const trialUnits = Object.values(ENDGAME.TRIAL_START_COST).reduce((sum, n) => sum + n, 0);
    const stockUnits = constructionUnits + trialUnits;
    const siteStoreCap = site.id === 'third' ? CAMP_CAP : STORE_CAP;
    const fuelAtSite = (cost.fuel || 0) + (ENDGAME.TRIAL_START_COST.fuel || 0);
    const siteFuelBatches = fuelOut > 0 ? Math.ceil(fuelAtSite / fuelOut) : 0;
    const siteFuelOre = siteFuelBatches * (fuelInput.ore || 0);
    return [site.id, {
      stockUnits,
      containerCap: siteStoreCap,
      stockFitsContainer: stockUnits <= siteStoreCap,
      remoteStoreKitUnits: site.id === 'third' ? 0 : storeKitUnits,
      remoteStoreKitPackLoads: site.id === 'third' ? 0 : Math.ceil(storeKitUnits / PACK_CAP),
      fullStockPackLoadsIfShipped: site.id === 'third' ? 0 : Math.ceil(stockUnits / PACK_CAP),
      fuelOreProcessedBeforeShipping: siteFuelOre,
      trialPrep: resonanceSitePrepBudget(site.id),
      note: '目的地库存只计已加工后的施工/预约物品；燃料原料在出发前加工，不额外占目的地容器格',
    }];
  }));
  return {
    total,
    fuelRecipe: fuelRecipe ? { id: fuelRecipe.id, input: { ...fuelInput }, output: fuelOut } : null,
    fuelBatches,
    fuelInputPerOutput,
    oreForFuel,
    oreIncludingFuel: (total.ore || 0) + oreForFuel,
    logistics: {
      packCap: PACK_CAP,
      storeCap: STORE_CAP,
      storeKitUnits,
      siteLogistics,
      note: '远端首次须先带够建箱材料；全包运输次数是假设物资都从原点携带的容量下界，不含往返时间、局部采集顺序与战斗风险',
    },
    nightBloomPerSite: Object.fromEntries(ENDGAME.SITE_CHUNK_PROBES.map((site) => {
      const cost = ENDGAME.SITE_COSTS[site.id] || {};
      return [site.id, (cost.night || 0) + (ENDGAME.TRIAL_START_COST.night || 0)];
    })),
    access: {
      depth2Entry: {
        surfaceResearch: { mining: RESEARCH.mining?.cost?.data || 0,
          totalData: surfaceAccessResearch, auditedSupplyMin: surfaceSupplyMin.relic,
          covered: Number.isFinite(surfaceSupplyMin.relic) && surfaceSupplyMin.relic >= surfaceAccessResearch },
        surfaceDataRoute: { requiredForResearchAndAllSites: surfaceRouteDataRequired,
          auditedSupplyMin: Number.isFinite(surfaceRouteDataMin) ? surfaceRouteDataMin : null,
          chunks: resourceAudit[0]?.resources?.accessRoute?.chunks || [],
          covered: Number.isFinite(surfaceRouteDataMin) && surfaceRouteDataMin >= surfaceRouteDataRequired,
          note: '固定首选路线：从(0,0)按X后Y走到碎岩台地首选探针；含沿途区块档案，候选点回退后的路线须在实测中重新核对' },
        depth1Research: { deep: RESEARCH.deep?.cost?.data || 0, deeper: RESEARCH.deeper?.cost?.data || 0,
          totalData: depth1AccessResearch, auditedSupplyMin: depth1DataMin,
          covered: Number.isFinite(depth1DataMin) && depth1DataMin >= depth1AccessResearch },
        depth1Shaft: { ...shaftCost, auditedDepth1SupplyMin: { ore: depth1SupplyMin.ore, vine: depth1SupplyMin.vine },
          covered: ['ore', 'vine'].every((key) => Number.isFinite(depth1SupplyMin[key]) && depth1SupplyMin[key] >= (shaftCost[key] || 0)) },
        depth2Core: { source: 'depth2', requiredAcrossSecondAndThird: depth2CoreNeeded, minimumByAuditSeeds: Number.isFinite(depth2CoreMin) ? depth2CoreMin : null,
          covered: Number.isFinite(depth2CoreMin) && depth2CoreMin >= depth2CoreNeeded },
        note: '研究分区有实际解锁顺序：地表先研究高效采掘（6档案），天然竖井首潜后才开放深渊分区，再研究深潜学（16）与深层深潜（20）；竖井材料从 depth1 供给审计。随后进入 depth2 一次采回后续站点母髓。此为必经访问成本，尚未计工具、照明、燃料、防守与食物',
      },
    },
    note: '含三座施工与三次预约的直接需求；访问深层的研究/竖井必需成本另列 access，仍未计工具、照明、燃料、防守与食物消耗',
  };
}

const lightRound = (value) => Number.isFinite(value) ? +value.toFixed(3) : null;

function isolatedResonanceLight(state, index, groups) {
  const n = state.map.w * state.map.h;
  // `computeLight` lazily caches lava sources on the map object. Clone the map
  // shell so this read-only counterfactual cannot add even that cache to game state.
  const map = { ...state.map };
  const player = state.player ? { ...state.player,
    lamp: { ...(state.player.lamp || {}), power: groups.player ? (state.player.lamp?.power || 0) : 0 } } : null;
  const beacons = groups.camp ? (state.beacons || []).map((b) => ({ ...b })) : [];
  const buildings = groups.buildings ? (state.buildings || []).map((b) => ({ ...b })) : [];
  const graves = groups.graves ? (state.graves || []).map((g) => ({ ...g })) : [];
  const isolated = { ...state, map, player, beacons, buildings, graves,
    light: new Float32Array(n), discovered: state.discovered ? new Uint8Array(n) : null };
  computeLight(isolated);
  return isolated.light[index] || 0;
}

// 潮夜诊断用：以生产光照计算器做只读反事实，区分玩家提灯、营火和建筑光。
// 光照按最大贡献合成，因此各来源值不可相加；本函数不改原 state/光图/建筑。
export function resonanceLightReport(state, requestedSite = null) {
  const activeTrial = state.resonance?.trial;
  const siteId = activeTrial && ['reserved', 'active'].includes(activeTrial.status)
    ? activeTrial.siteId : liveResonanceStatus(state).id;
  const site = requestedSite || state.resonance?.sites?.[siteId] || null;
  const base = { siteId, layer: state.layerId, chunk: { x: state.chunkX | 0, y: state.chunkY | 0 }, loaded: false };
  if (!site || !Number.isInteger(site.x) || !Number.isInteger(site.y)
    || state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY
    || !state.map || !state.player) return base;
  const index = site.y * state.map.w + site.x;
  if (index < 0 || index >= state.map.w * state.map.h) return base;
  const gridValue = state.light && Number.isFinite(state.light[index]) ? state.light[index] : null;
  const activeBuildingSources = (state.buildings || []).filter((b) => {
    const def = BUILD[b.type];
    return !b.site && !b.off && (b.fuel || 0) > 0 && def?.power > 0 && !def.decoy;
  });
  const playerLamp = state.player.lamp || {};
  const sourceRows = {
    playerLamp: { active: (playerLamp.power || 0) > 0, power: playerLamp.power || 0,
      radius: playerLamp.radius || 0, x: lightRound(state.player.x), y: lightRound(state.player.y) },
    campLights: (state.beacons || []).filter((b) => (b.power || 0) > 0).map((b) => ({
      x: b.x, y: b.y, power: b.power, radius: b.radius || 0, type: b.type || 'camp light',
    })),
    placedLights: activeBuildingSources.map((b) => ({ x: b.x, y: b.y, type: b.type,
      power: BUILD[b.type].power, radius: BUILD[b.type].radius || 0, fuel: b.fuel })),
    graves: (state.graves || []).map((g) => ({ x: g.x, y: g.y, day: g.day || state.day })),
  };
  const all = { player: true, camp: true, buildings: true, graves: true };
  const counterfactual = {
    allSources: isolatedResonanceLight(state, index, all),
    playerOnly: isolatedResonanceLight(state, index, { player: true, camp: false, buildings: false, graves: false }),
    campOnly: isolatedResonanceLight(state, index, { player: false, camp: true, buildings: false, graves: false }),
    buildingsOnly: isolatedResonanceLight(state, index, { player: false, camp: false, buildings: true, graves: false }),
    nonPlayerSources: isolatedResonanceLight(state, index, { player: false, camp: true, buildings: true, graves: true }),
    playerAndGraves: isolatedResonanceLight(state, index, { player: true, camp: false, buildings: false, graves: true }),
  };
  return { ...base, loaded: true, anchor: { x: site.x, y: site.y },
    threshold: ENDGAME.STANDARD_TRIAL.minLight, gridValue: lightRound(gridValue),
    recomputedValue: lightRound(counterfactual.allSources),
    lit: (gridValue == null ? counterfactual.allSources : gridValue) >= ENDGAME.STANDARD_TRIAL.minLight,
    sources: sourceRows,
    counterfactual: Object.fromEntries(Object.entries(counterfactual).map(([key, value]) => [key, lightRound(value)])),
    method: '生产光照计算器反事实；来源光值取最大值，不相加',
  };
}

export function resonanceReport(state) {
  const milestone = state.milestone || {};
  const progress = Object.fromEntries(ENDGAME.SITE_CHUNK_PROBES.map((probe) => {
    const site = state.resonance?.sites?.[probe.id];
    return [probe.id, site ? { ...site, trial: site.trial ? { ...site.trial } : null } : { id: probe.id, status: 'locked' }];
  }));
  const sites = ENDGAME.SITE_CHUNK_PROBES.map((p) => ({
    id: p.id,
    biome: p.biome,
    chunk: { x: p.x, y: p.y },
    actualBiome: biomeOf(p.x, p.y).id,
    hops: Math.max(Math.abs(p.x), Math.abs(p.y)),
    reachableBySurfaceExits: biomeOf(p.x, p.y).id === p.biome,
    ...siteAnchorAudit(state, p),
    role: p.id === 'first' ? '首站：邻近群系远征' : p.id === 'second' ? '二站：高风险深入' : '终站：回营地完成共鸣',
  }));
  const survey = ENDGAME.RESOURCE_AUDIT_SEEDS.map((seed) => ({ seed, resources: auditResourceSeed(seed) }));
  return {
    version: ENDGAME.VERSION,
    milestone: {
      bossDefeated: !!milestone.bossDefeated,
      bossDay: Number.isFinite(milestone.bossDay) ? milestone.bossDay : 7,
      // 老档可能只有已击败标记、没有历史日期；不要伪造为第 0 天。
      clearedDay: Number.isFinite(milestone.clearedDay) && milestone.clearedDay > 0 ? milestone.clearedDay : null,
    },
    trial: state.resonance?.trial ? { ...state.resonance.trial } : { status: 'idle', attempts: 0, result: null },
    sites: { required: ENDGAME.BEACON_COUNT, probes: sites, progress, distinctBiomes: new Set(sites.map((p) => p.actualBiome)).size },
    resourceAudit: { seeds: survey, scope: '3 个群系探针区块 + depth1–3；确定性生成、包含现行出口清理；分路线给出节点总量与夜辉草产出上限' },
    stock: Object.fromEntries(['ore', 'vine', 'fuel', 'data', 'core', 'food', 'night'].map((key) => [key, Math.max(0, Number(state.res && state.res[key]) || 0)])),
    costs: {
      status: 'R0 首轮预算；失败不额外扣料，预约费不退，R3 固定种子闭环后校准',
      construction: Object.fromEntries(Object.entries(ENDGAME.SITE_COSTS).map(([id, cost]) => [id, { ...cost }])),
      trialStart: { ...ENDGAME.TRIAL_START_COST },
      totalConstruction: Object.values(ENDGAME.SITE_COSTS).reduce((sum, cost) => {
        for (const [key, value] of Object.entries(cost)) sum[key] = (sum[key] || 0) + value;
        return sum;
      }, {}),
      fullRouteBudget: resonanceMaterialBudget(survey),
    },
    status: 'R0 基线；未探索区块用确定性基图审计，已保存区块避让现有占格；不载入、不写入或修改真实区块/存档',
    firstSite: state.resonance?.sites?.first ? { ...state.resonance.sites.first } : null,
    siteProgress: progress,
  };
}

// —— W15-C 生态观测台（E0：只读地基）——
export function ecologyReport(state) {
  const chunks = state.chunkStore ? Object.values(state.chunkStore) : [];
  const activeSurface = state.layers && state.layers.surface;
  const fronts = chunks.flatMap((c) => (c && c.map && c.map.blightFronts) || []);
  const stages = {};
  for (const f of fronts) { const k = frontStageOf(f.level); stages[k] = (stages[k] || 0) + 1; }
  const outposts = outpostReport(state);
  return {
    version: ECOLOGY.BIOME_VERSION,
    biome: biomeOf(state.chunkX || 0, state.chunkY || 0).id,
    current: { x: state.chunkX || 0, y: state.chunkY || 0 },
    chunks: { discovered: chunks.length, active: activeSurfaceChunks(state).length, limit: ECOLOGY.MAX_ACTIVE_OUTPOSTS },
    outposts,
    fronts: { count: fronts.length, cells: fronts.reduce((n, f) => n + ((f.cells && f.cells.length) || 0), 0), cap: ECOLOGY.MAX_FRONTS_PER_CHUNK * ECOLOGY.MAX_FRONT_CELLS, stages },
    patches: { count: activeSurface?.ecoPatches?.length || 0, cap: ECOLOGY.MAX_PATCHES_PER_CHUNK },
    creatures: { count: activeSurface?.ecoCreatures?.length || 0, cap: ECOLOGY.MAX_NEUTRAL_CREATURES },
    challenge: { pressure: lightPressure(state), locked: state.nightChallengeMul || 1, pressureStep: ECOLOGY.LIGHT_PRESSURE_PER_STEP, cap: ECOLOGY.LIGHT_PRESSURE_CAP },
    status: 'E3 生态斑块已接入；N6b-2d 远端前哨按当地光压记账前线并发出有限告警，不额外刷怪；无人区块冻结',
  };
}

// —— W16-D 拓荒者观测台（N0：只读，不改变行为）——
// 这里刻意不读取寻路缓存、UI 引用或对象本身，只输出后续任务板需要的稳定字段。
const CREW_JOB_LABEL = Object.freeze({
  idle: '待命', gather: '采集', eat: '进食', flee: '回营避难', guard: '守卫', forage: '夜采',
  patrol: '巡逻', mourn: '哀悼', wander: '梦游', hollow: '蚀化', refine: '炼油', build: '施工', stoke: '添火', rest: '休整', outpost: '前往前哨',
  rescue: '救援', medical: '治疗',
});

function crewEntries(state) {
  const out = [], seen = new Set();
  const add = (w, chunk, layer = 'surface') => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    out.push({ w, chunk, layer });
  };
  const here = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
  for (const w of state.workers || []) add(w, here, state.layerId || 'surface');
  for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) add(w, c, 'surface');
  for (const [id, layer] of Object.entries(state.layers || {})) {
    if (id === 'surface') continue;
    for (const w of layer.workers || []) add(w, null, id);
  }
  return out;
}

function targetPos(w) {
  const t = w.target || w.site || w.furnace || w.smelter || w.crop || w.grave || w.wanderTo;
  return t && Number.isFinite(t.x) && Number.isFinite(t.y) ? { x: t.x, y: t.y } : null;
}

function taskProjectionTarget(task, w) {
  return task && Object.prototype.hasOwnProperty.call(task, 'target') ? task.target : targetPos(w);
}

function taskReason(w) {
  const job = w.job || 'idle';
  if (!w.alive) return '已死亡，等待后续结算';
  if (w.downed) return `倒地：还可撑 ${Math.ceil(w.downT || 0)}s`;
  if (w.rescueState === 'escort') return '护送至简易铺位';
  if (w.medicalState === 'treating') return '医疗站治疗中';
  if (w.medicalState === 'queued') return '等待医疗位';
  if (w.hollow) return '已蚀化，只会朝光源移动';
  if (job === 'idle') return '待命：等待下一次工作决策';
  if (['gather', 'forage', 'build', 'refine', 'stoke', 'patrol', 'rest'].includes(job) && !targetPos(w)) return '任务已选，但暂时没有有效目标';
  if (targetPos(w) && !(w.path && w.path.length)) return '目标已选，等待或重新规划路径';
  return `执行${CREW_JOB_LABEL[job] || job}`;
}

function riskOf(w, state) {
  if (!w.alive) return { id: 'dead', label: '死亡', score: 4 };
  if (w.downed) return { id: 'downed', label: '倒地待救', score: 4 };
  if (w.hollow) return { id: 'hollow', label: '蚀化', score: 4 };
  if (w.hp <= 0 || w.hp / Math.max(1, w.maxHp || 1) < 0.35) return { id: 'injured', label: '重伤', score: 3 };
  if (w.hunger <= 0) return { id: 'starving', label: '断粮', score: 3 };
  if (w.morale < 25 || (w.sanity != null && w.sanity < 30)) return { id: 'unstable', label: '心志不稳', score: 2 };
  const offLayer = w.layerId && w.layerId !== state.layerId && w.layerId !== 'surface';
  if (offLayer) return { id: 'remote', label: '远层驻守', score: 1 };
  return { id: 'normal', label: '可工作', score: 0 };
}

export function crewReport(state) {
  const activeKeys = new Set(activeSurfaceChunks(state).map((c) => c.id));
  const entries = crewEntries(state);
  const members = entries.map(({ w, chunk, layer }, i) => {
    const card = crewCardOf(w, i, state.day || 1);
    const task = taskFromSave(w.task) || { job: w.job || 'idle', label: CREW_JOB_LABEL[w.job] || w.job || '待命', priority: 0, status: w.job ? 'planning' : 'idle', reason: taskReason(w), target: targetPos(w), reservation: null, id: w.job || 'idle' };
    const cx = w.chunkX == null ? (chunk ? chunk.cx || 0 : state.chunkX || 0) : w.chunkX;
    const cy = w.chunkY == null ? (chunk ? chunk.cy || 0 : state.chunkY || 0) : w.chunkY;
    const relations = Object.entries(w.bonds || {}).map(([name, value]) => ({ name, level: bondLevel(value) }))
      .filter((r) => r.level > 0).sort((a, b) => b.level - a.level).slice(0, COLONISTS.MAX_RELATIONS);
    const risk = riskOf(w, state);
    const light = w && state.light ? (state.light[Math.max(0, Math.min(state.map.h - 1, Math.floor(w.y))) * state.map.w + Math.max(0, Math.min(state.map.w - 1, Math.floor(w.x)))] || 0) : 0;
    const influence = roleInfluence(w, task.job, { night: isNight(state), dark: light <= 2.5, lit: light > 2.5, boss: (state.enemies || []).some((e) => e.alive && e.def && e.def.boss) });
    return {
      id: card.id,
      name: w.name,
      identity: {
        role: card.role, roleName: COLONISTS.ROLES[card.role].name,
        personality: card.personality, personalityName: COLONISTS.PERSONALITIES[card.personality].name,
        taboo: COLONISTS.PERSONALITIES[card.personality].taboo,
        origin: card.origin, joinedDay: card.joinedDay, palette: card.palette, portrait: card.portrait,
        events: (card.events || []).map((e) => ({ day: e.day | 0, kind: e.kind, text: e.text })),
      },
      status: {
        alive: !!w.alive, downed: !!w.downed, downT: +((w.downT || 0).toFixed(1)), rescueState: w.rescueState || 'none', rescueBed: w.rescueBed || null, rescueRestT: +((w.rescueRestT || 0).toFixed(1)), rescueWound: w.rescueWound | 0, medicalState: w.medicalState || 'none', medicalClinic: w.medicalClinic || null, medicalT: +((w.medicalT || 0).toFixed(1)),
        hp: +((w.hp || 0).toFixed(1)), maxHp: w.maxHp || 0,
        hunger: +((w.hunger || 0).toFixed(1)), morale: +((w.morale || 0).toFixed(1)), sanity: +(w.sanity == null ? 100 : w.sanity).toFixed(1),
        hollow: !!w.hollow, grief: w.grief || 0,
        deathRecord: w.deathRecord ? { day: w.deathRecord.day | 0, cause: w.deathRecord.cause || '伤势过重', x: w.deathRecord.x | 0, y: w.deathRecord.y | 0, layerId: w.deathRecord.layerId || 'surface' } : null,
      },
      task: { id: task.id, job: task.job, label: task.label, priority: task.priority, status: task.status, reason: task.reason || taskReason(w), target: taskProjectionTarget(task, w), reservation: task.reservation || null, pathNodes: (w.path || []).length },
      directive: directiveFromSave(w.directive),
      influence,
      risk,
      relation: { count: relations.length, strongest: relations },
      location: { layer, chunk: { x: cx, y: cy }, x: +((w.x || 0).toFixed(2)), y: +((w.y || 0).toFixed(2)), active: layer === 'surface' ? activeKeys.has(`${cx},${cy}`) : layer === state.layerId },
    };
  });
  return {
    version: COLONISTS.VERSION,
    schema: ['id', 'name', 'identity', 'status', 'task', 'directive', 'influence', 'risk', 'relation', 'location'],
    bounds: { maxRelations: COLONISTS.MAX_RELATIONS, maxActiveTasks: COLONISTS.MAX_ACTIVE_TASKS, maxMemorialEvents: COLONISTS.MAX_MEMORIAL_EVENTS, maxEvents: COLONISTS.MAX_EVENTS, maxReviveUses: SURVIVAL.REVIVE.MAX_USES },
    memorial: (state.memorial || []).slice(-COLONISTS.MAX_MEMORIAL_EVENTS).map((m) => ({
      type: 'death', crewId: m.crewId || null, name: m.name, day: m.day | 0, x: m.x | 0, y: m.y | 0,
      layerId: m.layerId || 'surface', cause: m.cause || '伤势过重',
      revived: !!m.revived, reviveDay: m.revived ? (m.reviveDay | 0) : 0,
      affected: (m.affected || []).slice(0, COLONISTS.MAX_RELATIONS).map((a) => ({ name: a.name, level: a.level | 0 })),
    })),
    board: taskBoardStats(state),
    totals: {
      all: members.length, alive: members.filter((m) => m.status.alive).length,
      active: members.filter((m) => m.location.active && m.status.alive).length,
      down: members.filter((m) => m.status.downed).length,
    },
    members,
  };
}

// 抗性表 → 一行展示（只列非 1 的项；没有就写"—"）
function armorRow(def) {
  const a = (def && def.armor) || {};
  const out = [];
  for (const t of TYPE_ORDER) {
    const v = a[t];
    if (!v || Math.abs(v - 1) < 1e-9) continue;
    out.push(`${TYPE_NAME[t]}×${v}`);
  }
  return out.length ? out.join(' ') : '—';
}

// 各塔按自己的伤害类型对某只敌人的单发伤害
function towerShotVs(state, def, tdmg) {
  const out = {};
  for (const k of towerTypes()) {
    const t = BUILD[k];
    if (def.air && !t.air) { out[t.name] = '打不到（不对空）'; continue; }
    out[t.name] = +(payloadStats(t, []).单发 * tdmg * armorMul(def, t.dmgType || TYPES.GENERAL)).toFixed(1);
  }
  return out;
}

// —— 战斗数值总表 ——
export function combatTable(state) {
  const pm = (state.pulseMul || 1) * pulseMul(state);
  const towers = {};
  for (const k in BUILD) {
    const d = BUILD[k];
    if (!d.dmg) continue;
    towers[k] = { name: d.name, dmg: d.dmg, range: d.range, cd: d.cd, aoe: d.aoe || 0, air: !!d.air, hp: d.hp };
  }
  const enemies = {};
  for (const k in ENEMIES) {
    const d = ENEMIES[k];
    enemies[k] = {
      name: d.name, hp: d.hp, dmg: d.dmg, speed: d.speed, hitR: d.hitR, weight: d.weight,
      flag: [d.boss && 'boss', d.breaker && '破墙', d.air && '飞行', d.lampPref && '优先啃灯', d.lightFear && '畏光'].filter(Boolean).join('/') || '—',
      黎明消解: d.dawnFade,
      抗性: armorRow(d), 弱点: weakTextOf(k),   // 抗性表 + 由它生成的文案（两处必须一致）
    };
  }
  return {
    光爆: {
      伤害: +(PULSE.DAMAGE * pm).toFixed(1), 范围: +(PULSE.RANGE * pulseRangeMul(state)).toFixed(2),
      冷却: PULSE.COOLDOWN, 燃料: PULSE.FUEL,
      乘子: { 研究: pulseMul(state), 范围研究: pulseRangeMul(state), 里程碑: state.pulseMul || 1 },
    },
    塔: { 开火光照: TOWER.LIGHT_MIN, 技师生效: hasTinker(state) ? TOWER.TINKER_RATE : 1,
      乘子: { 伤害: towerDmgMul(state), 射速: towerRateMul(state), 对空: owlDmgMul(state) } },
    波次: Object.assign({}, WAVES),
    Boss: Object.assign({}, BOSS, { 当前轮次: state.bossTier || 0 }),
    图鉴解锁加成: UNLOCK_BONUS,
    伤害类型: TYPE_ORDER.map((t) => TYPE_NAME[t]).join(' / ') + '（未标类型 = 常规，不吃抗性）',
    畏光灼烧: `${LIGHT_FEAR_BURN}/秒（走常规伤害，不与 armor.light 叠加）`,
    敌人: enemies,
    塔属性: towers,
  };
}

// —— 当前波次状态 ——
export function waveReport(state) {
  const surf = (state.layers && state.layers.surface) || null;
  const arr = (surf && surf.enemies) || state.enemies || [];
  const tide = tideOf(state);
  const dm = state.diff || { waveMul: 1, capMul: 1 };
  const bossNight = state.day % BOSS.EVERY === 0;
  const byKind = {};
  for (const e of alive(arr)) byKind[e.ekind] = (byKind[e.ekind] || 0) + 1;
  // 这一夜的"计划"（W14-A 第 4 步）：主题 × 时段 —— 与 waves.js 用的是**同一个函数**，不会分家
  const plan = nightPlan(state);
  const hud = nightHud(state);
  // 下一批构成：**直接采样 nightPlan 的加权表**（不在这里重写一遍公式 —— 那样两处一定会分家）
  const N = 20000, dist = {};
  for (let i = 0; i < N; i++) { const k = pickKind(plan, Math.random); dist[k] = (dist[k] || 0) + 1; }
  for (const k in dist) dist[k] = +(dist[k] / N).toFixed(3);
  return {
    天: state.day, t: +(state.t || 0).toFixed(1), 蚀潮中: isTide(state), 潮位: tide,
    今夜主题: plan.theme.name, 主题说明: plan.theme.note, 主题签名兵种: signatureOf(plan.theme).map((k) => ENEMIES[k].name),
    当前时段: plan.seg.name, 时段进度: `${plan.seg.upTo}s 前`,
    下波主力: ENEMIES[mainKindOf(plan)].name, 下波预告: hud.soon ? `剩 ${hud.secs}s` : '—',
    时段乘子: { 间隔: plan.intervalMul, 每批加: plan.batchAdd },
    同屏上限: Math.round((WAVES.CAP_BASE + tide * WAVES.CAP_PER_TIDE + (bossNight ? WAVES.CAP_BOSS_NIGHT : 0)) * (dm.capMul || 1)),
    刷新间隔: +(Math.max(WAVES.INTERVAL_MIN, WAVES.INTERVAL_MAX - tide * WAVES.INTERVAL_PER_TIDE) * (dm.waveMul || 1) * plan.intervalMul).toFixed(2),
    每批只数: 1 + Math.floor(tide / WAVES.BATCH_DIV) + plan.batchAdd,
    大潮夜: bossNight, 今晚Boss已出: !!state.bossSpawnedThisNight, 宁静剩余: +(state.noSpawnT || 0).toFixed(1),
    场上: alive(arr).length, 构成: byKind, 出怪概率: dist,
    只从黑暗出: `光照 < ${WAVES.DARK_MAX}`, 蚀痕加成: `≥${WAVES.BLIGHT_LV} 级 → 血/伤 +${Math.round(WAVES.BLIGHT_BOOST * 100)}%/级`,
  };
}

// —— 敌人行为观测（W14-A 第 3 步）——
// 用途：① 验证四条判据时直接读它（谁在蓄力/突进/引信/被庇护）
//       ② 第 4 步做“主题夜”与第 8 步调难度时，用来看“场上到底有多少个行为在跑”
export function abilityReport(state) {
  const arr = alive((state.enemies) || []);
  const per = {};
  const row = (k) => (per[k] || (per[k] = { 数量: 0, 蓄力中: 0, 突进中: 0, 引信中: 0, 被庇护: 0 }));
  for (const e of arr) {
    const r = row(e.ekind);
    r.数量++;
    if (e.windT > 0) r.蓄力中++;
    if (e.dashT > 0) r.突进中++;
    if (e.fuseT > 0) r.引信中++;
    if (e.auraT > 0) r.被庇护++;
  }
  return {
    调参: ABILITY,
    场上: arr.length,
    逐兵种: per,
    有行为的兵种: KINDS.filter((k) => ENEMIES[k].ability),
    玩法提示: {
      吐蚀: `玩家在 ${ABILITY.spit.RANGE} 格内且不贴身时它会隔墙吐（预警线看得见）`,
      冲锋: `${ABILITY.charge.RANGE} 格内蓄力 ${ABILITY.charge.WINDUP}s → 锁定方向 ×${ABILITY.charge.MUL} 速突进 ${ABILITY.charge.DASH}s`,
      自爆: `血量 ≤${Math.round(ABILITY.bomb.HP_FRAC * 100)}% 引信 ${ABILITY.bomb.FUSE}s → ${ABILITY.bomb.RADIUS} 格内玩家 ${ABILITY.bomb.DMG_PLAYER} / 同族 ${ABILITY.bomb.DMG_BEAST}（能连锁，不算玩家击杀）`,
      光环: `${ABILITY.aura.RANGE} 格内同族 ×${ABILITY.aura.SPEED_MUL} 速`,
    },
  };
}

// —— 理论 DPS（含当前乘子与"对具体敌人"的有效伤害）——
export function dpsReport(state) {
  const pm = (state.pulseMul || 1) * pulseMul(state);
  const pulseDmg = PULSE.DAMAGE * pm;
  const rate = towerRateMul(state) * (hasTinker(state) ? TOWER.TINKER_RATE : 1);
  const tdmg = towerDmgMul(state);
  const towers = {};
  for (const k of towerTypes()) {
    const d = BUILD[k];
    // 2a 阶段塔还没有载荷实例 → 0 槽 = 现状（数值必须与第 1 步逐格一致，这就是"零变化"的证据）
    const base = payloadStats(d, []);
    towers[k] = {
      name: d.name, 单发: +(base.单发 * tdmg).toFixed(1), 每秒: +(base.每秒 * tdmg * rate).toFixed(1),
      每秒开火次数: +(rate / base.cd).toFixed(2), 射程: base.射程, 需光照: TOWER.LIGHT_MIN, 对空: !!d.air,
      类型: TYPE_NAME[base.类型] || '常规',
      ...(d.aoe ? { 范围: d.aoe, 每发命中上限: '范围内全体' } : { 范围: 0 }),
    };
  }
  const eff = {};
  for (const k in ENEMIES) {
    const d = ENEMIES[k];
    const m = damageMul(state, k);
    const hit = pulseDmg * m * armorMul(d, TYPES.LIGHT);   // 光爆 = 光伤 → 吃 armor.light
    eff[k] = {
      名称: d.name, 血量: d.hp, 图鉴乘子: m, 抗性: armorRow(d),
      光爆单发: +hit.toFixed(1), 需要几发击杀: Math.ceil(d.hp / hit),
      塔单发: towerShotVs(state, d, tdmg),
    };
  }
  return {
    玩家光爆: { 单发: +pulseDmg.toFixed(1), 范围: +(PULSE.RANGE * pulseRangeMul(state)).toFixed(2),
      每秒: +(pulseDmg / PULSE.COOLDOWN).toFixed(1), 每秒燃料: +(PULSE.FUEL / PULSE.COOLDOWN).toFixed(2),
      注: '理论值；实际扣燃料走容器账本（withdrawOne），不许白嫖' },
    塔: towers,
    对每种敌人的有效伤害: eff,
    塔需光照: TOWER.LIGHT_MIN,
  };
}

// —— 载荷穷举台（W14-A 第 2 步）——
// 一次印出 **全部合法组合** 的数值，用来自动发现"强到破坏平衡的组合"。
// 表里的数值全部来自 payloadStats()（与游戏内面板/悬停同源）—— 这里不与实现分家。
export function labReport(state) {
  const rows = allCombos().map((c) => {
    const s = c.stats;
    return {
      塔: c.def.name, 载荷: c.mods.length ? c.mods.map((m) => MODS[m].name).join('·') : '（空载）',
      单发: s.单发, 每秒: s.每秒, 多靶每秒: s.多靶每秒,
      每发燃耗: s.每发燃耗, 燃耗每秒: s.燃耗每秒,
      命中上限: s.命中上限, 射程: s.射程, 类型: TYPE_NAME[s.类型] || '常规',
      减速: s.减速 ? `×${s.减速.mul}` : '—', 净化: s.净化半径 || '—',
    };
  });
  const 基准 = {};
  for (const t of towerTypes()) 基准[BUILD[t].name] = payloadStats(BUILD[t], []).每秒;
  return {
    塔数: towerTypes().length, 载荷数: allLoads().length, 组合数: rows.length,
    基准单靶每秒: 基准,
    数值门: { 下限: '0.3 × 该塔基准', 上限: '6 × 该塔基准', 每修饰器燃耗: FUEL_PER_MOD, 槽位上限: MAX_SLOTS },
    每槽乘子区间: dmgMulRange(),
    当前乘子: { 塔伤: towerDmgMul(state), 射速: towerRateMul(state), 技师: hasTinker(state) ? TOWER.TINKER_RATE : 1 },
    注: '本表是 0 槽基准 × 组合乘子（未乘上头的研究/技师）；游戏内塔的显示值同样走 payloadStats()',
    行: rows,
  };
}
