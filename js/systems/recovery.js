// 当前驻地的只读恢复投影。不归因未知历史、不付款、不推进队员或计时。
import { RECOVERY } from '../data/recovery.js';
import { SURVIVAL } from '../data/survival.js';
import { BUILD, towerHp } from '../data/buildings.js';
import { spendableOf } from './storage.js';
import { mealError, playerSafe, warmthAt, nearestRestSpot } from './survival.js';
import { isTide } from '../core/time.js';
function lightAt(state, x, y) {
  if (!state.light || !state.map) return 0;
  const ix = Math.max(0, Math.min(state.map.w - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(state.map.h - 1, Math.floor(y)));
  return state.light[iy * state.map.w + ix] || 0;
}

export function recoveryOf(state) {
  const issues = [];
  const stock = spendableOf(state);
  const buildings = state.buildings || [];
  const local = w => (!w.layerId || w.layerId === state.layerId)
    && (!Number.isFinite(w.chunkX) || w.chunkX === (state.chunkX || 0))
    && (!Number.isFinite(w.chunkY) || w.chunkY === (state.chunkY || 0)) && !w.outpostTravel;
  const push = (kind, id, title, detail, target, panel, blockers = []) => {
    issues.push({ kind, id, title, detail, target, panel, blockers: [...blockers], priority: RECOVERY.priority[kind] });
  };
  for (const w of state.workers || []) {
    if (!w.alive || !local(w)) continue;
    const id = w.id || w.name;
    const target = { x: w.x, y: w.y, worker: id };
    if (w.downed) {
      const blockers = [];
      if ((stock.food || 0) < SURVIVAL.RESCUE.FOOD) blockers.push('缺食物');
      if (lightAt(state, w.x, w.y) < SURVIVAL.RESCUE.LIGHT_MIN) blockers.push('光线不足');
      if ((state.enemies || []).some(e => e.alive && Math.hypot(e.x - w.x, e.y - w.y) <= SURVIVAL.RESCUE.DANGER_RANGE)) blockers.push('蚀兽太近');
      if (state.rescue && state.rescue.worker !== w) blockers.push('另一人正在救援');
      push('rescue', `rescue:${id}`, `${w.name} · 倒地`,
        state.rescue?.worker === w ? '救援进行中' : `走近救援 · 剩 ${Math.ceil(w.downT || 0)}s`, target, 'crew', blockers);
      continue;
    }
    if (w.rescueWound > 0 || w.hp < w.maxHp || w.rescueRestT > 0 || w.rescueState === 'escort') {
      const status = w.rescueState === 'escort' ? '护送到铺位' : w.medicalState === 'treating' ? '医疗站治疗中'
        : w.medicalState === 'queued' ? '医疗站候诊中' : w.rescueRestT > 0 ? '恢复期休整中' : '查看照护与休整';
      const blockers = [];
      if (w.directive?.care === 'guard') blockers.push('照护设为守灯');
      if (w.hunger <= SURVIVAL.WORKER.NATURAL_HEAL_HUNGER && !(stock.food > 0)) blockers.push('缺食物');
      if (w.medicalState === 'queued' && (stock.fuel || 0) < SURVIVAL.RESCUE.MEDICAL_FUEL) blockers.push('治疗缺燃料');
      if (w.medicalClinic && lightAt(state, w.medicalClinic.x + 0.5, w.medicalClinic.y + 0.5) < SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN) blockers.push('医疗站光线不足');
      if (!w.rescueRestT && w.hp < w.maxHp && lightAt(state, w.x, w.y) <= SURVIVAL.WORKER.NATURAL_HEAL_LIGHT) blockers.push('回血需回到亮光下');
      push('injury', `injury:${id}`, `${w.name} · ${Math.ceil(w.hp)}/${w.maxHp} HP`, status, target, 'crew', blockers);
    }
    if (!w.hollow && w.hunger < SURVIVAL.WORKER.LOW_HUNGER) {
      const blockers = stock.food > 0 ? [] : ['缺食物'];
      if (w.morale <= RECOVERY.eatMoraleMin) blockers.push('士气低 · 暂不自主进食');
      push('hunger', `hunger:${id}`, `${w.name} · 饥饿`, w.job === 'eat' ? '正在取食物' : '补充本区食物', target, 'pack', blockers);
    }
  }
  if (state.player && (state.playerHp < (state.playerMaxHp || SURVIVAL.PLAYER.BASE_MAX_HP) || state.playerInjury > 0)) {
    const blockers = [];
    const hotError = mealError(state, true);
    if (hotError) blockers.push(`热食：${hotError}`);
    const spot = nearestRestSpot(state, state.player.x, state.player.y);
    const atBed = !!spot && spot.d <= SURVIVAL.REST.RANGE;
    if (isTide(state) || !playerSafe(state) || (!warmthAt(state) && !atBed)) blockers.push('休整需安全、潮落、靠近火或铺位');
    push('injury', 'player:injury', '你 · 受伤', state.playerInjury > 0 ? '吃热食减轻伤势 · 休整只回血' : '停止移动后休整或进食', null, 'pack', blockers);
  }
  if (state.player && state.playerHunger < SURVIVAL.PLAYER.LOW_HUNGER) {
    const err = mealError(state, false);
    push('hunger', 'player:hunger', '你 · 饥饿', '打开背包进食', null, 'pack', err ? [err] : []);
  }
  for (const b of buildings) {
    const d = BUILD[b.type];
    if (!d || b.site) continue;
    const target = { x: b.x, y: b.y, type: b.type };
    if (d.power && !d.fireMat && !d.decoy && d.burnSec && !b.off && !(b.fuel > 0) && !(b.hp <= 0)) {
      push('light', `light:${b.type}:${b.x}:${b.y}`, `${d.name} · 缺燃料`, '走近添火种', target, 'night', stock.fuel > 0 ? [] : ['本区缺燃料']);
    }
    const max = towerHp(d, b.level || 1) || d.hp || 0;
    if (Number.isFinite(b.hp) && b.hp > 0 && b.hp < max) {
      const blockers = [];
      if ((stock.stone || 0) < SURVIVAL.REPAIR.STONE) blockers.push('缺石材');
      if ((stock.vine || 0) < SURVIVAL.REPAIR.VINE) blockers.push('缺藤木');
      push('repair', `repair:${b.type}:${b.x}:${b.y}`, `${d.name} · ${Math.ceil(b.hp)}/${max} HP`, '装备修缮钳 · 走近右键修缮', target, 'pack', blockers);
    }
  }
  issues.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const lastNight = (state.nightOutcomes?.history || []).at(-1);
  return { scope: `${state.seed}|${state.layerId}|${state.chunkX || 0}|${state.chunkY || 0}`,
    day: state.day, lastNight: lastNight ? { ...lastNight } : null,
    trialFailure: state.resonance?.trial?.status === 'failed' ? String(state.resonance.trial.failureReason || '试炼中断') : null,
    issues, urgent: issues.slice(0, RECOVERY.hudLimit) };
}
