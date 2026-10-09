// W21-P P2：当前驻地的只读备战投影。无计时推进、随机数或存档字段。
import { BUILD, LIGHT_LEVELS } from '../data/buildings.js';
import { ENEMIES } from '../data/enemies.js';
import { PREPARATION, planNight, mainKindOf, SEGMENTS, signatureOf } from '../data/night.js';
import { BOSS, TOWER, CARRY } from '../data/combat.js';
import { TIDE_START, TIDE_END, DAY_SECS } from '../core/time.js';
import { fireMatOf } from '../data/fire.js';
import { payloadStats } from '../data/payload.js';
import { buildingBurnSec } from './logistics.js';
import { spendableOf } from './storage.js';
import { beamNeighbor } from './towers.js';

function towerStatus(state, b, available) {
  const d = BUILD[b.type];
  const lit = d.needsBeam ? !!beamNeighbor(state, b)
    : !!b.mounted || (state.light?.[b.y * state.map.w + b.x] || 0) >= TOWER.LIGHT_MIN;
  const ps = payloadStats(d, b.mods || [], b.level || 1);
  const perShot = b.mounted ? Math.max(ps.每发燃耗, CARRY.BASE_FUEL) * CARRY.FUEL_MUL : ps.每发燃耗;
  const debit = Math.floor((b.fuelDebt || 0) + perShot);
  return { type: b.type, x: b.x, y: b.y, air: !!d.air, damageType: d.dmgType,
    ready: lit && (available.fuel || 0) >= debit, lit, perShot, debit };
}

// 按槽内燃料估算；库存与补给站只列条件，不加入槽内续航。
export function deviceStatusOf(state, b, available = {}, supplies = []) {
  const d = BUILD[b.type], interval = buildingBurnSec(b, state);
  if (!d || !interval) return null;
  const mat = d.fireMat ? fireMatOf(b, d) : 'fuel';
  const fuel = Math.max(0, b.fuel || 0);
  const burning = !b.site && !b.off && fuel > 0;
  const seconds = burning ? Math.max(0, fuel * interval - (b.burnT || 0)) : null;
  const caches = b.site ? [] : supplies.filter(c => c !== b && Math.hypot(c.x - b.x, c.y - b.y) <= BUILD.cache.supplyRange);
  return { type: b.type, name: d.name, x: b.x, y: b.y, fuel, maxFuel: d.maxFuel,
    brightness: (LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1]).name,
    material: mat, interval, seconds, burning, site: !!b.site, off: !!b.off,
    light: !!d.power && !d.decoy && !b.site && burning,
    reserve: available[mat] || 0, refill: !b.site && fuel < d.maxFuel && (available[mat] || 0) > 0,
    cacheCount: caches.length, cacheFuel: caches.reduce((n, c) => n + c.fuel, 0),
    supplySeconds: BUILD.cache.supplySec };
}

export function preparationOf(state) {
  const day = (state.day || 1) + ((state.t || 0) >= TIDE_END ? 1 : 0);
  // 主题建议取加压阶段的真实候选，不把尚未解锁的签名兵种写成必出。
  const plan = planNight({ ...state, day, t: TIDE_START + SEGMENTS[0].upTo });
  const candidates = signatureOf(plan.theme).filter(k => plan.shares[k] > 0);
  const boss = day % BOSS.EVERY === 0;
  const kind = boss ? 'core' : candidates[0] || mainKindOf(plan);
  const enemy = ENEMIES[kind] || {};
  const actionId = boss ? 'boss' : enemy.air ? 'air' : enemy.lampPref ? 'lamp' : enemy.breaker ? 'wall' : 'swarm';
  const available = spendableOf(state);
  const buildings = state.buildings || [];
  const towers = buildings.filter(b => !b.site && BUILD[b.type]?.dmg).map(b => towerStatus(state, b, available));
  const supplies = buildings.filter(b => b.type === 'cache' && !b.site && b.fuel > 0);
  const devices = buildings.filter(b => BUILD[b.type]?.burnSec).map(b => deviceStatusOf(state, b, available, supplies));
  const walls = buildings.filter(b => !b.site && ['wall', 'stoneWall', 'gate', 'barricade'].includes(b.type));
  const relevant = towers.filter(t => actionId === 'air' ? t.air
    : actionId === 'lamp' ? t.damageType === 'shock'
      : actionId === 'wall' ? t.damageType === 'light' : true);
  return { day, layerId: state.layerId || 'surface', chunkX: state.chunkX || 0, chunkY: state.chunkY || 0,
    surface: state.layerId === 'surface', theme: plan.theme.name, themeId: plan.theme.id,
    kind, threat: enemy.name || kind, tag: enemy.tag || '', actionId, action: PREPARATION.actions[actionId],
    candidates: Object.keys(plan.shares), towers, defense: { total: relevant.length, ready: relevant.filter(t => t.ready).length,
      walls: walls.length, damaged: walls.filter(b => b.hp < (BUILD[b.type].hp || b.hp)).length },
    devices, campLights: (state.beacons || []).length,
    untilDawn: (state.t || 0) < TIDE_END ? TIDE_END - (state.t || 0) : DAY_SECS - (state.t || 0) + TIDE_END,
    playerLamp: (state.player?.lamp?.power || 0) > 0,
    relays: buildings.filter(b => !b.site && BUILD[b.type]?.relay).map(b => ({ type: b.type, x: b.x, y: b.y, lit: b.relayHop != null })),
    graves: state.layerId === 'surface' ? (state.graves || []).length : 0,
    fuelReserve: available.fuel || 0 };
}
