// systems/survival.js —— W15-B 第 1 步：玩家饱食、伤势与进食
//
// 规则：食物不是第二套货币。口粮保障远行，热食把燃料换成一次可靠恢复；
// 两者都只从容器账本扣除，不能在蚀兽贴脸时当作瞬时治疗药。
import { SURVIVAL } from '../data/survival.js';
import { BUILD } from '../data/buildings.js';
import { withdraw } from './storage.js';
import { isTide } from '../core/time.js';
import { sfx } from '../core/audio.js';

const P = SURVIVAL.PLAYER;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function injuryName(n) {
  return n >= 2 ? '重伤' : n === 1 ? '擦伤' : '无伤';
}

export function playerSafe(state) {
  const p = state.player;
  return !(state.enemies || []).some((e) => e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= P.SAFE_RADIUS);
}

export function warmthAt(state) {
  const p = state.player;
  const within = (x, y) => Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= P.HOT_MEAL.RANGE;
  for (const b of state.beacons || []) if (b.hp > 0 && within(b.x, b.y)) return '营地火';
  for (const b of state.buildings || []) {
    const def = BUILD[b.type];
    if (def && def.fireMat && b.fuel > 0 && !b.off && within(b.x, b.y)) return def.name;
  }
  return null;
}

export function markPlayerInjury(state) {
  const max = Math.max(1, state.playerMaxHp || P.BASE_MAX_HP);
  const frac = state.playerHp / max;
  const next = frac <= P.INJURY.HEAVY_AT ? 2 : frac <= P.INJURY.LIGHT_AT ? 1 : 0;
  state.playerInjury = Math.max(state.playerInjury || 0, next);
  return state.playerInjury;
}

export function hurtPlayer(state, amount) {
  state.playerHp = Math.max(0, state.playerHp - Math.max(0, amount));
  if (amount > 0) markPlayerInjury(state);
  return state.playerHp;
}

function mealError(state, hot) {
  if (state.playerDead) return '倒下时不能进食';
  if (!playerSafe(state)) return '蚀兽太近 · 先退回光里';
  if (state.playerHunger >= P.HUNGER_MAX && state.playerHp >= state.playerMaxHp && !(state.playerInjury > 0)) {
    return hot ? '现在不需要热食' : '现在不需要口粮';
  }
  if ((state.res.food || 0) < (hot ? P.HOT_MEAL.FOOD : P.RATION.FOOD)) return '食物不足 · 种幽菌田';
  if (hot && (state.res.fuel || 0) < P.HOT_MEAL.FUEL) return '燃料不足 · 先炼油';
  if (hot && !warmthAt(state)) return '靠近营地火或点燃的炉子';
  return null;
}

function eat(state, hot) {
  const err = mealError(state, hot);
  if (err) return err;
  const meal = hot ? P.HOT_MEAL : P.RATION;
  if (withdraw(state, hot ? { food: meal.FOOD, fuel: meal.FUEL } : { food: meal.FOOD }, state.player.x, state.player.y)) return '材料不足';
  state.playerHunger = clamp((state.playerHunger || 0) + meal.HUNGER, 0, P.HUNGER_MAX);
  state.playerHp = clamp(state.playerHp + meal.HEAL, 0, state.playerMaxHp || P.BASE_MAX_HP);
  if (hot) state.playerInjury = Math.max(0, (state.playerInjury || 0) - meal.CURE);
  state.floaties.push({ x: state.player.x, y: state.player.y - 0.8, txt: hot ? '吃热食' : '吃口粮', color: hot ? '#ffd76e' : '#9ef7a8', t: 0, life: 0.8 });
  state._sidebarSig = null;
  sfx(hot ? 'ok' : 'harvest');
  return null;
}

export const eatRation = (state) => eat(state, false);
export const eatHotMeal = (state) => eat(state, true);

// Z：优先吃热食；附近没有热源时退回口粮。这样一个动作同时服务远征补给与回营恢复。
export function eatBestMeal(state) {
  return warmthAt(state) ? eatHotMeal(state) : eatRation(state);
}

export function restBeds(state) {
  return (state.buildings || []).reduce((n, b) => n + (!b.site && BUILD[b.type]?.restSlots ? BUILD[b.type].restSlots : 0), 0);
}

export function restCount(state) {
  return (state.workers || []).filter((w) => w.alive && w.job === 'rest').length;
}

export function restAvailable(state, worker) {
  const cap = restBeds(state);
  return cap > 0 && restCount(state) < cap || !!(worker && worker.job === 'rest');
}

export function nearestRestSpot(state, x, y) {
  let best = null;
  for (const b of state.buildings || []) {
    if (b.site || !BUILD[b.type]?.restSlots) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (!best || d < best.d) best = { x: b.x, y: b.y, d };
  }
  if (best) return best;
  const camp = (state.beacons || [])[0];
  return camp ? { x: camp.x, y: camp.y, d: Math.hypot(camp.x + 0.5 - x, camp.y + 0.5 - y) } : null;
}

export function updatePlayerSurvival(state, dt) {
  if (!state.started || !state.player || state.playerDead) return;
  if ((state.playerRestT || 0) > 0) {
    const bed = nearestRestSpot(state, state.player.x, state.player.y);
    const atBed = bed && bed.d <= SURVIVAL.REST.RANGE;
    if (!state.moveInput && !(state.player.path && state.player.path.length)
      && !isTide(state) && playerSafe(state) && (warmthAt(state) || atBed)) {
      state.playerRestT = Math.max(0, state.playerRestT - dt);
      state.playerHp = clamp(state.playerHp + SURVIVAL.REST.HEAL_PER_SEC * dt, 0, state.playerMaxHp || P.BASE_MAX_HP);
      state.playerHunger = clamp((state.playerHunger || 0) - P.INJURY_HUNGER_PER_SEC * dt, 0, P.HUNGER_MAX);
      return;
    }
    state.playerRestT = 0;
  }
  let drain = 0;
  const camp = (state.beacons || [])[0];
  if (camp && Math.hypot(state.player.x - (camp.x + 0.5), state.player.y - (camp.y + 0.5)) > P.EXPEDITION_RANGE) drain += P.EXPEDITION_HUNGER_PER_SEC;
  if (isTide(state)) drain += P.TIDE_HUNGER_PER_SEC;
  drain += (state.playerInjury || 0) * P.INJURY_HUNGER_PER_SEC;
  state.playerHunger = clamp((state.playerHunger == null ? P.START_HUNGER : state.playerHunger) - drain * dt, 0, P.HUNGER_MAX);
}
