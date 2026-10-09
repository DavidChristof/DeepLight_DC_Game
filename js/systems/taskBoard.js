// systems/taskBoard.js —— W16-D N1：任务板桥接层
//
// 这里只维护“谁在做什么”的轻量投影；旧 AI 仍在 worker.js 决定 job、目标和路径。
// 任务板不每帧扫描地图，也不持有实体引用，便于存档、观测和后续 N2 调度 UI 使用。
import { TASKS, makeTask, taskFromSave, taskPoint, taskReservation, taskDef, directiveFromSave } from '../data/tasks.js';
import { EXPEDITION } from '../data/expedition.js';
import { beginCrewDispatch, recordOutpostEvent } from '../data/colonists.js';

const DEFAULT_REASON = Object.freeze({
  idle: '待命：等待下一次工作决策',
  planning: '正在选择目标',
  active: '目标已选，等待或重新规划路径',
  blocked: '暂时没有有效目标',
});

// 名册/调度面板共用的成员枚举：当前区块和休眠区块都只返回已有实体，不触发加载或寻路。
export function allCrewWorkers(state) {
  const out = [];
  const seen = new Set();
  const add = (w) => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    out.push(w);
  };
  for (const w of state && state.workers || []) add(w);
  for (const c of Object.values((state && state.chunkStore) || {})) for (const w of c.workers || []) add(w);
  return out;
}

export function ensureDirective(w) {
  if (!w) return null;
  w.directive = directiveFromSave(w.directive);
  return w.directive;
}

export function restoreDirective(w, raw) {
  if (!w) return null;
  w.directive = directiveFromSave(raw);
  return w.directive;
}

export function findCrewWorker(state, id) {
  if (!id) return null;
  return allCrewWorkers(state).find((w) => (w.crew && w.crew.id === id) || w.name === id) || null;
}

export function setDirective(w, patch = {}, state = null) {
  if (!w) return null;
  const old = ensureDirective(w);
  const next = { ...old, ...patch };
  if (('outpost' in patch || 'outpostMode' in patch) && !('returnHome' in patch)) next.returnHome = false;
  w.directive = directiveFromSave(next);
  const targetChanged = JSON.stringify(old.outpost) !== JSON.stringify(w.directive.outpost) || old.returnHome !== w.directive.returnHome;
  if (targetChanged) {
    beginCrewDispatch(w);
    if (old.outpost && !w.directive.outpost && state) recordOutpostEvent(w, 'outpostCancel', { x: w.chunkX | 0, y: w.chunkY | 0 }, state.day);
  }
  if (targetChanged || !w.directive.outpost) {
    w.outpostTravel = null; w.path = [];
    w.target = null; w.crop = null; w.site = null; w.furnace = null; w.smelter = null;
    w.job = 'idle';
    w.task = makeTask('idle', null, 'idle', w.directive.outpost ? '等待调度' : '已取消驻守命令', w.crew && w.crew.id || '');
  }
  return w.directive;
}

// 只读准入：面板与调度器共用；不加载目标区块，也不清除待兑现告警。
export function returnHomeError(state, w) {
  if (!w || !w.alive) return '已离世，无法返营';
  if (w.downed) return '需要先救援';
  if (w.hollow) return '蚀化，无法自行返营';
  if (state.layerId !== 'surface') return '回到地表再调度';
  const home = EXPEDITION.HOME_CHUNK;
  const distance = Math.abs((w.chunkX | 0) - home.x) + Math.abs((w.chunkY | 0) - home.y);
  if (distance > EXPEDITION.RETURN_MAX_DISTANCE) return '仅支持相邻前哨返营';
  const c = state.chunkStore && state.chunkStore[`${w.chunkX | 0},${w.chunkY | 0}`];
  if ((c && c.outpost && c.outpost.alerts || []).some(a => a.status === 'open' && a.rescuePending && (!a.workerId || a.workerId === (w.crew && w.crew.id)))) return '前往前哨确认险情';
  if (!distance && !(w.directive && w.directive.returnHome)) return '已在营地';
  return null;
}

// 返回null成功，字符串为拒绝；重复请求不重置迁移计时。
export function requestReturnHome(state, w) {
  const error = returnHomeError(state, w);
  if (error) return error;
  setDirective(w, { outpost: { ...EXPEDITION.HOME_CHUNK }, outpostMode: 'silent', returnHome: true }, state);
  return null;
}

export function beginTask(w) {
  if (!w) return null;
  const job = w.job || 'idle';
  w.task = makeTask(job, null, job === 'idle' ? 'idle' : 'planning', DEFAULT_REASON[job === 'idle' ? 'idle' : 'planning']);
  return w.task;
}

export function syncTask(w, point = null, reason = '') {
  if (!w) return null;
  const job = w.job || 'idle';
  const source = job === 'gather' ? (w.crop || w.target)
    : job === 'build' ? w.site
      : job === 'refine' ? w.furnace
        : job === 'stoke' ? w.smelter
          : job === 'mourn' ? w.grave
            : job === 'wander' ? w.wanderTo
              : null;
  const sourceKind = source && (source.kind || source.type || (source.res ? 'resource' : null));
  const withChunk = (p) => p ? { ...p, chunkX: p.chunkX == null ? (w.chunkX || 0) : p.chunkX, chunkY: p.chunkY == null ? (w.chunkY || 0) : p.chunkY } : null;
  const target = source
    ? taskPoint(withChunk(source), sourceKind, source.res || null)
    : (point ? taskPoint(withChunk(point), point.kind || point.type || null, point.res || null) : null);
  const status = job === 'idle' ? 'idle' : (target ? 'active' : 'blocked');
  const fallback = DEFAULT_REASON[status] || DEFAULT_REASON.planning;
  w.task = makeTask(job, target, status, reason || fallback, w.crew && w.crew.id ? w.crew.id : w.name || '');
  return w.task;
}

export function restoreTask(w, raw) {
  if (!w) return null;
  w.task = taskFromSave(raw) || makeTask(w.job || 'idle', null, (w.job || 'idle') === 'idle' ? 'idle' : 'planning', '读档后等待下一次工作决策', w.crew && w.crew.id ? w.crew.id : w.name || '');
  return w.task;
}

// 资源点采用单席位预约：施工/炼油/添火等旧逻辑已有自己的容量规则，继续由 worker.js 管理。
export function taskReservedByOther(state, worker, job, target) {
  const key = taskReservation(job, target);
  if (!key) return false;
  for (const other of state.workers || []) {
    if (!other || other === worker || !other.alive || !other.task) continue;
    if (other.task.reservation === key) return true;
  }
  return false;
}

export function taskBoardStats(state) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const members = [];
  const seen = new Set();
  const add = (w) => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    members.push(w);
  };
  for (const w of allCrewWorkers(state)) add(w);
  const reservations = new Map();
  let active = 0, blocked = 0, idle = 0;
  for (const w of members) {
    const task = w.task;
    if (!task || task.job === 'idle' || task.status === 'idle') idle += 1;
    else if (task.status === 'blocked') blocked += 1;
    else active += 1;
    if (task && task.reservation) {
      const list = reservations.get(task.reservation) || [];
      list.push(w.name || '拓荒者');
      reservations.set(task.reservation, list);
    }
  }
  const conflicts = [];
  // 资源点允许两人轮流/并行采集：只有施工、炼油等“单席位”任务才算冲突。
  for (const [key, owners] of reservations) if (owners.length > 1 && !key.startsWith('gather:')) conflicts.push({ key, owners: owners.slice(0, TASKS.MAX_RESERVATIONS_PER_WORKER + 1) });
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    version: TASKS.VERSION,
    active, blocked, idle,
    reservations: reservations.size,
    conflicts,
    ms: +(Math.max(0, t1 - t0).toFixed(4)),
  };
}

export function taskPriority(job) { return taskDef(job).priority; }
