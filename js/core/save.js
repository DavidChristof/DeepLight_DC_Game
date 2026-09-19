// core/save.js —— 存档：3 个手动槽位 + 1 个自动槽位（localStorage）
import { taskForSave, directiveForSave } from '../data/tasks.js';
import { COLONISTS } from '../data/colonists.js';

const KEY = 'deep-light-saves-v2';      // { auto: data, s1: data, s2: data, s3: data }
const LEGACY = 'deep-light-save-v1';    // 旧版单槽存档，首次运行时迁移到 auto

export const SLOTS = ['s1', 's2', 's3'];

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) { /* 忽略 */ }
  return {};
}
function writeAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* 忽略隐私模式错误 */ }
}

// 旧版单槽 → 迁移到 auto（只做一次）
export function migrateLegacy() {
  const all = readAll();
  if (all.auto) return false;
  try {
    const old = localStorage.getItem(LEGACY);
    if (!old) return false;
    all.auto = { ...JSON.parse(old), at: Date.now(), legacy: true };
    writeAll(all);
    localStorage.removeItem(LEGACY);
    return true;
  } catch (e) { return false; }
}

// 蚀痕（只有地表层，稀疏存储：[索引, 等级]）
function packBlight(state) {
  const m = state.map;
  if (!m || !m.blight) return [];
  const out = [];
  for (let i = 0; i < m.blight.length; i++) if (m.blight[i] > 0) out.push(i, m.blight[i]);
  return out;
}

function packBuilding(b) {
  return { type: b.type, x: b.x, y: b.y, hp: b.hp == null ? null : Math.round(b.hp), fuel: b.fuel || 0, growth: b.growth || 0, level: b.level == null ? 1 : b.level, site: b.site ? 1 : 0, work: Math.round(b.work || 0), stock: b.stock || null, craft: b.craft || null, prog: b.prog || 0, made: b.made || 0, off: b.off ? 1 : 0, open: b.open == null ? null : !!b.open, recipe: b.recipe || null, fireMat: b.fireMat || null, mods: b.mods && b.mods.length ? b.mods.slice() : null, natural: b.natural ? 1 : 0, entry: b.entry ? 1 : 0, mounted: b.mounted ? 1 : null };
}

function packFront(f) {
  return { x: f.x | 0, y: f.y | 0, core: f.core | 0, cells: Array.isArray(f.cells) ? f.cells.slice() : [], level: f.level | 0, growT: +f.growT || 0, pressure: f.pressure | 0, source: f.source || 'legacy' };
}

function packChunks(state) {
  const out = [];
  for (const c of Object.values(state.chunkStore || {})) {
    if (!c || !c.map) continue;
    const nodes = [];
    for (let i = 0; i < c.map.nodeAmt.length; i++) if (c.map.nodeAmt[i]) nodes.push(i, c.map.nodeAmt[i]);
    const blight = [];
    if (c.map.blight) for (let i = 0; i < c.map.blight.length; i++) if (c.map.blight[i]) blight.push(i, c.map.blight[i]);
    out.push({ x: c.cx || 0, y: c.cy || 0, biome: c.biome || c.map.biome || null, buildings: (c.buildings || []).map(packBuilding), beacons: (c.beacons || []).map((b) => ({ ...b, stock: b.stock ? { ...b.stock } : undefined })), nodes, blight, fronts: (c.map.blightFronts || []).map(packFront), patches: (c.ecoPatches || []).map((p) => ({ ...p })), creatures: (c.ecoCreatures || []).map((e) => ({ ...e })), outpost: c.outpost ? { nextT: +c.outpost.nextT || 0, ticks: c.outpost.ticks | 0, lightPressure: +c.outpost.lightPressure || 0, frontDebt: c.outpost.frontDebt | 0, lastEcology: { ...(c.outpost.lastEcology || {}) }, alerts: (c.outpost.alerts || []).slice(-3).map((a) => ({ ...a })), lastYield: { ...(c.outpost.lastYield || {}) }, lastNeeds: { ...(c.outpost.lastNeeds || {}) }, lastReason: String(c.outpost.lastReason || '') } : null, nightops: c.nightops ? { day: c.nightops.day || 0, tideOn: !!c.nightops.tideOn, blooms: (c.nightops.blooms || []).map((b) => ({ ...b })), vents: (c.nightops.vents || []).map((v) => ({ ...v })) } : null });
  }
  return out;
}

export function snapshot(state) {
  return {
    at: Date.now(),
    seed: state.seed,
    day: state.day,
    t: state.t,
    // 夜战“记账”（B21）：不存它就会导致读档后重放“蚀潮降临”边沿、
    // 且当晚大潮 Boss 再降临一次（bossTier 还会再加一次 = 自己刷难度）。
    // 散怪/Boss 本体不存是有意的（“读档清夜”），但“今晚算不算已经考过试”必须存。
    spawnT: state.spawnT || 0,
    noSpawnT: state.noSpawnT || 0,
    wasTide: !!state.wasTide,
    wasDawn: !!state.wasDawn,
    nightLightPressure: state.nightLightPressure || 0,
    nightChallengeMul: state.nightChallengeMul || 1,
    reviveCount: state.reviveCount | 0,
    bossSpawnedThisNight: !!state.bossSpawnedThisNight,
    rescue: state.rescue ? {
      actor: state.rescue.actor || 'player', phase: state.rescue.phase || 'stabilize',
      t: +state.rescue.t || 0, bed: state.rescue.bed ? { x: state.rescue.bed.x | 0, y: state.rescue.bed.y | 0 } : null,
      worker: state.rescue.worker ? { id: state.rescue.worker.crew && state.rescue.worker.crew.id || null, name: state.rescue.worker.name } : null,
      rescuer: state.rescue.rescuer ? { id: state.rescue.rescuer.crew && state.rescue.rescuer.crew.id || null, name: state.rescue.rescuer.name } : null,
    } : null,
    lastSealDay: state.lastSealDay | 0,        // 封灯撤退的冷却起点（第 7 步）：不存的话读档就能刷新冷却
    diff: state.diffKey || 'normal',
    px: state.player ? state.player.x : 0,
    py: state.player ? state.player.y : 0,
    res: state.res,
    kills: state.kills || 0,
    playerHp: state.playerHp,
    playerMaxHp: state.playerMaxHp,
    playerHunger: state.playerHunger,
    playerInjury: state.playerInjury,
    pulseMul: state.pulseMul,
    bossTier: state.bossTier,
    milestone: state.milestone,
    research: state.research,
    layerId: state.layerId,
    chunkX: state.chunkX || 0,
    chunkY: state.chunkY || 0,
    equip: state.equip || { held: null },          // 玩家手上的工具
    buildings: state.buildings.map(packBuilding),
    chunks: packChunks(state),
    stores: {
      beacons: ((state.layers && state.layers.surface && state.layers.surface.beacons) || []).map((b) => Object.assign({}, b.stock || {})),
      pack: Object.assign({}, (state.pack && state.pack.stock) || {}),
    },
    blight: packBlight(state),
    fronts: ((state.map && state.map.blightFronts) || []).map(packFront),
    patches: ((state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`] && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`].ecoPatches) || []).map((p) => ({ ...p })),
    creatures: ((state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`] && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`].ecoCreatures) || []).map((e) => ({ ...e })),
    relics: state.relics || {},                    // 残页收藏 { seriesId: [idx] }
    relicTiles: state.relicTiles || {},            // 已经掉过残页的碑
    observed: state.observed || {},                // 观察类知识计数（被渗漏咬过…）
    body: state.body || {},                        // 身体换来的知识计数（岩浆…）
    graves: (state.graves || []).map(g => ({ x: g.x, y: g.y, name: g.name, day: g.day, layerId: g.layerId || 'surface' })),
    memorial: (state.memorial || []).slice(-COLONISTS.MAX_MEMORIAL_EVENTS).map((m) => ({
      type: 'death', crewId: m.crewId || null, name: m.name, day: m.day, x: m.x, y: m.y,
      layerId: m.layerId || 'surface', cause: m.cause || '伤势过重',
      affected: (m.affected || []).slice(0, COLONISTS.MAX_RELATIONS).map((a) => ({ name: a.name, level: a.level | 0 })),
      revived: !!m.revived, reviveDay: m.revived ? (m.reviveDay | 0) : 0,
      snapshot: m.snapshot && typeof m.snapshot === 'object' ? {
        traits: m.snapshot.traits && typeof m.snapshot.traits === 'object' ? { good: m.snapshot.traits.good, bad: m.snapshot.traits.bad } : null,
        crew: m.snapshot.crew && typeof m.snapshot.crew === 'object' ? { ...m.snapshot.crew } : null,
        maxHp: Math.max(1, Number(m.snapshot.maxHp) || 90), hunger: Math.max(0, Math.min(100, Number(m.snapshot.hunger) || 0)),
        morale: Math.max(0, Math.min(100, Number(m.snapshot.morale) || 0)), sanity: Math.max(0, Math.min(100, Number(m.snapshot.sanity) || 0)),
        bonds: m.snapshot.bonds && typeof m.snapshot.bonds === 'object' ? { ...m.snapshot.bonds } : {},
      } : null,
    })),
    deathPack: state.deathPack ? { x: state.deathPack.x, y: state.deathPack.y, layerId: state.deathPack.layerId, stock: Object.assign({}, state.deathPack.stock || {}), held: state.deathPack.held || null, day: state.deathPack.day || state.day } : null,
    mind: state.mind || null,
    seen: state.seen || {},                        // 首次提示：读档后不要再说一遍
    // N6b：快照必须收集所有已载入区块的成员；只拼原点会让“回营地存档”的远端前哨成员丢失。
    workers: ([...(state.workers || []), ...Object.values(state.chunkStore || {}).flatMap((c) => c && c.workers || [])].filter((w, i, a) => a.indexOf(w) === i)).map(w => ({
      name: w.name, hp: w.hp, hunger: w.hunger, morale: w.morale, x: w.x, y: w.y, layerId: w.layerId,
      chunkX: w.chunkX || 0, chunkY: w.chunkY || 0,
      outpostTravel: w.outpostTravel && w.outpostTravel.to && w.outpostTravel.from ? {
        from: { x: w.outpostTravel.from.x | 0, y: w.outpostTravel.from.y | 0 },
        to: { x: w.outpostTravel.to.x | 0, y: w.outpostTravel.to.y | 0 },
        t: Math.max(0, Number(w.outpostTravel.t) || 0), blocked: !!w.outpostTravel.blocked,
      } : null,
      crew: w.crew ? { ...w.crew } : null,
      task: taskForSave(w.task),
      directive: directiveForSave(w.directive),
      traits: w.traits || null, sanity: w.sanity, bonds: w.bonds || null,
      grief: w.grief || 0, hollow: !!w.hollow, grave: w.grave || null,
      deathRecord: w.deathRecord ? { ...w.deathRecord } : null,
      alive: w.alive !== false, downed: !!w.downed, downT: +w.downT || 0,
      rescueWound: w.rescueWound | 0, rescueWoundT: +w.rescueWoundT || 0,
      rescueState: w.rescueState === 'escort' ? 'escort' : 'none', rescueBed: w.rescueBed ? { x: w.rescueBed.x | 0, y: w.rescueBed.y | 0 } : null, rescueRestT: +w.rescueRestT || 0,
      medicalState: ['queued', 'treating'].includes(w.medicalState) ? w.medicalState : 'none',
      medicalClinic: w.medicalClinic ? { x: w.medicalClinic.x | 0, y: w.medicalClinic.y | 0 } : null,
      medicalT: +w.medicalT || 0,
      tool: w.tool || null,                       // 工具跟着人走
      overwork: w.overwork || 0, shiftDay: w.shiftDay == null ? -1 : w.shiftDay,
    })),
  };
}

export function saveGame(state, slot = 'auto') {
  const all = readAll();
  all[slot] = snapshot(state);
  writeAll(all);
  return all[slot];
}

export function loadGame(slot = 'auto') {
  const all = readAll();
  return all[slot] || null;
}

export function deleteSave(slot) {
  const all = readAll();
  delete all[slot];
  writeAll(all);
}

export function listSaves() {
  const all = readAll();
  return ['auto', ...SLOTS].map((id) => ({ id, data: all[id] || null }));
}

// 最近一次存档（「继续游戏」用）
export function latestSlot() {
  const list = listSaves().filter(s => s.data);
  if (!list.length) return null;
  list.sort((a, b) => (b.data.at || 0) - (a.data.at || 0));
  return list[0];
}

export function clearSave() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY); } catch (e) { /* 忽略 */ }
}

export function prettyTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function slotLabel(id) {
  return id === 'auto' ? '自动存档' : `存档位 ${id.slice(1)}`;
}

