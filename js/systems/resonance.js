// systems/resonance.js —— W20-R 三座共鸣地点：持久选址、施工与反冲状态
import { ENDGAME } from '../data/endgame.js';
import { T } from '../world/map.js';
import { ensureSurfaceChunk } from '../world/chunks.js';
import { withdraw } from './storage.js';
import { isTide, isDawn, TIDE_START } from '../core/time.js';
import { themeIdOf } from '../data/night.js';
import { BOSS } from '../data/combat.js';
import { RES_NAME } from '../data/storage.js';
import { settleResonanceEnding } from './ending.js';

const SITE_PROBES = ENDGAME.SITE_CHUNK_PROBES;
const SITE_IDS = SITE_PROBES.map((site) => site.id);
const FIRST = SITE_PROBES.find((site) => site.id === 'first');

function siteOf(state, id) {
  return state && state.resonance && state.resonance.sites
    ? state.resonance.sites[id] || null : null;
}

function nextSiteId(state) {
  return SITE_PROBES.find((probe) => siteOf(state, probe.id)?.status !== 'complete')?.id || null;
}

function activeTrialSite(state) {
  const id = state?.resonance?.trial?.siteId || 'first';
  return siteOf(state, id) || siteOf(state, 'first');
}

function persistTrial(state) {
  const trial = state?.resonance?.trial;
  const site = activeTrialSite(state);
  if (!trial || !site) return;
  site.trial = { ...trial };
  state.resonance.activeSiteId = site.id;
}

function stageName(id) {
  return ({ first: '首座', second: '二座', third: '终座' })[id] || '共鸣';
}

function normalizeTrial(saved) {
  const valid = ENDGAME.STANDARD_TRIAL.statuses;
  const status = saved && valid.includes(saved.status) ? saved.status : 'idle';
  return {
    siteId: SITE_IDS.includes(saved?.siteId) ? saved.siteId : 'first',
    status,
    targetDay: Number.isInteger(saved?.targetDay) ? Math.max(1, saved.targetDay) : null,
    activeDay: Number.isInteger(saved?.activeDay) ? Math.max(1, saved.activeDay) : null,
    attempts: Number.isInteger(saved?.attempts) ? Math.max(0, saved.attempts) : 0,
    result: saved?.result === 'success' || saved?.result === 'failure' ? saved.result : null,
    failureReason: typeof saved?.failureReason === 'string' ? saved.failureReason.slice(0, 80) : null,
    themeId: typeof saved?.themeId === 'string' ? saved.themeId : null,
    lightPressure: Number.isFinite(saved?.lightPressure) ? Math.max(0, saved.lightPressure) : null,
    challengeMul: Number.isFinite(saved?.challengeMul) ? Math.max(1, saved.challengeMul) : null,
    completedDay: Number.isInteger(saved?.completedDay) ? Math.max(1, saved.completedDay) : null,
  };
}

function normalizeSite(probe, saved = null) {
  const valid = ['locked', 'pending', 'revealed', 'building', 'built', 'complete'];
  return {
    id: probe.id,
    status: saved && valid.includes(saved.status) ? saved.status : (probe.id === 'first' ? 'locked' : 'locked'),
    chunkX: Number.isInteger(saved?.chunkX) ? saved.chunkX : probe.x,
    chunkY: Number.isInteger(saved?.chunkY) ? saved.chunkY : probe.y,
    x: Number.isInteger(saved?.x) ? saved.x : null,
    y: Number.isInteger(saved?.y) ? saved.y : null,
    completedDay: Number.isInteger(saved?.completedDay) ? Math.max(1, saved.completedDay) : null,
    trial: saved?.trial && typeof saved.trial === 'object' ? normalizeTrial(saved.trial) : null,
  };
}

function beaconForSite(state, site = null) {
  site = site || siteOf(state, nextSiteId(state)) || siteOf(state, 'first');
  if (!state || !site) return null;
  const current = (state.buildings || []).find((b) => b.type === 'resonanceBeacon' && b.resonanceSiteId === site.id
    && b.x === site.x && b.y === site.y && (state.chunkX | 0) === site.chunkX && (state.chunkY | 0) === site.chunkY);
  if (current) return current;
  const chunk = state.chunkStore && state.chunkStore[`${site.chunkX},${site.chunkY}`];
  return (chunk && chunk.buildings || []).find((b) => b.type === 'resonanceBeacon' && b.resonanceSiteId === site.id
    && b.x === site.x && b.y === site.y) || null;
}

function lightAtBeacon(state, site = null) {
  site = site || activeTrialSite(state);
  if (!state || !site || state.layerId !== 'surface'
      || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY || !state.map || !state.light) return 0;
  return state.light[site.y * state.map.w + site.x] || 0;
}

function failTrial(state, reason) {
  const trial = state && state.resonance && state.resonance.trial;
  if (!trial || (trial.status !== 'active' && trial.status !== 'reserved')) return false;
  trial.status = 'failed'; trial.result = 'failure'; trial.failureReason = String(reason || '试炼中断').slice(0, 80);
  persistTrial(state);
  state.floaties?.push({ x: state.player?.x || 0, y: (state.player?.y || 0) - 0.6, txt: `共鸣中断 · ${trial.failureReason}`, color: '#ffb3a0', t: 0, life: 2.2 });
  state.banner = { title: '共鸣中断', sub: `${trial.failureReason} · 可重新预约`, t: 0, life: 3.5 };
  return true;
}

function reachableMask(chunk) {
  const m = chunk && chunk.map;
  if (!m) return null;
  const seen = new Uint8Array(m.w * m.h), queue = new Uint32Array(m.w * m.h);
  let head = 0, tail = 0;
  const start = (m.h >> 1) * m.w;
  if (!m.isWalk(0, m.h >> 1)) return seen;
  seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++], x = i % m.w, y = (i / m.w) | 0;
    for (const ni of [x > 0 ? i - 1 : -1, x + 1 < m.w ? i + 1 : -1, y > 0 ? i - m.w : -1, y + 1 < m.h ? i + m.w : -1]) {
      if (ni < 0 || seen[ni]) continue;
      const nx = ni % m.w, ny = (ni / m.w) | 0;
      if (!m.isWalk(nx, ny)) continue;
      seen[ni] = 1; queue[tail++] = ni;
    }
  }
  return seen;
}

function validAnchor(chunk, x, y, reachable = null) {
  const m = chunk && chunk.map;
  const margin = ENDGAME.SITE_MARGIN;
  if (!m || !Number.isInteger(x) || !Number.isInteger(y) || x < margin || y < margin || x >= m.w - margin || y >= m.h - margin) return false;
  const i = y * m.w + x;
  if (reachable && !reachable[i]) return false;
  return m.get(x, y) === T.FLOOR && m.isWalk(x, y)
    && !(m.occBuild && m.occBuild[i]) && !(m.occWalk && m.occWalk[i])
    && !(m.blight && m.blight[i] > 0)
    && !(chunk.beacons || []).some((b) => b.x === x && b.y === y)
    && !(chunk.nightops && (chunk.nightops.vents || []).some((v) => v.x === x && v.y === y));
}

function chooseAnchor(state, chunk) {
  const m = chunk.map;
  const reachable = reachableMask(chunk);
  const cx = m.w >> 1, cy = m.h >> 1;
  let best = null, bestScore = Infinity;
  const margin = ENDGAME.SITE_MARGIN;
  for (let y = margin; y < m.h - margin; y++) for (let x = margin; x < m.w - margin; x++) {
    if (!validAnchor(chunk, x, y, reachable)) continue;
    // Prefer a reachable, central clearing; stable tie-break means save/load never rerolls the site.
    const dx = x - cx, dy = y - cy;
    const tie = ((Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663) ^ (state.seed | 0)) >>> 0) / 0xffffffff;
    const score = dx * dx + dy * dy + tie * ENDGAME.SITE_TIE_BREAK;
    if (score < bestScore) { best = { x, y }; bestScore = score; }
  }
  return best;
}

export function initResonance(state, saved = null) {
  const sites = saved && saved.sites && typeof saved.sites === 'object' ? saved.sites : {};
  const normalizedSites = Object.fromEntries(SITE_PROBES.map((probe) => [probe.id, normalizeSite(probe, sites[probe.id]) ]));
  const legacyTrial = saved && saved.trial;
  if (!normalizedSites.first.trial && legacyTrial) normalizedSites.first.trial = normalizeTrial({ ...legacyTrial, siteId: 'first' });
  for (const site of Object.values(normalizedSites)) {
    if (site.trial?.status !== 'complete') continue;
    site.status = 'complete';
    site.completedDay = site.trial.completedDay;
  }
  state.resonance = {
    version: 2,
    trial: normalizeTrial(legacyTrial),
    sites: normalizedSites,
  };
  // 老版本信标没有 siteId 时仍迁移为首站；三站ID之后都按原样恢复。
  const current = [...(state.buildings || [])].map((b) => ({ b, chunk: null, key: null }));
  const stored = Object.entries(state.chunkStore || {}).sort((a, b) => {
      const ca = a[1] || {}, cb = b[1] || {};
      return (ca.cx | 0) - (cb.cx | 0) || (ca.cy | 0) - (cb.cy | 0);
    }).flatMap(([key, chunk]) => (chunk && chunk.buildings || []).map((b) => ({ b, chunk, key })));
  for (const entry of [...current, ...stored]) {
    const b = entry.b;
    if (b.type !== 'resonanceBeacon') continue;
    const id = SITE_IDS.includes(b.resonanceSiteId) ? b.resonanceSiteId : 'first';
    const site = state.resonance.sites[id];
    if (!site || (site.status === 'complete' && b.resonanceSiteId !== id)) continue;
    b.resonanceSiteId = id;
    site.status = b.site ? 'building' : (site.status === 'complete' ? 'complete' : 'built');
    site.chunkX = Number.isInteger(entry.chunk?.cx) ? entry.chunk.cx : (entry.key ? Number(String(entry.key).split(',')[0]) : (state.chunkX | 0));
    site.chunkY = Number.isInteger(entry.chunk?.cy) ? entry.chunk.cy : (entry.key ? Number(String(entry.key).split(',')[1]) : (state.chunkY | 0));
    site.x = b.x | 0; site.y = b.y | 0;
  }
  if (state.milestone && state.milestone.bossDefeated) revealNextResonanceSite(state);
  return state.resonance;
}

export function revealNextResonanceSite(state) {
  if (!state || !state.milestone || !state.milestone.bossDefeated) return 'locked';
  if (!state.resonance) initResonance(state);
  const id = nextSiteId(state);
  const site = siteOf(state, id);
  if (!site) return 'complete';
  if (site.status === 'built' || site.status === 'building' || site.status === 'complete') return site.status;
  const candidates = ENDGAME.SITE_CHUNK_SEARCH?.[id] || [{ x: site.chunkX, y: site.chunkY }];
  if (site.x != null && site.y != null) {
    const chunk = ensureSurfaceChunk(state, site.chunkX, site.chunkY);
    if (validAnchor(chunk, site.x, site.y, reachableMask(chunk))) {
      site.status = 'revealed';
      return site.status;
    }
  }
  for (const probe of candidates) {
    const chunk = ensureSurfaceChunk(state, probe.x, probe.y);
    if (chunk.biome !== SITE_PROBES.find((p) => p.id === id)?.biome) continue;
    const anchor = chooseAnchor(state, chunk);
    if (!anchor) continue;
    site.chunkX = probe.x; site.chunkY = probe.y;
    site.x = anchor.x; site.y = anchor.y; site.status = 'revealed';
    return site.status;
  }
  if (site.x != null && site.y != null) {
    const chunk = ensureSurfaceChunk(state, site.chunkX, site.chunkY);
    if (validAnchor(chunk, site.x, site.y, reachableMask(chunk))) {
      site.status = 'revealed';
      return site.status;
    }
  }
  const fallback = SITE_PROBES.find((p) => p.id === id) || FIRST;
  site.chunkX = fallback.x; site.chunkY = fallback.y;
  site.x = null; site.y = null; site.status = 'pending';
  return site.status;
}

export const revealFirstResonanceSite = revealNextResonanceSite;

export function retryPendingResonanceSite(state, siteId = null) {
  const id = siteId || nextSiteId(state), site = siteOf(state, id);
  if (!site || site.status !== 'pending' || !state.milestone?.bossDefeated) return site ? site.status : 'locked';
  return revealNextResonanceSite(state);
}

// 标准净光仪式：先付预约费，锁定下一次合格蚀潮；实际波次仍由 waves.js 的原预算产生。
export function beginStandardTrial(state, requestedSiteId = null) {
  if (!state || !state.resonance) return '尚未发现共鸣地点';
  const id = requestedSiteId && SITE_IDS.includes(requestedSiteId) ? requestedSiteId : nextSiteId(state);
  const site = siteOf(state, id);
  if (!site || !id) return '三座信标均已完成';
  if (site.status === 'complete') return `${stageName(id)}共鸣已经完成`;
  if (site.status !== 'built') return `先建成${stageName(id)}共鸣信标`;
  let trial = state.resonance.trial;
  if (trial && (trial.status === 'active' || trial.status === 'reserved')) return `仪式已${trial.status === 'active' ? '开始' : '预约'}`;
  if (!trial || trial.siteId !== id || trial.status === 'complete') {
    trial = normalizeTrial(site.trial || { status: 'idle', siteId: id });
    if (trial.status === 'complete') trial = normalizeTrial({ status: 'idle', siteId: id });
    trial.siteId = id;
    state.resonance.trial = trial;
  }
  if (trial.status === 'complete') return `${stageName(id)}共鸣已经完成`;
  if (state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY) return '必须在信标所在区块预约';
  const beacon = beaconForSite(state, site);
  if (!beacon || beacon.site || !(beacon.hp > 0)) return '信标尚未建成或已损毁';
  if (lightAtBeacon(state, site) < ENDGAME.STANDARD_TRIAL.minLight) return `需要信标格亮度 ≥${ENDGAME.STANDARD_TRIAL.minLight} 的人工光`;
  const cost = ENDGAME.TRIAL_START_COST;
  const err = withdraw(state, cost);
  if (err) return `材料不足：${Object.entries(cost).map(([k, n]) => `${RES_NAME[k] || k} ${n}`).join('、')}`;
  const afterTide = isTide(state) || isDawn(state) || state.t >= TIDE_START;
  trial.status = 'reserved'; trial.targetDay = (state.day | 0) + (afterTide ? 1 : 0);
  trial.activeDay = null; trial.attempts = Math.min(0x7fffffff, trial.attempts + 1);
  trial.result = null; trial.failureReason = null; trial.themeId = null;
  trial.lightPressure = null; trial.challengeMul = null; trial.completedDay = null;
  site.trial = { ...trial };
  state.resonance.activeSiteId = id;
  state.banner = { title: '共鸣已预约', sub: `第 ${trial.targetDay} 天蚀潮 · 守住信标，留在本区块`, t: 0, life: 3.5 };
  state.floaties?.push({ x: beacon.x + 0.5, y: beacon.y - 0.4, txt: '净光已预约', color: '#ffe2a1', t: 0, life: 1.8 });
  state._sidebarSig = null;
  return null;
}

// 由蚀潮边沿调用。Boss 周期夜不叠考，预约顺延；错过驻守条件则明确失败、不扣第二次费用。
export function lockStandardTrialAtTide(state) {
  const trial = state && state.resonance && state.resonance.trial;
  if (!trial || trial.status !== 'reserved' || (trial.targetDay || 0) > (state.day | 0)) return false;
  if ((state.day | 0) % BOSS.EVERY === 0) {
    trial.targetDay = (state.day | 0) + 1;
    persistTrial(state);
    state.banner = { title: '仪式顺延', sub: '大潮夜 · 反冲顺延至明晚', t: 0, life: 3.5 };
    return false;
  }
  const site = activeTrialSite(state), beacon = beaconForSite(state, site);
  if (!site || !beacon || state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY) {
    failTrial(state, '蚀潮来临时不在信标区块'); return false;
  }
  if (!(beacon.hp > 0) || lightAtBeacon(state, site) < ENDGAME.STANDARD_TRIAL.minLight) {
    failTrial(state, '信标未被人工光照亮'); return false;
  }
  trial.status = 'active'; trial.activeDay = state.day | 0; trial.themeId = themeIdOf(state);
  trial.lightPressure = state.nightLightPressure || 0;
  trial.challengeMul = state.nightChallengeMul || 1;
  persistTrial(state);
  state.banner = { title: '反冲夜', sub: '守住信标直到黎明 · 离区或断光即告失败', t: 0, life: 3.5 };
  state._sidebarSig = null;
  return true;
}

export function updateStandardTrial(state) {
  const trial = state && state.resonance && state.resonance.trial;
  if (!trial || trial.status !== 'active') return false;
  const site = activeTrialSite(state);
  if (!site || state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY) return failTrial(state, '离开信标区块');
  const beacon = beaconForSite(state, site);
  if (!beacon || !(beacon.hp > 0)) return failTrial(state, '信标被毁');
  if (isTide(state) && lightAtBeacon(state, site) < ENDGAME.STANDARD_TRIAL.minLight) return failTrial(state, '信标断光');
  return false;
}

export function settleStandardTrialAtDawn(state) {
  const trial = state && state.resonance && state.resonance.trial;
  if (!trial || trial.status !== 'active' || trial.activeDay !== (state.day | 0)) return false;
  const site = activeTrialSite(state);
  if (!site || state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY) return failTrial(state, '黎明前离开信标区块');
  const beacon = beaconForSite(state, site);
  if (!site || !beacon || !(beacon.hp > 0) || lightAtBeacon(state, site) < ENDGAME.STANDARD_TRIAL.minLight) return failTrial(state, '黎明前信标未能维持净光');
  trial.status = 'complete'; trial.result = 'success'; trial.failureReason = null; trial.completedDay = state.day | 0;
  site.status = 'complete'; site.completedDay = state.day | 0; site.trial = { ...trial };
  persistTrial(state);
  revealNextResonanceSite(state);
  settleResonanceEnding(state);
  state.banner = { title: `${stageName(site.id)}共鸣完成`, sub: `第 ${state.day} 天 · 信标守至黎明`, t: 0, life: 5 };
  state.floaties?.push({ x: beacon.x + 0.5, y: beacon.y - 0.7, txt: '共鸣封存', color: '#ffe2a1', t: 0, life: 2.6 });
  state._sidebarSig = null;
  return true;
}

export function resonancePlaceError(state, type, x, y) {
  if (type !== 'resonanceBeacon') return null;
  const id = nextSiteId(state), site = siteOf(state, id);
  if (!state.milestone?.bossDefeated) return '尚未发现共鸣地点';
  if (!id) return '三座信标均已完成';
  if (!site || site.status === 'locked') return '尚未发现共鸣地点';
  if (site.status === 'pending' || site.x == null || site.y == null) return '候选地点被占：拆除建筑后自动重试';
  if (state.layerId !== 'surface' || (state.chunkX | 0) !== site.chunkX || (state.chunkY | 0) !== site.chunkY) return `只能在区块 ${site.chunkX},${site.chunkY} 的标记处建造`;
  if (x !== site.x || y !== site.y) return '只能建在共鸣地点';
  if (site.status !== 'revealed') return site.status === 'building' ? '信标正在施工' : '信标已建成';
  return null;
}

export function resonanceSiteForBuild(state, x, y) {
  const id = nextSiteId(state), site = siteOf(state, id);
  return site && site.status === 'revealed' && site.x === x && site.y === y ? id : null;
}

export function isResonanceSiteId(id) { return SITE_IDS.includes(id); }

export function markResonanceBuilding(state, b, status) {
  if (!b || b.type !== 'resonanceBeacon' || !SITE_IDS.includes(b.resonanceSiteId)) return;
  const site = siteOf(state, b.resonanceSiteId);
  if (!site) return;
  if (site.status === 'complete') return;
  const trial = state.resonance?.trial;
  if (status === 'revealed' && trial?.status === 'active' && trial.siteId === site.id) failTrial(state, '信标被毁');
  site.status = status;
  if (status === 'revealed') { site.x = b.x; site.y = b.y; }
}

export function liveResonanceStatus(state, siteId = null) {
  const id = siteId || nextSiteId(state) || 'first';
  const site = siteOf(state, id);
  return site ? { ...site } : { id, status: 'locked', chunkX: FIRST.x, chunkY: FIRST.y, x: null, y: null };
}
