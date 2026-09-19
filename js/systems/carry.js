// systems/carry.js —— 结构装载体：把一座塔**背到背上**（W14-A 第 5 步 5b）
//
// 【为什么它仍然是一个 building】瞄准、开火、光束、载荷数值、存档全部复用现成代码 ——
//   只是多一个 `mounted` 标记 + 每帧把 x/y 钉在玩家身上。不新写一套"移动炮台"。
//
// 【它必须跳过三件事】（塔的代码默认"它不动"，不跳过就会"背着塔穿墙"）
//   ① 不占格：mount 时清掉 occWalk/occBuild；卸载时用 placeError 重新占回来
//   ② 不挡光：mount 时清 blockLight（塔类本来 block=false，清一次是保险）
//   ③ 不要求所在格光照：开火条件里 mounted 直接放行 —— 你就是那束光
//
// 【三条代价】（写在 data/combat.js 的 CARRY，不是这里手写数字）
//   移动中射速 ×RATE_MUL_MOVING / 每发燃耗 ×FUEL_MUL 且有底价 / 占 PACK_SLOTS 个背包格
//   —— 而且它**有 hp、被啃掉就真丢**（不回背包），所以"带塔出征"是有风险的。
import { BUILD } from '../data/buildings.js';
import { CARRY } from '../data/combat.js';
import { hasTech } from './research.js';
import { placeError } from './building.js';
import { packContainer, usedOf } from './storage.js';
import { sfx } from '../core/audio.js';

export const carried = (state) => state.carried || null;
export const carryUnlocked = (state) => hasTech(state, 'carrier');
// 能背的只有"已建成的塔"（工地不行；灯/井/箱子这类没有 dmg 的不算结构体）
export const carryable = (b) => {
  const def = b && BUILD[b.type];
  return !!(def && def.dmg && !b.site);
};

// 能不能装：每条都给一句人话（错误文案就是玩家的教学）
export function mountError(state, b) {
  if (!carryUnlocked(state)) return '需研究「背负支架」（研究台 · 深渊）';
  if (state.carried) return `已经背着 ${BUILD[state.carried.type].name} 了`;
  if (!b) return '这里没有塔';
  const def = BUILD[b.type];
  if (!def) return '未知建筑';
  if (!def.dmg) return `${def.name} 不是塔（只能背塔）`;
  if (b.site) return '工地还没盖完';
  // 背包得有位置（背上它要占 PACK_SLOTS 格）。
  // 【为什么不“先装着、超了就超了”】那样背包会变成 24/23 这种非法状态（检测器 container.cap 会报），
  //   而且真·玩家视角就是“东西凭空多出来了一格”。宁可装不上，也不能把账做坏。
  const pack = packContainer(state);
  if (usedOf(pack) + CARRY.PACK_SLOTS > (pack.cap || 0)) return '背包满了：背负要占 1 格，先腾出一格';
  return null;
}

// 放下时这一格能不能站住（重复用建造的合法性判定，只是不查钱：塔早就付过账了）
export function unmountError(state, b, tx, ty) {
  const err = placeError(state, b.type, tx, ty, { ignoreCost: true });
  return err ? `放不下：${err}` : null;
}

// —— 装：把塔从地上摘下来，绑到玩家身上 ——
export function mount(state, b) {
  const err = mountError(state, b);
  if (err) { sfx('deny'); return err; }
  const m = state.map;
  const i = b.y * m.w + b.x;
  // ① 不占格 ② 不挡光 —— "谁写的谁清"：拆卸时由 unmount 重新写回来
  m.occWalk[i] = 0;
  if (m.occBuild) m.occBuild[i] = 0;
  if (m.blockLight) m.blockLight[i] = 0;
  b.mounted = true;
  b.mountT = 0;
  b.x = Math.floor(state.player.x);        // 立刻钉到玩家脚下：不然会有“背上却还停在原格”的一帧
  b.y = Math.floor(state.player.y);
  state.carried = b;
  state._sidebarSig = null;
  sfx('place', { x: b.x + 0.5, y: b.y + 0.5 });
  state.floaties.push({ x: state.player.x, y: state.player.y - 1, txt: `背起 ${BUILD[b.type].name}`, color: '#9ef7d8', t: 0, life: 1.3 });
  return null;
}

// —— 卸：放到 (tx,ty) 上 ——
// force=true 用于"阵亡就地掉落"：那一格可能就是岩浆/岩壁，也必须真的落地（否则背上的塔会跟着尸体回营地）
export function unmount(state, tx, ty, force) {
  const b = state.carried;
  if (!b) return '背上没有东西';
  if (!force) {
    const err = unmountError(state, b, tx, ty);
    if (err) { sfx('deny'); return err; }
  }
  const def = BUILD[b.type];
  const m = state.map;
  b.x = tx; b.y = ty;
  b.mounted = false;
  b.mountT = 0;
  state.carried = null;
  const i = b.y * m.w + b.x;
  if (m.occBuild) m.occBuild[i] = 1;
  if (def && def.solid) m.occWalk[i] = 1;
  if (def && def.block) m.blockLight[i] = 1;
  state._sidebarSig = null;
  if (!force) {
    sfx('built', { x: tx + 0.5, y: ty + 0.5 });
    state.floaties.push({ x: tx + 0.5, y: ty - 0.3, txt: `放下 ${def ? def.name : '结构体'}`, color: '#cfe6ff', t: 0, life: 1.2 });
  }
  return null;
}

// 每帧：把背上的塔钉在玩家脚下。**只改坐标**，别的什么都不碰
// （占格/挡光已经在 mount 时清掉，light 脏标记由位置变化自然触发）
export function updateCarry(state, dt) {
  const b = state.carried;
  if (!b) return;
  const p = state.player;
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  if (b.x !== tx || b.y !== ty) { b.x = tx; b.y = ty; }
  b.mountT = (b.mountT || 0) + dt;
}
