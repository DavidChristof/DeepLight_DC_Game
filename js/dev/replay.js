// dev/replay.js —— 标准局回放台（W14-A 第 8 步：难度曲线与收敛）
//
// 【它回答什么问题】"这难度合理吗？"以前只能靠"我打了几天，感觉还行"。
//   现在把它变成**一条曲线**：固定种子 + 固定打法 + 固定随机源 → 跑 3 难度 × N 天，
//   每天记一行（存活/血/资源/击杀/灯/塔/蚀痕/工人），再把两件事当场对质：
//     ① **无必死夜**：一个"正常守家"的打法，照着规则做就该活得下来（deaths 应为 0）
//     ② **无白给夜**：同种子下**什么都不做**必须被打崩（idle 对照 → 死亡或长期低血）
//   两条同时成立，难度曲线才算"有决策空间"。
//
// 【为什么能复现】三样东西全部固定：
//   · 地图：`newGame(seed, diff)`（种子派生的地形）
//   · 随机源：把 `Math.random` 换成 LCG（跑完**必须**还原 —— 用 try/finally 兜住）
//   · 打法：策略是**纯函数**（只看 state，不看时间/性能），所以同状态必然同决定
//
// 【纪律】
//   · 本文件不 import 游戏内部模块（除了纯数据表）—— 所有"动手"的操作都由 main.js 注入（`api`），
//     和 observe.js 一样：观测台/回放台不许把游戏改坏。
//   · 打法在**宏观**层面模拟"玩家会做的决定"（补油 / 建灯 / 建塔 / 光爆 / 撤退），
//     **不模拟走位**：采集与施工照旧交给拓荒者 AI。这是刻意的取舍 —— 回放台是用来调难度的，
//     不是用来重放一次真人操作。
//   · 不许写存档：回放期间 `settings.autosave` 由调用方关掉（main.js 的 __replay 里做了）。
import { BUILD, canAfford } from '../data/buildings.js';

// —— 确定性随机源（LCG；数值取自 Numerical Recipes）——
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// —— 一行曲线（每天跨天时取一次）——
export function curveRow(state) {
  const bs = state.buildings || [];
  const lamps = bs.filter((b) => !b.site && BUILD[b.type] && BUILD[b.type].maxFuel && !BUILD[b.type].fireMat);
  const lit = lamps.filter((b) => (b.fuel || 0) > 0);
  return {
    day: state.day,
    hp: Math.round(state.playerHp),
    maxHp: state.playerMaxHp,
    kills: state.kills || 0,
    ore: Math.round(state.res.ore || 0),
    vine: Math.round(state.res.vine || 0),
    fuel: Math.round(state.res.fuel || 0),
    food: Math.round(state.res.food || 0),
    lamps: lamps.length,
    lit: lit.length,
    towers: bs.filter((b) => !b.site && BUILD[b.type] && BUILD[b.type].dmg).length,
    farms: bs.filter((b) => !b.site && b.type === 'farm').length,
    workers: (state.workers || []).length,
    hollow: (state.workers || []).filter((w) => w.hollow).length,
    graves: (state.graves || []).length,
    blight: blightTiles(state),
    blightL3: blightL3Of(state),
    enemies: (state.enemies || []).filter((e) => e.alive).length,
    sealUsed: state.lastSealDay || 0,
  };
}

// 蚀痕格数 / 3 级格数（blightStats 的轻量版；只在这里用，避免把整个统计拉进来）
function blightTiles(state) {
  const m = state.map;
  if (!m || !m.blight) return 0;
  let n = 0;
  for (let i = 0; i < m.blight.length; i++) if (m.blight[i] > 0) n += 1;
  return n;
}
function blightL3Of(state) {
  const m = state.map;
  if (!m || !m.blight) return 0;
  let n = 0;
  for (let i = 0; i < m.blight.length; i++) if (m.blight[i] >= 3) n += 1;
  return n;
}

// —— 打法（策略）——
// 每个策略是 `(state, api, ctx) => void`，由 runReplay 每 N 步调一次。
// ctx = { day, step, steps, deaths, inTide }（只给"决定"用，不许影响随机性之外的时序）
export const POLICIES = {
  // 守家型：把营地照亮、在光里建塔、夜里有怪就开光爆；血少了就封灯撤退
  home(state, api, ctx) {
    const bs = state.buildings || [];
    const p = state.player;
    const near = (b, r) => Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y) <= r;
    const lamps = bs.filter((b) => !b.site && BUILD[b.type] && BUILD[b.type].maxFuel && !BUILD[b.type].fireMat);
    const lit = lamps.filter((b) => (b.fuel || 0) > 0);
    const towers = bs.filter((b) => !b.site && BUILD[b.type] && BUILD[b.type].dmg);
    const farms = bs.filter((b) => !b.site && b.type === 'farm');
    const furnaces = bs.filter((b) => !b.site && b.type === 'furnace');
    // ① 补油：营地 14 格内的灯，低于 70% 就补（每拍补 1 点 —— 与玩家按 E 同一条账本）
    //    ⚠️ 封灯会**清空所有灯油**，所以“动不动就撤退”的打法会把自己困死在“没光→没塔→更怕”的循环里
    if ((state.res.fuel || 0) > 1) {
      let fed = 0;
      for (const b of lamps) {
        if (fed >= 3) break;
        if (!near(b, 14)) continue;
        const def = BUILD[b.type];
        if ((b.fuel || 0) >= def.maxFuel * 0.7) continue;
        ctx.bump('refuel');
        api.refuel(b);
        fed += 1;
      }
    }
    // ② 收菜：成熟就收（真实 tick 入口）
    for (const f of farms) if ((f.growth || 0) >= 1) { ctx.bump('harvest'); api.harvest(f); break; }

    const day = state.t < 300;                   // 白天段（时间轴：0~300 白天）
    if (day) {
      // ③ 熔炉优先：没有燃料就没灯、没塔、没光 —— 它是一切的上游
      //    【回放台第一版真踩过】建了炉子却不点火、不手做 → 燃料 3 天恒为 0，夜里全是黑的。
      //    所以“标准打法”必须包含：建炉 → 加火种 → 选炼油 → 手做。
      if (furnaces.length < 1 && canAfford(state.res, 'furnace') && ctx.ready('furnace', 8)) {
        ctx.bump('tryFurnace');
        const spot = api.ringSpot(p, 3, 6);
        if (spot) { if (!api.place('furnace', spot.tx, spot.ty)) { api.finish(spot.tx, spot.ty); ctx.bump('okFurnace'); } }
      }
      for (const f of furnaces) {
        if ((f.fuel || 0) <= 0) { ctx.bump('addFire'); api.addFire(f, 4); }          // 冷炉先点着（4 个足够烧一阵）
        api.setRecipe(f, 'fuel');                                                     // 选中“炼油”
        if ((f.fuel || 0) > 0) for (let k = 0; k < 3; k++) { const e = api.workOnce(f); if (e) { ctx.bump('craftFail'); break; } ctx.bump('craft'); }
        break;
      }
      // ④ 点灯：目标 2 盏（建在玩家 3~6 格内）—— 成本从数据读，不写死
      if (lamps.length < 2 && canAfford(state.res, 'lamp') && ctx.ready('lamp', 6)) {
        ctx.bump('tryLamp');
        const spot = api.ringSpot(p, 3, 6);
        if (spot) { if (!api.place('lamp', spot.tx, spot.ty)) { api.finish(spot.tx, spot.ty); ctx.bump('okLamp'); } }
      }
      // ⑤ 建塔：辉光塔，建在**灯**（含暂时没油的）2~7 格内（脚下有光才打得动），最多 4 座
      if (towers.length < 4 && canAfford(state.res, 'towerGlow') && ctx.ready('tower', 8)) {
        ctx.bump('tryTower');
        const spot = api.towerSpot(state, lamps, 2, 7);
        if (spot) {
          if (!api.place('towerGlow', spot.tx, spot.ty)) { api.finish(spot.tx, spot.ty); ctx.bump('okTower'); }
        } else ctx.bump('noTowerSpot');
      }
      // ⑥ 断粮就种一块幽菌田（要光照，所以贴着灯放）
      if ((state.res.food || 0) < 6 && farms.length < 2 && canAfford(state.res, 'farm') && ctx.ready('farm', 10)) {
        ctx.bump('tryFarm');
        const spot = api.towerSpot(state, lamps, 1, 4);
        if (spot) { if (!api.place('farm', spot.tx, spot.ty)) { api.finish(spot.tx, spot.ty); ctx.bump('okFarm'); } }
      }
    } else {
      // ⑦ 夜里：低血先回营地中心（那里有篝火，是最亮的地方）—— 回放台不模拟走位，但**可以下一个真实的寻路指令**
      const camp = (state.beacons || [])[0];
      const lowHp = state.playerHp < state.playerMaxHp * 0.5;
      if (lowHp && camp && Math.hypot(camp.x + 0.5 - p.x, camp.y + 0.5 - p.y) > 2.5 && ctx.ready('home', 3)) {
        ctx.bump('goHome');
        api.goto(camp.x, camp.y);
      }
      // ⑧ 真的守不住就用第 7 步给的牌：能封灯就封（代价是灯油+土气，换回一整段白天）
      if (state.playerHp < state.playerMaxHp * 0.45 && api.sealError() === null) { ctx.bump('seal'); api.seal(); return; }
      // ⑨ 贴脸就光爆（玩家唯一的常规输出）
      let close = 0;
      for (const e of state.enemies) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= 3.2) close += 1;
      if (close > 0) { ctx.bump('pulse'); api.pulse(); }
    }
  },
  // 低风险生存：与守家相同的补给/建造闭环，但不主动远征。
  rest(state, api, ctx) {
    POLICIES.home(state, api, ctx);
  },
  // 远征型：白天把玩家送向边缘，检验跨区块/离营地后的补给压力；夜里仍回到守家逻辑。
  expedition(state, api, ctx) {
    POLICIES.home(state, api, ctx);
    if (state.t < 260 && ctx.ready('expedition', 45)) {
      const p = state.player, m = state.map;
      // 送到出口内侧；`tryCrossSurfaceExit` 会在玩家真正越过 0.6 边界时换区块。
      // 旧值 m.w-3 只会停在岩壁前，远征统计因此永远看不到新区块。
      const eastWest = p.x < m.w / 2;
      // 目标用出口内侧可行走格；`tryCrossSurfaceExit` 会在碰撞边界约 1.5 格处换区块。
      const tx = eastWest ? m.w - 1 : 1;
      const ty = Math.round(m.h / 2);
      api.goto(tx, ty);
      ctx.bump('expeditionGoto');
    }
  },
  // 对照组：什么都不做（连灯都不点、不建塔、不开火）
  idle() {},
  panic() {},
};

// —— 回放主循环 ——
// api: { newGame(seed,diff), state(), step(dt), place(type,tx,ty), finish(tx,ty), buildingAt(tx,ty),
//        refuel(b), harvest(b), pulse(), seal(), ringSpot(p,rMin,rMax), towerSpot(state,lit,rMin,rMax) }
export function runReplay(opts, api) {
  const o = Object.assign({ seed: 1234, diff: 'normal', days: 3, policy: 'home', dt: 1 / 60, everySteps: 15, maxSteps: 400 * 60 * 30 }, opts || {});
  const policy = typeof o.policy === 'function' ? o.policy : (POLICIES[o.policy] || POLICIES.home);
  const realRandom = Math.random;
  const rng = makeRng((o.seed ^ 0x9e3779b9) >>> 0);
  const rows = [];
  const days = [];
  const cd = new Map();                           // 策略自己的冷却（step 计数）
  const stats = {};                               // 动作计数（回放台的可观测性："为什么没建成"先看这里）
  const ctx = {
    ready(key, secs) { const at = cd.get(key) || -1e9; if (steps - at < secs * 60) return false; cd.set(key, steps); return true; },
    bump(key) { stats[key] = (stats[key] || 0) + 1; },
  };
  let deaths = 0, steps = 0, wasDead = false, lastDay = 1, minHpEver = Infinity, minHpDay = 1, prevHp = 100;
  const t0 = performance.now();
  Math.random = rng;                              // 注入确定性随机源
  try {
    api.newGame(o.seed, o.diff);
    const S = api.state();
    lastDay = S.day;
    prevHp = S.playerHp;
    rows.push(curveRow(S));
    while (S.day <= o.days && steps < o.maxSteps) {
      api.step(o.dt);
      steps += 1;
      if (S.playerDead && !wasDead) deaths += 1;   // 阵亡计数（游戏会复活，所以要看边沿）
      wasDead = !!S.playerDead;
      // ⚠️`playerDead` 在同一帧内就会被 handleDeath 清掉（死亡结算与复活同帧），所以再加一道兜底：
      //    血量骤增 = 刚被抬回上限 = 刚阵亡过（本作玩家不能自己回血，只有阵亡复活 / 击破 Boss 奖励）
      if (S.playerHp > prevHp + 40) deaths += 1;
      prevHp = S.playerHp;
      // 每帧采样最低血（“跨天那一刻的血”是幸存者偏差：夜里被打到 20% 又回血就看不见了）
      if (S.playerHp < minHpEver) { minHpEver = S.playerHp; minHpDay = S.day; }
      if (steps % o.everySteps === 0) policy(S, api, ctx);
      if (S.day !== lastDay) {                     // 跨天：记一行（day 字段已是新的一天）
        lastDay = S.day;
        const row = curveRow(S);
        row.deaths = deaths;
        row.atSecs = Math.round((steps - 1) * o.dt);
        days.push(row);
        rows.push(row);
      }
    }
    const last = rows[rows.length - 1];
    const minHp = Math.round(minHpEver === Infinity ? last.hp : minHpEver);
    return {
      seed: o.seed, diff: o.diff, policy: typeof o.policy === 'string' ? o.policy : 'custom', days: o.days,
      ranDays: last.day, steps, secs: Math.round(steps * o.dt), ms: Math.round(performance.now() - t0),
      deaths, minHp, minHpDay,
      workersStart: rows[0].workers, workersEnd: last.workers, gravesEnd: last.graves,
      blightEnd: last.blight, blightL3End: last.blightL3, litEnd: last.lit, towersEnd: last.towers,
      fuelEnd: last.fuel, foodEnd: last.food, kills: last.kills, sealDay: last.sealUsed,
      stats, rows,
    };
  } finally {
    Math.random = realRandom;                     // ⚠️ 无论如何都要还原（否则整个页面进入"魔法随机"状态）
  }
}
