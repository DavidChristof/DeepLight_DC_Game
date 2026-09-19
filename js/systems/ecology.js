// systems/ecology.js —— E3：区块级生态斑块与中性生物（事件/定时分片）
import { T } from '../world/map.js';
import { ECOLOGY, BIOMES, CREATURES, biomeIdAt } from '../data/ecology.js';
import { activeSurfaceChunks } from '../world/chunks.js';

function hash(x) { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; }

export function ensureEcologyChunk(state, chunk) {
  if (!chunk || !chunk.map) return chunk;
  const m = chunk.map;
  if (!chunk.biome) chunk.biome = biomeIdAt(chunk.cx || 0, chunk.cy || 0);
  if (!m.biome) m.biome = chunk.biome;
  if (!Array.isArray(chunk.ecoPatches)) {
    const preferred = BIOMES[chunk.biome]?.resourceBias?.vine >= 1.2 ? T.VINE : T.ORE;
    const patches = [];
    for (let i = 0; i < m.tiles.length && patches.length < ECOLOGY.MAX_PATCHES_PER_CHUNK; i++) {
      if (m.tiles[i] !== preferred || (hash(i + (state.seed | 0)) & 7) !== 0) continue;
      const x = i % m.w, y = (i / m.w) | 0;
      patches.push({ x, y, kind: preferred === T.VINE ? 'vine' : 'ore', amount: 1, cap: 3, stage: 1, nextT: 0 });
    }
    chunk.ecoPatches = patches;
  }
  if (!Array.isArray(chunk.ecoCreatures)) {
    const def = CREATURES[chunk.biome] || CREATURES.tundra;
    chunk.ecoCreatures = chunk.ecoPatches.slice(0, 2).map((p) => ({ kind: def.kind, x: p.x + 0.5, y: p.y + 0.5, state: 'forage', t: 0, alive: true })).slice(0, ECOLOGY.MAX_NEUTRAL_CREATURES);
  }
  return chunk;
}

function updatePatch(chunk, patch, dt) {
  patch.nextT = Math.max(0, (patch.nextT || 0) - dt);
  if (patch.nextT > 0) return;
  patch.nextT = ECOLOGY.PATCH_UPDATE_SEC;
  const i = patch.y * chunk.map.w + patch.x;
  const blocked = chunk.map.blight && chunk.map.blight[i] > 0;
  if (blocked) patch.stage = Math.max(0, (patch.stage || 1) - 1);
  else patch.amount = Math.min(patch.cap || 3, (patch.amount || 0) + 1);
}

function updateCreature(creature, chunk, dt) {
  creature.t = (creature.t || 0) + dt;
  if (creature.t < ECOLOGY.CREATURE_UPDATE_SEC) return;
  creature.t = 0;
  creature.state = chunk.map.blight?.[(creature.y | 0) * chunk.map.w + (creature.x | 0)] ? 'flee' : 'forage';
}

export function updateEcology(state, dt) {
  if (state.layerId !== 'surface' || !state.chunkStore) return;
  const active = new Set(activeSurfaceChunks(state));
  for (const chunk of Object.values(state.chunkStore)) {
    ensureEcologyChunk(state, chunk);
    if (!active.has(chunk)) continue;
    for (const p of chunk.ecoPatches) updatePatch(chunk, p, dt);
    for (const c of chunk.ecoCreatures) updateCreature(c, chunk, dt);
  }
}
