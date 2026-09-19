// systems/hints.js —— 首次提示（"只说一次"）
//
// 设计意图（OPTIMIZE_PLAN §3.8）：**不做教程关**（会杀掉"发现感"），只做"第一次遇到某件事时说一句"。
//   每条提示只出现一次，之后永不再打扰；想看回来：设置 → 画面 → 「重置新手提示」。
//
// 判定原则：
//   · 只提示"你现在就能做点什么"的事（空燃料、断粮、有人蚀化…）
//   · 不解释数值、不写公式、不堆破折号（照 docs/COPY.md 的文案规范）
//   · 状态型判定（资源为 0、有人在蚀化）比"事件型"更好写也更稳 —— 不需要在 8 个模块里埋钩子
import { isTide, isDawn } from '../core/time.js';

export const HINTS = {
  firstGame: '左键 前往 · 右键 对光标处做事 · 鼠标指哪就采哪（按住 E） · H 看全键位',
  fuelEmpty: '燃料空了 · 采辉髓到熔炉炼油，藤木也能直接引火',
  noFood: '食物空了 · 幽菌田要光照才长，也可以派人夜采',
  firstTide: '蚀潮来了 · 塔必须在光照里才能开火，先把灯点起来',
  firstDawn: '黎明 · 残留蚀兽正在消解，夜辉草还没凋谢，可以抢收',
  firstBlight: '没光太久的地会长出蚀痕 · 点灯或光爆能净化，3 级夜里会渗怪',
  firstHollow: '有拓荒者蚀化了 · 按住 E 安抚她，或让净光柱照她',
  firstBloom: '夜辉草只在夜里长 · N 面板可以派「夜采」',
  firstBoss: '大潮降临 · 集火蚀巢核心本体，它会孵小怪',
  storeFull: '本层容器满了 · 多出来的材料会丢，造个储物箱或先搬走',
  firstShaft: '小地图上的黄色井口是天然竖井 · 走上去按 E 就能下潜到深渊',
  firstCarry: '结构装载体已上身 · 跟着你走、用你身上的光开火（移动中射速减半、燃耗 ×1.5、占 1 背包格）',
  firstDrop: '结构体已就地放下 · 它重新占格挡路，也重新变回一座普通炮台',
  firstSeal: '封灯撤退 · 灯全封了，壶潮失去目标便退去（白天记得重新点灯；每 3 天只能用一次）',  starving: '有人开始挨饿了 · 食物空了会先掉精神、再掉血 —— 种幽菌田（需光照）或派人夜采',};

// 一次性标记存在 state.seen（随存档走，所以读档不会又弹一遍）
export function firstTime(state, key) {
  if (!state.seen) state.seen = {};
  if (state.seen[key]) return false;
  state.seen[key] = true;
  return true;
}

// 显示一条首次提示（走 main.js 的 setNote → #firstnote 那条横幅）
export function maybeHint(state, key, show) {
  if (!HINTS[key]) return false;
  if (!firstTime(state, key)) return false;
  const el = document.getElementById('firstnote');
  if (!el || !show) return false;
  show(HINTS[key]);
  return true;
}

// 每帧一次：把"状态型"的首次提示挨个试一遍（都是 O(1) 判断，没有扫描）
// 说明：blight 用 state._blightAny（由 systems/blight.js 第一次累积时点亮）而不是每帧扫地图
export function checkHints(state, dt, show) {
  if (!state.started || !show) return;
  const night = isTide(state);
  if (night) maybeHint(state, 'firstTide', show);
  if (isDawn(state)) maybeHint(state, 'firstDawn', show);
  if ((state.res.fuel || 0) <= 0) maybeHint(state, 'fuelEmpty', show);
  if ((state.res.food || 0) <= 0 && (state.workers || []).length) maybeHint(state, 'noFood', show);
  if (state._blightAny) maybeHint(state, 'firstBlight', show);
  if (!state.seen.firstHollow && (state.workers || []).some((w) => w.hollow)) maybeHint(state, 'firstHollow', show);
  // 第 8 步（B18）：挨饿要“先说一声”—— 缓冲期内提示，玩家还有时间反应（而不是只看到墓碑）
  if (!state.seen.starving && (state.workers || []).some((w) => !w.hollow && w.hunger <= 0)) maybeHint(state, 'starving', show);
  if (!state.seen.firstBoss && state.bossRef && state.bossRef.alive) maybeHint(state, 'firstBoss', show);
  if (!state.seen.storeFull && state.storeWarnT > 0) maybeHint(state, 'storeFull', show);
  if (!state.seen.firstBloom) {
    const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
    if (ops && ops.blooms.some((b) => b.alive)) maybeHint(state, 'firstBloom', show);
  }
  // 天然竖井：等它的格子被揭开（小地图上看到）才说 —— 不剧透位置
  if (!state.seen.firstShaft) {
    const sh = (state.buildings || []).find((b) => b.type === 'shaft' && b.natural);
    if (sh && state.discovered && state.discovered[sh.y * state.map.w + sh.x]) maybeHint(state, 'firstShaft', show);
  }
}

export function seenStats(state) { return Object.keys(state.seen || {}); }
