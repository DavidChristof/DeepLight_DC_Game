// systems/smelt.js —— 自动熔炉：无人值守的配方站（配方 = 炼油 / 烧炭…）
//
// 规则（与整个游戏的账本规则一致）：
//   · 扣料用 withdraw（从【最近的容器】扣）· 出货用 deposit（入【最近的容器】；本层满了就丢 + 报警）
//   · 产出取决于【选中的配方】（`b.recipe`），不写死一种
//   · 火种可配置（`b.fireMat`，见 data/fire.js）：没火就熄火（不发光、不生产）
//     火越旺出活越快：批次间隔 = 配方 sec ÷ 火力（藤木 0.7 / 木炭 1.0 / 燃料 1.35）
//   · 面板里可以手动关火（off）：熄火后既不烧火种也不生产，适合“存着油过夜”
import { BUILD } from '../data/buildings.js';
import { RECIPE_OF } from '../data/tools.js';
import { heatOf, fireMatOf } from '../data/fire.js';
import { smeltSpeedMul } from './research.js';
import { withdraw, deposit, hasRoomFor } from './storage.js';
import { restockFire } from './craft.js';

export const smelterDef = () => BUILD.smelter;
// 自动节奏 = 配方 sec ÷ 火力 ÷ 机制加成（火种质量 + 炉膛研究 + 残页知识）
export const smeltSecs = (b, state) => {
  const r = RECIPE_OF[(b && b.recipe) || (BUILD.smelter && BUILD.smelter.recipe) || 'fuel'];
  const base = (r && r.sec) || 4;
  const heat = heatOf(b, BUILD.smelter) || 1;
  const fast = state ? smeltSpeedMul(state) : 1;
  return base / (heat * fast);
};

export function updateSmelt(state, dt) {
  for (const b of state.buildings || []) {
    if (b.type !== 'smelter') continue;
    b.prog = b.prog || 0;
    b.made = b.made || 0;
    if (b.site) { b.prog = 0; b.dry = null; continue; }
    if (b.off) { b.prog = 0; b.dry = null; continue; }              // 玩家按了熄火：不烧也不补（尊重开关）
    // —— 自动补火种（本次修复）——
    // 【为什么机器得自己做】以前只有工人的 needStoke 会添火：工人忙、人死光、人在另一层 → 它就熄火。
    //   而「自动熔炉」这个名字的含义就是无人值守，实测（无工人 + 仓库 88 藤木）它 12 秒里一直 no-fire。
    //   工人的添火保留为兜底（基本不会再触发）。每 0.5 秒看一次，避免每帧跑数据库。
    const def = BUILD.smelter;
    const cap = def.maxFuel || 12;
    b.stokeT = (b.stokeT || 0) + dt;
    if ((b.fuel | 0) < cap && b.stokeT >= 0.5) {
      b.stokeT = 0;
      const want = cap - (b.fuel | 0);
      let got = restockFire(state, b, want);
      if (!got && fireMatOf(b, def) !== 'vine') {          // 设定的火种没了：退而用藤木引火（同步切档，别让标签说谎）
        b.fireMat = 'vine';
        got = restockFire(state, b, want);
      }
      if (got > 0) {
        if (b.dry === 'no-fire') b.dry = null;             // 补上了就别再说“没火种”（面板状态行每帧读它）
        if (b.fuel >= 3) state.floaties.push({ x: b.x + 0.5, y: b.y - 0.5, txt: `自动补火种 +${got}`, color: '#ffb060', t: 0, life: 1.1 });
      }
    }
    if (!(b.fuel > 0)) { b.prog = 0; b.dry = 'no-fire'; continue; }   // 仓库里真没火种了：等补齐
    const r = RECIPE_OF[b.recipe || 'fuel'];
    if (!r) { b.prog = 0; continue; }
    const secs = smeltSecs(b, state);
    b.prog += dt;
    if (b.prog < secs) continue;                  // 注意：这里不能清 dry，否则「缺料」下一帧就被抹掉
    b.prog -= secs;
    const x = b.x + 0.5, y = b.y + 0.5;
    if (!hasRoomFor(state, r.n || 1)) {            // 本层没地方放成品：先不扣料（不然就是白烧）
      b.dry = 'no-room';
      b.prog = 0;
      continue;
    }
    if (withdraw(state, r.cost, x, y)) {           // 最近的容器里没料
      b.dry = 'no-mat';
      b.dryMat = Object.keys(r.cost)[0];
      b.prog = 0;
      continue;
    }
    b.dry = null;
    if (deposit(state, r.out, r.n || 1, x, y) > 0) b.made += 1;
  }
}
