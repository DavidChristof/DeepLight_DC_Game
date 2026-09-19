// data/buildings.js —— 建造物定义（数据驱动，无依赖）

import { STORE_CAP } from './storage.js';

// 光源亮度档位（R 键循环）：越亮半径越大，但耗油涨得更快
// 设计意图：光变成预算 —— 视野/防守/农业/士气抢同一池燃料
export const LIGHT_LEVELS = [
  { name: '低', r: 0.65, burn: 0.7 },
  { name: '中', r: 1.0, burn: 1.0 },
  { name: '高', r: 1.35, burn: 1.6 },
];

// 占格规则：
//   solid=true  —— 实体：挡人（墙 / 机器 / 灯柱 / 净光柱）
//   solid=false —— 可通行（幽菌田只是作物、竖井是井口，人都能走过去）
//   block=true  —— 额外挡光（只有木墙）
export const BUILD = {
  lamp: {
    name: '灯柱',
    cost: { ore: 2, vine: 2 },
    power: 9, radius: 7,
    maxFuel: 30, burnSec: 18,   // 每 burnSec 秒消耗 1 燃料（按 140s/天 调）
    solid: true, block: false,  // 柱身占格，但不挡光
    color: '#aee9ff',
  },
  wall: {
    name: '木墙',
    cost: { vine: 2 },
    hp: 80,
    solid: true, block: true,   // 实体 + 挡光
    color: '#b98c5f',
  },
  stoneWall: {
    name: '石墙', cost: { stone: 3, vine: 1 }, hp: 180,
    solid: true, block: true, color: '#9aa6b5',
  },
  gate: {
    name: '栅门', cost: { vine: 4, stone: 1 }, hp: 110,
    solid: false, block: false, gate: true, openDefault: true, color: '#d7b58a',
  },
  barricade: {
    name: '路障', cost: { vine: 3, stone: 2 }, hp: 70,
    solid: false, block: false, slow: 0.45, color: '#c28b5a',
  },
  furnace: {     // 熔炉：手炉 —— 只做炼油（烧炭在自动熔炉上）；按住 E 手做
    name: '熔炉',
    cost: { ore: 2, vine: 3 },
    solid: true, block: false,
    station: 'furnace', recipe: 'fuel', work: true,
    // 火种（见 data/fire.js）：默认藤木 —— 开局随手能捡，所以不会“没燃料就什么都干不了”
    fireMat: 'vine', maxFuel: 12, burnSec: 7,   // 火种槽 12（第 8 步从 6 提到 12：添一次能撑 ~84 秒，手动添火不再是绑人活）
    power: 4, radius: 2.2,       // 炉口暖光（只有 2 格，替代不了灯柱；有火才亮）
    color: '#ff9d5c',
  },
  towerGlow: {   // 辉光塔：单体高伤，可对空；需处于光照中才能开火
    name: '辉光塔',
    cost: { ore: 6, fuel: 2 },
    hp: 120, range: 6.5, dmg: 16, cd: 0.9, air: true,
    dmgType: 'light',                             // 光伤（W14-A 第 1 步：抗性表按类型生效）
    solid: true, block: false,
    color: '#9fe8ff',
  },
  towerShock: {  // 震荡塔：范围伤害 + 减速，仅对地；需处于光照中
    name: '震荡塔',
    cost: { ore: 4, vine: 4 },
    hp: 120, range: 4.5, aoe: 2.2, dmg: 7, cd: 2.4, slow: 0.5, slowT: 1.6, air: false,
    dmgType: 'shock',                             // 震荡伤（壳类扛、噬光虫怕）
    solid: true, block: false,
    color: '#c9a0ff',
  },
  towerChain: {  // 连锁光塔（2e）：单发同辉光塔，但冷却更慢 —— 代价是单目标弱，回报是光弧会继续跳
    name: '连锁光塔',
    cost: { ore: 8, fuel: 3 },
    // 【为什么单发是 16 而不是计划里的 11】11/1.6×满链倍率 2.176 = 14.96 单靶等效 DPS，
    //   反而**低于**辉光塔的 17.78 → 与子计划 §2e 的判据“对密集潮的有效 DPS 明显高于辉光塔”相矛盾。
    //   16/1.6 = 10 单靶（辉光塔的 0.56×）、满链 21.76（辉光塔的 1.22×）—— 单靶弱、群战强，身份清楚。
    hp: 110, range: 5.5, dmg: 16, cd: 1.6, air: false,
    // 「链」是发射器自带的规则（不是载荷修饰器）：跳距按**敌人之间**算，每跳衰减一次
    chain: { jump: 2, max: 3, mul: 0.6 },
    dmgType: 'light',                             // 光伤：对蚀壳好使、对噬光虫打折
    solid: true, block: false, locked: 'chain',
    color: '#ffe9a8',
  },
  shaft: {       // 深潜竖井：通往蚀渊（需研究「深潜学」解锁）——井口可站人
    name: '深潜竖井',
    cost: { ore: 8, vine: 4 },
    hp: 140, solid: false, block: false,
    color: '#7fe0ff', locked: 'deep',
  },
  farm: {        // 幽菌田：需光照生长，成熟后可采收食物——只是作物，可以走进去
    name: '幽菌田',
    cost: { vine: 4 },
    hp: 60, solid: false, block: false,
    growSec: 95, lightMin: 2.5, yield: 3,
    color: '#9ef7a8',
  },
  mycobed: {
    name: '菌床', cost: { vine: 5, stone: 1 }, hp: 55, solid: false, block: false,
    growSec: 120, lightMin: 0.8, lightMax: 2.4, yield: 2, regen: 'vine', color: '#c9a0ff',
  },
  bunk: {
    name: '简易铺位',
    cost: { vine: 4 },
    hp: 50, solid: false, block: false,
    restSlots: 1,
    color: '#d7b58a',
  },
  clinic: {
    name: '医疗站',
    cost: { ore: 6, vine: 8, stone: 4 },
    hp: 100, solid: true, block: false,
    station: 'clinic', medicalSlots: 1,
    locked: 'healing',
    color: '#9fe8d5',
  },
  purifier: {    // 净光柱：既是光源，又能定期净化蚀痕（耗油约为灯柱的 2.5 倍）
    name: '净光柱',
    cost: { ore: 6, fuel: 3 },
    hp: 90, solid: true, block: false,
    power: 7, radius: 5, maxFuel: 30, burnSec: 7.2,
    purifySec: 8, purifyR: 3,
    color: '#d8c6ff',
  },
  cache: {       // 补给站：只建在深渊；把燃料分给附近光源（噬光虫闻得到油味）
    name: '补给站',
    cost: { ore: 6, vine: 6 },
    hp: 100, solid: true, block: false,
    maxFuel: 60, supplySec: 4, supplyRange: 6, locked: 'deep', deepOnly: true,
    color: '#ffcf8a',
  },
  prism: {       // 棱镜：自己不产光、也不耗油 —— 只是把「收到的光」再发出去
    name: '棱镜',
    cost: { ore: 3, vine: 1 },
    hp: 22, solid: true, block: false, locked: 'lamp',
    relay: { minLit: 1.6, power: 7, radius: 4.5 },
    color: '#bfe4ff',
  },
  prismGun: {    // 光路炮（第 6 步）：不吃**自己脚下**的光，而是吃**旁边一面被点亮的棱镜**
    // 【它回答什么问题】棱镜之前只能“把光接力出去” —— 那是基建。现在把它接成武器：
    //   把炮建在光路上，射程比辉光塔远一截，火力也能投到黑暗里去（灯的照不到的地方）。
    // 【代价（两件同时成立）】①它**必须挨着被点亮的棱镜**才开火 —— 棱镜自己不产光，
    //   所以上游任何一个环节断掉（灯灭/镜子被砸/光路超距）它就当场焕火；
    //   ②重到只能打地面（夜祟归辉光塔负责）—— 一格一身份，不与现有三座塔抢活。
    name: '光路炮',
    cost: { ore: 8, vine: 4 },
    hp: 110, range: 8.5, dmg: 24, cd: 1.3, air: false,
    needsBeam: true,                             // 开火条件标记（systems/towers.js 读它）
    dmgType: 'light',
    solid: true, block: false, locked: 'lamp',   // 与棱镜同一张研究（「灯芯」）：一次解锁整条光路体系
    color: '#9ff0e0',
  },
  decoy: {       // 诱饵灯：只吸仇恨，不给视野（不是光源、不算照亮、不压蚀痕）
    name: '诱饵灯',
    cost: { ore: 3, vine: 2 },
    maxFuel: 20, burnSec: 20,
    decoy: true, lure: 0.35,
    solid: true, block: false,
    color: '#8fa8c0',
  },
  store: {       // 储物箱：采到的材料自动进最近的容器；本层全满就会丢
    key: null, name: '储物箱',
    cost: { ore: 2, vine: 2 },
    hp: 60, solid: true, block: false,
    store: STORE_CAP,       // 总容量（各种材料共用）
    color: '#c9b48a',
  },
  bench: {       // 制造台：辉髓 + 藤木 → 工具（工具是真物品，会占容器格子）
    key: null, name: '制造台',
    // 【为什么不要石头】石头只能从岩壁来，而镐子又在制造台上做 ——
    //   一旦工具链要石头，新手就会在“没镐→凿不动岩壁→没石头→造不出镐”里打转（用户实机报的 B41）。
    //   制造台放在“辉髓 + 藤木”这一层：两者徒手就能采。
    cost: { ore: 4, vine: 6 },
    hp: 90, solid: true, block: false,
    station: 'bench',       // 站旁边按 E 打开操作台面板
    locked: 'stonework',
    color: '#bfe0c0',
  },
  smelter: {     // 自动熔炉：同一个配方表，但无人值守（代价：得喂火种）
    key: null, name: '自动熔炉',
    cost: { ore: 8, vine: 6, stone: 4 },
    hp: 120, solid: true, block: false,
    station: 'smelter', recipe: 'fuel',
    locked: 'autosmelt',
    smelt: { sec: 4 },            // 每 sec 秒炼 1 个：料 = 从最近容器取，成品 = 存回最近容器
    power: 6, radius: 4,          // 它本身就是一团火：有火种才发光（也是防守的一环）
    fireMat: 'vine',              // 火种（可切木炭/燃料；质量见 data/fire.js）
    maxFuel: 12, burnSec: 20,     // 火种槽：同时是灯芯（实际节奏看火种表 burnSecOf）
    color: '#ff9d5c',
  },
  analyzer: {    // 解析台：知识锁的物理载体 —— 残页 / 观察 / 伤口都要拿回这里才能解析
    key: null, name: '解析台',
    cost: { stone: 8, vine: 6, data: 6 },
    hp: 80, solid: true, block: false,
    station: 'analyze',           // 站旁边按 E 打开解析台面板
    locked: 'analyzer',           // 需研究「解析学」（石工 → 解析学）
    color: '#d8c6ff',
  },
};

// 棱镜接力：光路的每一段都从上一段「取光」，所以断一环就整条熄灭
// 段数上限防止一块镜子把光传到天涯海角
// 余烬层（decay ×1.6）里同样两块镜子的可用间距会从 4 格缩到 2 格 —— 这是层法则与光路的化学反应
export const PRISM_MAX_HOPS = 8;
const RELAY = BUILD.prism.relay;
export const PRISM_LIT = RELAY.minLit;

// —— 塔的成长（W14-A 第 6 步）：就地升级 Lv1→Lv3 ——
// 【为什么升级只管数值、不管槽位】槽位已经是研究（payload1/2/3）在管的事 —— 一条轴管一件事：
//   研究 = “你能给塔装几个修饰器”；升级 = “这一座塔本身更硬更亮”。
//   两条都给玩家，他就要同时算两套账（而且“升级解锁槽”会让研究节点看起来像白买了）。
// 【Lv1 必须是 1/1/1】= 今天的行为，一字不差 —— 零变化基线（检测器 tower.level 守着）。
export const TOWER_LV_MAX = 3;
export const TOWER_LV = [
  { dmg: 1, range: 1, hp: 1 },
  { dmg: 1.45, range: 1.12, hp: 1.4 },
  { dmg: 2.0, range: 1.22, hp: 1.8 },
];
// 升到第 n 级要的料：造价 × mul + 固定燃料附加（等级越高效价越大）
// ⚠️ 下标 = **目标等级**（不是"第几步"）：索引 1 用不到（Lv1 是建成时的状态），2 = 升到 Lv2，3 = 升到 Lv3
const LV_COST = [null, null, { mul: 0.6, fuel: 2 }, { mul: 1.0, fuel: 4 }];
export const lvOf = (level) => TOWER_LV[Math.min(TOWER_LV_MAX, Math.max(1, level | 0)) - 1];
// 【返回 null = “这东西压根没有结构这回事”】灯柱/工作台/储物箱这些 def 里没写 hp ——
//   不能把 null 当 0 用：别处大量用 `b.hp <= 0` 判“已毁”（仓库/小地图/添火），
//   一旦给它们盖上 0 血，它们会集体被当成坟场里的破片（W14-A 第 6 步真踩过：仓库和小地图先跳）。
export const towerHp = (def, level = 1) =>
  (def && typeof def.hp === 'number' ? Math.round(def.hp * lvOf(level).hp) : null);
// 当前等级 → 下一级的料（含燃料附加）；已满级 / 不是塔 → null
export function upgradeCostFor(type, level = 1) {
  const d = BUILD[type];
  if (!d || !d.dmg) return null;
  const next = Math.max(1, level | 0) + 1;
  if (next > TOWER_LV_MAX) return null;
  const spec = LV_COST[next];
  if (!spec) return null;
  const out = {};
  for (const k in d.cost) out[k] = Math.ceil(d.cost[k] * spec.mul);
  out.fuel = (out.fuel || 0) + spec.fuel;
  return out;
}

// 拆除返还比例（按建造成本向下取整）
export const DEMOLISH_REFUND = 0.5;
export const DEMOLISH_RANGE = 6;

// —— 工期（工时）——
// 放下去的是【蓝图/工地】：需要累积这么多「工」才真正建成。
// 玩家按住 E ≈ 2.9 工/秒；一名拓荒者 ≈ 1.1 工/秒（技师 ×2）—— 所以人是真的能替你盖房。
export const PLAYER_WORK = 1;        // 玩家每完成一次 E 结算推进的工
export const PLAYER_WORK_SECS = 0.35;  // 玩家两次 E 结算的间隔（即 ≈2.9 工/秒）
export const WORKER_RATE = 1.1;      // 工人每秒贡献的工
const BUILD_WORK = {
  prism: 5, wall: 6, stoneWall: 12, gate: 9, barricade: 7, store: 6, bench: 10, farm: 8, mycobed: 8, bunk: 6, clinic: 14, decoy: 8, lamp: 8,
  analyzer: 10,
  furnace: 12, smelter: 16, purifier: 14, towerGlow: 16, towerShock: 16, towerChain: 18, prismGun: 20, shaft: 18, cache: 18,
};
export const workOf = (type) => BUILD_WORK[type] || 8;

// 建造面板分类（面板按这个分组显示；**新增方块只需在本表里登记一次**）
export const CATEGORIES = [
  { id: 'light', name: '光', note: '光源与光路', types: ['lamp', 'purifier', 'prism', 'decoy'] },
  { id: 'struct', name: '结构', note: '挡路、可控通行与减速', types: ['wall', 'stoneWall', 'gate', 'barricade'] },
  { id: 'prod', name: '生产', note: '燃料、食物、生物质与工具', types: ['furnace', 'smelter', 'farm', 'mycobed', 'bench', 'analyzer'] },
  { id: 'def', name: '防御', note: '需光照才开火（光路炮需接上光路）', types: ['towerGlow', 'towerShock', 'towerChain', 'prismGun'] },
  { id: 'logi', name: '后勤', note: '探深的根，得先有地方放料', types: ['shaft', 'store', 'cache', 'bunk', 'clinic'] },
];
export const CATEGORY_OF = {};
for (const c of CATEGORIES) for (const t of c.types) CATEGORY_OF[t] = c.id;

// 建造顺序（扁平表：面板按分类分组，这里只是全量清单）
export const ORDER = CATEGORIES.flatMap((c) => c.types);

export function canAfford(res, type) {
  const c = BUILD[type].cost;
  for (const k in c) if ((res[k] || 0) < c[k]) return false;
  return true;
}
