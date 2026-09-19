// systems/ecoPressure.js —— 活跃区块的人造光压力（只在入夜锁定）
import { BUILD } from '../data/buildings.js';
import { ECOLOGY } from '../data/ecology.js';

export function lightPressure(state) {
  let total = 0;
  for (const b of state.buildings || []) {
    const d = BUILD[b.type];
    if (d && d.power > 0 && (b.fuel || 0) > 0 && !b.off) total += d.power;
  }
  return total;
}

export function lockNightChallenge(state) {
  const pressure = lightPressure(state);
  const ratio = pressure / Math.max(1, ECOLOGY.LIGHT_PRESSURE_BASE);
  state.nightLightPressure = pressure;
  state.nightChallengeMul = Math.min(ECOLOGY.LIGHT_PRESSURE_CAP, 1 + ECOLOGY.LIGHT_PRESSURE_PER_STEP * Math.max(0, ratio - 1));
  return state.nightChallengeMul;
}
