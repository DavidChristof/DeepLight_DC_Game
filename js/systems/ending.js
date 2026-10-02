// systems/ending.js —— W20-R R5：以本局真实事实封存一次结局记录
import { ENDGAME } from '../data/endgame.js';

const SITE_IDS = ENDGAME.SITE_CHUNK_PROBES.map((site) => site.id);
const RUN_STAT_KEYS = Object.freeze([
  'maxLightPressure', 'nightHarvests', 'rescues', 'hollowings', 'soothings', 'workerDeaths', 'revivals',
]);
const OUTCOME_IDS = Object.freeze(Object.keys(ENDGAME.ENDING.OUTCOMES));

export function createRunStats() {
  return {
    version: ENDGAME.ENDING.VERSION,
    maxLightPressure: 0,
    nightHarvests: 0,
    rescues: 0,
    hollowings: 0,
    soothings: 0,
    workerDeaths: 0,
    revivals: 0,
  };
}

export function normalizeRunStats(saved) {
  if (!saved || typeof saved !== 'object' || saved.version !== ENDGAME.ENDING.VERSION) return null;
  const stats = { version: ENDGAME.ENDING.VERSION };
  for (const key of RUN_STAT_KEYS) {
    const value = saved[key];
    stats[key] = Number.isFinite(value) && value >= 0 ? Math.min(ENDGAME.ENDING.COUNT_MAX, Math.floor(value)) : null;
  }
  return stats;
}

export function recordRunCount(state, key, amount = 1) {
  if (!state || !state.runStats || !RUN_STAT_KEYS.includes(key) || key === 'maxLightPressure') return false;
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const current = state.runStats[key];
  if (!add || !Number.isFinite(current) || current < 0) return false;
  state.runStats[key] = Math.min(ENDGAME.ENDING.COUNT_MAX, current + add);
  return true;
}

export function recordRunMaximum(state, key, value) {
  if (!state || !state.runStats || key !== 'maxLightPressure' || !Number.isFinite(value) || value < 0) return false;
  const current = state.runStats[key];
  if (!Number.isFinite(current) || current < 0) return false;
  state.runStats[key] = Math.max(current, Math.min(ENDGAME.ENDING.COUNT_MAX, value));
  return true;
}

function sitesComplete(state) {
  return SITE_IDS.every((id) => state?.resonance?.sites?.[id]?.status === 'complete');
}

function crewStatus(worker) {
  if (!worker || worker.alive === false) return '离去';
  if (worker.hollow) return '蚀化';
  if (worker.downed) return '倒地';
  return '幸存';
}

function positiveDay(value) { return Number.isInteger(value) && value > 0 ? value : null; }
function gridValue(value) { return Number.isInteger(value) ? value : null; }

function outcomeFor(state) {
  const workers = Array.isArray(state.workers) ? state.workers : [];
  const livingCrew = workers.filter((worker) => worker.alive !== false && !worker.hollow).length;
  if (livingCrew >= ENDGAME.ENDING.MIN_DAWN_CREW) return 'dawn';
  if (workers.length || (Array.isArray(state.memorial) && state.memorial.some((event) => event && event.type === 'death'))) return 'solitude';
  return 'afterglow';
}

function siteFacts(state) {
  return ENDGAME.SITE_CHUNK_PROBES.map((probe) => {
    const site = state.resonance.sites[probe.id] || {};
    return {
      id: probe.id,
      biome: probe.biome,
      chunkX: gridValue(site.chunkX), chunkY: gridValue(site.chunkY),
      x: gridValue(site.x), y: gridValue(site.y),
      completedDay: positiveDay(site.completedDay),
    };
  });
}

function legacySettledDay(sites) {
  const finalSite = sites.find((site) => site.id === 'third');
  return finalSite ? positiveDay(finalSite.completedDay) : null;
}

function makeEndingRecord(state, legacy = false) {
  const knownStats = normalizeRunStats(state.runStats);
  const sites = siteFacts(state);
  const memorial = !legacy && knownStats && Array.isArray(state.memorial)
    ? state.memorial.map((event) => ({
      name: String(event.name || '拓荒者').slice(0, 48),
      day: positiveDay(event.day),
      cause: String(event.cause || '未记录').slice(0, 48),
      revived: !!event.revived,
    })) : null;
  const crew = legacy ? null : [
    { id: 'player', name: '你', status: state.playerDead ? '倒地' : '幸存' },
    ...(Array.isArray(state.workers) ? state.workers : []).map((worker) => ({
      id: String(worker.crew?.id || worker.name || 'crew').slice(0, 48),
      name: String(worker.name || '拓荒者').slice(0, 48),
      status: crewStatus(worker),
    })),
  ];
  const milestoneDay = positiveDay(state.milestone?.clearedDay);
  const settledDay = legacy ? legacySettledDay(sites) : positiveDay(state.day);
  return {
    version: ENDGAME.ENDING.VERSION,
    id: legacy ? 'afterglow' : outcomeFor(state),
    settledDay,
    legacy: !!legacy,
    award: { id: ENDGAME.ENDING.AWARD_ID, granted: true, day: legacy ? null : settledDay },
    bossDay: milestoneDay,
    kills: !legacy && Number.isFinite(state.kills) ? Math.max(0, Math.floor(state.kills)) : null,
    crew,
    memorial,
    graveCount: !legacy && Array.isArray(state.graves) ? state.graves.length : null,
    stats: knownStats,
    sites,
  };
}

export function normalizeEndingRecord(saved) {
  if (!saved || typeof saved !== 'object' || saved.version !== ENDGAME.ENDING.VERSION || !OUTCOME_IDS.includes(saved.id)) return null;
  const facts = Array.isArray(saved.sites) ? saved.sites : [];
  const sites = ENDGAME.SITE_CHUNK_PROBES.map((probe) => {
    const site = facts.find((row) => row && row.id === probe.id) || {};
    return {
      id: probe.id, biome: probe.biome,
      chunkX: gridValue(site.chunkX), chunkY: gridValue(site.chunkY),
      x: gridValue(site.x), y: gridValue(site.y),
      completedDay: positiveDay(site.completedDay),
    };
  });
  const crew = Array.isArray(saved.crew) ? saved.crew.map((row) => ({
    id: String(row?.id || 'crew').slice(0, 48),
    name: String(row?.name || '拓荒者').slice(0, 48),
    status: ['幸存', '倒地', '蚀化', '离去'].includes(row?.status) ? row.status : '离去',
  })) : null;
  const memorial = Array.isArray(saved.memorial) ? saved.memorial.map((event) => ({
    name: String(event?.name || '拓荒者').slice(0, 48),
    day: positiveDay(event?.day),
    cause: String(event?.cause || '未记录').slice(0, 48),
    revived: !!event?.revived,
  })) : null;
  const award = saved.award && saved.award.id === ENDGAME.ENDING.AWARD_ID && saved.award.granted === true
    ? { id: ENDGAME.ENDING.AWARD_ID, granted: true, day: positiveDay(saved.award.day) } : null;
  if (!award) return null;
  return {
    version: ENDGAME.ENDING.VERSION,
    id: saved.id,
    settledDay: positiveDay(saved.settledDay),
    legacy: !!saved.legacy,
    award,
    bossDay: positiveDay(saved.bossDay),
    kills: Number.isFinite(saved.kills) && saved.kills >= 0 ? Math.floor(saved.kills) : null,
    crew, memorial,
    graveCount: Number.isInteger(saved.graveCount) && saved.graveCount >= 0 ? saved.graveCount : null,
    stats: normalizeRunStats(saved.stats),
    sites,
  };
}

// 由第三站黎明结算调用。已有记录永不重算，避免读档/重试重复授予。
export function settleResonanceEnding(state) {
  if (!state || normalizeEndingRecord(state.ending) || !sitesComplete(state)) return false;
  state.ending = makeEndingRecord(state, false);
  state._endingPending = true;
  return true;
}

// 旧档已有三站完成事实但没有 R5 快照时，只补一条“余辉”记录；未知历史留空。
export function restoreLegacyEnding(state) {
  if (!state || normalizeEndingRecord(state.ending) || !sitesComplete(state)) return false;
  state.ending = makeEndingRecord(state, true);
  state._endingPending = false;
  return true;
}
