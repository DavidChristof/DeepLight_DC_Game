// systems/spawnBudget.js —— 单夜普通刷怪预算与活动区同屏硬上限
import { BOSS, WAVES, tideOf } from '../data/combat.js';
import { waveUnitsElapsed, waveUnitsInWindow } from '../data/night.js';

export function enemyCapOf(state) {
  const diff = state && state.diff || {};
  const bossNight = ((state && state.day) | 0) % BOSS.EVERY === 0;
  return Math.round((WAVES.CAP_BASE + tideOf(state) * WAVES.CAP_PER_TIDE
    + (bossNight ? WAVES.CAP_BOSS_NIGHT : 0)) * (diff.capMul || 1));
}

export function aliveEnemyCount(enemies) {
  let n = 0;
  for (const enemy of enemies || []) if (enemy && enemy.alive) n++;
  return n;
}

export function screenEnemyRoom(state, enemies, pending = 0) {
  return Math.max(0, enemyCapOf(state) - aliveEnemyCount(enemies) - Math.max(0, pending | 0));
}

function ordinaryAliveCount(enemies) {
  let n = 0;
  for (const enemy of enemies || []) {
    if (enemy && enemy.alive && !(enemy.def && enemy.def.boss) && enemy.ekind !== 'core') n++;
  }
  return n;
}

// 新潮夜从完整标准波次表锁定名额。旧版潮中存档首次读取时，按已流逝时段
// 保守补记已用名额，避免读档把整夜预算重置；标准名额只允许波次与潮穴消费。
export function ensureNightSpawnBudget(state, enemies, tideEdge = false) {
  if (!state) return { budget: 0, used: 0, remaining: 0 };
  const day = state.day | 0;
  const valid = Number.isFinite(state.nightSpawnBudget) && state.nightSpawnDay === day;
  if (tideEdge || !valid) {
    const budget = Math.max(0, waveUnitsInWindow(state) | 0);
    const legacyMidTide = !tideEdge && !!state.wasTide;
    const elapsed = legacyMidTide ? waveUnitsElapsed(state, state.t) : 0;
    state.nightSpawnDay = day;
    state.nightSpawnBudget = budget;
    state.nightSpawnUsed = Math.min(budget, Math.max(elapsed, legacyMidTide ? ordinaryAliveCount(enemies) : 0));
  } else if (!Number.isFinite(state.nightSpawnUsed)) {
    state.nightSpawnUsed = Math.min(state.nightSpawnBudget, waveUnitsElapsed(state, state.t));
  }
  state.nightSpawnUsed = Math.max(0, Math.min(state.nightSpawnBudget, state.nightSpawnUsed | 0));
  const remaining = Math.max(0, state.nightSpawnBudget - state.nightSpawnUsed);
  return { budget: state.nightSpawnBudget, used: state.nightSpawnUsed, remaining };
}

export function remainingNightSpawnBudget(state) {
  if (!state || state.nightSpawnDay !== (state.day | 0) || !Number.isFinite(state.nightSpawnBudget)) return 0;
  return Math.max(0, state.nightSpawnBudget - (state.nightSpawnUsed | 0));
}

export function recordNightSpawn(state, count = 1) {
  if (!state || count <= 0) return 0;
  const granted = Math.min(count | 0, remainingNightSpawnBudget(state));
  state.nightSpawnUsed = Math.min(state.nightSpawnBudget, (state.nightSpawnUsed | 0) + granted);
  return granted;
}
