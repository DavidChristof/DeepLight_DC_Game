// data/tasks.js —— W16-D N1：拓荒者任务板的数据契约
//
// 任务只是“意图与解释”的稳定投影；它不拥有寻路、不直接执行生产，也不改变旧 AI 的选择顺序。
// 所有任务标签、优先级和可抢占规则集中在这里，避免 UI / NPC 各写一套名字。

export const TASKS = Object.freeze({
  VERSION: 1,
  MAX_ACTIVE_PER_WORKER: 1,
  MAX_RESERVATIONS_PER_WORKER: 1,
  STATUSES: Object.freeze(['idle', 'planning', 'active', 'blocked']),
  JOBS: Object.freeze({
    idle: Object.freeze({ id: 'idle', label: '待命', priority: 0, reserve: false }),
    gather: Object.freeze({ id: 'gather', label: '采集', priority: 35, reserve: true }),
    eat: Object.freeze({ id: 'eat', label: '进食', priority: 88, reserve: false }),
    flee: Object.freeze({ id: 'flee', label: '回营避难', priority: 100, reserve: false }),
    guard: Object.freeze({ id: 'guard', label: '守卫', priority: 52, reserve: false }),
    forage: Object.freeze({ id: 'forage', label: '夜采', priority: 46, reserve: true }),
    patrol: Object.freeze({ id: 'patrol', label: '巡逻', priority: 70, reserve: false }),
    mourn: Object.freeze({ id: 'mourn', label: '哀悼', priority: 24, reserve: false }),
    wander: Object.freeze({ id: 'wander', label: '梦游', priority: 12, reserve: false }),
    hollow: Object.freeze({ id: 'hollow', label: '蚀化', priority: 96, reserve: false }),
    refine: Object.freeze({ id: 'refine', label: '炼油', priority: 64, reserve: true }),
    build: Object.freeze({ id: 'build', label: '施工', priority: 58, reserve: true }),
    stoke: Object.freeze({ id: 'stoke', label: '添火', priority: 68, reserve: true }),
    rest: Object.freeze({ id: 'rest', label: '休整', priority: 18, reserve: true }),
    rescue: Object.freeze({ id: 'rescue', label: '救援', priority: 99, reserve: false }),
    medical: Object.freeze({ id: 'medical', label: '治疗', priority: 97, reserve: false }),
    outpost: Object.freeze({ id: 'outpost', label: '前往前哨', priority: 72, reserve: false }),
  }),
});

// N2 拓荒者调度：指令是“任务板权重/限制”的可存档意图，不是瞬移或直接执行脚本。
export const DIRECTIVES = Object.freeze({
  MODES: Object.freeze({
    auto: Object.freeze({ id: 'auto', label: '自动', desc: '按营地总令自行选择工作' }),
    rest: Object.freeze({ id: 'rest', label: '休整', desc: '优先休息、进食和恢复状态' }),
    guard: Object.freeze({ id: 'guard', label: '守卫', desc: '优先守住当前灯火与营地' }),
    forage: Object.freeze({ id: 'forage', label: '夜采', desc: '允许在夜间采集夜辉草' }),
    patrol: Object.freeze({ id: 'patrol', label: '巡逻', desc: '沿当前巡逻方向观察边界' }),
  }),
  RESCUE: Object.freeze({ normal: '常规', high: '优先救援' }),
  // N4d：照护意图只改变治疗/救援候选排序，不替代工作模式。
  // neutral 供旧档兼容；玩家可在名册中选择三种明确意图。
  CARE: Object.freeze({ neutral: '常规', medical: '治疗优先', rescue: '救援优先', guard: '仅守灯' }),
  CARE_PRIORITY: Object.freeze({ medical: 0, neutral: 1, rescue: 2, guard: 3 }),
  // N6a：前哨是可解释的驻守意图；本步只记录，不瞬移、不跨区块结算。
  OUTPOST: Object.freeze({ guard: '守灯', gather: '采掘', silent: '静默撤离' }),
  VERSION: 1,
});

const MODE_SET = new Set(Object.keys(DIRECTIVES.MODES));
const RESCUE_SET = new Set(Object.keys(DIRECTIVES.RESCUE));
const CARE_SET = new Set(Object.keys(DIRECTIVES.CARE));
const OUTPOST_SET = new Set(Object.keys(DIRECTIVES.OUTPOST));
export const CARE_PRIORITY = DIRECTIVES.CARE_PRIORITY;

function safeChunk(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number.isFinite(p.x) ? p.x | 0 : null;
  const y = Number.isFinite(p.y) ? p.y | 0 : null;
  return x == null || y == null ? null : { x, y };
}

export function directiveFromSave(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const mode = MODE_SET.has(r.mode) ? r.mode : 'auto';
  const rescue = RESCUE_SET.has(r.rescue) ? r.rescue : 'normal';
  const care = CARE_SET.has(r.care) ? r.care : 'neutral';
  const area = safeChunk(r.area);
  const outpost = safeChunk(r.outpost);
  const outpostMode = OUTPOST_SET.has(r.outpostMode) ? r.outpostMode : (outpost ? 'guard' : null);
  return {
    version: DIRECTIVES.VERSION,
    mode,
    area,
    outpost,
    outpostMode,
    noNight: !!r.noNight,
    rescue,
    care,
  };
}

export function directiveForSave(raw) {
  return directiveFromSave(raw);
}

const STATUS_SET = new Set(TASKS.STATUSES);

export function taskDef(job) {
  return TASKS.JOBS[job] || TASKS.JOBS.idle;
}

function finitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: p.x | 0, y: p.y | 0 }
    : null;
}

// 只保留可序列化的坐标/资源信息，不把建筑或实体引用写进任务板/存档。
export function taskPoint(p, kind = null, res = null) {
  const point = finitePoint(p);
  if (!point) return null;
  const out = { x: point.x, y: point.y };
  if (kind) out.kind = String(kind);
  if (res) out.res = String(res);
  if (Number.isFinite(p.chunkX)) out.chunkX = p.chunkX | 0;
  if (Number.isFinite(p.chunkY)) out.chunkY = p.chunkY | 0;
  return out;
}

export function taskReservation(job, target) {
  const def = taskDef(job);
  if (!def.reserve || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const kind = target.kind || target.type || target.res || 'point';
  const cx = Number.isFinite(target.chunkX) ? target.chunkX | 0 : 0;
  const cy = Number.isFinite(target.chunkY) ? target.chunkY | 0 : 0;
  return `${def.id}:${kind}:${cx},${cy}:${target.x | 0},${target.y | 0}`;
}

export function taskId(job, target, owner = '') {
  const def = taskDef(job);
  const reservation = taskReservation(job, target);
  if (reservation) return reservation;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) return `${def.id}:${target.x | 0},${target.y | 0}`;
  return owner ? `${def.id}:${owner}` : def.id;
}

export function makeTask(job, target = null, status = 'planning', reason = '', owner = '') {
  const def = taskDef(job);
  const safeStatus = STATUS_SET.has(status) ? status : 'planning';
  const safeTarget = target ? taskPoint(target, target.kind || target.type || null, target.res || null) : null;
  const reservation = taskReservation(def.id, safeTarget);
  return {
    id: taskId(def.id, safeTarget, owner),
    job: def.id,
    label: def.label,
    priority: def.priority,
    status: safeStatus,
    reason: String(reason || ''),
    target: safeTarget,
    reservation,
  };
}

export function taskFromSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const job = TASKS.JOBS[raw.job] ? raw.job : 'idle';
  const status = STATUS_SET.has(raw.status) ? raw.status : (job === 'idle' ? 'idle' : 'planning');
  const target = taskPoint(raw.target, raw.target && (raw.target.kind || raw.target.type), raw.target && raw.target.res);
  const out = makeTask(job, target, status, raw.reason || '', raw.owner || '');
  return { ...out, id: typeof raw.id === 'string' && raw.id ? raw.id : out.id };
}

// 观测/存档使用同一份安全投影，防止对象引用或未知字段泄漏出去。
export function taskForSave(task) {
  return taskFromSave(task);
}
