// data/ecology.js —— C 生态轴的规则地基（E0）
// 这里只放定义与纯函数；E1/E2/E3 的系统从这里读取数值，避免散落魔数。
export const ECOLOGY = Object.freeze({
  BIOME_VERSION: 1,
  RING_STEP: 2,
  MAX_ACTIVE_OUTPOSTS: 3,
  OUTPOST_TRAVEL_SEC: 8,
  OUTPOST_SETTLE_SEC: 12,
  OUTPOST_MAX_WORKERS_PER_TICK: 3,
  OUTPOST_GUARD_FUEL_PER_TICK: 1,
  // 远端潮夜只累计有限债务，达到阈值才落一处前线；白天每次有光只退一格债务。
  OUTPOST_FRONT_DEBT_MAX: 2,
  OUTPOST_FRONT_DEBT_DECAY: 1,
  OUTPOST_MAX_ALERTS: 3,
  MAX_FRONTS_PER_CHUNK: 8,
  MAX_FRONT_CELLS: 96,
  FRONT_NEST_CELLS: 12,
  FRONT_GROW_SEC: 18,
  FRONT_SPAWN_RESERVE: 1,
  FRONT_SPAWN_RADIUS: 8,
  MAX_PATCHES_PER_CHUNK: 12,
  MAX_NEUTRAL_CREATURES: 8,
  PATCH_UPDATE_SEC: 12,
  CREATURE_UPDATE_SEC: 2,
  LIGHT_PRESSURE_BASE: 2,
  LIGHT_PRESSURE_CAP: 1.8,
  LIGHT_PRESSURE_PER_STEP: 0.06,
});

export const BIOMES = Object.freeze({
  tundra: Object.freeze({ id: 'tundra', name: '苔原营地', color: '#305648', sightMul: 1, resourceBias: Object.freeze({ ore: 1, vine: 1 }) }),
  vineMist: Object.freeze({ id: 'vineMist', name: '藤雾林', color: '#426047', sightMul: 0.78, resourceBias: Object.freeze({ ore: 0.75, vine: 1.8 }) }),
  shaleRise: Object.freeze({ id: 'shaleRise', name: '碎岩台地', color: '#5b5868', sightMul: 0.92, resourceBias: Object.freeze({ ore: 1.65, vine: 0.65 }) }),
});

export const CREATURES = Object.freeze({
  vineMist: Object.freeze({ kind: 'moth', name: '雾翅蛾', preferred: 'vine' }),
  shaleRise: Object.freeze({ kind: 'skitter', name: '碎岩掘兽', preferred: 'ore' }),
  tundra: Object.freeze({ kind: 'moth', name: '雾翅蛾', preferred: 'vine' }),
});

export function biomeIdAt(cx = 0, cy = 0) {
  const x = cx | 0, y = cy | 0;
  if (x === 0 && y === 0) return 'tundra';
  const ring = Math.max(Math.abs(x), Math.abs(y));
  if (ring <= ECOLOGY.RING_STEP) return 'vineMist';
  const h = Math.imul((x + 0x45d9f3b) | 0, 0x27d4eb2d) ^ Math.imul((y - 0x119de1f3) | 0, 0x165667b1);
  return ((h ^ (h >>> 16)) & 1) ? 'shaleRise' : 'vineMist';
}

export const biomeOf = (cx = 0, cy = 0) => BIOMES[biomeIdAt(cx, cy)] || BIOMES.tundra;
export const frontStageOf = (level = 0) => level >= 3 ? 'rift' : level >= 2 ? 'nest' : level >= 1 ? 'trace' : 'none';
