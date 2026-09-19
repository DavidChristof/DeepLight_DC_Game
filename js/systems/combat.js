// systems/combat.js —— 玩家防御技能（光爆）、统一伤害入口与死亡结算
import { recordKill, damageMul } from './codex.js';
import { pulseMul as techPulseMul, pulseRangeMul } from './research.js';
import { purify } from './blight.js';
import { DAWN_T, DUSK_START, TIDE_END } from '../core/time.js';
import { deposit, withdrawFraction, withdrawOne, syncRes } from './storage.js';
import { sfx } from '../core/audio.js';
import { playStinger } from '../core/music.js';
import { unmount } from './carry.js';                                   // 阵亡时就地放下背上的结构体（第 5 步 5b）
import { PULSE, REWARD, TYPES, armorMul } from '../data/combat.js';
import { SURVIVAL } from '../data/survival.js';

// 数值统一从 data/combat.js 读（W14-A 第 0 步：战斗数值中央化）——本文件不再写魔数
const RANGE = PULSE.RANGE;
const DAMAGE = PULSE.DAMAGE;
const COOLDOWN = PULSE.COOLDOWN;

// 统一伤害入口：抗性表 → 图鉴加成 → 受击闪白 → 死亡与击杀记录 → Boss 里程碑
// type（W14-A 第 1 步）：伤害类型，默认 'general'（不吃抗性）→ 旧调用点不传参也完全不变
//   light 光（光爆/辉光塔）· shock 震荡（震荡塔）· physical 物理（第 2 步接入）
// credit（W14-A 第 3 步）：是否计入“玩家击杀”。默认 true（向后兼容）；
//   只有一种情况传 false：自爆壳炸死同族 —— 那是它们自己打自己，算玩家的击杀会把击杀数/图鉴灌水。
// 抗性来源单一：敌人 def.armor（data/enemies.js）+ data/combat.js 的 armorMul()
export function applyDamage(state, e, amount, type = TYPES.GENERAL, credit = true) {
  if (!e.alive) return;
  e.hp -= amount * armorMul(e.def, type) * damageMul(state, e.ekind);
  e.flash = 0.18;
  if (e.hp <= 0) {
    e.hp = 0;
    e.alive = false;
    if (credit) {
      state.kills = (state.kills || 0) + 1;
      recordKill(state, e.ekind);
    }
    if (e.def && e.def.boss) onBossDefeated(state);
    else sfx('kill', { x: e.x, y: e.y });
  }
}

// 「期中考试」通过：序章完成，真正的拓荒开始
function onBossDefeated(state) {
  sfx('bossDown');
  playStinger('clear');          // 序章完成的小高潮（没放 clear.* 文件就自动略过）
  state.bossRef = null;
  const arr = state.enemies;                               // 余兽溃散（就地清空，保持层数组引用）
  for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].alive) arr.splice(i, 1);
  state.noSpawnT = REWARD.NO_SPAWN;                                     // 短暂宁静
  const m = state.milestone;
  if (!m.bossDefeated) {
    m.bossDefeated = true;
    m.clearedDay = state.day;
    state.playerMaxHp += REWARD.FIRST_HP;                               // 成长奖励
    state.playerHp = state.playerMaxHp;
    state.pulseMul = PULSE.MUL_FIRST_BOSS;
    deposit(state, 'fuel', REWARD.FIRST_FUEL, state.player.x, state.player.y);
    deposit(state, 'ore', REWARD.FIRST_ORE, state.player.x, state.player.y);
    deposit(state, 'data', REWARD.FIRST_DATA, state.player.x, state.player.y);    // 从核心里解析出的知识（否则研究树只靠遗迹碑）
    state.banner = {
      title: '序章 完成',
      sub: `蚀巢核心崩解（第 ${state.day} 天）——真正的拓荒由此开始`, t: 0, life: 6,
    };
  } else {
    const round = Math.floor(state.day / 7) || 1;
    deposit(state, 'data', REWARD.ROUND_DATA, state.player.x, state.player.y);     // 每次大潮也是一份知识
    state.banner = { title: `大潮已破 · 第 ${round} 轮`, sub: '蚀巢核心再度崩解，你更强了', t: 0, life: 5 };
  }
  state.floaties.push({ x: state.player.x, y: state.player.y - 1.2, txt: '蚀巢核心崩解！', color: '#ffd6f2', t: 0, life: 2.2 });
  // 战斗胜利也是一种治疗：全队心志 +12（活着回来了）
  for (const w of state.workers || []) {
    if (w.hollow) continue;
    w.sanity = Math.min(100, (w.sanity == null ? 100 : w.sanity) + REWARD.SANITY);
    w.morale = Math.min(100, w.morale + REWARD.MORALE);
  }
  state._sidebarSig = null;
}

export function updatePlayerSkill(state, dt) {
  state.skillCd = Math.max(0, (state.skillCd || 0) - dt);
  // 光爆视觉扩散动画
  if (state.pulse) {
    state.pulse.t += dt;
    if (state.pulse.t >= state.pulse.life) state.pulse = null;
  }

  if (state.skillQueued > 0 && state.skillCd <= 0) {
    state.skillQueued = 0;
    const p = state.player;
    // 燃料必须走容器账本：state.res 是聚合值，直接减会被下一次 syncRes 抹掉（= 光爆白嫖）
    if (!withdrawOne(state, 'fuel', PULSE.FUEL, p.x, p.y)) {
      state.skillCd = COOLDOWN;
      sfx('pulse');
      const range = RANGE * pulseRangeMul(state);
      state.pulse = { x: p.x, y: p.y, t: 0, life: 0.45, range };
      purify(state, p.x, p.y, range);            // 光爆同时净化蚀痕
      for (const e of state.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < range)
          applyDamage(state, e, DAMAGE * (state.pulseMul || 1) * techPulseMul(state), TYPES.LIGHT);
      }
      state.floaties.push({ x: p.x, y: p.y - 0.7, txt: '光爆!', color: '#aef6ff', t: 0, life: 0.55 });
    } else {
      sfx('deny');
      state.floaties.push({ x: state.player.x, y: state.player.y - 0.8, txt: '燃料不足', color: '#ff9d5c', t: 0, life: 0.6 });
    }
  }
}

// 死亡结算：退回营地、天快亮、蚀兽退散、燃料减半
export function handleDeath(state) {
  if (!state.playerDead) return;
  // 第 3 步：先把玩家背包与手持工具封存到死亡点，避免死亡变成免费传送。
  const packStock = Object.assign({}, (state.pack && state.pack.stock) || {});
  const held = state.equip && state.equip.held || null;
  const hasPack = Object.values(packStock).some((n) => (n || 0) > 0) || !!held;
  if (hasPack) {
    state.deathPack = { x: state.player.x, y: state.player.y, layerId: state.layerId, stock: packStock, held, day: state.day };
  }
  if (state.pack) state.pack.stock = {};
  if (state.equip) state.equip.held = null;
  syncRes(state);
  // W14-A 第 5 步 5b：背上背着结构体就**就地放下**（force：岩浆/岩壁也得真落地）
  // —— 否则它会跟着尸体一起回营地（等于一条以死为代价的免费传送），而死在深渊里更不该把塔送回地表
  if (state.carried) unmount(state, Math.floor(state.player.x), Math.floor(state.player.y), true);
  const cx = state.map.w / 2, cy = state.map.h / 2;
  state.playerDead = false;
  state.playerHp = Math.max(1, Math.round((state.playerMaxHp || 100) * SURVIVAL.DEATH.RESPAWN_HP));
  state.playerHunger = SURVIVAL.DEATH.RESPAWN_HUNGER;
  state.playerInjury = Math.min(SURVIVAL.PLAYER.INJURY.MAX, Math.max(state.playerInjury || 0, SURVIVAL.DEATH.RESPAWN_INJURY));
  state.playerInvuln = Math.max(state.playerInvuln || 0, 6);
  state.player.x = cx + 1; state.player.y = cy;
  state.player.clearPath(); state.dest = null;
  state.enemies.length = 0;         // 蚀兽全部退散（就地清空）
  // ⚠️ 清空数组必须**同时**放开 bossRef —— 否则它指向一只已经不在场上的 Boss，
  //   `bossRef.alive` 仍是 true → HUD 血条永久卡在最后那一格（`ui.ref` 断言第 7 步长跑时抓到）。
  state.bossRef = null;
  // 「把你直接送到黎明」只对“黄昏/蚀潮里阵亡”有意义（不让人干等一整夜）。
  // 不能用 isNight 判：它含清晨 0~6s 与黎明，会让白天的死亡也跳时间 ——
  //   · 白天死亡（深渊被岩浆烧死）→ 实测最多白丢 290s 白天
  //   · 黎明死亡（t>390）→ 时间倒流，一天就不再是 400s
  const inNightBattle = state.t >= DUSK_START && state.t < TIDE_END;
  if (inNightBattle) state.t = DAWN_T;             // 直接跳到黎明，蚀潮结束
  withdrawFraction(state, 'fuel', SURVIVAL.DEATH.FUEL_LOSS);            // 燃料减半（从最近的容器里扣）
  state.floaties.push({ x: cx + 1, y: cy - 0.8, txt: hasPack ? '你被冲回营地…遗落包留在原地' : '你被冲回营地…燃料减半', color: '#ffb3a0', t: 0, life: 1.4 });
}
