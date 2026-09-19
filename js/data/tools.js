// data/tools.js —— 工具、配方与「操作台」站点定义
//
// 设计意图：
//   · 工具不是「数值升级」，而是【行为开关 + 手感】：石镐打开岩壁这扇门，石斧/石镰/石锤各自管一件事
//   · 工具是【真物品】：占容器格子、会随层带、会跟着人死
//   · 熔炉/自动熔炉是【配方站】：产出取决于玩家选中的配方（而不是写死一种产出）
//     —— 熔炉是手炉，**只做炼油**；烧炭只能上自动熔炉（用户拍板：两个炉子的分工要一眼看清）
//        hand = 你按住 E 手做的间隔（快，但要你自己站在那里）
//        sec  = 自动熔炉无人值守的间隔（慢，但不用人）
import { RES_NAME } from './storage.js';

// 【工具 = 生产件】
// 第 5 步原本给每件工具加过 `atk/vsHard/kb` 的"战斗性格"，**已被用户否决**（详见 docs/BUG_HUNT.md D47）：
//   ① 工具是生产件，突然要玩家去背"镐打壳 ×1.6、镰打不动壳"这张表 = 割裂；
//   ② 近战还占着 E 的最高优先级 → 鼠标指着怪时 E 不再采集/施工，把 B48 刚理顺的手势又搅浑；
//   ③ 深潜贴脸的自保手段已经有更清楚的答案：**辉光棒（F，耗燃料）+ 光爆 + 背上的塔**。
//   所以本表只写生产属性；战斗能力一律在 data/combat.js，别再漏回来。
export const TOOLS = {
  pick: {
    name: '石镐', mineMul: 0.62, rock: true,
    desc: '开凿岩壁（需研究「石工」）；挖矿与凿岩快 40%（徒手也能凿，只是慢）',
  },
  axe: {
    name: '石斧', mineMul: 0.72, vineBonus: 1,
    desc: '伐藤木快 30%，每次多 1 藤木',
  },
  sickle: {
    name: '石镰', harvestBonus: 1,
    desc: '采收幽菌田多 1 食物',
  },
  hammer: {
    name: '石锤', buildMul: 1.8, workerBuild: 1.35,
    desc: '按住 E 施工快 80%（拓荒者快 35%）',
  },
  wand: {   // 手持辉光棒（第 5 步）：你的“随身远程” —— 不靠环境光，黑暗里也能打
    name: '辉光棒',
    fire: true,                      // 能力标记（数值全在 data/combat.js 的 HAND_FIRE）
    desc: '按 F 朝鼠标方向开一束辉光（约 3 发耗 1 燃料）。不靠环境光，黑暗里也能打',
  },
  repair: {
    name: '修缮钳', repair: true,
    desc: '维护受损工事；每次消耗石头与藤木，不能造成伤害',
  },
};

export const TOOL_ORDER = ['pick', 'axe', 'sickle', 'hammer', 'wand', 'repair'];
export const toolDef = (k) => TOOLS[k] || null;
export const isTool = (k) => !!TOOLS[k];
export const canFire = (k) => !!(TOOLS[k] && TOOLS[k].fire);   // 手上这件工具能不能开火

// 岩壁：一格能挖出多少石头 / 每块石头的基准耗时（比矿石慢，石头沉）
export const ROCK_AMT = 3;
export const ROCK_SECS = 0.42;

// —— 配方 ——
// station: 哪个站点能做（furnace=熔炉/smelter=自动熔炉/bench=制造台）
// hand: 按住 E 手做的间隔；sec: 自动熔炉的间隔；out/n: 产物；cost: 从最近容器扣料
export const RECIPES = [
  {
    id: 'fuel', station: ['furnace', 'smelter'], name: '炼油', out: 'fuel', n: 2,
    cost: { ore: 1 }, hand: 0.35, sec: 4,
    // 【为什么是 1 → 2（W14-A 第 8 步的曲线调参）】回放台（固定种子 4242 · 标准守家打法）量到：
    //   辉髓在第 2 天就归零 → 夜里灯灭 → 必死夜。而辉髓同时是“建材”与“油源”，1:1 的转化
    //   把两条需求挤在同一个壶口上。产出翻倍后，“建造 vs 炼油”仍是真选择，但不再是零和。
    desc: '辉髓 → 燃料：灯与塔的口粮（1 辉髓炼 2 燃料；手做快、自动慢，但自动不用人）',
  },
  {
    id: 'coal', station: ['smelter'], name: '烧炭', out: 'coal', n: 3,
    cost: { vine: 1 }, hand: 1.0, sec: 5,
    desc: '藤木 → 木炭：自动熔炉的火种（也是唯一能“存起来的火”）',
  },
  { id: 'pick', station: ['bench'], name: '石镐', out: 'pick', n: 1, cost: { stone: 3, vine: 1 }, sec: 6 },
  { id: 'axe', station: ['bench'], name: '石斧', out: 'axe', n: 1, cost: { stone: 2, vine: 1 }, sec: 5 },
  { id: 'sickle', station: ['bench'], name: '石镰', out: 'sickle', n: 1, cost: { stone: 2, vine: 2 }, sec: 5 },
  { id: 'hammer', station: ['bench'], name: '石锤', out: 'hammer', n: 1, cost: { stone: 3, vine: 2 }, sec: 7 },
  // 辉光棒：辉髓 + 燃料（不要石头 —— 与 B41 同一条理由：别把新东西又挂回“石头→镐子”那条链上）
  { id: 'wand', station: ['bench'], name: '辉光棒', out: 'wand', n: 1, cost: { ore: 6, fuel: 2 }, sec: 8, desc: '随身远程：黑暗里也能打（按 F 开火）' },
  { id: 'repair', station: ['bench'], name: '修缮钳', out: 'repair', n: 1, cost: { stone: 2, vine: 2 }, sec: 6, desc: '维护受损工事：每次消耗石头与藤木' },
];
export const RECIPE_OF = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
export const recipesOf = (station) => RECIPES.filter((r) => (r.station || []).includes(station));
export const recipeName = (r) => r.name || RES_NAME[r.out] || r.out;
export const canMake = (recipe, station) => !!(recipe && (recipe.station || []).includes(station));
