// W21-P P1：玩家所在夜晚的有界结果；不是全世界守夜胜率。
import { ENDGAME } from '../data/endgame.js';

const RULE = ENDGAME.NIGHT_OUTCOME;
export function createNightOutcomes(day = 1) {
  return { version: RULE.VERSION, knownSinceDay: Math.max(1, day | 0), history: [] };
}
export function normalizeNightOutcomes(saved) {
  if (!saved || saved.version !== RULE.VERSION || !Array.isArray(saved.history)) return null;
  const history = [], seen = new Set();
  for (const row of saved.history.slice(-RULE.HISTORY_LIMIT)) {
    if (!row || !Number.isInteger(row.day) || row.day < 1 || seen.has(row.day)
      || !['survived', 'retreat'].includes(row.result)
      || !['dawn', 'death', 'seal'].includes(row.cause)
      || (row.result === 'survived') !== (row.cause === 'dawn')) continue;
    seen.add(row.day);
    history.push({ day: row.day, result: row.result, cause: row.cause,
      layerId: ['surface', 'depth1', 'depth2', 'depth3'].includes(row.layerId) ? row.layerId : 'surface',
      chunkX: Number.isInteger(row.chunkX) ? row.chunkX : 0,
      chunkY: Number.isInteger(row.chunkY) ? row.chunkY : 0 });
  }
  return { version: RULE.VERSION, knownSinceDay: Number.isInteger(saved.knownSinceDay) && saved.knownSinceDay > 0
    ? saved.knownSinceDay : (history[0]?.day || null), history };
}
export function recordNightOutcome(state, cause) {
  if (!['death', 'seal', 'dawn'].includes(cause)) return false;
  const records = state.nightOutcomes || (state.nightOutcomes = createNightOutcomes(state.day));
  const day = state.day | 0;
  if (records.history.some(row => row.day === day)) return false;
  records.history.push({ day, result: cause === 'dawn' ? 'survived' : 'retreat', cause,
    layerId: state.layerId || 'surface', chunkX: state.chunkX | 0, chunkY: state.chunkY | 0 });
  if (records.history.length > RULE.HISTORY_LIMIT) records.history.shift();
  return true;
}
