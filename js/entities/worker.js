// entities/worker.js —— 拓荒者（NPC）：需求（饥饿/士气）+ 自动工作
// 简陋但活的 AI：饿了自己回营地吃饭、天黑了回营地躲、白天出去采矿/采木
import { Entity } from './entity.js';
import { T } from '../world/map.js';
import { findPath } from '../world/pathfinding.js';
import { BUILD, WORKER_RATE } from '../data/buildings.js';
import { advanceBuild } from '../systems/building.js';
import { workOnce, lightFire, addFire, fireOn } from '../systems/craft.js';
import { fireMatOf, fuelName } from '../data/fire.js';
import { deposit, withdraw, withdrawOne } from '../systems/storage.js';
import { isTide, isNight, ambientOf } from '../core/time.js';
import { NIGHTBLOOM, PATROL } from '../data/nightops.js';
import { hasTech, darkMoraleMul } from '../systems/research.js';
import { workerMineMul, workerBuildMul, updateWorkerTools, returnWorkerTool } from '../systems/tools.js';
// 心志系统反向依赖：mind.js 不引用 worker.js，避免环
import { rollTraits, sanityTier, sanityWorkMul, BOND, HOT_MEAL, REFINE, RECRUIT_COST, RECRUIT_MAX, RECRUIT_LETTERS, STARVE } from '../data/traits.js';
import { SURVIVAL } from '../data/survival.js';
import { restAvailable, nearestRestSpot } from '../systems/survival.js';
import { bondLevel, onWorkerDeath } from '../systems/mind.js';
import { ensureCrewCard, recordCrewEvent, roleIs, roleTaskMul, personalityIs } from '../data/colonists.js';
import { makeTask, CARE_PRIORITY } from '../data/tasks.js';
import { beginTask, syncTask, ensureDirective } from '../systems/taskBoard.js';

const R = 0.34;
const MINE_TICK = 0.6;          // 每 MINE_TICK 秒产出 1 单位
const EAT_RANGE = 2.2;          // 靠近营地灯即可进食
const WORK_RANGE = 18;          // 搜索工作点的半径

function canStand(map, x, y) {
  const x0 = Math.floor(x - R), x1 = Math.floor(x + R);
  const y0 = Math.floor(y - R), y1 = Math.floor(y + R);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (!map.isWalk(tx, ty)) return false;
  return true;
}

function lightAt(state, x, y) {
  if (!state.light) return 0;
  const ix = Math.max(0, Math.min(state.map.w - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(state.map.h - 1, Math.floor(y)));
  return state.light[iy * state.map.w + ix] || 0;
}

function addFx(state, x, y, txt, color) {
  state.floaties.push({ x, y: y - 0.4, txt, color, t: 0, life: 0.9 });
}

export class Worker extends Entity {
  constructor(name, x, y, traits) {
    super('worker', x, y);
    this.name = name;
    this.crew = null;                 // N0 身份卡：由创建/读档入口补齐，不参与旧 AI 数值
    this.hp = SURVIVAL.WORKER.BASE_HP; this.maxHp = SURVIVAL.WORKER.BASE_HP;      // 拓荒者不是战士，但也该撑到跑掉
    this.hunger = SURVIVAL.WORKER.START_HUNGER;            // 0=饿死边缘 100=饱
    this.morale = 70;            // 0=崩溃 100=高昂
    this.job = 'idle';           // idle / gather / eat / flee
    this.task = makeTask('idle', null, 'idle', '等待下一次工作决策'); // N1 任务板投影：不持有实体引用，不改变旧 AI
    this.directive = { version: 1, mode: 'auto', area: null, outpost: null, outpostMode: null, noNight: false, rescue: 'normal', care: 'neutral' }; // N2/N4d/N6a：调度意图
    this.outpostTravel = null;   // N6b：跨区迁移进度（只存坐标/计时，不存路径引用）
    this.target = null;          // {x,y} 工作点
    this.path = [];
    this.pathT = 0;
    this.mineT = 0;
    this.crop = null;             // 正在抢收的幽菌田
    this.flash = 0;
    this.layerId = 'surface';     // 所属层：拓荒者驻守地表营地，不随玩家下潜
    // —— D4「人的重量」——
    this.traits = traits || rollTraits();   // 1 长 1 短，开局随机
    this.sanity = 100;            // 心志：长期精神值（天级），归零即蚀化
    this.bonds = {};              // { 名字: 共处秒数 } → 好感 1~3 级
    this.grief = 0;               // 葬友：剩余不工作天数
    this.grave = null;            // 要去守的坟
    this.hollow = false;          // 蚀化：不再是人，只朝着光走
    this.lockedOrder = 'auto';    // 疑惧以下不再响应指令切换
    this.wanderT = 0;             // 梦游剩余时间
    this.dm = 0;                  // 本帧士气增减/秒（供 mind.js 推算心志）
    this.overwork = 0;
    this.shiftDay = -1;
    // N4：生命归零先进入可救援的倒地窗口；成功救回会留下短期伤势。
    this.downed = false;
    this.downT = 0;
    this.rescueWound = 0;
    this.rescueWoundT = 0;
    this.rescueBy = null;
    this.rescueState = 'none';
    this.rescueBed = null;
    this.rescueRestT = 0;
    this.medicalState = 'none';
    this.medicalClinic = null;
    this.medicalT = 0;
    if (personalityIs(this, 'frail')) { this.maxHp = SURVIVAL.WORKER.FRAIL_HP; this.hp = SURVIVAL.WORKER.FRAIL_HP; }   // 孱弱
  }
  sanityTierInfo() { return sanityTier(this.sanity); }
}

// 找最近的资源节点（矿/藤木/可挖的岩壁）
// 岩壁：研究「石工」后就能挖（徒手慢，手里有镐快 40%）—— 不再要求“必须持镐”，
//   否则工人也进不去岩壁，而石头又是制造台/工具的唯一原料。
function findNode(state, px, py, w) {
  const m = state.map;
  const rockOpen = hasTech(state, 'stonework');
  const wantRock = rockOpen && (state.res.stone || 0) < 24;      // 石头不缺的时候别抢着挖
  let best = null;
  for (let y = Math.max(1, py - WORK_RANGE); y <= Math.min(m.h - 2, py + WORK_RANGE); y++)
    for (let x = Math.max(1, px - WORK_RANGE); x <= Math.min(m.w - 2, px + WORK_RANGE); x++) {
      const i = y * m.w + x;
      const t = m.tiles[i];
      if (m.occWalk[i]) continue;
      if (t === T.ORE || t === T.VINE) {
        if (!(m.nodeAmt[i] > 0)) continue;
        const res = t === T.ORE ? 'ore' : 'vine';
        const d = Math.abs(x - px) + Math.abs(y - py);
        if (!best || d < best.d) best = { x, y, d, res };
      } else if (t === T.ROCK && wantRock) {
        const d = Math.abs(x - px) + Math.abs(y - py) + 4;      // 岩壁优先级略低（跑远路挖石头不划算）
        if (!best || d < best.d) best = { x, y, d, res: 'stone' };
      }
    }
  return best;
}

// 引路篝火：消耗食物 + 燃料，深渊送回一位迷路的拓荒者（随机专长/短处）
// 返回错误字符串，成功返回 null
export function recruitWorker(state) {
  const ws = state.workers || [];
  if (ws.length >= RECRUIT_MAX) return `营地最多 ${RECRUIT_MAX} 人`;
  for (const k in RECRUIT_COST) if ((state.res[k] || 0) < RECRUIT_COST[k]) return '资源不足';
  const m = state.map;
  const bx = state.beacons.length ? state.beacons[0].x : Math.floor(state.player.x);
  const by = state.beacons.length ? state.beacons[0].y : Math.floor(state.player.y);
  let spot = null;
  for (let r = 2; r <= 7 && !spot; r++) {
    for (let a = 0; a < 20 && !spot; a++) {
      const ang = (a / 20) * Math.PI * 2 + r * 0.7;
      const x = Math.round(bx + Math.cos(ang) * r), y = Math.round(by + Math.sin(ang) * r);
      if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
      if (!m.isWalk(x, y) || (m.occBuild && m.occBuild[y * m.w + x])) continue;
      spot = { x: x + 0.5, y: y + 0.5 };
    }
  }
  if (!spot) return '营地周围没有空地';
  withdraw(state, RECRUIT_COST, bx, by);      // 从最近的容器付账
  const used = ws.map((w) => w.name);
  const letter = RECRUIT_LETTERS.find((L) => !used.includes(`拓荒者 ${L}`)) || `${ws.length + 1}`;
  const nw = new Worker(`拓荒者 ${letter}`, spot.x, spot.y);
  ensureCrewCard(nw, ws.length, state.day || 1);
  recordCrewEvent(nw, 'join', '加入拓荒队', state.day || 1);
  nw.hunger = SURVIVAL.WORKER.RECRUIT_HUNGER; nw.morale = 65; nw.sanity = 80;      // 初来乍到：心志没满，也不是空的
  state.workers.push(nw);
  state.floaties.push({ x: spot.x, y: spot.y - 0.7, txt: `${nw.name} 循着火光来了`, color: '#ffd76e', t: 0, life: 2.2 });
  state.banner = { title: `${nw.name} 加入了拓荒队`, sub: '她说她记得上一堆篝火的味道', t: 0, life: 4.5 };
  state._sidebarSig = null;
  return null;
}

function finishWorkerDeath(state, w) {
  if (!w.alive) return;
  w.deathCause = w.downed ? '救援窗口耗尽' : '伤势过重';
  w.alive = false;
  w.downed = false;
  w.downT = 0;
  w.rescueBy = null;
  w.rescueState = 'none';
  w.rescueBed = null;
  w.rescueRestT = 0;
  w.medicalState = 'none';
  w.medicalClinic = null;
  w.medicalT = 0;
  if (state.rescue && state.rescue.worker === w) state.rescue = null;
  returnWorkerTool(state, w);
  addFx(state, w.x, w.y, `${w.name} 没能撑住…`, '#ff9d9d');
  recordCrewEvent(w, 'death', w.deathCause, state.day || 1);
  onWorkerDeath(state, w);
  if (state.rescue && state.rescue.worker === w) state.rescue = null;
  state._sidebarSig = null;
}

// 公开给区块入口使用：远端告警只在玩家进入后兑现，之后仍走同一套倒地/救援状态机。
export function downWorker(state, w) {
  if (w.downed || !w.alive) return;
  w.downed = true;
  w.downT = SURVIVAL.RESCUE.DOWNED_SECS;
  w.hp = 0;
  w.job = 'rescue';
  w.task = makeTask('rescue', { x: Math.floor(w.x), y: Math.floor(w.y) }, 'blocked', '倒地：等待救援');
  w.path = [];
  w.target = null; w.crop = null; w.bloom = null; w.site = null; w.furnace = null; w.smelter = null;
  w.rescueBy = null;
  w.rescueState = 'none';
  w.rescueBed = null;
  w.rescueRestT = 0;
  w.medicalState = 'none';
  w.medicalClinic = null;
  w.medicalT = 0;
  returnWorkerTool(state, w);
  addFx(state, w.x, w.y, `${w.name} 倒地 · 还能撑 ${Math.ceil(w.downT)}s`, '#ffcf8a');
  recordCrewEvent(w, 'down', '倒地待救', state.day || 1);
  state._sidebarSig = null;
}

function rescueActor(state, session) {
  if (!session) return null;
  if (session.actor === 'player') return state.player;
  const w = session.rescuer;
  return w && w.alive && !w.downed && w.layerId === state.layerId ? w : null;
}

function nearestBunk(state, x, y) {
  let best = null;
  for (const b of state.buildings || []) {
    if (b.site || !BUILD[b.type]?.restSlots) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (!best || d < best.d) best = { x: b.x, y: b.y, d };
  }
  return best;
}

function medicalClinics(state) {
  return (state.buildings || []).filter((b) => !b.site && BUILD[b.type]?.medicalSlots && b.layerId !== 'depth');
}

function clinicNear(state, w) {
  let best = null, bestD = Infinity;
  for (const b of medicalClinics(state)) {
    const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
    if (d > SURVIVAL.RESCUE.MEDICAL_RANGE || lightAt(state, b.x + 0.5, b.y + 0.5) < SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN) continue;
    if (!best || d < bestD) { best = b; bestD = d; }
  }
  return best;
}

function clearMedical(w, clinic = null) {
  if (clinic && clinic.medicalWorker === w) clinic.medicalWorker = null;
  w.medicalState = 'none';
  w.medicalClinic = null;
  w.medicalT = 0;
}

// N4c：医疗站只处理已经救回的恢复期伤员；没有跨区块/离线结算。
function updateMedicalCare(state, dt) {
  const clinics = medicalClinics(state);
  const workers = state.workers || [];
  const maxQ = SURVIVAL.RESCUE.MEDICAL_QUEUE_MAX;
  const inState = (w) => w && workers.includes(w) && w.alive && !w.downed && w.rescueWound > 0;
  const queue = Array.isArray(state.medicalQueue) ? state.medicalQueue : (state.medicalQueue = []);
  for (let i = queue.length - 1; i >= 0; i--) {
    const w = queue[i];
    if (!inState(w) || !['queued', 'treating'].includes(w.medicalState)) queue.splice(i, 1);
  }

  // 先清掉换区块、死亡、拆除医疗站后留下的运行时引用。
  for (const b of clinics) if (b.medicalWorker && (!inState(b.medicalWorker) || b.medicalWorker.medicalClinic !== b)) b.medicalWorker = null;
  for (const w of workers) {
    if (!inState(w) || !w.medicalState || w.medicalState === 'none') {
      if (w.medicalState && w.medicalState !== 'none') clearMedical(w);
      continue;
    }
    const b = clinics.find((x) => x.x === w.medicalClinic?.x && x.y === w.medicalClinic?.y);
    const care = ensureDirective(w).care;
    if (!b || w.layerId !== state.layerId || care === 'guard') clearMedical(w, b);
    else {
      // 存档恢复的是坐标快照；重新绑定到当前区块里的建筑对象，不能因引用不同误清队列。
      w.medicalClinic = b;
      if (w.medicalState === 'treating' && !b.medicalWorker) b.medicalWorker = w;
      if (!queue.includes(w) && queue.length < maxQ) queue.push(w);
    }
  }
  while (queue.length > maxQ) clearMedical(queue.pop());

  // 恢复期伤员在医疗站覆盖范围内自动排队；队列满时保留普通恢复，不吞掉伤势。
  if (queue.length < maxQ) {
    const candidates = workers.filter((w) => inState(w) && w.medicalState === 'none' && w.rescueRestT > 0 && w.layerId === state.layerId && ensureDirective(w).care !== 'guard')
      .map((w) => ({ w, b: clinicNear(state, w), urgency: w.rescueWoundT || SURVIVAL.RESCUE.INJURY_SECS, careRank: CARE_PRIORITY[ensureDirective(w).care] ?? CARE_PRIORITY.neutral }))
      .filter((x) => x.b)
      .sort((a, b) => a.careRank - b.careRank || a.urgency - b.urgency);
    for (const { w, b } of candidates) {
      if (queue.length >= maxQ) break;
      w.medicalState = 'queued'; w.medicalClinic = b; w.medicalT = 0; queue.push(w);
    }
  }

  // 玩家改照护意图后，候诊顺序在下一次调度 tick 生效；正在治疗者保持首位，不被插队。
  queue.sort((a, b) => {
    const activeA = a.medicalState === 'treating' ? 0 : 1;
    const activeB = b.medicalState === 'treating' ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    const careA = CARE_PRIORITY[ensureDirective(a).care] ?? CARE_PRIORITY.neutral;
    const careB = CARE_PRIORITY[ensureDirective(b).care] ?? CARE_PRIORITY.neutral;
    return careA - careB || (a.rescueWoundT || SURVIVAL.RESCUE.INJURY_SECS) - (b.rescueWoundT || SURVIVAL.RESCUE.INJURY_SECS);
  });

  // 每座医疗站 1 个治疗位；治疗开始才扣燃料。
  for (const b of clinics) {
    let w = b.medicalWorker;
    if (w) {
      const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
      const lit = lightAt(state, b.x + 0.5, b.y + 0.5) >= SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN;
      if (!inState(w) || w.medicalClinic !== b || d > SURVIVAL.RESCUE.MEDICAL_RANGE || !lit) {
        clearMedical(w, b);
        w = null;
      } else {
        const mul = roleTaskMul(w, 'medical');
        w.medicalState = 'treating'; w.job = 'medical';
        w.medicalT = Math.min(SURVIVAL.RESCUE.MEDICAL_SECS, (w.medicalT || 0) + dt * mul);
        w.hp = Math.min(w.maxHp, w.hp + SURVIVAL.RESCUE.MEDICAL_HEAL_PER_SEC * mul * dt);
        w.rescueWoundT = Math.max(0, w.rescueWoundT - SURVIVAL.RESCUE.MEDICAL_WOUND_PER_SEC * mul * dt);
        if (w.medicalT >= SURVIVAL.RESCUE.MEDICAL_SECS || w.rescueWoundT <= 0) {
          w.rescueWound = 0; w.rescueWoundT = 0;
          clearMedical(w, b);
          addFx(state, w.x, w.y, '治疗完成 · 伤势已清除', '#9fe8d5');
          w = null;
        }
      }
    }
    if (w) continue;
    const next = queue.find((x) => x && x.medicalState === 'queued' && x.medicalClinic === b);
    if (!next) continue;
    const lit = lightAt(state, b.x + 0.5, b.y + 0.5) >= SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN;
    if (!lit) continue;
    if (withdrawOne(state, 'fuel', SURVIVAL.RESCUE.MEDICAL_FUEL, b.x + 0.5, b.y + 0.5) !== null) continue;
    next.medicalState = 'treating'; next.medicalT = 0; b.medicalWorker = next;
    addFx(state, next.x, next.y, '医疗站开始治疗', '#9fe8d5');
  }
}

function moveRescueBody(state, w, tx, ty, dt) {
  const d = Math.hypot(tx + 0.5 - w.x, ty + 0.5 - w.y);
  if (d <= SURVIVAL.RESCUE.ESCORT_FOLLOW_GAP) return d;
  w.pathT = (w.pathT || 0) - dt;
  if (!w.path.length || w.pathT <= 0) {
    w.pathT = SURVIVAL.RESCUE.ESCORT_PATH_T;
    w.path = findPath(state.map, Math.floor(w.x), Math.floor(w.y), Math.floor(tx), Math.floor(ty)) || [];
  }
  follow(state, w, dt);
  return d;
}

function cancelRescue(state, message) {
  const r = state.rescue;
  if (!r) return;
  const w = r.worker;
  if (w && w.rescueBy === (r.actor === 'player' ? 'player' : r.rescuer && r.rescuer.name)) w.rescueBy = null;
  if (r.rescuer && r.rescuer.job === 'rescue') r.rescuer.job = 'flee';
  if (w && !w.downed) {
    w.rescueState = 'none';
    w.rescueBed = null;
    w.job = 'flee';
  }
  if (w) addFx(state, w.x, w.y, message, '#ff9d5c');
  state.rescue = null;
  state._sidebarSig = null;
}

function updateRescueSession(state, dt) {
  const r = state.rescue;
  if (!r) return;
  const w = r.worker;
  const actor = rescueActor(state, r);
  if (!w || !w.alive || !actor || w.layerId !== state.layerId) { cancelRescue(state, '救援中断'); return; }

  if (r.phase === 'escort') {
    if (w.downed) { cancelRescue(state, '再次倒地 · 护送中断'); return; }
    const bed = r.bed;
    if (!bed) { cancelRescue(state, '铺位目标失效'); return; }
    if (r.t > SURVIVAL.RESCUE.ESCORT_TTL) { cancelRescue(state, '护送超时 · 先回到灯下'); return; }
    if (nearestEnemy(state, w.x, w.y, SURVIVAL.RESCUE.DANGER_RANGE)) { cancelRescue(state, '蚀兽逼近 · 护送中断'); return; }
    if (lightAt(state, w.x, w.y) < SURVIVAL.RESCUE.LIGHT_MIN || lightAt(state, bed.x, bed.y) < SURVIVAL.RESCUE.LIGHT_MIN) { cancelRescue(state, '光线不足 · 护送中断'); return; }
    const bedD = Math.hypot(bed.x + 0.5 - w.x, bed.y + 0.5 - w.y);
    if (r.actor === 'player') {
      if (Math.hypot(actor.x - w.x, actor.y - w.y) > SURVIVAL.RESCUE.ESCORT_MAX_GAP) { cancelRescue(state, '距离太远 · 护送中断'); return; }
      if (bedD > SURVIVAL.RESCUE.ESCORT_BED_RANGE) moveRescueBody(state, w, actor.x, actor.y, dt);
    } else {
      // 铺位建筑格不可站立：NPC 先走到相邻可站格，再让伤员跟随，避免目标永远不可达。
      const walk = approachTile(state, bed) || bed;
      const actorBedD = Math.hypot(bed.x + 0.5 - actor.x, bed.y + 0.5 - actor.y);
      if (actorBedD > SURVIVAL.RESCUE.ESCORT_BED_RANGE) moveRescueBody(state, actor, walk.x, walk.y, dt);
      if (bedD > SURVIVAL.RESCUE.ESCORT_BED_RANGE) moveRescueBody(state, w, walk.x, walk.y, dt);
    }
    r.t += dt;
    if (bedD <= SURVIVAL.RESCUE.ESCORT_BED_RANGE && Math.hypot(actor.x - (bed.x + 0.5), actor.y - (bed.y + 0.5)) <= SURVIVAL.RESCUE.ESCORT_BED_RANGE) {
      w.x = bed.x + 0.5; w.y = bed.y + 0.5;
      w.rescueState = 'none'; w.rescueBed = null; w.rescueBy = null;
      w.rescueRestT = SURVIVAL.RESCUE.RECOVERY_SECS;
      w.job = 'rest';
      if (r.rescuer && r.rescuer.job === 'rescue') r.rescuer.job = 'flee';
      addFx(state, w.x, w.y, '已安置 · 简易铺位', '#9ef7d8');
      state.rescue = null;
      state._sidebarSig = null;
    }
    return;
  }

  if (!w.downed) { cancelRescue(state, '救援中断'); return; }
  const range = r.actor === 'player' ? SURVIVAL.RESCUE.PLAYER_RANGE : SURVIVAL.RESCUE.NPC_RANGE;
  if (Math.hypot(actor.x - w.x, actor.y - w.y) > range) { cancelRescue(state, '距离太远 · 救援中断'); return; }
  if (nearestEnemy(state, w.x, w.y, SURVIVAL.RESCUE.DANGER_RANGE)) { cancelRescue(state, '蚀兽逼近 · 救援中断'); return; }
  if (lightAt(state, w.x, w.y) < SURVIVAL.RESCUE.LIGHT_MIN) { cancelRescue(state, '光线不足 · 救援中断'); return; }
  r.t += dt;
  if (r.t < SURVIVAL.RESCUE.ACTION_SECS) return;
  if (withdrawOne(state, 'food', SURVIVAL.RESCUE.FOOD, w.x, w.y) !== null) { cancelRescue(state, '需要食物 · 救援中断'); return; }
  let hot = false;
  if (lightAt(state, w.x, w.y) >= SURVIVAL.RESCUE.LIGHT_MIN
      && withdrawOne(state, 'fuel', SURVIVAL.RESCUE.HOT_FUEL, w.x, w.y) === null) hot = true;
  w.downed = false;
  w.downT = 0;
  w.hp = Math.max(1, Math.ceil(w.maxHp * (hot ? SURVIVAL.RESCUE.HOT_HP_FRAC : SURVIVAL.RESCUE.COLD_HP_FRAC)));
  w.hunger = Math.min(SURVIVAL.WORKER.HUNGER_MAX, w.hunger + (hot ? SURVIVAL.RESCUE.HOT_HUNGER : SURVIVAL.RESCUE.COLD_HUNGER));
  w.rescueWound = 1;
  w.rescueWoundT = SURVIVAL.RESCUE.INJURY_SECS;
  recordCrewEvent(w, 'rescue', hot ? '热食救回' : '救回来了', state.day || 1);
  const bed = nearestBunk(state, w.x, w.y);
  if (bed) {
    w.rescueState = 'escort';
    w.rescueBed = { x: bed.x, y: bed.y };
    w.job = 'rescue';
    r.phase = 'escort'; r.t = 0; r.bed = { x: bed.x, y: bed.y }; r.hot = hot;
    addFx(state, w.x, w.y, hot ? '热食救回 · 护送到铺位' : '救回来了 · 护送到铺位', hot ? '#ffd76e' : '#9ef7a8');
  } else {
    w.rescueState = 'none'; w.rescueBed = null; w.rescueRestT = SURVIVAL.RESCUE.RECOVERY_SECS; w.job = 'rest'; w.rescueBy = null;
    if (r.rescuer && r.rescuer.job === 'rescue') r.rescuer.job = 'flee';
    addFx(state, w.x, w.y, hot ? '热食救回' : '救回来了', hot ? '#ffd76e' : '#9ef7a8');
    state.rescue = null;
  }
  state._sidebarSig = null;
}

function tryNpcRescue(state, downed) {
  if (state.rescue || !downed || !downed.downed || downed.layerId !== state.layerId) return;
  let best = null, bestD = SURVIVAL.RESCUE.NPC_RANGE, bestPriority = Infinity;
  for (const w of state.workers || []) {
    if (w === downed || !w.alive || w.downed || w.hollow || w.layerId !== state.layerId) continue;
    const d = Math.hypot(w.x - downed.x, w.y - downed.y);
    const directive = ensureDirective(w);
    if (directive.care === 'guard') continue;
    const priority = directive.care === 'rescue' ? 0 : (directive.rescue === 'high' ? 1 : Infinity);
    if (!Number.isFinite(priority) || d > SURVIVAL.RESCUE.NPC_RANGE) continue;
    if (nearestEnemy(state, downed.x, downed.y, SURVIVAL.RESCUE.DANGER_RANGE)) continue;
    if (priority < bestPriority || (priority === bestPriority && d < bestD)) { best = w; bestD = d; bestPriority = priority; }
  }
  if (!best) return;
  best.job = 'rescue';
  best.task = makeTask('rescue', { x: downed.x, y: downed.y }, 'active', '优先救援倒地者');
  downed.rescueBy = best.name;
  state.rescue = { worker: downed, actor: 'npc', rescuer: best, t: 0 };
  addFx(state, best.x, best.y, `${best.name} 开始救援`, '#9ef7d8');
  state._sidebarSig = null;
}

export function startPlayerRescue(state, w) {
  if (!w || !w.alive || !w.downed || w.layerId !== state.layerId) return '目标不在倒地状态';
  if (state.rescue && state.rescue.worker === w && state.rescue.actor === 'player') return null;
  if (state.rescue) return '已有救援进行中';
  if (Math.hypot(state.player.x - w.x, state.player.y - w.y) > SURVIVAL.RESCUE.PLAYER_RANGE) return '距离太远';
  state.rescue = { worker: w, actor: 'player', rescuer: null, t: 0 };
  w.rescueBy = 'player';
  addFx(state, w.x, w.y, '开始救援', '#9ef7d8');
  state._sidebarSig = null;
  return null;
}

// N5b：在墓碑旁执行一次性复苏。它只读取死亡履历中的有限快照，
// 不把旧实体、任务或路径“倒带”回来，因此不会产生重复尸体/悬空引用。
export function reviveAtGrave(state, grave) {
  if (!grave || (grave.layerId || 'surface') !== state.layerId) return '不在当前区域';
  if (!hasTech(state, 'revival')) return '需先研究「余烬回声」';
  const used = Math.max(0, state.reviveCount | 0);
  if (used >= SURVIVAL.REVIVE.MAX_USES) return '本局的复苏次数已用尽';
  const memorial = (state.memorial || []).find((m) => !m.revived
    && m.name === grave.name && (m.layerId || 'surface') === state.layerId
    && (m.x | 0) === (grave.x | 0) && (m.y | 0) === (grave.y | 0));
  if (!memorial || !memorial.snapshot) return '这座墓碑没有完整的回声';
  if (memorial.crewId && (state.workers || []).some((w) => w.crew && w.crew.id === memorial.crewId)) return '这名拓荒者已经在队伍里';

  const m = state.map;
  let spot = null;
  for (let r = 0; r <= 3 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
      const x = (grave.x | 0) + dx, y = (grave.y | 0) + dy;
      if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
      const i = y * m.w + x;
      if (!m.isWalk(x, y) || (m.occBuild && m.occBuild[i])) continue;
      if ((state.workers || []).some((w) => w.layerId === state.layerId && Math.floor(w.x) === x && Math.floor(w.y) === y)) continue;
      spot = { x: x + 0.5, y: y + 0.5 };
    }
  }
  if (!spot) return '墓碑周围没有可站的位置';
  if (withdraw(state, SURVIVAL.REVIVE.COST, grave.x + 0.5, grave.y + 0.5) !== null) return '复苏所需的档案、母髓或夜髓不足';

  const snap = memorial.snapshot;
  const nw = new Worker(memorial.name || '拓荒者', spot.x, spot.y, snap.traits || undefined);
  ensureCrewCard(nw, (state.workers || []).length, state.day, snap.crew || { id: memorial.crewId || undefined });
  recordCrewEvent(nw, 'revive', '从余烬中醒来', state.day || 1);
  nw.maxHp = Math.max(1, Number(snap.maxHp) || nw.maxHp);
  nw.hp = Math.max(1, Math.ceil(nw.maxHp * SURVIVAL.REVIVE.HP_FRAC));
  nw.hunger = Math.min(SURVIVAL.WORKER.HUNGER_MAX, Math.max(0, Number(snap.hunger) || 0) + SURVIVAL.REVIVE.HUNGER);
  nw.morale = Math.max(25, Math.min(100, Number(snap.morale) || 0));
  nw.sanity = SURVIVAL.REVIVE.SANITY;
  nw.bonds = snap.bonds && typeof snap.bonds === 'object' ? { ...snap.bonds } : {};
  nw.grief = 0; nw.grave = null; nw.hollow = false;
  nw.rescueWound = 1; nw.rescueWoundT = SURVIVAL.REVIVE.INJURY_SECS;
  nw.rescueRestT = SURVIVAL.REVIVE.RECOVERY_SECS;
  nw.job = 'flee'; nw.task = makeTask('idle', null, 'blocked', '复苏后恢复中');
  nw.chunkX = state.chunkX || 0; nw.chunkY = state.chunkY || 0;
  nw.reviveDay = state.day;
  nw.tool = null;
  state.workers.push(nw);
  state.reviveCount = used + 1;
  memorial.revived = true;
  memorial.reviveDay = state.day;
  // 同一格若没有其它未复苏履历，墓碑才会被移除，避免出现“尸体已清但墓碑仍可重复用”。
  const other = (state.memorial || []).some((x) => x !== memorial && !x.revived
    && x.x === grave.x && x.y === grave.y && (x.layerId || 'surface') === state.layerId);
  if (!other) {
    const gi = (state.graves || []).indexOf(grave);
    if (gi >= 0) state.graves.splice(gi, 1);
  }
  state.floaties.push({ x: spot.x, y: spot.y - 0.7, txt: `${nw.name} 从余烬中醒来`, color: '#ffd76e', t: 0, life: 2.4 });
  state.banner = { title: `${nw.name} 回来了`, sub: '余烬回声只允许发生一次；她还带着伤', t: 0, life: 5 };
  state._sidebarSig = null;
  return null;
}

export function updateWorkers(state, dt) {
  updateWorkerTools(state, dt);       // 没工具的人自己去容器里领一把（工具是真物品）
  updateRescueSession(state, dt);
  updateMedicalCare(state, dt);
  const list = state.workers || [];
  for (const w of list) {
    if (!w.alive) continue;
    if (w.rescueWoundT > 0) {
      w.rescueWoundT = Math.max(0, w.rescueWoundT - dt);
      if (w.rescueWoundT <= 0) w.rescueWound = 0;
    }
    if (w.rescueRestT > 0) w.rescueRestT = Math.max(0, w.rescueRestT - dt);
    // —— 死亡判定必须**与所在层无关**（B50）——
    // 【为什么不能放在下面那句“不在本层就不模拟”之后】实测：玩家在深渊时，地表留在岩浆旁的拓荒者
    //   会持续被 hazard 扣血（hazard 不按层过滤 —— 那是“世界还在烧”），血量掉到 −476/90 却永远不被判死：
    //   名册里她一直活着、血条是负的，检测器 num.range 连报 80 次。
    //   死亡是“这个人还在不在”，不是“这一层要不要模拟他”。
    if (w.hp <= 0 && !w.downed) downWorker(state, w);
    if (w.downed) {
      if (!state.rescue) tryNpcRescue(state, w);
      w.downT = Math.max(0, (w.downT || 0) - dt);
      if (w.downT <= 0) finishWorkerDeath(state, w);
      continue;
    }
    if (state.rescue && state.rescue.phase === 'escort' && state.rescue.worker === w) {
      w.job = 'rescue';
      w.task = makeTask('rescue', state.rescue.bed, 'active', '护送至简易铺位');
      continue;
    }
    if (state.rescue && state.rescue.rescuer === w) {
      w.job = 'rescue';
      continue;
    }
    if (w.medicalState === 'queued' || w.medicalState === 'treating') {
      w.job = 'medical';
      w.task = makeTask('medical', w.medicalClinic ? { x: w.medicalClinic.x, y: w.medicalClinic.y } : null, 'active', w.medicalState === 'treating' ? '医疗站治疗中' : '等待医疗位');
      continue;
    }
    if (w.layerId && w.layerId !== state.layerId) continue;   // 不在当前层则不属于本轮模拟
    // N6b：跨区迁移由 world/chunks.js 的事件调度器推进；迁移途中不参与采集、生产或战斗，
    // 避免一个人同时出现在旧区块和目标区块，也避免把旧目标引用带入新地图。
    if (w.outpostTravel) {
      w.job = 'outpost';
      w.target = null; w.crop = null; w.site = null; w.furnace = null; w.smelter = null; w.path = [];
      syncTask(w, null, w.outpostTravel.blocked ? '等待活跃区块名额' : '正在前往前哨');
      continue;
    }
    w.flash = Math.max(0, w.flash - dt);

    // —— 需求 ——（数值按 140s/天 的新节奏重调：每晚/每天的总量与原版接近）
    const tide = isTide(state);
    const night = isNight(state);                    // 黄昏后就算"夜里"（夜采从黄昏开始）
    // 光照：太阳光也算光（白天人在野外也安心）——否则一整天都在掉士气
    const amb = ambientOf(state);
    const lv = Math.max(lightAt(state, w.x, w.y), amb >= 0.5 ? 3 : 0);
    if (w.bondCd > 0) w.bondCd = Math.max(0, w.bondCd - dt);
    if (w.wanderT > 0) w.wanderT = Math.max(0, w.wanderT - dt);

    if (!w.hollow) {
      const hungerMul = state.diff ? (state.diff.hungerMul || 1) : 1;
      const glutton = personalityIs(w, 'glutton') ? SURVIVAL.WORKER.GLUTTON_MUL : 1;     // 贪食
      w.hunger = Math.max(0, w.hunger - SURVIVAL.WORKER.HUNGER_PER_SEC * hungerMul * glutton * dt);
      let dm = 0;
      if (lv > 2.5) dm += 1.5; else dm -= 0.65;         // 光下安心，黑暗焦虑
      if (dm < 0) dm *= darkMoraleMul(state);           // 暗行术：黑暗中不那么崩溃
      if (dm < 0 && personalityIs(w, 'darkfear') && lv <= 2.5) dm *= 1.6;   // 怕黑（白天不算黑暗）
      if (tide) dm -= 1.7 * (w.job === 'forage' ? 0.5 : 1);   // 夜采者有任务专注：恐惧减半
      if (w.hunger < SURVIVAL.WORKER.LOW_HUNGER) dm -= 1.6;                     // 饥饿
      if (state.res.food <= 0) dm -= 0.6;               // 断粮
      const ord = w.order === 'patrol' ? w.order : (state.order || 'auto');
      if (w.grief > 0) dm -= 0.5;                       // 葬友：心里空了一块
      if (roleIs(w, 'nightwatch') && night) dm = Math.max(dm, 0) + 0.4;   // 守夜人：夜里不减反增
      w.dm = dm;                                        // 交给 mind.js 折算心志
      w.morale = Math.max(0, Math.min(100, w.morale + dm * dt));
      if (w.hunger <= 0) {
        // B18（第 8 步）：先走缓冲，再真掉血 —— 直接 3hp/s 会把“没注意到断粮”变成“人已经没了”
        w.starveT = (w.starveT || 0) + dt;
        if (w.starveT >= STARVE.graceSecs) {
          w.hp -= STARVE.hpPerSec * dt;
          w.morale = Math.max(0, w.morale - STARVE.moralePerSec * dt);
        }
      } else {
        w.starveT = 0;
        if (lv > SURVIVAL.WORKER.NATURAL_HEAL_LIGHT && w.hunger > SURVIVAL.WORKER.NATURAL_HEAL_HUNGER && w.hp < w.maxHp) w.hp = Math.min(w.maxHp, w.hp + SURVIVAL.WORKER.NATURAL_HEAL_PER_SEC * dt);
      }
    } else {
      w.dm = 0;
    }

    // —— 决策 ——（团队夜间指令优先）
    // 疑惧（心志 < 60）：不再响应指令切换，仍按上一次听懂的命令行事
    const directive = ensureDirective(w);
    const requestedOrder = directive.mode && directive.mode !== 'auto' ? directive.mode : (state.order || 'auto');
    const order = (w.sanity < 60 && w.lockedOrder) ? w.lockedOrder : requestedOrder;
    // 保命优先：远处有蚀兽（3.4）或已经贴脸（2.3）都先闪
    const threat = nearestEnemy(state, w.x, w.y, 3.4);
    const threatClose = threat || nearestEnemy(state, w.x, w.y, 2.3);
    if (w.rescueRestT > 0) w.job = 'rest';                   // 救回后的恢复期：先休整，不能立刻回夜班
    else if (w.hollow) w.job = 'hollow';                     // 蚀化：只朝着光走
    else if (threatClose) { w.job = 'flee'; w.fleeFrom = threatClose; }
    else if (w.hunger < SURVIVAL.WORKER.EAT_AT && (state.res.food || 0) > 0 && w.morale > 25) w.job = 'eat';
    else if (w.grief > 0) w.job = 'mourn';                   // 葬友：三天不工作，守在墓前
    else if (w.wanderT > 0 && w.wanderTo) w.job = 'wander';  // 蚀化前兆：梦游出营
    else if (needRefine(state, w)) w.job = 'refine';         // 燃料见底：主动去熔炉炼油
    else if (needStoke(state, w)) w.job = 'stoke';           // 自动熔炉火种见底：去添一把（不然它就熄了）
    else if (night && directive.noNight && restAvailable(state, w)) w.job = 'rest';
    else if (night && directive.noNight) { w.job = 'flee'; w.fleeFrom = null; }
    else if (order === 'rest' && night && restAvailable(state, w)) w.job = 'rest';
    else if (order === 'guard') w.job = 'guard';             // 全天留守营地并维修
    else if (order === 'forage' && (tide || night)) w.job = 'forage';
    else if (order === 'patrol' && tide && state.patrol && state.patrol.day === state.day) w.job = 'patrol';
    else if (w.morale < 25 || tide) { w.job = 'flee'; w.fleeFrom = null; }   // 崩溃或蚀潮：回营地
    else if (needBuild(state, w)) w.job = 'build';            // 白天有工地就去盖房（蚀潮时先保命）
    else w.job = 'gather';                                   // 断粮时照样得干活

    // 任务板只记录本帧已经做出的旧 AI 决策；优先级是解释/UI数据，不参与决策。
    beginTask(w);

    if (night && w.shiftDay !== state.day) {
      w.shiftDay = state.day;
      if (w.job === 'forage' || w.job === 'guard' || w.job === 'patrol') {
        w.overwork = Math.min(SURVIVAL.REST.OVERWORK_MAX, (w.overwork || 0) + 1);
      }
    }

    // —— 选目标 —— 
    let tx = null, ty = null;
    if (w.job === 'hollow') {
      // 蚀化者：本能地走向最近的光（灯光 / 营地灯 / 玩家）—— 净光柱会把她拉回来
      const s = nearestLightSrc(state, w.x, w.y);
      if (s) { tx = s.x; ty = s.y; }
      else { tx = null; w.idle = true; syncTask(w, null, '附近没有可达光源'); continue; }
    } else if (w.job === 'mourn') {
      // 葬友：守在墓前，什么也不干
      w.target = null;
      w.grave = w.grave || { x: Math.floor(w.x), y: Math.floor(w.y) };
      tx = w.grave.x; ty = w.grave.y;
      w.mournFx = (w.mournFx || 0) + dt;
      if (w.mournFx > 7) {
        w.mournFx = 0;
        state.floaties.push({ x: w.x, y: w.y - 0.7, txt: '…', color: '#9fb0c8', t: 0, life: 1.4 });
      }
    } else if (w.job === 'wander') {
      tx = w.wanderTo.x; ty = w.wanderTo.y;
      if (Math.hypot(tx + 0.5 - w.x, ty + 0.5 - w.y) < 1.2) { w.wanderT = 0; w.wanderTo = null; }
    } else if (w.job === 'forage') {
      // 夜采：找最近的夜辉草（在黑暗里，很危险）
      const b = nearestBloom(state, w.x, w.y);
      if (b) { w.bloom = b; tx = b.x; ty = b.y; }
      else { w.job = 'flee'; tx = null; }
    } else if (w.job === 'patrol') {
      // 巡逻：推进到营地外 PATROL.range 格的指定方向
      const cx = state.map.w / 2, cy = state.map.h / 2;
      const pt = patrolPoint(state);
      tx = pt.x; ty = pt.y;
      w.bloom = null;
    } else if (w.job === 'rest') {
      const spot = nearestRestSpot(state, w.x, w.y);
      if (!spot) { w.job = 'flee'; tx = null; }
      else { tx = spot.x; ty = spot.y; w.target = null; }
    } else if (w.job === 'refine') {
      // 熔炉炼油：站在炉边自动干活（与玩家手按 E 同一个循环）
      // B29：目标必须是"还在、还没被拆、还没变成工地的炉子"。这条与下面的 stoke 分支对称；
      //      少了它，任何让 w.furnace 变 null 的路径都会在这一行解引用 null → simStep 每帧抛异常。
      const f = w.furnace;
      if (!f || f.site || !state.buildings.includes(f)) { w.furnace = null; w.job = 'idle'; syncTask(w, null, '熔炉目标已失效，返回待命'); continue; }
      const at = approachTile(state, f);
      tx = at ? at.x : f.x; ty = at ? at.y : f.y;
      const fdef = BUILD[f.type] || {};
      if (Math.hypot(f.x + 0.5 - w.x, f.y + 0.5 - w.y) <= REFINE.range + 0.9) {
        if (!fireOn(f)) {
          // 炉子冷了：先点火（用炉子设定的火种，没有就用藤木引火）——不然“站在那里”什么也不发生
          if (!lightFire(state, f)) {
            // 顺手多塞几个：藤木只烧 7 秒，1 个撑不住一次手做（3.5s）→ 否则每 7 秒就要重新点一次火
            const top = addFire(state, f, 3);
            void top;
            addFx(state, f.x, f.y, `点火：+${fuelName(fireMatOf(f, fdef))}`, '#ff9d5c');
          }
        } else {
            const rate = roleIs(w, 'tinker') ? REFINE.tinker : 1;   // 技师快一倍
          w.mineT += dt * rate;
          if (w.mineT >= REFINE.secs) {
            w.mineT = 0;
            workOnce(state, f);        // 按熔炉当前选中的配方干（平时是炼油）
          }
        }
      }
    } else if (w.job === 'stoke') {
      // 给自动熔炉添火种：从最近的容器拿【炉子设定的那种火种】放进槽里（没有就用藤木引火）
      const b = w.smelter;
      if (!b || b.site || !state.buildings.includes(b)) { w.smelter = null; w.job = 'idle'; syncTask(w, null, '熔炉目标已失效，返回待命'); continue; }
      if (b.off) { w.smelter = null; w.job = 'idle'; syncTask(w, null, '熔炉已被玩家熄火'); continue; }   // 玩家按了熄火：别替他点着（addFire 会顺手清 off）
      const at = approachTile(state, b);
      tx = at ? at.x : b.x; ty = at ? at.y : b.y;
      if (Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y) <= 2.8) {
        const rate = roleIs(w, 'tinker') ? 2 : 1;
        w.mineT += dt * rate;
        if (w.mineT >= 0.7) {
          w.mineT = 0;
          const def = BUILD[b.type] || {};
          const max = def.maxFuel || 12;
          if (b.fuel >= max) { w.smelter = null; }
          else {
            const mat0 = fireMatOf(b, def);
            let got = addFire(state, b, 1);
            if (!got && mat0 !== 'vine') { b.fireMat = 'vine'; got = addFire(state, b, 1); }   // 退而用藤木引火
            if (!got) { w.smelter = null; }                 // 容器里什么火种都没有：放弃
            else addFx(state, b.x, b.y, `+${fuelName(fireMatOf(b, def))}`, '#6e6a72');
          }
        }
      }
    } else if (w.job === 'build') {
      // 工地施工：直接以工地格为目标（工地可通行，所以工人会在 1.7 格外停下并开工）
      // 注意不要把落脚点选到“旁边那一格”：那样“到位卡在 1.7”与“作业需 ≤2.2”会形成谁都不动的死区。
      const s = w.site;
      if (!s || !s.site || !state.buildings.includes(s)) { w.site = null; syncTask(w, null, '工地目标已失效'); continue; }
      tx = s.x; ty = s.y;
      if (Math.hypot(s.x + 0.5 - w.x, s.y + 0.5 - w.y) <= 2.2) {
        advanceBuild(state, s, buildRate(w) * workerBuildMul(w) * (1 - (w.overwork || 0) * SURVIVAL.REST.OVERWORK_PENALTY) * dt);      // 石锤：施工更快
        w.buildFx = (w.buildFx || 0) + dt;
        if (w.buildFx > 1.1) {                    // 偶尔喷一下施工飘字，让人看得见“他在干活”
          w.buildFx = 0;
          addFx(state, s.x, s.y, '施工 +', '#ffd76e');
        }
      }
    } else if (w.job === 'gather') {
      // 优先抢收成熟的幽菌田（农田格不可通行，走到相邻格作业）
      const farm = findFarm(state, Math.floor(w.x), Math.floor(w.y));
      if (farm) {
        w.target = null;
        const at = approachTile(state, farm);
        tx = at ? at.x : farm.x; ty = at ? at.y : farm.y;
        if (Math.hypot(farm.x + 0.5 - w.x, farm.y + 0.5 - w.y) <= 1.6) w.crop = farm;
      } else {
        w.crop = null;
        if (!w.target || !validNode(state, w.target)) {
          const n = findNode(state, Math.floor(w.x), Math.floor(w.y), w);
          w.target = n ? { x: n.x, y: n.y, res: n.res } : null;
          w.path = [];
        }
        if (w.target) {
          const at = approachTile(state, w.target);      // 资源格同样不可通行
          tx = at ? at.x : w.target.x; ty = at ? at.y : w.target.y;
        }
      }
    } else {
      // 回营（最近的营地灯）／守卫也待在这里
      w.target = null;
      if (w.job === 'flee' && w.fleeFrom) {           // 被蚀兽逼开：先远离它
        const t = escapeTile(state, w, w.fleeFrom);
        tx = t.x; ty = t.y;
      } else {
        let bestD = Infinity;
        for (const b of state.beacons) {
          const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
          if (d < bestD) { bestD = d; tx = b.x; ty = b.y; }
        }
        if (tx == null) {                             // 营地已毁：退回去采集，不要发呆
          const n = findNode(state, Math.floor(w.x), Math.floor(w.y), w);
          if (n) { w.job = 'gather'; tx = n.x; ty = n.y; w.target = { x: n.x, y: n.y, res: n.res }; }
          else { w.idle = true; syncTask(w, null, '附近没有可执行资源'); continue; }
        }
      }
    }
    // 夜采/巡逻需要走路，若目标未定则回营
    if (tx == null && (w.job === 'forage' || w.job === 'patrol')) {
      w.job = 'flee';
      for (const b of state.beacons) { tx = b.x; ty = b.y; break; }
      if (tx == null) { syncTask(w, null, '没有营地可供撤回'); continue; }
    }

    // 没有可执行目标时必须停在原地。null 会被 JS 隐式转成 0，若继续计算
    // 距离就会把拓荒者当成要前往 (0.5,0.5)，最终两人一起走到地图左上角。
    if (tx == null || ty == null) {
      w.path = [];
      w.idle = true;
      syncTask(w, null, '暂时没有有效目标');
      continue;
    }

    syncTask(w, { x: tx, y: ty }, w.path && w.path.length ? '正在前往目标' : '目标已选，等待或重新规划路径');

    // 移动（BFS 寻路 + 碰撞）
    // ⚠ 对着“实体建筑”干活的三种活（炼油/添火）必须真站到邻格：
    //   approachTile 给的是相邻格（其格心离工作点约 1.5 格），如果 arrive 比作业半径还宽，
    //   人就会停在 3 格开外——“到位了”与“够不着”同时成立，谁都不动（死区）。
    const dist = Math.hypot(tx + 0.5 - w.x, ty + 0.5 - w.y);
    const closeJob = w.job === 'refine' || w.job === 'stoke';
    const arrive = closeJob ? 0.7
      : w.job === 'gather' ? 1.3
        : (w.job === 'eat' ? EAT_RANGE : (w.job === 'forage' ? 1.4 : (w.job === 'rest' ? SURVIVAL.REST.RANGE : (w.job === 'build' ? 1.7 : 2.0))));
    if (dist > arrive) {
      w.pathT -= dt;
      if (!w.path.length || w.pathT <= 0) {
        w.pathT = 1.4;
        const p = findPath(state.map, Math.floor(w.x), Math.floor(w.y), tx, ty);
        w.path = p || [];
        if (!p) { w.target = null; }                 // 不可达就换目标
      }
      follow(state, w, dt);
      // 卡死兜底：想走但没有可达路径，则放弃当前目标
      if (dist > arrive && !w.path.length) {
        w.stuckT = (w.stuckT || 0) + dt;
        if (w.stuckT > 1.6) { w.target = null; w.crop = null; w.site = null; w.path = []; w.stuckT = 0; }
      } else w.stuckT = 0;
    } else {
      w.path = [];
      // —— 就近作业 ——
      const onFarm = w.job === 'gather' && w.crop && (w.crop.growth || 0) >= 1
        && Math.hypot(w.crop.x + 0.5 - w.x, w.crop.y + 0.5 - w.y) <= 1.6;
      if (onFarm) {
        const gain = BUILD.farm.yield + (roleIs(w, 'farmer') ? 1 : 0);   // 农人：抢收多得 1
        deposit(state, 'food', gain, w.crop.x + 0.5, w.crop.y + 0.5);   // 幽菌田收获
        w.crop.growth = 0;
        addFx(state, w.crop.x, w.crop.y, '+食物', '#9ef7a8');
        w.crop = null;
      } else if (w.job === 'gather' && w.target) {
        w.mineT += dt * workRate(w) * workerMineMul(w, w.target.res) * (1 - (w.overwork || 0) * SURVIVAL.REST.OVERWORK_PENALTY);
        if (w.mineT >= MINE_TICK) {
          w.mineT = 0;
          const i = w.target.y * state.map.w + w.target.x;
          const tt = state.map.tiles[i];
          if (tt === T.ORE || tt === T.VINE || tt === T.ROCK) {
            const res = tt === T.ORE ? 'ore' : (tt === T.VINE ? 'vine' : 'stone');
            const extra = res === 'vine' && w.tool === 'axe' ? 1 : 0;      // 石斧：每次多 1 藤木
            const stored = deposit(state, res, 1 + extra, w.target.x + 0.5, w.target.y + 0.5);
            state.map.nodeAmt[i] -= 1;
            if (stored > 0) {
              addFx(state, w.target.x, w.target.y,
                res === 'ore' ? '+辉髓' : (res === 'vine' ? (extra ? '+藤木 ×2' : '+藤木') : '+石头'),
                res === 'ore' ? '#4be0c4' : (res === 'vine' ? '#e0b96a' : '#9aa6b5'));
            }
            if (state.map.nodeAmt[i] <= 0) {
              if (res === 'stone') { w.target = null; }                     // 岩壁挖穿了：整格变成地面
              else if (roleIs(w, 'miner') && Math.random() < 0.15) {  // 矿工：发现第二层矿脉
                state.map.nodeAmt[i] = 2;
                addFx(state, w.target.x, w.target.y, '第二层矿脉！', '#7dffe0');
              } else { w.target = null; }
              if (state.map.nodeAmt[i] <= 0) { state.map.nodeAmt[i] = 0; state.map.set(i % state.map.w, (i / state.map.w) | 0, T.FLOOR); }
            }
          } else w.target = null;
        }
      } else if (w.job === 'forage' && w.bloom) {
        // 夜采：黑暗中的额外恐惧 + 采集读条
        w.morale = Math.max(0, w.morale - NIGHTBLOOM.moraleDrain * dt);
        w.mineT += dt;
        const speed = 0.9 * (hasTech(state, 'nightlamp') ? 0.5 : 1);
        if (w.mineT >= speed) {
          w.mineT = 0;
          const b = w.bloom;
          if (b.alive && b.charges > 0) {
            b.charges -= 1;
            const stored = deposit(state, 'night', 1, b.x, b.y);
            if (stored > 0) addFx(state, b.x, b.y, '+夜髓', '#b9a6ff');
            if (b.charges <= 0) { b.alive = false; w.bloom = null; }
          } else w.bloom = null;
        }
      } else if (w.job === 'rest') {
        w.hp = Math.min(w.maxHp, w.hp + SURVIVAL.REST.HEAL_PER_SEC * dt);
        w.morale = Math.min(100, w.morale + SURVIVAL.REST.MORALE_PER_SEC * dt);
        w.sanity = Math.min(100, (w.sanity == null ? 100 : w.sanity) + SURVIVAL.REST.SANITY_PER_SEC * dt);
        if (w.shiftDay !== state.day) w.shiftDay = state.day;
        w.overwork = Math.max(0, (w.overwork || 0) - 1);
      } else if (w.job === 'eat') {
        if (state.res.food > 0) {
          const wasHungry = w.hunger < SURVIVAL.WORKER.EAT_AT;
          withdrawOne(state, 'food', 1, w.x, w.y);
          w.hunger = Math.min(SURVIVAL.WORKER.HUNGER_MAX, w.hunger + SURVIVAL.WORKER.EAT_GAIN);
          if (wasHungry) {
            // 热食：多烧 1 燃料换更多安抚（但留一点油给灯，别把营地点熄了）
            const hot = (state.res.fuel || 0) >= HOT_MEAL.keepFuel;
            if (hot) {
              withdrawOne(state, 'fuel', HOT_MEAL.fuel, w.x, w.y);
              w.sanity = Math.min(100, (w.sanity == null ? 100 : w.sanity) + HOT_MEAL.sanityHot);
              w.morale = Math.min(100, w.morale + HOT_MEAL.moraleHot);
            } else {
              w.sanity = Math.min(100, (w.sanity == null ? 100 : w.sanity) + HOT_MEAL.sanityCold);
            }
            addFx(state, w.x, w.y, hot ? '热食' : '进食', hot ? '#ffd76e' : '#9ef7a8');
          } else {
            addFx(state, w.x, w.y, '进食', '#9ef7a8');
          }
          w.mineT = 0;
        } else {
          w.morale = Math.max(0, w.morale - 2.5 * dt);   // 断粮焦虑（按秒计）
        }
      }
    }

    // —— 死亡 ——（判定已提到循环开头，见 B50：与所在层无关；这里只保留“本层内被打死”的即时反馈）
    if (w.hp <= 0 && !w.downed) downWorker(state, w);
  }

  // 清理阵亡者
  if (list.some((w) => !w.alive)) {
    const alive = list.filter((w) => w.alive);
    state.workers = alive;
    // 地表当前区块与 state.workers 必须保持同一成员桶引用；否则死亡清理后
    // chunkStore 仍留着旧数组，下一次切区块/存档会复活幽灵成员或触发名册不一致。
    if (state.layerId === 'surface') {
      const here = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
      if (here && here.workers === list) here.workers = alive;
    }
  }
}

function validNode(state, t) {
  const i = t.y * state.map.w + t.x;
  const tile = state.map.tiles[i];
  if (t.res === 'stone') return tile === T.ROCK && state.map.nodeAmt[i] > 0;
  return (tile === T.ORE || tile === T.VINE) && state.map.nodeAmt[i] > 0;
}

// 找最近的蚀兽（保命判定）
function nearestEnemy(state, x, y, range) {
  let best = null, bestD = range;
  for (const e of state.enemies || []) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// 逃离某只蚀兽的落点：在"远离蚀兽"的扇面里挑最优格 —— 优先有光、其次靠营地
function escapeTile(state, w, e) {
  const m = state.map;
  const ax = w.x - e.x, ay = w.y - e.y;
  const len = Math.hypot(ax, ay) || 1;
  const dx = ax / len, dy = ay / len;
  // 营地中心（信标优先，否则玩家）
  let hx = state.player.x, hy = state.player.y, hd = Infinity;
  for (const b of state.beacons) {
    const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
    if (d < hd) { hd = d; hx = b.x + 0.5; hy = b.y + 0.5; }
  }
  let best = null, bestScore = -Infinity;
  for (let r = 5; r >= 2; r--) {
    for (const k of [0, 0.5, -0.5, 1.0, -1.0]) {       // 直退 / 向两侧偏
      const cos = Math.cos(k), sin = Math.sin(k);
      const nx = dx * cos - dy * sin, ny = dx * sin + dy * cos;
      const x = Math.round(w.x + nx * r), y = Math.round(w.y + ny * r);
      if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
      if (!m.isWalk(x, y) || (m.occBuild && m.occBuild[y * m.w + x])) continue;
      const i = y * m.w + x;
      const lit = state.light ? state.light[i] : 0;
      const toHome = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
      // 有光最优先；顺带往营地靠（别逃进黑暗里送死）——但绝不逃进蚀兽堆里
      let crowd = 0;
      for (const en of state.enemies || []) {
        if (!en.alive) continue;
        if (Math.hypot(en.x - (x + 0.5), en.y - (y + 0.5)) <= 3.5) crowd += 1;
      }
      const score = Math.min(lit, 8) * 3 - toHome - r * 0.1 - crowd * 9;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (best && r <= 3) break;                          // 3 格内已有安全落点就不再往外找
  }
  return best || { x: Math.floor(w.x), y: Math.floor(w.y) };
}

// 找最近的存活夜辉草（夜采）
function nearestBloom(state, x, y) {
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  if (!ops) return null;
  let best = null, bestD = Infinity;
  for (const b of ops.blooms) {
    if (!b.alive || b.charges <= 0) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// 巡逻点：营地外侧指定方向的落点（取可站立格）
function patrolPoint(state) {
  const m = state.map;
  const cx = m.w / 2, cy = m.h / 2;
  const d = state.patrol || { dx: 1, dy: 0 };
  for (let r = PATROL.range; r >= 4; r--) {
    const x = Math.round(cx + d.dx * r), y = Math.round(cy + d.dy * r);
    if (x < 2 || y < 2 || x >= m.w - 2 || y >= m.h - 2) continue;
    if (m.isWalk(x, y) && !(m.occBuild && m.occBuild[y * m.w + x])) return { x, y };
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

// 找附近已成熟的幽菌田（自动抢收）
function findFarm(state, px, py) {
  let best = null;
  for (const b of state.buildings) {
    if (b.type !== 'farm' || (b.growth || 0) < 1) continue;
    const d = Math.abs(b.x - px) + Math.abs(b.y - py);
    if (d > 20) continue;
    if (!best || d < best.d) { best = { b, d }; }
  }
  return best ? best.b : null;
}

// 目标格不可通行时，找一个可站立的相邻格作为落脚点
function approachTile(state, t) {
  const m = state.map;
  if (m.isWalk(t.x, t.y)) return { x: t.x, y: t.y };       // 资源格本身可站（矿/藤）
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = t.x + dx, y = t.y + dy;
    if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
    if (m.isWalk(x, y)) return { x, y };
  }
  return null;
}

// 站到某一格旁边（备用：需要站在脚手架外侧时用）
function besideTile(state, t) {
  const m = state.map;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = t.x + dx, y = t.y + dy;
    if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
    if (m.isWalk(x, y)) return { x, y };
  }
  return null;
}

// 施工速度：技师快一倍（和维修/炼油同一条专长），再乘羁絆与心志
function buildRate(w) {
  let m = WORKER_RATE;
  if (roleIs(w, 'tinker')) m *= 2;
  m *= 1 + BOND.workBonus * bestBondLevel(w);
  m *= sanityWorkMul(w);
  return m;
}

// 该不该去施工：本层有工地 + 最近的那个工地最多两个人去（剩下的继续采集）
export function needBuild(state, w) {
  let best = null, bestD = Infinity;
  for (const b of state.buildings || []) {
    if (!b.site) continue;
    const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
    if (d > 30 || d >= bestD) continue;
    bestD = d; best = b;
  }
  if (!best) { w.site = null; return false; }
  let crew = 0;
  for (const o of state.workers || []) {
    if (o === w || !o.alive || o.hollow) continue;
    if (o.job === 'build' && o.site === best) crew += 1;
  }
  if (crew >= 2) { w.site = null; return false; }
  w.site = best;
  return true;
}

// 该不该去添火：自动熔炉火种见底了（不然它就熄了）
// ⚠️ 「接手的炉子要填满再走」——早先只看“低于 34% 就去”，于是工人添 1 个就超过阈值、
//    下一帧就撂挑子去采集了：槽永远半空，一旦夜里被打断就熄火停摆（实测 4→5 反复）。
//    现在：阈值只用来决定“要不要去”；已经接手的那台就一直干到满。
//    另：玩家按了「熄火」的炉子不碰（否则 addFire 会顺手把 off 清掉，等于违背玩家）
//    另：本层没有火种可添时不接（去了也只是站着）
//    另：手炉（furnace）不在这里管 —— 它是玩家手做的站，别人不在时白烧藤木；
//        工人只在「要炼油」时才去碰它（见 refine 任务）。
export function needStoke(state, w) {
  const list = (state.buildings || []).filter((b) => b.type === 'smelter' && !b.site && !b.off);
  let best = null, bestD = 1e9;
  for (const b of list) {
    const def = BUILD[b.type] || {};
    const max = def.maxFuel || 12;
    if ((b.fuel || 0) >= max) {                                      // 已经满了：解绑，回去干别的
      if (w.smelter === b) w.smelter = null;                         // （解绑必须在这里：满了就不会再走 stoke 分支）
      continue;
    }
    const mine = w.smelter === b;                                    // 我已经接手这台
    if (!mine && (b.fuel || 0) > max * 0.34) continue;               // 还够烧：没接手的先不去
    const mat = fireMatOf(b, def);
    const stock = (state.res[mat] || 0) + (mat === 'vine' ? 0 : (state.res.vine || 0));  // 没有设定火种还能用藤木引火
    if (stock < (mine ? 1 : 3)) continue;                            // 仓库里没火种：去了也白搭
    if (mine) return true;                                           // 自己接手的优先，不让别人抢
    const d = Math.hypot(b.x + 0.5 - w.x, b.y + 0.5 - w.y);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return false;
  for (const o of state.workers || []) if (o !== w && o.job === 'stoke') return false;   // 一个人去就够
  w.smelter = best;
  return true;
}

export function needRefine(state, w) {
  if ((state.res.fuel || 0) >= REFINE.wantFuel) return false;
  if ((state.res.ore || 0) <= 0) return false;
  // 熔炉本身没有 hp 字段（不可被砸），所以只判断存在
  const furnaces = (state.buildings || []).filter((b) => b.type === 'furnace' && !b.site && !b.off && (b.recipe || 'fuel') === 'fuel');   // 只挑设成「炼油」的炉
  // 该不该去炼油：燃料见底 + 有矿 + 本层有熔炉 + 同一时间只留一个人炼（其他人去采）
  if (!furnaces.length) return false;
  let best = null, bestD = Infinity;
  for (const f of furnaces) {
    const fd = BUILD[f.type] || {};
    // 没火的炉子得能点得着才去（仓库里连藤木都没有 → 去了也只是站着）
    if (!(f.fuel > 0) && (state.res[fireMatOf(f, fd)] || 0) <= 0 && (state.res.vine || 0) <= 0) continue;
    const d = Math.hypot(f.x + 0.5 - w.x, f.y + 0.5 - w.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  // 已经有别人在看炉子 → 其他人去干别的（燃料不该由全队一起炼）
  for (const o of state.workers || []) {
    if (o === w || !o.alive || o.hollow) continue;
    if (o.job === 'refine') return false;
  }
  // B29：上面的筛选可能把**每一座**炉子都跳掉（槽里没火 + 仓库里连藤木都没有）→ best 仍是 null。
  // 这里必须说"不去"，否则 job='refine' 会配上一个 null 目标 → 下一帧 approachTile(null) 崩溃（每帧抛，直接卡死游戏）。
  // needBuild/needStoke 都有这道守卫，只有这里漏了。
  if (!best) { w.furnace = null; return false; }
  w.furnace = best;
  return true;
}

// 工作效率：专长 × 羁绊 × 心志（失眠 −20% / 疑惧 −30% / 蚀化前兆 −40%）
function bestBondLevel(w) {
  let lv = 0;
  for (const n in (w.bonds || {})) lv = Math.max(lv, bondLevel(w.bonds[n]));
  return lv;
}
function workRate(w) {
  let m = 1;
  if (roleIs(w, 'miner')) m *= 1.4;
  m *= 1 + BOND.workBonus * bestBondLevel(w);
  m *= sanityWorkMul(w);
  return m;
}

// 最近的光源（蚀化者的本能 / 恐惧时的避难方向）
function nearestLightSrc(state, x, y) {
  let best = null, bestD = 1e9;
  for (const b of state.beacons || []) {
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (d < bestD) { bestD = d; best = { x: b.x, y: b.y }; }
  }
  for (const b of state.buildings || []) {
    const def = BUILD[b.type];
    if (!def || !def.power || !(b.fuel > 0)) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y);
    if (d < bestD) { bestD = d; best = { x: b.x, y: b.y }; }
  }
  const pd = Math.hypot(state.player.x - x, state.player.y - y);
  if (pd < bestD) { bestD = pd; best = { x: Math.floor(state.player.x), y: Math.floor(state.player.y) }; }
  return best;
}

// 沿路径移动（带碰撞钳制与贴墙滑行）
function follow(state, w, dt) {
  const m = state.map;
  let speed = w.job === 'flee' && w.fleeFrom ? 5.2 : 3.4;   // 逃命时比任何蚀兽都快（拓荒者不是战士）
  if (w.job === 'hollow') speed = 2.2;                      // 蚀化者：缓慢、茫然地走向光
  if (w.rescueState === 'escort') speed = SURVIVAL.RESCUE.ESCORT_SPEED;
  if (personalityIs(w, 'slowhand')) speed *= 0.85;   // 慢手
  const step = speed * dt;
  while (w.path.length) {
    const n = w.path[0];
    const dx = n.x + 0.5 - w.x, dy = n.y + 0.5 - w.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) { w.path.shift(); continue; }
    const s = Math.min(step, d);
    const nx = w.x + (dx / d) * s, ny = w.y + (dy / d) * s;
    if (canStand(m, nx, ny)) { w.x = nx; w.y = ny; }
    else if (canStand(m, nx, w.y)) w.x = nx;
    else if (canStand(m, w.x, ny)) w.y = ny;
    else w.path = [];
    if (Math.abs(dx) >= Math.abs(dy)) w.face = dx > 0 ? 'right' : 'left';
    else w.face = dy > 0 ? 'down' : 'up';
    return;
  }
}
