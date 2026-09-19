// systems/craft.js —— 配方站：制造台（计时排队） / 熔炉（按住 E 手做） / 自动熔炉（见 smelt.js）
//
// 统一规则（与整个游戏的账本规则一致）：
//   · 扣料：从【最近的容器】扣  · 出货：deposit 进【最近的容器】（本层满了就丢 + 报警）
//   · 站点产出取决于【选中的配方】（b.recipe），不是写死一种产出
import { RECIPE_OF, recipesOf, canMake } from '../data/tools.js';
import { BUILD } from '../data/buildings.js';
import { FUELS, FUEL_ORDER, fuelDef, fuelName, fireMatOf, fireOn } from '../data/fire.js';
import { RES_NAME } from '../data/storage.js';
import { withdraw, withdrawOne, deposit, hasRoomFor } from './storage.js';
import { sfx } from '../core/audio.js';

export { recipesOf, fireOn };

// 这台站现在真正能做的配方 id
// 【为什么要自愈】旧存档里可能存着“熔炉做木炭”这类**现在已经下线的选择**（B42：烧炭移给自动熔炉了）。
//   若直接念 b.recipe，面板会显示一个选不中任何行的配方、`workOnce` 也会回“配方不对” ——
//   玩家只会看到“炉子坏了”。回退到站点默认配方（BUILD[type].recipe）并写回，与“镜像要能自愈”同一套做法。
export function recipeForStation(b, def) {
  const id = b && b.recipe;
  if (id && canMake(RECIPE_OF[id], def && def.station)) return id;
  const fallback = (def && def.recipe) || 'fuel';
  if (b && b.recipe !== fallback) b.recipe = fallback;
  return fallback;
}

// 火种数量上限（不同炉子不一样，实例优先）
const fireCap = (b, def) => (def && def.maxFuel) || 6;

// 能不能开工：返回错误字符串 / null
export function craftError(state, b, id) {
  const r = RECIPE_OF[id];
  if (!r) return '未知配方';
  if (!b || b.site) return '还没建好';
  if (b.craft) return '台子在忙';
  for (const k in r.cost) if ((state.res[k] || 0) < r.cost[k]) return `${RES_NAME[k]}不足`;
  return null;
}

// —— 火种：加料 / 换料 / 点火 ——
// 从容器取 n 个【当前火种】放槽里（槽满停止）
// 返回实际加进去的数量
export function addFire(state, b, n = 1) {
  const def = BUILD[b.type] || {};
  const cap = fireCap(b, def);
  const mat = fireMatOf(b, def);
  let got = 0;
  while (got < n && (b.fuel || 0) < cap) {
    if (withdrawOne(state, mat, 1, b.x + 0.5, b.y + 0.5)) break;      // 容器里没这个火种了
    b.fuel = (b.fuel || 0) + 1;
    got += 1;
  }
  if (got > 0) { b.off = false; sfx('fuel', { x: b.x + 0.5, y: b.y + 0.5 }); }   // 加火种 = 顺手点火
  return got;
}

// 【只补火种、不碰开关】自动熔炉的火种槽应该一直是满的（消耗一个就自己补一个），
//   所以不能用 addFire —— 它会顺手把 b.off 清掉（那是玩家按 E 点火的语义，不是机器的语义）。
// 返回实际补进去的数量。
export function restockFire(state, b, n = 1) {
  const def = BUILD[b.type] || {};
  const cap = fireCap(b, def);
  const mat = fireMatOf(b, def);
  let got = 0;
  while (got < n && (b.fuel || 0) < cap) {
    if (withdrawOne(state, mat, 1, b.x + 0.5, b.y + 0.5)) break;      // 仓库里没这种火种了
    b.fuel = (b.fuel || 0) + 1;
    got += 1;
  }
  return got;
}

// 点火：确保槽里至少有 1 个火种；当前火种不够时退而用藤木引火（永远有解，不会卡死）
// 返回 错误字符串 / null
export function lightFire(state, b) {
  if (!b || b.site) { sfx('fail'); return '还没建好'; }
  const def = BUILD[b.type] || {};
  if ((b.fuel || 0) > 0) { b.off = false; sfx('ignite', { x: b.x + 0.5, y: b.y + 0.5 }); return null; }
  const want = fireMatOf(b, def);
  if (!withdrawOne(state, want, 1, b.x + 0.5, b.y + 0.5)) { b.fuel = 1; b.burnT = 0; b.off = false; sfx('ignite', { x: b.x + 0.5, y: b.y + 0.5 }); return null; }
  if (want !== 'vine' && !withdrawOne(state, 'vine', 1, b.x + 0.5, b.y + 0.5)) {
    b.fireMat = 'vine';                    // 拿藤木引火，顺便把炉子切到藤木档
    b.fuel = 1; b.burnT = 0; b.off = false;
    sfx('ignite', { x: b.x + 0.5, y: b.y + 0.5 });
    return null;
  }
  sfx('fail', { x: b.x + 0.5, y: b.y + 0.5 });
  const def2 = fuelDef(want);
  return `没有火种：${FUEL_ORDER.map(fuelName).join(' / ')}都能烧（${def2.name}、藤木都没有）`;
}

// 换火种：槽里剩下的先退回容器（不然“木炭被当成藤木烧”），再换档
export function setFireMat(state, b, k) {
  if (!b || b.site) return '还没建好';
  if (!FUELS[k]) return '不能当火种';
  const def = BUILD[b.type] || {};
  if (fireMatOf(b, def) === k) return null;
  if ((b.fuel || 0) > 0) {
    const back = deposit(state, fireMatOf(b, def), b.fuel, b.x + 0.5, b.y + 0.5);   // 退不回去就丢了（会报警）
    b.fuel = 0; b.burnT = 0;
    void back;
  }
  b.fireMat = k;
  state._panelSig = null;
  return null;
}

export function startCraft(state, b, id) {
  const err = craftError(state, b, id);
  if (err) return err;
  const r = RECIPE_OF[id];
  if (withdraw(state, r.cost, b.x + 0.5, b.y + 0.5)) return '材料不足';
  b.craft = { id, t: 0, sec: r.sec };
  state._panelSig = null;                 // 面板立刻显示“制作中”
  return null;
}

// —— 熔炉：按住 E 手做一次（按当前选中的配方；炉子得先有火）——
// 返回错误字符串 / null
export function workOnce(state, b) {
  if (!b || b.site) return '还没建好';
  if (!fireOn(b)) return '炉子冷着：先放火种（藤木/木炭/燃料都能烧）';
  const r = RECIPE_OF[recipeForStation(b, BUILD[b.type] || {})];
  if (!r || !canMake(r, 'furnace')) return '配方不对';
  for (const k in r.cost) if ((state.res[k] || 0) < r.cost[k]) return `${RES_NAME[k]}不足`;
  if (!hasRoomFor(state, r.n || 1)) return '容器满了：成品没处放（先腾地方）';
  if (withdraw(state, r.cost, b.x + 0.5, b.y + 0.5)) return '材料不足';
  const got = deposit(state, r.out, r.n || 1, b.x + 0.5, b.y + 0.5);
  if (got > 0) {
    state.floaties.push({ x: b.x, y: b.y - 0.6, txt: `+${RES_NAME[r.out] || r.out}`, color: '#ffd76e', t: 0, life: 0.9 });
  }
  b.workT = 0;
  return null;
}

// —— 切换配方（熔炉 / 自动熔炉共用）——
export function setRecipe(state, b, id) {
  const def = b && b.type ? b.type : null;
  if (!b || !def) return '没有站点';
  const r = RECIPE_OF[id];
  if (!r || !canMake(r, def === 'smelter' ? 'smelter' : 'furnace')) return '这台做不了这个';
  b.recipe = id;
  b.prog = 0;                       // 换配方丢掉未完成的进度（不然会“用 A 的进度出 B”）
  state._panelSig = null;
  return null;
}

// 每帧推进制造台的排队（挂在 SIM 里）
export function updateCraft(state, dt) {
  for (const b of state.buildings || []) {
    const c = b.craft;
    if (!c || b.site) continue;
    c.t += dt;
    if (c.t < c.sec) continue;
    const r = RECIPE_OF[c.id];
    b.craft = null;
    if (!r) continue;
    const got = deposit(state, r.out, r.n || 1, b.x + 0.5, b.y + 0.5);
    if (got > 0) {
      state.floaties.push({ x: b.x, y: b.y - 0.7, txt: `制好：${RES_NAME[r.out] || r.out}`, color: '#bfe0c0', t: 0, life: 1.4 });
    }
    state._panelSig = null;
  }
}
