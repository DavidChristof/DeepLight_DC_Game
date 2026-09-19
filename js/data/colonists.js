// data/colonists.js —— W16-D N0：拓荒者身份卡与观测契约（纯数据）
//
// N0 只建立稳定的“人是谁”与“当前发生什么”数据边界，不改变现有工作选择与数值。
// 后续 N1+ 的任务板、职业和救援逻辑都只能引用这里的字段/表，不能各自再造一套名字。

export const COLONISTS = Object.freeze({
  VERSION: 1,
  MAX_RELATIONS: 4,
  MAX_MEMORIAL_EVENTS: 24,
  MAX_EVENTS: 12,
  MAX_ACTIVE_TASKS: 1,
  ID_PREFIX: 'crew',
  ROLES: Object.freeze({
    miner: Object.freeze({ id: 'miner', trait: 'miner', name: '采掘', note: '优先处理矿脉与岩壁', portrait: 'colonist_miner', palette: 'amber', effects: Object.freeze({ gather: 1.4, findDeep: true }) }),
    farmer: Object.freeze({ id: 'farmer', trait: 'farmer', name: '农务', note: '照看幽菌田与食物', portrait: 'colonist_farmer', palette: 'moss', effects: Object.freeze({ farmYield: 1, farmBonus: 1 }) }),
    nightwatch: Object.freeze({ id: 'nightwatch', trait: 'nightwatch', name: '守望', note: '更适合夜间留守与巡逻', portrait: 'colonist_nightwatch', palette: 'blue', effects: Object.freeze({ nightMorale: 0.4 }) }),
    tinker: Object.freeze({ id: 'tinker', trait: 'tinker', name: '机工', note: '照看炉具、工具与施工', portrait: 'colonist_tinker', palette: 'copper', effects: Object.freeze({ build: 2, refine: 2, stoke: 2, towerRate: 1.1 }) }),
    scholar: Object.freeze({ id: 'scholar', trait: 'scholar', name: '学者', note: '负责解析与记录', portrait: 'colonist_scholar', palette: 'violet', effects: Object.freeze({ analyze: 1.5, story: true }) }),
    medic: Object.freeze({ id: 'medic', trait: 'medic', name: '行医', note: '更快完成医疗站治疗，也更快重新排队', portrait: 'colonist_scholar', palette: 'rose', effects: Object.freeze({ medical: 1.35, rescueRestart: true }) }),
  }),
  PERSONALITIES: Object.freeze({
    darkfear: Object.freeze({ id: 'darkfear', trait: 'darkfear', name: '畏暗', taboo: '长时间离灯', note: '黑暗中更快失去心志', effects: Object.freeze({ darkDrain: 1.6 }) }),
    glutton: Object.freeze({ id: 'glutton', trait: 'glutton', name: '好胃口', taboo: '断粮', note: '饥饿来得更快', effects: Object.freeze({ hungerRate: 1.3 }) }),
    slowhand: Object.freeze({ id: 'slowhand', trait: 'slowhand', name: '慢热', taboo: '连续赶工', note: '移动与工作节奏偏慢', effects: Object.freeze({ move: 0.85 }) }),
    coward: Object.freeze({ id: 'coward', trait: 'coward', name: '谨慎', taboo: '正面迎敌', note: '看到蚀巢核心会优先避险', effects: Object.freeze({ bossMorale: -20 }) }),
    frail: Object.freeze({ id: 'frail', trait: 'frail', name: '脆弱', taboo: '高风险作业', note: '生命上限较低', effects: Object.freeze({ maxHp: -20 }) }),
  }),
});

const ROLE_IDS = Object.freeze(Object.keys(COLONISTS.ROLES));
const PERSONALITY_IDS = Object.freeze(Object.keys(COLONISTS.PERSONALITIES));
const CREW_EVENT_KINDS = Object.freeze(['join', 'role', 'down', 'rescue', 'death', 'revive']);

function normalizeCrewEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-COLONISTS.MAX_EVENTS).map((e) => ({
    day: Math.max(1, Number.isFinite(e && e.day) ? e.day | 0 : 1),
    kind: String(e && e.kind || ''),
    text: String(e && e.text || '').slice(0, 48),
  })).filter((e) => CREW_EVENT_KINDS.includes(e.kind) && e.text);
}

// N7b：经历是有限、纯数据的个人记忆，不参与 AI 决策或数值计算。
export function recordCrewEvent(worker, kind, text, day = 1) {
  if (!worker) return null;
  const card = ensureCrewCard(worker);
  if (!CREW_EVENT_KINDS.includes(kind)) return null;
  const event = { day: Math.max(1, Number.isFinite(day) ? day | 0 : 1), kind, text: String(text || '').slice(0, 48) };
  if (!event.text) return null;
  const events = normalizeCrewEvents(card.events);
  const last = events[events.length - 1];
  if (!last || last.day !== event.day || last.kind !== event.kind || last.text !== event.text) events.push(event);
  card.events = events.slice(-COLONISTS.MAX_EVENTS);
  return card.events[card.events.length - 1] || event;
}

// 由现有专长/短处确定默认身份，不重新抽签，保证旧档读入后仍是同一个人。
export function roleOfTrait(id) { return ROLE_IDS.includes(id) ? id : 'miner'; }
export function personalityOfTrait(id) { return PERSONALITY_IDS.includes(id) ? id : 'slowhand'; }

export function roleOf(worker) {
  const id = worker && worker.crew && worker.crew.role;
  return COLONISTS.ROLES[id] || COLONISTS.ROLES[roleOfTrait(worker && worker.traits && worker.traits.good)];
}

export function personalityOf(worker) {
  const id = worker && worker.crew && worker.crew.personality;
  return COLONISTS.PERSONALITIES[id] || COLONISTS.PERSONALITIES[personalityOfTrait(worker && worker.traits && worker.traits.bad)];
}

export function roleIs(worker, id) { return roleOf(worker).id === id; }

// N4d：玩家在名册中重排职业时走同一写入口。只改身份卡的职业/视觉锚点，
// 不重掷擅长、性格或随机数；因此旧档和未主动调度的回放仍保持原曲线。
export function assignRole(worker, id) {
  if (!worker || !COLONISTS.ROLES[id]) return null;
  const card = ensureCrewCard(worker);
  const role = COLONISTS.ROLES[id];
  card.role = role.id;
  card.palette = role.palette;
  card.portrait = role.portrait;
  return card;
}
export function personalityIs(worker, id) { return personalityOf(worker).id === id; }

// 当前任务的“适配度”只读投影：它复用现有实际倍率，不额外改变 AI 选择。
export function roleTaskMul(worker, job) {
  const effects = roleOf(worker).effects || {};
  return Number.isFinite(effects[job]) ? effects[job] : 1;
}

export function roleInfluence(worker, job, ctx = {}) {
  const role = roleOf(worker), personality = personalityOf(worker);
  const out = [];
  const mul = roleTaskMul(worker, job);
  if (mul !== 1) out.push(`职业「${role.name}」：${job === 'gather' ? '采集' : job === 'build' ? '施工' : job === 'refine' ? '炼油' : job === 'stoke' ? '添火' : job === 'medical' ? '治疗' : '当前任务'} ×${mul}`);
  if (role.id === 'medic' && (job === 'medical' || job === 'rescue')) out.push('行医：优先处理伤员');
  if (role.id === 'farmer' && job === 'gather') out.push('擅长幽菌田：收获 +1 食物');
  if (role.id === 'nightwatch' && ctx.night) out.push('守望：夜间士气 +0.4/s');
  if (role.id === 'scholar' && ctx.lit) out.push('学者：灯下让同伴心志回升');
  if (personality.id === 'darkfear' && ctx.dark) out.push('畏暗：黑暗中的心志流失 ×1.6');
  if (personality.id === 'glutton') out.push('好胃口：饥饿速度 ×1.3');
  if (personality.id === 'slowhand') out.push('慢热：移动速度 ×0.85');
  if (personality.id === 'coward' && ctx.boss) out.push('谨慎：遇到蚀巢核心会先避险');
  if (personality.id === 'frail') out.push('脆弱：生命上限 −20');
  return { role: role.id, personality: personality.id, taskMul: mul, effects: out };
}

// 名字目前不会被玩家改，但 ID 仍不依赖数组位置，避免前面有人死亡后全队换 ID。
export function stableCrewId(name, index = 0) {
  const text = String(name || `拓荒者 ${index + 1}`);
  let h = 2166136261;
  for (const ch of text) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return `${COLONISTS.ID_PREFIX}-${(h >>> 0).toString(36)}`;
}

// 身份卡的唯一写入口。stored 只接受旧档已有字段；未知字段不进入运行时契约。
export function ensureCrewCard(worker, index = 0, joinedDay = 1, stored = null) {
  const old = stored || worker.crew || {};
  const good = worker.traits && worker.traits.good;
  const bad = worker.traits && worker.traits.bad;
  const role = COLONISTS.ROLES[old.role] ? old.role : roleOfTrait(good);
  const personality = COLONISTS.PERSONALITIES[old.personality] ? old.personality : personalityOfTrait(bad);
  worker.crew = {
    id: old.id || stableCrewId(worker.name, index),
    role,
    personality,
    origin: old.origin || '营地拓荒者',
    joinedDay: Number.isFinite(old.joinedDay) ? old.joinedDay : Math.max(1, joinedDay | 0),
    palette: old.palette || COLONISTS.ROLES[role].palette,
    portrait: old.portrait || COLONISTS.ROLES[role].portrait,
    events: normalizeCrewEvents(old.events),
  };
  return worker.crew;
}

// 观测/存档需要一个不带运行时引用的稳定投影。
export function crewCardOf(worker, index = 0, joinedDay = 1) {
  const card = worker.crew || {};
  const role = COLONISTS.ROLES[card.role] ? card.role : roleOfTrait(worker.traits && worker.traits.good);
  const personality = COLONISTS.PERSONALITIES[card.personality] ? card.personality : personalityOfTrait(worker.traits && worker.traits.bad);
  return {
    id: card.id || stableCrewId(worker.name, index),
    role,
    personality,
    origin: card.origin || '营地拓荒者',
    joinedDay: Number.isFinite(card.joinedDay) ? card.joinedDay : Math.max(1, joinedDay | 0),
    palette: card.palette || COLONISTS.ROLES[role].palette,
    portrait: card.portrait || COLONISTS.ROLES[role].portrait,
    events: normalizeCrewEvents(card.events),
  };
}
