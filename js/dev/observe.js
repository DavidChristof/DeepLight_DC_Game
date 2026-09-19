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
import { BUILD } from '../data/buildings.js';
import { EXPEDITION } from '../data/expedition.js';
import { CAMP_CAP, PACK_CAP } from '../data/storage.js';
import { CARRY } from '../data/combat.js';
import { ENEMIES, KINDS } from '../data/enemies.js';
import { nightPlan, signatureOf, mainKindOf, nightHud, pickKind } from '../data/night.js';
import { UNLOCK_BONUS, weakTextOf } from '../data/codex.js';
import { MODS, FUEL_PER_MOD, MAX_SLOTS, allLoads, allCombos, towerTypes, payloadStats, dmgMulRange } from '../data/payload.js';
import { pulseMul, pulseRangeMul, towerDmgMul, towerRateMul, owlDmgMul } from '../systems/research.js';
import { damageMul } from '../systems/codex.js';
import { hasTinker, bondLevel } from '../systems/mind.js';
import { isTide, isNight } from '../core/time.js';
import { SURVIVAL } from '../data/survival.js';
import { injuryName, restBeds, restCount } from '../systems/survival.js';
import { T } from '../world/map.js';
import { nodeMax } from '../data/nodes.js';
import { ECOLOGY, biomeOf, frontStageOf } from '../data/ecology.js';
import { lightPressure } from '../systems/ecoPressure.js';
import { activeSurfaceChunks, outpostReport } from '../world/chunks.js';
import { visualSpec } from '../data/visual.js';
import { assetStats } from '../core/assets.js';
import { COLONISTS, crewCardOf, roleInfluence } from '../data/colonists.js';
import { taskFromSave, directiveFromSave } from '../data/tasks.js';
import { taskBoardStats } from '../systems/taskBoard.js';

const alive = (arr) => (arr || []).filter((e) => e && e.alive);

export function visualReport() {
  const spec = visualSpec();
  return {
    ...spec,
    semanticCount: Object.values(spec.semantic || {}).reduce((sum, count) => sum + count, 0),
    assets: assetStats(),
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
    deathPack: state.deathPack ? { layerId: state.deathPack.layerId, day: state.deathPack.day, items: Object.assign({}, state.deathPack.stock || {}), held: state.deathPack.held || null } : null,
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
