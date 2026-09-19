// systems/seal.js —— 封灯撤退（W14-A 第 7 步）
//
// 【这一层解决什么】第 6 步之后，夜战的输赢已经"可操作"（布局、升级、光路炮），
//   但玩家在**必败的夜晚**里仍然只有两条路：硬撑到天亮，或者死一次（死还会燃料减半）。
//   两条都不叫决策 —— 一条是拖延，一条是被动挨罚。
//   这一步给第三条路：**主动把自己的灯封掉**。蚀兽追的是光，光没了，潮就散得快。
//
// 【为什么代价必须落在"你真正投入的东西"上】夜里最贵的不是时间，是灯油：
//   ① 所有点着的灯柱/净光柱余油全部倒掉（灯灭，白天得重新加）—— 这是"牺牲灯光换时间"的字面兑现
//   ② 全队士气/心志受挫（撤了，不是赢了；后面的采集/施工会慢）
//   ③ 每 COOLDOWN_DAYS 天只能用一次
//   ④ 必须在蚀潮里顶过 MIN_SECS —— 否则潮刚起就能按，等于白拿一段白天
//   ⑤ 不在蚀潮 / 不在表层 / 一盏灯都没点着 → 直接拒绝
//
// 【为什么不收进暂停菜单】它不是"设置"，而是一个**在压力下做的手势**：
//   与背负结构体同一条语言 —— 按住不放、移动就取消、松开重来。
//   这样"误按"不可能发生，而"真想撤"的人只需要按住一瞬间。
import { isTide, DAWN_T, TIDE_START } from '../core/time.js';
import { RETREAT } from '../data/combat.js';
import { BUILD } from '../data/buildings.js';
import { sfx } from '../core/audio.js';

// 一盏"可封"的灯 = 有 power（真的在发光）、不是诱饵灯（它不提供视野）、还有油
function litLamps(state) {
  const out = [];
  for (const b of state.buildings || []) {
    if (b.site) continue;
    const def = BUILD[b.type];
    if (!def || !def.power || def.decoy) continue;
    if ((b.fuel || 0) <= 0) continue;
    out.push(b);
  }
  return out;
}

// 能不能封？返回 null（可以）或一句人话（为什么不行）。
// 【为什么返回错误串而不是 boolean】与 tryPlace/upgradeBuilding/__place 同一套语义：
//   调用方拿到就能直接显示 —— 不用再写一份"为什么不行"的文案表。
export function sealError(state) {
  if (!state || !state.started) return '还没开局';
  if (!isTide(state)) return '蚀潮没来（只在夜里能封灯撤退）';
  if (state.layerId !== 'surface') return '得回到地表才能封灯';
  const elapsed = (state.t || 0) - TIDE_START;
  if (elapsed < RETREAT.MIN_SECS) return `潮还没压上来（顶过 ${RETREAT.MIN_SECS} 秒才能封）`;
  const last = state.lastSealDay | 0;
  const since = (state.day | 0) - last;
  if (last > 0 && since < RETREAT.COOLDOWN_DAYS) return `刚封过灯（第 ${last + RETREAT.COOLDOWN_DAYS} 天才能再封）`;
  if (!litLamps(state).length) return '没有点着的灯（封灯要先有灯可封）';
  return null;
}

// 长按判定：由 main.js 的每步调用（和 updateCarry 一样是 SIM 的一环）
// 返回本次是否**进行中**（HUD 用来显示进度环/提示行）；真正生效时返回 'done'
// 【为什么"按不了"要出声】静默的无反应会让玩家以为键坏了 —— 借现成的警示通道
//   （state.storeWarnTxt/storeWarnT，与"燃料不足"同一条）说清为什么，并做 4 秒节流。
export function updateSeal(state, dt, holding) {
  state.sealWarnT = Math.max(0, (state.sealWarnT || 0) - dt);
  const err = sealError(state);
  if (!holding) {
    if (state.sealT) { state.sealT = 0; state.sealPrompt = null; }   // 松手 → 从 0 重来（与背负同一条规则：不许"分段攒进度"）
    return false;
  }
  if (err) {
    if (state.sealT) { state.sealT = 0; state.sealPrompt = null; }
    if (state.sealWarnT <= 0) {
      state.sealWarnT = 4;
      state.storeWarnTxt = err;
      state.storeWarnT = 3;
      sfx('deny');
    }
    return false;
  }
  state.sealT = (state.sealT || 0) + dt;
  state.sealPrompt = '封灯撤退';
  if (state.sealT >= RETREAT.HOLD) { state.sealT = 0; state.sealPrompt = null; return sealNow(state) ? 'done' : false; }
  return true;
}

// 真正执行：把灯油倒掉、全队受挫、潮提前退去。成功返回 true。
export function sealNow(state) {
  if (sealError(state)) return false;
  const lamps = litLamps(state);
  let oil = 0;
  for (const b of lamps) { oil += b.fuel || 0; b.fuel = 0; }          // ① 灯油全部倒掉（灯当场灭）
  withdrawMorale(state);                                              // ② 士气/心志受挫
  state.lastSealDay = state.day | 0;                                  // ③ 冷却起点（随存档走）
  state.t = DAWN_T;                                                   // ④ 潮提前退去 → 直接进黎明
  state.wasTide = false;
  state.wasDawn = false;                                             // 让 updateWaves 走一次"黎明刚到"的边沿（残留蚀兽开始消解）
  state.floaties.push({
    x: state.player.x, y: state.player.y - 1.0,
    txt: `封灯撤退 · 倒掉 ${lamps.length} 盏灯的 ${Math.round(oil)} 燃料`, color: '#9fb0c8', t: 0, life: 2.2,
  });
  state.toast = { txt: '灯全封了 · 蚀潮退去（白天记得重新点灯）', at: performance.now() };
  sfx('extinguish');
  state._sidebarSig = null;
  return true;
}

function withdrawMorale(state) {
  for (const w of state.workers || []) {
    if (w.hollow) continue;                                           // 蚀化的人已经不在这套情绪里
    w.morale = Math.max(0, w.morale - RETREAT.MORALE);
    w.sanity = Math.max(0, (w.sanity == null ? 100 : w.sanity) - RETREAT.SANITY);
  }
}

// —— HUD 用的一行说明（data 层不管 DOM）——
// 显示"按下去会付出什么"，而不是"快捷键是什么" —— 代价必须在按下之前就看得见。
export function sealHint(state) {
  const err = sealError(state);
  if (err) return err;
  const lamps = litLamps(state);
  let oil = 0;
  for (const b of lamps) oil += b.fuel || 0;
  return `封灯撤退：倒掉 ${lamps.length} 盏灯的 ${Math.round(oil)} 燃料 · 全队士气 −${RETREAT.MORALE} · 潮立刻退去`;
}

// 已封过几次（日志/断言用；不进存档）
export function litLampStats(state) {
  const lamps = litLamps(state);
  let oil = 0;
  for (const b of lamps) oil += b.fuel || 0;
  return { lamps: lamps.length, oil: Math.round(oil) };
}
