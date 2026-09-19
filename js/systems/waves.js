// systems/waves.js —— 蚀潮波次生成 + 大潮 Boss（每 7 天一次「期中考试」）+ 黎明消解
import { kindFor, ENEMIES } from '../data/enemies.js';
import { Enemy } from '../entities/enemy.js';
import { isTide, isDawn, DAWN_SECS } from '../core/time.js';
import { sfx } from '../core/audio.js';
import { WAVES, BOSS, tideOf } from '../data/combat.js';   // 波次/Boss/潮位数值的唯一数据源（W14-A 第 0 步）
import { nightPlan, pickKind, themeIdOf, spawnInterval } from '../data/night.js';   // 一夜三段 + 主题夜 + 刷怪节奏（W14-A 第 4/7 步）

export const BOSS_EVERY = BOSS.EVERY;        // 每 N 天一次大潮 Boss
import { artificialLightPresent, chunkActive } from '../world/chunks.js';
import { seedBlightFront } from './blight.js';
import { ECOLOGY } from '../data/ecology.js';
import { lockNightChallenge } from './ecoPressure.js';

export function updateWaves(state, dt) {
  if (state.noSpawnT > 0) state.noSpawnT -= dt;
  // 波次只作用于「地表」层：下潜时地下不会刷潮汐怪
  const surf = state.layers && state.layers.surface;
  const arr = surf ? surf.enemies : state.enemies;
  // 地下那一层也会被黎明收走（旧版一到天亮就整体清空，行为保持一致）
  const lists = (state.enemies && state.enemies !== arr) ? [arr, state.enemies] : [arr];
  const inTide = isTide(state);
  const inDawn = isDawn(state);

  // —— 黎明：残留的蚀兽逐个消解 ——
  // 【为什么不是一到白天就 arr.length = 0】那样满屏怪"啪一下"全没，守了一夜毫无过程感，
  // 白天一睁眼世界就干净了。现在改成一段看得见的消解：按最大生命的百分比持续扣血
  // （= 强制处决，你杀了它也一样死），脆的先化、硬的撑到最后 —— 曲线由 dawnFade 决定。
  if (inDawn) {
    if (!state.wasDawn) {
      state.wasDawn = true;
      sfx('dawn');                             // 天亮的边沿（只响一次）
      if (state.bossRef && state.bossRef.alive) {
        state.floaties.push({
          x: state.player.x, y: state.player.y - 1.1,
          txt: '蚀巢核心退回深渊…', color: '#ff7ad9', t: 0, life: 1.6,
        });
      }
    }
    for (const list of lists) dissolveAtDawn(list, dt);
    for (const list of lists) removeBoss(list);   // Boss 不参与消解：直接退场（和以前一样）
    state.bossRef = null;
    state.wasTide = false;
    state.bossSpawnedThisNight = false;      // 次日重置
    return;
  }
  state.wasDawn = false;

  if (!inTide) {
    // 白天：保险起见清干净（正常情况下黎明已经把它们化完了）
    for (const list of lists) if (list.length) list.length = 0;
    state.bossRef = null;
    state.wasTide = false;
    state.bossSpawnedThisNight = false;
    return;
  }
  if (!state.wasTide) { sfx('tide'); lockNightChallenge(state); } // 入夜只锁定一次光压挑战系数
  state.wasTide = true;
  if (state.layerId === 'surface' && (!chunkActive(state) || !artificialLightPresent(state))) return;

  // 大潮：固定天数降临蚀巢核心
  const isBossNight = state.day % BOSS_EVERY === 0;
  if (isBossNight && !state.bossSpawnedThisNight) {
    spawnBoss(state, arr);
    state.bossSpawnedThisNight = true;
    sfx('bossSpawn');
  }

  if (state.noSpawnT > 0) return;         // 击败 Boss 后的短暂宁静

  const cx = state.map.w / 2, cy = state.map.h / 2;
  const tide = tideOf(state);
  // 第 4 步：这一夜的「计划」= 潮位分档 × 主题加权 × 当前时段（缓存，只有天/时段变才重算）
  const plan = nightPlan(state);
  state.nightTheme = themeIdOf(state);         // 给 HUD / 检测器 / 存档不存（会话态）
  const dm = state.diff || { waveMul: 1, capMul: 1, bossHpMul: 1 };
  // 一天 400s（蚀潮 60s，是旧版的两倍）：同屏压力看 cap、不看一夜的总量，
  // 所以 cap 不动、只调刷新间隔 —— 第 4 步起间隔再乘一个**时段**乘子（试探稀 / 高潮密）。
  // 第 7 步：这个式子挪到了 `data/night.js` 的 `spawnInterval()` —— HUD 的“还剩几波”预告
  //   必须与刷怪器用**同一个式子**，否则玩家按预告做的决定是建立在假数字上的。
  const interval = spawnInterval(state, plan.seg, dm);
  state.spawnT = (state.spawnT || 0) - dt;

  const cap = Math.round((WAVES.CAP_BASE + tide * WAVES.CAP_PER_TIDE + (isBossNight ? WAVES.CAP_BOSS_NIGHT : 0)) * (dm.capMul || 1));
  if (state.spawnT <= 0 && arr.length < cap) {
    state.spawnT = interval;
    const batch = 1 + Math.floor(tide / WAVES.BATCH_DIV) + plan.batchAdd;
    for (let i = 0; i < batch; i++) spawnOne(state, cx, cy, tide, arr, plan);
  }
}

// —— 黎明消解 ——
// 每秒扣掉 maxHp / (DAWN_SECS × dawnFade)：dawnFade 就是"它在黎明第几成处化完"。
//   脆弱（蚀芽 0.30 → 6s）→ 噬光虫 0.45 → 夜枭 0.60 → 盲蚀兽 0.70 → 蚀壳 0.90（18s）
// 已经被你打掉一半血的会提前化完（扣的是同一个速率），所以"夜里多打掉几只"是有回报的。
// 不给击杀数、不掉落 —— 这是黎明收走的，不是你杀的（否则"留着不打"就成了刷分玩法）。
function dissolveAtDawn(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e.alive) continue;
    if (e.def && e.def.boss) continue;                    // Boss 不参与消解
    const fade = Math.max(WAVES.DISSOLVE_MIN_FADE, (e.def && e.def.dawnFade) || 0.6);
    e.hp -= (e.maxHp / (DAWN_SECS * fade)) * dt;
    e.slowT = Math.max(e.slowT || 0, 0.25);               // 消解中动作变慢（复用减速通道）
    e.dawnA = Math.max(0, e.hp / e.maxHp);                // 渲染用：跟着血量淡出
    if (e.hp <= 0) { e.hp = 0; e.alive = false; }         // 主循环会把它从数组里剔掉
  }
}
function removeBoss(list) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].def && list[i].def.boss) list.splice(i, 1);
}

function spawnBoss(state, arr) {
  const m = state.layers && state.layers.surface ? state.layers.surface.map : state.map;
  const cx = m.w / 2, cy = m.h / 2;
  for (let k = 0; k < BOSS.SPAWN_TRIES; k++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = BOSS.RING_MIN + Math.random() * BOSS.RING_VAR;
    const tx = Math.floor(cx + Math.cos(ang) * rad);
    const ty = Math.floor(cy + Math.sin(ang) * rad);
    if (tx < 2 || ty < 2 || tx >= m.w - 2 || ty >= m.h - 2) continue;
    const i = ty * m.w + tx;
    if (!m.isWalk(tx, ty) || (m.occBuild && m.occBuild[i])) continue;
    const lv = state.light ? state.light[i] : 0;
    if (lv > BOSS.DARK_MAX) continue;
    const e = new Enemy('core', tx + 0.5, ty + 0.5);
    const scale = 1 + state.bossTier * BOSS.HP_SCALE;            // 每次降临更强
    const hpMul = state.diff ? (state.diff.bossHpMul || 1) : 1;
    e.hp = e.maxHp = Math.round(ENEMIES.core.hp * scale * hpMul);
    e.tier = state.bossTier;
    state.bossTier += 1;
    arr.push(e);
    state.bossRef = e;
    state.floaties.push({
      x: state.player.x, y: state.player.y - 1.1,
      txt: '大潮降临：蚀巢核心！', color: '#ff7ad9', t: 0, life: 2.0,
    });
    return;
  }
}

function spawnOne(state, cx, cy, tide, arr, plan) {
  const m = state.layers && state.layers.surface ? state.layers.surface.map : state.map;
  let best = null, bestLv = Infinity;
  let frontBest = null, frontDist = Infinity;
  const fronts = m.blightFronts || [];
  for (let k = 0; k < WAVES.SPAWN_TRIES; k++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = WAVES.RING_MIN + Math.random() * WAVES.RING_VAR;
    const tx = Math.floor(cx + Math.cos(ang) * rad);
    const ty = Math.floor(cy + Math.sin(ang) * rad);
    if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) continue;
    const i = ty * m.w + tx;
    if (!m.isWalk(tx, ty) || (m.occBuild && m.occBuild[i])) continue;
    const lv = state.light ? state.light[i] : 0;
    // 有人工光的活跃区块才会刷；区块里最弱的光场可以是完全黑（0），这正是入侵边缘。
    // 旧的 `lv >= SPAWN_LIGHT_MIN` 会把所有 0 光格排除，玩家只点一盏灯时整夜无怪。
    if (lv < WAVES.DARK_MAX) {
      if (lv < bestLv) best = { tx, ty, i, lv }, bestLv = lv;
      for (const f of fronts) {
        const fd = Math.abs(f.x - tx) + Math.abs(f.y - ty);
        if (fd <= ECOLOGY.FRONT_SPAWN_RADIUS && fd < frontDist) { frontBest = { tx, ty, i, lv }; frontDist = fd; }
      }
    }
  }
  const pick = frontBest || best;
  if (!pick) return;
  const { tx, ty, i } = pick;
  // 蚀潮登陆点同时留下局部侵蚀前线；不增加敌人总量，只改变下一步的空间压力。
  seedBlightFront(state, tx, ty, 'tide');
  const e = new Enemy(plan ? pickKind(plan, Math.random) : kindFor(tide, Math.random), tx + 0.5, ty + 0.5);
  const lvl = m.blight ? m.blight[i] : 0;
  if (lvl >= WAVES.BLIGHT_LV) { const boost = 1 + WAVES.BLIGHT_BOOST * (lvl - 1); e.hp = e.maxHp = Math.round(e.maxHp * boost); e.dmg = e.dmg * boost; }
  arr.push(e);
}
