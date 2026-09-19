// systems/mind.js —— D4「人的重量」：心志（长期精神值）/ 蚀化与安抚 / 羁绊 / 墓碑
// 与士气（分钟级情绪）分工：士气决定"当下干什么"，心志决定"她还是不是一个人"
import { BOND, GRIEF_DAYS, SOOTHE, SANITY_MAX, sanityTier, graveRadius } from '../data/traits.js';
import { BUILD } from '../data/buildings.js';
import { withdrawOne, deposit } from './storage.js';
import { purify } from './blight.js';
import { memoryGain } from './research.js';
import { isTide, isNight } from '../core/time.js';
import { COLONISTS, roleIs, personalityIs } from '../data/colonists.js';

// —— 基础查询 ——

export function ensureMind(state) {
  if (!state.graves) state.graves = [];
  if (!state.mind) state.mind = { day: state.day, hollowed: 0, soothed: 0, bossSeen: -1 };
  return state.mind;
}

export function bondLevel(secs) {
  if (secs >= BOND.lv3) return 3;
  if (secs >= BOND.lv2) return 2;
  if (secs >= BOND.lv1) return 1;
  return 0;
}
export function bondOf(w, name) { return (w.bonds && w.bonds[name]) || 0; }
export function bestBond(w) {
  let best = null, lv = 0;
  for (const n in (w.bonds || {})) {
    const l = bondLevel(w.bonds[n]);
    if (l > lv) { lv = l; best = n; }
  }
  return { name: best, level: lv };
}

// 活着且能干活的人（蚀化者不算人）
export function working(w) { return w.alive && !w.hollow && !w.downed; }
export function hasTrait(state, id, good) {
  return (state.workers || []).some((w) => working(w) && w.traits && w.traits[good ? 'good' : 'bad'] === id);
}
export const hasScholar = (state) => hasTrait(state, 'scholar', true);
export const hasTinker = (state) => hasTrait(state, 'tinker', true);
export const hasFarmer = (state) => hasTrait(state, 'farmer', true);

function lightAt(state, x, y) {
  if (!state.light) return 0;
  const ix = Math.max(0, Math.min(state.map.w - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(state.map.h - 1, Math.floor(y)));
  return state.light[iy * state.map.w + ix] || 0;
}
function nearGrave(state, x, y, r) {
  for (const g of state.graves || []) if (Math.hypot(g.x + 0.5 - x, g.y + 0.5 - y) <= r) return g;
  return null;
}
function nearCompanion(state, w) {
  for (const o of state.workers || []) {
    if (o === w || !working(o) || o.layerId !== w.layerId) continue;
    if (Math.hypot(o.x - w.x, o.y - w.y) <= 3) return o;
  }
  return null;
}

// 可工作的状态集合（羁绊累积用）
const WORKING_JOB = { gather: 1, eat: 0, guard: 1, forage: 1, patrol: 1, mourn: 0, flee: 0, hollow: 0, wander: 0, idle: 0, build: 1, refine: 1, rescue: 0, medical: 0 };

// —— 主循环 ——

export function updateMind(state, dt) {
  const mind = ensureMind(state);
  const ws = state.workers || [];
  const night = isNight(state);
  const tide = isTide(state);

  // 跨天：哀悼递减 / 前兆症状在入夜时结算
  if (mind.day !== state.day) {
    mind.day = state.day;
    for (const w of ws) if (w.grief > 0) w.grief -= 1;
  }

  // 学者在灯下讲故事 → 全队心志回复
  const story = ws.some((w) => working(w) && roleIs(w, 'scholar')
    && lightAt(state, w.x, w.y) > 2.5);

  // 怯战：视野内出现蚀巢核心时士气 −20（每只 Boss 只触发一次）
  const boss = (state.enemies || []).find((e) => e.alive && e.def && e.def.boss);
  if (boss && mind.bossSeen !== state.bossTier) {
    mind.bossSeen = state.bossTier;
    for (const w of ws) {
      if (!working(w) || !personalityIs(w, 'coward')) continue;
      w.morale = Math.max(0, w.morale - 20);
      w.sanity = Math.max(0, w.sanity - 6);
      state.floaties.push({ x: w.x, y: w.y - 0.6, txt: `${w.name}：那东西太大了…`, color: '#ff9d5c', t: 0, life: 1.4 });
    }
  }

  for (const w of ws) {
    if (!w.alive) continue;
    if (w.downed) continue;
    if (w.layerId && w.layerId !== state.layerId) continue;
    if (w.sanity == null) w.sanity = SANITY_MAX;
    if (w.hollow) continue;

    const lv = lightAt(state, w.x, w.y);
    const dm = w.dm || 0;

    // —— 心志：坏日子照士气速度侵蚀，好日子靠光/饱/同伴/墓碑慢慢长回来 ——
    if (dm < 0) {
      let drain = -dm * 0.35;
      if (personalityIs(w, 'darkfear') && lv <= 2.5) drain *= 1.6;
      w.sanity = Math.max(0, w.sanity - drain * dt);
    } else {
      let gain = 0;
      if (lv > 2.5 && w.hunger > 40 && w.morale > 55) gain += 0.03;   // 光 + 吃饱 + 心气
      if (story) gain += 0.02;                                        // 学者讲故事
      if (nearGrave(state, w.x, w.y, 4)) gain += 0.02;                // 墓碑的微光
      if (nearCompanion(state, w)) gain += 0.02;                      // 同伴陪伴
      if (gain > 0) w.sanity = Math.min(SANITY_MAX, w.sanity + gain * dt);
    }

    // 疑惧以上：不再响应指令切换（记住上一次能听懂的指令）
    if (w.sanity >= 60 || !w.lockedOrder) w.lockedOrder = state.order || 'auto';

    // —— 羁绊：8 格内一起干活，时间会说话 ——
    for (const o of ws) {
      if (o === w || !working(o) || o.layerId !== w.layerId) continue;
      if (!WORKING_JOB[w.job] || !WORKING_JOB[o.job]) continue;
      if (Math.hypot(o.x - w.x, o.y - w.y) > BOND.range) continue;
      w.bonds = w.bonds || {};
      w.bonds[o.name] = Math.min(BOND.lv3 + 300, (w.bonds[o.name] || 0) + dt);
    }

    // —— 蚀化前兆：入夜时偷吃 / 梦游 ——
    const tier = sanityTier(w.sanity);
    if (tier.id === 'prehollow' && !w.symT && (night || tide)) {
      w.symT = 1;                                        // 每天只发作一次
      if ((state.res.food || 0) > 0 && Math.random() < 0.35) {
        withdrawOne(state, 'food', 1, w.x, w.y);
        state.floaties.push({ x: w.x, y: w.y - 0.6, txt: `${w.name} 悄悄吃掉了 1 份食物`, color: '#ffb3b3', t: 0, life: 1.6 });
      }
      if (Math.random() < 0.45) {
        w.wanderT = 8;
        w.wanderTo = randomWanderTile(state);
        state.floaties.push({ x: w.x, y: w.y - 0.6, txt: `${w.name} 梦游了…`, color: '#c07bff', t: 0, life: 1.6 });
      }
    }
    if (!night && tier.id !== 'prehollow') w.symT = 0;

    // —— 心志归零：蚀化 ——
    if (w.sanity <= 0) hollow(state, w);
  }

  // —— 蚀化者的本能：站在净光柱里会被慢慢安抚回来 ——
  for (const w of ws) {
    if (!w.hollow) continue;
    const pur = (state.buildings || []).find((b) => b.type === 'purifier' && b.fuel > 0
      && BUILD.purifier && Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y) <= BUILD.purifier.purifyR + 0.6);
    if (!pur) { w.sootheT = 0; continue; }
    w.sootheT = (w.sootheT || 0) + dt;
    if (w.sootheT >= SOOTHE.autoSec) { w.sootheT = 0; soothe(state, w, SOOTHE.autoGain, true); }
  }
}

function randomWanderTile(state) {
  const m = state.map, cx = m.w / 2, cy = m.h / 2;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 10;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (x < 2 || y < 2 || x >= m.w - 2 || y >= m.h - 2) continue;
    if (m.isWalk(x, y) && !(m.occBuild && m.occBuild[y * m.w + x])) return { x, y };
  }
  return null;
}

// —— 蚀化 / 安抚 ——

export function hollow(state, w) {
  if (w.hollow) return;
  w.hollow = true;
  w.sanity = 0;
  w.morale = 0;
  w.job = 'hollow';
  w.path = [];
  w.bloom = null; w.target = null; w.crop = null;
  if (w.tool) { deposit(state, w.tool, 1, w.x, w.y); w.tool = null; }   // 人已经不是人了，工具留下
  const mind = ensureMind(state);
  mind.hollowed += 1;
  state.floaties.push({ x: w.x, y: w.y - 0.7, txt: `${w.name} 的心志碎了…`, color: '#c07bff', t: 0, life: 2.4 });
  state.banner = { title: `${w.name} 蚀化了`, sub: '——她只朝着光走。按住 E 安抚（消耗燃料），或用净光柱照她', t: 0, life: 6 };
  state._sidebarSig = null;
}

// 安抚：唯一"救人"的路径。free=true 表示净光柱自动安抚（不耗燃料，靠时间）
export function soothe(state, w, gain = SOOTHE.gain, free = false) {
  if (!w.hollow) return null;
  if (!free) {
    // 直接改 state.res 会被 syncRes 抹掉 —— 必须走容器账本
    if (withdrawOne(state, 'fuel', SOOTHE.fuel, w.x, w.y)) return `需要 ${SOOTHE.fuel} 燃料`;
  }
  w.sanity = Math.min(SANITY_MAX, (w.sanity || 0) + gain);
  w.morale = Math.max(w.morale, 45);
  purify(state, w.x, w.y, 2.4);                            // 安抚伴随一圈净光
  state.floaties.push({
    x: w.x, y: w.y - 0.7,
    txt: free ? `${w.name} 慢慢抬起了头` : `…她认出了你`,
    color: '#ffe9b0', t: 0, life: 1.6,
  });
  if (w.sanity >= SOOTHE.back) {
    w.hollow = false;
    w.sootheT = 0;
    w.hp = Math.max(w.hp, Math.ceil(w.maxHp * 0.5));
    w.job = 'flee';
    ensureMind(state).soothed += 1;
    const mg = memoryGain(state);                    // 知识「她带回的记忆」：安抚成功后全队心志 +10
    if (mg > 0) {
      for (const o of state.workers || []) {
        if (!o.alive || o.hollow) continue;
        o.sanity = Math.min(SANITY_MAX, (o.sanity || 0) + mg);
      }
      state.floaties.push({ x: w.x, y: w.y - 1.5, txt: `她带回的记忆：全队心志 +${mg}`, color: '#d8c6ff', t: 0, life: 2.4 });
    }
    state.floaties.push({ x: w.x, y: w.y - 1.1, txt: `${w.name} 回来了`, color: '#9ef7a8', t: 0, life: 2.2 });
    state.banner = { title: `${w.name} 回来了`, sub: '你还记得她的名字——这就够了', t: 0, life: 4.5 };
    state._sidebarSig = null;
  }
  return null;
}

// —— 伤亡 ——

// 同伴挨打：8 格内的羁绊同伴士气 −15（有冷却）
export function bondHurt(state, victim) {
  for (const w of state.workers || []) {
    if (w === victim || !working(w) || w.layerId !== victim.layerId) continue;
    const lv = bondLevel(bondOf(w, victim.name));
    if (lv <= 0) continue;
    if (Math.hypot(w.x - victim.x, w.y - victim.y) > BOND.hurtRange) continue;
    w.bondCd = w.bondCd || 0;
    if (w.bondCd > 0) continue;
    w.bondCd = BOND.hurtCd;
    w.morale = Math.max(0, w.morale - BOND.hurt);
    state.floaties.push({ x: w.x, y: w.y - 0.6, txt: `${w.name}：${victim.name}！`, color: '#ffb3b3', t: 0, life: 1.4 });
  }
}
export function tickBondCds(state, dt) {
  for (const w of state.workers || []) if (w.bondCd > 0) w.bondCd = Math.max(0, w.bondCd - dt);
}

// 阵亡：立墓碑（会成为光源），羁绊同伴心志 −30 且三天不工作
export function onWorkerDeath(state, dead) {
  ensureMind(state);
  const g = { x: Math.floor(dead.x), y: Math.floor(dead.y), name: dead.name, day: state.day, layerId: dead.layerId || state.layerId || 'surface', seen: 0 };
  if (!state.graves.some((o) => o.x === g.x && o.y === g.y)) state.graves.push(g);
  const affected = [];
  for (const w of state.workers || []) {
    if (w === dead || !w.alive || w.hollow || w.downed) continue;
    const lv = bondLevel(bondOf(w, dead.name));
    if (lv <= 0) continue;
    w.sanity = Math.max(0, (w.sanity == null ? SANITY_MAX : w.sanity) - BOND.death);
    w.grief = GRIEF_DAYS;
    w.grave = { x: g.x, y: g.y };
    affected.push({ name: w.name, level: lv });
    state.floaties.push({ x: w.x, y: w.y - 0.8, txt: `${w.name}：不…`, color: '#c9a0ff', t: 0, life: 2.2 });
  }
  const record = {
    type: 'death',
    crewId: dead.crew && dead.crew.id ? dead.crew.id : null,
    name: dead.name,
    day: state.day,
    x: g.x,
    y: g.y,
    layerId: dead.layerId || state.layerId || 'surface',
    cause: dead.deathCause || '伤势过重',
    affected: affected.slice(0, COLONISTS.MAX_RELATIONS),
    revived: false,
    reviveDay: 0,
    // 只保留可复苏所需的身份与状态快照；不保存路径、任务、实体引用。
    snapshot: {
      traits: dead.traits ? { good: dead.traits.good, bad: dead.traits.bad } : null,
      crew: dead.crew ? { ...dead.crew } : null,
      maxHp: dead.maxHp,
      hunger: dead.hunger,
      morale: dead.morale,
      sanity: dead.sanity,
      bonds: dead.bonds ? { ...dead.bonds } : {},
    },
  };
  dead.deathRecord = record;
  if (!Array.isArray(state.memorial)) state.memorial = [];
  state.memorial.push(record);
  if (state.memorial.length > COLONISTS.MAX_MEMORIAL_EVENTS) state.memorial.splice(0, state.memorial.length - COLONISTS.MAX_MEMORIAL_EVENTS);
  state._sidebarSig = null;
}

// 墓碑统计（HUD / 侧栏用）
export function graveStats(state) {
  const list = state.graves || [];
  let r = 0;
  for (const g of list) r = Math.max(r, graveRadius(state.day - g.day + 1));
  return { count: list.length, maxRadius: list.length ? r : 0 };
}
