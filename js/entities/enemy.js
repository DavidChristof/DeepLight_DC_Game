// entities/enemy.js —— 蚀兽实体 + 更新（寻光/飞行/破墙/减速/啃灯咬人）
import { Entity } from './entity.js';
import { ENEMIES } from '../data/enemies.js';
import { BUILD } from '../data/buildings.js';
import { destroyBuilding, spillStock } from '../systems/building.js';
import { BOSS, BREAKER_BUILD_MUL, LIGHT_FEAR_BURN, ABILITY, TYPES, CARRY } from '../data/combat.js';   // 战斗数值唯一数据源（W14-A 第 0 步）
import { applyDamage } from '../systems/combat.js';
import { hurtPlayer } from '../systems/survival.js';
import { bondHurt } from '../systems/mind.js';
import { sfx } from '../core/audio.js';

const R = 0.32;                 // 蚀兽碰撞半径

function canStand(map, x, y) {
  const x0 = Math.floor(x - R), x1 = Math.floor(x + R);
  const y0 = Math.floor(y - R), y1 = Math.floor(y + R);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (!map.isWalk(tx, ty)) return false;
  return true;
}

export class Enemy extends Entity {
  constructor(kind, x, y) {
    super('enemy', x, y);
    const d = ENEMIES[kind];
    this.ekind = kind;
    this.def = d;
    this.hp = d.hp; this.maxHp = d.hp;
    this.speed = d.speed; this.dmg = d.dmg;
    this.fuelDmg = d.fuelDmg || 6;
    this.atkCd = d.atkCd; this.atkT = 0;
    this.r = d.hitR;
    this.air = !!d.air;
    this.breaker = !!d.breaker;
    this.lampPref = !!d.lampPref;
    this.wob = Math.random() * 6.28;   // 个体抖动相位
    this.flash = 0;                    // 受击闪白
    this.slowT = 0;                    // 减速剩余时间
    this.stuck = 0;                    // 卡住计时（供破墙判断）
    this.summonT = d.summonCd || 0;    // Boss 孵化计时
    this.tier = 0;                     // Boss 层级
    // —— W14-A 第 3 步：四种行为的状态量（全部初始 0 = 没在做事）——
    //   字段全部写在构造器里（不要把状态“隐式”地只存在行为分支里，否则存档/读档与断言的形状不一致）
    this.windT = 0;                    // 蓄力剩余（spit/charge）
    this.dashT = 0;                    // 突进剩余（charge）
    this.dashVX = 0; this.dashVY = 0;  // 突进锁定方向（charge）
    this.fuseT = 0;                    // 引信剩余（bomb）
    this.auraT = 0;                    // 光环剩余（被庇护兽照到的）
  }
}

function addFx(state, x, y, txt, color) {
  state.floaties.push({ x, y: y - 0.3, txt, color, t: 0, life: 0.6 });
}

// 收集"光目标"：有燃料灯柱 / 诱饵灯 / 点亮的棱镜 / 营地灯 / 玩家
function lightTargets(state) {
  const out = [];
  const lamps = [];
  for (const b of state.buildings) {
    if (b.type === 'decoy') {                     // 诱饵灯：只要还有燃料就"很香"（不发光也能闻到）
      if (b.fuel > 0) { const t = { kind: 'decoy', x: b.x + 0.5, y: b.y + 0.5, ref: b }; lamps.push(t); out.push(t); }
      continue;
    }
    if (b.type === 'prism') {                     // 棱镜：只在点亮时才是目标 —— 砸碎它 = 断掉整条光路
      if (b.relayHop != null) { const t = { kind: 'prism', x: b.x + 0.5, y: b.y + 0.5, ref: b }; lamps.push(t); out.push(t); }
      continue;
    }
    if ((b.type === 'lamp' || b.type === 'cache') && b.fuel > 0) {
      const t = { kind: b.type, x: b.x + 0.5, y: b.y + 0.5, ref: b };
      lamps.push(t); out.push(t);
    }
  }
  for (const b of state.beacons) out.push({ kind: 'beacon', x: b.x + 0.5, y: b.y + 0.5, ref: b });
  // 蚀化者不算「胆」：它们已经在黑暗那边了
  for (const w of state.workers || []) if (!w.hollow) out.push({ kind: 'worker', x: w.x, y: w.y, ref: w });
  // 喷发中的潮穴会短暂吸引蚀兽（它们会涌过去）
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  if (ops && state.layerId === 'surface') {
    for (const v of ops.vents) if (v.burst > 0.3) out.push({ kind: 'vent', x: v.x + 0.5, y: v.y + 0.5, ref: v });
  }
  out.push({ kind: 'player', x: state.player.x, y: state.player.y, ref: state.player });
  return { lamps, all: out };         // lamps 是「闻起来最香的」池子（噬光虫偏好），all 是全部目标
}

// 找身边可砸的建筑（破墙者用）
function adjacentBuilding(state, x, y) {
  for (const b of state.buildings) {
    if (!BUILD[b.type] || !(b.hp > 0)) continue;
    if (Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y) < 1.25) return b;
  }
  return null;
}

// 自爆（第 3 步 · bomb）：1.5 格范围 —— 玩家与同族一起吃伤害（所以能连锁，贴脸点射很亏）
//   注：同族那一下走 `credit=false` —— 蚀兽自爆死了不算玩家击杀（否则图鉴/击杀数会被“自爆送头”灌水）
function explodeBeast(state, e) {
  const B = ABILITY.bomb;
  addFx(state, e.x, e.y - 0.35, '自爆！', '#ffcf6e');
  state.beams.push({ x1: e.x, y1: e.y, x2: e.x, y2: e.y, color: '255,207,110', t: 0, life: 0.24, ripple: B.RADIUS });
  for (const o of state.enemies) {
    if (o === e || !o.alive) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) > B.RADIUS) continue;
    applyDamage(state, o, B.DMG_BEAST, TYPES.GENERAL, false);
    if (!o.alive) addFx(state, o.x, o.y - 0.3, '被波及！', '#ffd6a0');
  }
  const p = state.player;
  if (Math.hypot(p.x - e.x, p.y - e.y) <= B.RADIUS && state.playerInvuln <= 0) {
    state.playerInvuln = 0.5;
    hurtPlayer(state, B.DMG_PLAYER);
    sfx('hurt');
  }
}

export function updateEnemies(state, dt) {
  const m = state.map, p = state.player;
  state.playerInvuln = Math.max(0, (state.playerInvuln || 0) - dt);
  const targets = lightTargets(state);
  const pending = [];                              // 本帧新孵化的小怪

  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.atkT -= dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.slowT > 0) e.slowT -= dt;
    if (e.auraT > 0) e.auraT -= dt;                  // 光环（第 3 步）由庇护兽每帧续期

    // 目标：Boss 优先扑向营地灯；噬光虫优先扑灯；其余取最近光目标
    let pool;
    if (e.def.boss && state.beacons.length) {
      pool = state.beacons.map((b) => ({ kind: 'beacon', x: b.x + 0.5, y: b.y + 0.5, ref: b }));
    } else {
      pool = (e.lampPref && targets.lamps.length) ? targets.lamps : targets.all;
    }
    let best = null, bd = 1e9, bs = 1e9;
    for (const c of pool) {
      const dd = Math.hypot(c.x - e.x, c.y - e.y);
      // 蚀兽真正想吃的是光：拓荒者权重打折，只有明显更近时才去咬人
      // 诱饵灯把"有效距离"打到 0.35 —— 所以远处的蚀兽会舍近求远地去扑它（弃车保帅的代价）
      const w = c.kind === 'worker' ? 1.8
        : c.kind === 'decoy' ? (BUILD.decoy.lure || 0.4)
          : c.kind === 'prism' ? 0.85 : 1;
      const score = dd * w;
      if (score < bs) { bs = score; bd = dd; best = c; }
    }
    if (!best) { e.alive = false; continue; }

    // —— W14-A 第 3 步：四种行为 ——
    // 全部“用已有的字段风格”表达（e.atkT / e.speed / applyDamage / state.beams），没有新系统；
    // 数值一律读 data/combat.js 的 ABILITY（断言 enemy.ability 守着“表与实现不分家”）。
    const ab = e.def.ability;
    let dashVX = 0, dashVY = 0;                     // 非 0 = 本帧走突进（速度另算）
    if (ab === 'spit') {
      // ① 远程吐蚀：玩家在 6 格内就优先吐它（隔墙也打得到）；蓄力期站定呕准
      const pr0 = Math.hypot(p.x - e.x, p.y - e.y);
      if (pr0 <= ABILITY.spit.RANGE && pr0 >= ABILITY.spit.MIN_RANGE) {
        best = { kind: 'player', x: p.x, y: p.y, ref: p }; bd = pr0;
      }
      if (e.windT > 0) {
        e.windT = Math.max(0, e.windT - dt);      // 夹零：浮点会落到 -6e-16，而检测器（与 HUD）要求计时量 ≥0
        if (e.windT <= 0) {
          const pr2 = Math.hypot(p.x - e.x, p.y - e.y);
          state.beams.push({ x1: e.x, y1: e.y, x2: p.x, y2: p.y, color: '200,255,143', t: 0, life: 0.2 });
          // 走 playerInvuln：不然“吐一下 + 贴身咬一下”会在同一帧叠着扣血
          if (pr2 <= ABILITY.spit.RANGE && state.playerInvuln <= 0) {
            state.playerInvuln = 0.45;
            hurtPlayer(state, ABILITY.spit.DMG);
            sfx('hurt');
            addFx(state, p.x, p.y, '蚀液！', '#c8ff8f');
          }
        }
        continue;                                   // 蓄力期间站定（不移动、不近战）
      }
      if (bd >= ABILITY.spit.MIN_RANGE && bd <= ABILITY.spit.RANGE && e.atkT <= 0) {
        e.windT = ABILITY.spit.WINDUP; e.atkT = ABILITY.spit.CD;
        continue;
      }
    } else if (ab === 'charge') {
      // ② 突进冲锋：3 格内蓄力 0.6s → 锁定方向 ×3 速突进 0.35s（惩罚站桩）
      if (e.dashT > 0) {
        e.dashT = Math.max(0, e.dashT - dt); dashVX = e.dashVX; dashVY = e.dashVY;
      } else if (e.windT > 0) {
        e.windT = Math.max(0, e.windT - dt);
        if (e.windT <= 0) {
          const ddx = best.x - e.x, ddy = best.y - e.y, dl2 = Math.hypot(ddx, ddy) || 1;
          e.dashVX = ddx / dl2; e.dashVY = ddy / dl2; e.dashT = ABILITY.charge.DASH;
          dashVX = e.dashVX; dashVY = e.dashVY;
        } else continue;                            // 蓄力期间站定并“顶住”（看得出来的动作前摇）
      } else if (bd <= ABILITY.charge.RANGE && e.atkT <= 0) {
        e.windT = ABILITY.charge.WINDUP; e.atkT = ABILITY.charge.CD;
        continue;
      }
    } else if (ab === 'bomb') {
      // ③ 自爆：血量 ≤20% 点引信 1.2s → 范围爆炸（黎明消解期不点：那时它们本来就在化）
      if (!state.wasDawn) {
        if (e.fuseT > 0) {
          e.fuseT = Math.max(0, e.fuseT - dt);
          if (e.fuseT <= 0) { explodeBeast(state, e); e.alive = false; continue; }
        } else if (e.hp > 0 && e.hp / e.maxHp <= ABILITY.bomb.HP_FRAC) {
          e.fuseT = ABILITY.bomb.FUSE;
          addFx(state, e.x, e.y - 0.4, '引信点燃！', '#ff8f6e');
        }
      }
    } else if (ab === 'aura') {
      // ④ 庇护兽：给自己 3.5 格内的同族续一帧“+30% 速”（自己不享受，Boss 也不享受）
      const A = ABILITY.aura;
      for (const o of state.enemies) {
        if (o === e || !o.alive || (o.def && o.def.boss)) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) <= A.RANGE) o.auraT = Math.max(o.auraT, A.REFRESH);
      }
    }

    // 畏光（盲蚀兽）：光照中灼伤并逃向黑暗
    let fear = false;
    if (e.def.lightFear) {
      const ix = Math.max(0, Math.min(m.w - 1, Math.floor(e.x)));
      const iy = Math.max(0, Math.min(m.h - 1, Math.floor(e.y)));
      const lv = state.light ? state.light[iy * m.w + ix] : 0;
      if (lv > 3) {
        fear = true;
        // 光照灼伤（点亮即武器）。**走常规伤害**：这个特性本身就是"光抗性"的可视化，
        // 再乘一次 armor.light 就是同一件事算两遍（数值见 data/combat.js LIGHT_FEAR_BURN）
        applyDamage(state, e, LIGHT_FEAR_BURN * dt);
        if (!e.alive) continue;
      }
    }

    // 移动（直线 + 抖动绕行；飞行单位无视墙体；Boss 抗减速）
    const slowMul = e.slowT > 0 ? (e.def.boss ? 0.85 : 0.5) : 1;
    const auraMul = e.auraT > 0 ? ABILITY.aura.SPEED_MUL : 1;      // 庇护兽光环（第 3 步）
    let step = e.speed * slowMul * auraMul * dt;
    if (!e.air) {
      const under = state.buildings.find((b) => !b.site && b.type === 'barricade' && Math.floor(e.x) === b.x && Math.floor(e.y) === b.y);
      if (under) step *= Math.max(0.1, 1 - (BUILD.barricade.slow || 0));
    }
    let dx = best.x - e.x, dy = best.y - e.y;
    if (fear) { dx = -dx; dy = -dy; }        // 背光而逃
    const dl = Math.hypot(dx, dy) || 1;
    const jx = Math.cos(e.wob + state.day * 0.7), jy = Math.sin(e.wob * 1.3 + state.day);
    let vx = dx / dl + jx * 0.2, vy = dy / dl + jy * 0.2;
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;

    // 站定距离：贴上去之后就不再往里挤 —— 否则会钻进目标身体里（配合 systems/collide.js 的碰撞体积）
    // 太靠里 → 往外退；已经贴边 → 只保留切向抖动（看起来像围着你磨牙）
    if (!fear) {
      const standoff = best.kind === 'player' ? 0.75 : (e.def.boss ? 1.35 : 1.0);
      if (dl < standoff) {
        if (dl < standoff * 0.7) { vx = -dx / dl; vy = -dy / dl; }
        else { vx = jx; vy = jy; }
      }
    }

    const ox = e.x, oy = e.y;
    if (dashVX || dashVY) { step = e.speed * ABILITY.charge.MUL * slowMul * dt; vx = dashVX; vy = dashVY; }
    if (e.air) {                                     // 夜枭：直线飞行，不受地形限制
      e.x += vx * step; e.y += vy * step;
    } else {
      const nx = e.x + vx * step, ny = e.y + vy * step;
      if (canStand(m, nx, ny)) { e.x = nx; e.y = ny; }
      else if (canStand(m, nx, e.y)) e.x = nx;       // 沿墙滑行
      else if (canStand(m, e.x, ny)) e.y = ny;
      else {                                         // 侧向绕行，避免被单个建筑卡死
        const px = -vy, py = vx;
        if (canStand(m, e.x + px * step, e.y + py * step)) { e.x += px * step; e.y += py * step; }
        else if (canStand(m, e.x - px * step, e.y - py * step)) { e.x -= px * step; e.y -= py * step; }
      }
    }
    e.x = Math.max(0.7, Math.min(m.w - 0.7, e.x));
    e.y = Math.max(0.7, Math.min(m.h - 0.7, e.y));

    // 破墙者：被挡住就砸建筑
    if (e.breaker) {
      const moved = Math.hypot(e.x - ox, e.y - oy);
      e.stuck = moved < 0.01 ? e.stuck + dt : 0;
      if (e.stuck > 0.3 && e.atkT <= 0) {
        const w = adjacentBuilding(state, e.x, e.y);
        if (w && !w.natural) {                 // 天然结构（天然竖井）砸不掉：入口不能因一夜意外消失
          e.atkT = e.atkCd;
          w.hp -= e.dmg * BREAKER_BUILD_MUL;
          if (w.hp <= 0) destroyBuilding(state, w);
        }
      }
    }

    // Boss：周期孵化小蚀兽
    // 第 7 步：**二阶段** —— 血量降到 PHASE2_AT 以下时，孵化更快、每批更多。
    //   阶段只改“孵化节奏”，不改移动/伤害：阶段应该改变**压力形状**，不是把数值拉满。
    if (e.def.boss) {
      const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      const ph = frac <= BOSS.PHASE2_AT ? 2 : 1;
      if (ph !== (e.bossPhase || 1)) {
        e.bossPhase = ph;
        if (ph === 2) {
          state.floaties.push({ x: e.x, y: e.y - 2.2, txt: '蚀巢核心：二阶段', color: '#ff7ad9', t: 0, life: 2.0 });
          sfx('bossSpawn', { x: e.x, y: e.y, rate: 0.8 });
        }
      }
      const p2 = (e.bossPhase || 1) >= 2;
      e.summonT -= dt;
      if (e.summonT <= 0) {
        const cd = Math.max(BOSS.SUMMON_CD_MIN, (e.def.summonCd || BOSS.SUMMON_CD) - e.tier * BOSS.SUMMON_TIER_STEP);
        e.summonT = cd * (p2 ? BOSS.PHASE2_CD_MUL : 1);
        const batch = BOSS.SUMMON_BATCH + (p2 ? BOSS.PHASE2_BATCH_ADD : 0);
        if (state.enemies.length + pending.length < BOSS.SUMMON_CAP) {
          for (let k = 0; k < batch; k++) {
            const a = Math.random() * Math.PI * 2, r = BOSS.SUMMON_RAD_MIN + Math.random() * BOSS.SUMMON_RAD_VAR;
            pending.push(new Enemy(Math.random() < 0.5 ? 'bud' : 'moth', e.x + Math.cos(a) * r, e.y + Math.sin(a) * r));
          }
        }
      }
    }

    // 攻击：靠近目标才动手（建筑/营地灯占整格，需更大的接触距离）
    // 玩家的攻击距离略大于碰撞半径之和（0.74），这样它们会停在"刚碰到"的位置咬你，而不是穿进你身体里
    const touch = best.kind === 'player' ? 0.85 : (e.def.boss ? 1.7 : 1.15);
    if (!fear && bd < touch && e.atkT <= 0) {
      if (best.kind === 'lamp' || best.kind === 'cache' || best.kind === 'decoy') {
        e.atkT = e.atkCd;
        best.ref.fuel = Math.max(0, best.ref.fuel - e.fuelDmg);   // 啃灯芯/啃补给站/啃诱饵（空了自动换目标）
      } else if (best.kind === 'prism') {
        e.atkT = e.atkCd;
        best.ref.hp -= e.dmg;                                     // 棱镜极脆：一碰就碎
        best.ref.flash = 0.2;
        if (best.ref.hp <= 0) {
          destroyBuilding(state, best.ref);
          addFx(state, best.ref.x + 0.5, best.ref.y - 0.2, '光路断裂！', '#ff8f6e');
        }
      } else if (best.kind === 'player') {
        if (state.playerInvuln <= 0) {
          e.atkT = e.atkCd;
          hurtPlayer(state, e.dmg);
          state.playerInvuln = 0.7;
          sfx('hurt');
          // 第 5 步 5b：背上的结构体替你挡下半下 —— 它不占格，所以没有别的办法被咬到；
          //   血掉光就是**真丢**（不回背包、不回营地）。
          if (state.carried) {
            const car = state.carried;
            car.hp -= e.dmg * CARRY.TOWER_BITE_SHARE;
            car.flash = 0.2;
            if (car.hp <= 0) {
              addFx(state, car.x + 0.5, car.y - 0.6, '结构体被打碎了！', '#ff8f6e');
              sfx('deny');
              destroyBuilding(state, car);
            }
          }
          if (e.leaked) state.observed = Object.assign({ seep: 0 }, state.observed, { seep: (state.observed.seep || 0) + 1 });
        }
      } else if (best.kind === 'worker') {
        if (e.atkT <= 0) {
          e.atkT = e.atkCd;
          best.ref.hp = best.ref.downed ? 0 : best.ref.hp - e.dmg;
          best.ref.flash = 0.2;
          best.ref.morale = Math.max(0, best.ref.morale - 5);
          if (e.leaked) state.observed = Object.assign({ seep: 0 }, state.observed, { seep: (state.observed.seep || 0) + 1 });
          bondHurt(state, best.ref);                 // 同伴挨打：8 格内的羈絆同伴士气 −１５
        }
      } else if (best.kind === 'beacon' && e.def.boss && best.ref.hp > 0) {
        e.atkT = e.atkCd;                             // Boss 腐蚀营地灯
        best.ref.hp -= e.def.beaconDmg;
        if (best.ref.hp <= 0) {
          // B31/B32：营地灯也是仓库（allContainers 里那两座 camp），打掉时里面的东西不能凭空消失；
          //   而且必须**原位删除**（splice）—— 整体替换 state.beacons 会与 layers.*.beacons 脱钩：
          //   旧数组里还留着这座死信标，一旦 bindLayer 把 state.beacons 指回去（换层/读档）它就“复活”了。
          //   （simStep 里剔除敌人时同样是这个原因才用 splice，注释写明“绝不可整体替换”。）
          const bi = state.beacons.indexOf(best.ref);
          if (bi >= 0) state.beacons.splice(bi, 1);
          // 顺序：先退出容器名单，再洒库存 —— 否则 deposit 会把它自己当“最近的容器”又塞回去。
          spillStock(state, best.ref, '营地灯熄灭');
          addFx(state, best.ref.x + 0.5, best.ref.y, '营地灯熄灭！', '#ff7ad9');
        }
      }
      // 普通蚀兽对 beacon 只是围拢（成为光爆的靶子）
    }
  }

  // 本帧孵化的小怪入列
  for (const e of pending) state.enemies.push(e);

  // 玩家失血反馈（低血闪烁由渲染层做）
  if (state.playerHp <= 0 && !state.playerDead) {
    state.playerDead = true;
    addFx(state, p.x, p.y, '倒下了…', '#ff6b6b');
  }
}
