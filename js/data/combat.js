// data/combat.js —— 战斗数值的唯一数据源（W14-A 第 0 步）
//
// 【为什么单独一份】这些数字原来散在五个逻辑文件里：
//   systems/combat.js（光爆 / 死亡惩罚 / 击破奖励）、systems/towers.js（塔的开火门槛与技师生效）、
//   systems/waves.js（波次与 Boss）、systems/entities/enemy.js（Boss 召唤）、systems/research.js（加成倍率）。
//   调平衡时要在五个文件之间翻，而且文档与代码极易分家 —— B13 的教训就是"表与实现分家必然出事"。
//
// 【纪律】
//   · 本文件**只放数值**，不放逻辑；systems/* 一律从这里读，不许再写新魔数。
//   · 逐条属性表仍留在各自的数据文件：敌人 data/enemies.js、塔 data/buildings.js、图鉴 data/codex.js
//     （它们本来就是数据文件，没必要搬）。本文件只收"写死在逻辑里的魔数 + 跨系统加成倍率"。
//   · 改这里 = 改平衡。改完请跑：`__combat()`（对照表）/ `__wave()` / `__dps()` + `__check()`
//
// 【乘子约定】数值乘子的最终生效顺序：基础值 → 研究倍率 → 里程碑/图鉴倍率 → （未来）载荷修饰器。
//   任何一环都不允许绕过账本（光爆要扣燃料、塔要耗火种），这是"不白嫖"的底线。

// —— 光爆（玩家唯一主动技能）——
export const PULSE = {
  RANGE: 4.6,           // 半径（格）
  DAMAGE: 55,           // 基础伤害
  COOLDOWN: 2.6,        // 冷却（秒）
  FUEL: 1,              // 每次消耗燃料
  MUL_RESEARCH: 1.25,   // 研究「光爆威力」+25%
  MUL_RANGE: 1.3,       // 研究「光爆范围」+30%
  MUL_FIRST_BOSS: 1.25, // 首次击破蚀巢核心的成长奖励（永久 ×1.25）
};

// —— 塔（辉光塔 / 震荡塔；逐条属性在 data/buildings.js）——
export const TOWER = {
  LIGHT_MIN: 3.2,       // 所在格光照低于此值 → 熄火
  TINKER_RATE: 1.1,     // 技师在场：全场射速 ×
  MUL_DMG: 1.25,        // 研究「塔学精研」
  MUL_RATE: 1.25,       // 研究「塔射速」
  MUL_OWL: 1.3,         // 研究「对空索」（只作用于飞行目标）
};

// —— 伤害类型与抗性（W14-A 第 1 步）——
// 三类 + 默认「常规」：没写类型的调用一律走 GENERAL（= 不吃抗性，对旧调用完全兼容）
//   light 光：光爆 / 辉光塔 / 灯下灼伤    —— 本作的核心武器（光照既是防御也是武器）
//   shock 震荡：震荡塔（范围 + 减速）
//   physical 物理：工具近战 / 破墙反伤    —— **暂无入口，第 2 步（载荷与组合框架）接入**
// 抗性表写在敌人身上（data/enemies.js）：`armor: { light: 1.5 }` = 受到的光伤 ×1.5（省略 = ×1）
//   · 表在数据里、图鉴文案由表生成（data/codex.js 的 weakTextOf）—— 数字与文案不许两处写死
//   · 环境伤害（熔岩）与「畏光灼伤」一律走 GENERAL：它们本身就是那个特性的表达，
//     再乘一次抗性 = 同一件事算两遍（断言 combat.counter 守着这条）
export const TYPES = { GENERAL: 'general', LIGHT: 'light', SHOCK: 'shock', PHYSICAL: 'physical' };
export const TYPE_ORDER = ['light', 'shock', 'physical'];            // 展示 / 生成文案的顺序
export const TYPE_NAME = { general: '常规', light: '光', shock: '震荡', physical: '物理' };

// 某只敌人受到某类伤害的倍率（未知类型、未声明的类型、没写 armor 的敌人 = ×1）
export function armorMul(def, type) {
  if (!def || !type || type === TYPES.GENERAL) return 1;
  const a = def.armor;
  if (!a) return 1;
  const v = a[type];
  return (typeof v === 'number' && v > 0) ? v : 1;
}

// 畏光灼伤：光照 >3 时对「畏光」蚀兽的持续伤害（每秒，实际生效值）
// 走 GENERAL：这是 lightFear 这个特性的**可视化**，光伤加成由 armor.light 表达（各管一层，不叠加）
export const LIGHT_FEAR_BURN = 42;

// —— 手持开火（W14-A 第 5 步）——
// 【近战已撤（用户否决）】这一步原本还给每件工具加过 `atk/vsHard/kb`（E 抡人），
//   用户原话：“工具能攻击简直是个废物设计，太割裂了，根本没必要”。详见 docs/BUG_HUNT.md D47：
//   ① 工具是生产件，多一套战斗性格只会让玩家多背一张表；
//   ② 近战占着 E 的**最高优先级**，会抢走采集/施工（B48 刚理顺的手势又浑了）。
//   玩家输出保持四条清楚的线：**塔 / 光爆 / 辉光棒(F) / 背上的塔**。
// 手持发射器（辉光棒）：单目标命中弹出，不靠环境光
//   燃料用**小数债务**（与塔同一条纪律）：每发记 0.34，满 1 才真扣容器 —— 约 3 发 1 燃料。
export const HAND_FIRE = {
  RANGE: 7, DMG: 14, CD: 0.6, FUEL_PER_SHOT: 0.34, BEAM_R: 0.62, TYPE: 'light',
};

// —— 结构装载体（W14-A 第 5 步 5b）：把一座塔背到背上 ——
// 【三条代价必须同时存在】否则它就是“免费移动堡垒”：
//   ① 移动中射速 ×0.5（RATE_MUL_MOVING）—— 站着打才划算，阵地战仍有意义
//   ② 燃耗 ×1.5（FUEL_MUL），且有底价（BASE_FUEL）：0 修饰器的塔平时免费，背起来也要烧油
//   ③ 占 1 背包格（PACK_SLOTS），本体有 hp，**被啃掉就真丢**（不回背包）
//   装卸要停下来按住（MOUNT_SECS）—— 打在 V 键上，不与 E 的“装配载荷/施工”抢手势。
export const CARRY = {
  MOUNT_SECS: 2.2,        // 按住 V 的时长（移动/换目标都会重来）
  RATE_MUL_MOVING: 0.5,   // 移动中的射速倍率
  FUEL_MUL: 1.5,          // 背负时的每发燃耗倍率
  BASE_FUEL: 0.34,        // 每发最低燃耗（与辉光棒同值：都是“你自己当光源”的代价）
  PACK_SLOTS: 1,          // 占背包格数
  // 每被咬一次，背上的结构体也跟着吃 TOWER_BITE_SHARE 的份。
  // 【为何必须有这一条】装在身上的塔**不占格**，所以敌人既绕不过它也撞不着它 ——
  //   实测：自爆壳在脚边炸、破墙壳撞你，它一点血都不掉，那条“本体有 hp、被啃掉就真丢”就是句空话。
  //   现在改成“它替你挡下半下”：深潜里被打就等于两倍压力，这才是带塔出征真正的代价。
  TOWER_BITE_SHARE: 0.5,
};

// —— 蚀潮波次 ——
export const WAVES = {
  TIDE_MAX: 8,                                   // tide = min(day, TIDE_MAX)
  CAP_BASE: 20, CAP_PER_TIDE: 6, CAP_BOSS_NIGHT: 10,   // 同屏上限 = (base + tide*per + boss夜) × diff.capMul
  INTERVAL_MAX: 4.2, INTERVAL_PER_TIDE: 0.22, INTERVAL_MIN: 1.9,  // 刷新间隔
  BATCH_DIV: 3,                                  // 每批只数 = 1 + floor(tide / BATCH_DIV)
  RING_MIN: 10, RING_VAR: 5, SPAWN_TRIES: 24,    // 出怪环带（以营地为中心）
  DARK_MAX: 0.5,                                 // 只从光照低于此值的格子出现（光照封锁）
  BLIGHT_LV: 2, BLIGHT_BOOST: 0.15,              // 蚀痕 ≥2 级的地块：出怪血量/伤害 +15%/级
  DISSOLVE_MIN_FADE: 0.15,                       // 黎明消解的最慢档（保护除数）
};

// —— 大潮 Boss（蚀巢核心）——
export const BOSS = {
  EVERY: 7,                                      // 每 N 天一次
  HP_SCALE: 0.55,                                // 每轮 +55% 血量
  RING_MIN: 13, RING_VAR: 4, SPAWN_TRIES: 60, DARK_MAX: 0.4,   // 同样只落在黑暗里
  SUMMON_CD: 9, SUMMON_CD_MIN: 3, SUMMON_TIER_STEP: 0.8,       // 召唤间隔（随轮次缩短，有下限）
  SUMMON_BATCH: 2,                                             // 每次召唤只数
  SUMMON_RAD_MIN: 1.6, SUMMON_RAD_VAR: 1.4,                    // 召唤落点环带（不让它一下堆在脚下）
  SUMMON_CAP: 60,                                              // 场上总数上限（召唤不再往上涨）
  // —— 二阶段（W14-A 第 7 步）——
  // 【为什么要有阶段】原来 Boss 战就是“血条很长的一只怪”：从满血到暴血，行为一个字不变，
  //   打到一半就腻了。给它一个**看得见的转折**：血量降到 PHASE2_AT 以下 → 孵化更快、每批更多。
  //   两件都只改“孵化节奏”，不改它的移动/伤害 —— 阶段应该改变**压力形状**，不是把数值拉满。
  PHASE2_AT: 0.5,                                              // 血量 ≤ 这个比例进二阶段
  PHASE2_CD_MUL: 0.65,                                         // 二阶段：孵化间隔 ×（越小越快）
  PHASE2_BATCH_ADD: 1,                                         // 二阶段：每批多孵 1 只
};

// —— 封灯撤退（W14-A 第 7 步）——
// 【它回答什么问题】夜里眼看守不住时，玩家原本只有两条路：“硬撑到天亮”和“死一次” —— 都不是决策。
//   现在给第三条：**主动把自己的灯封掉**，壶潮失去目标便提前退去。
// 【为什么代价必须这么重】否则它就是“跳过夜晚”按钮：
//   ① 把每一盏点着的灯柱/净光柱的余油全部倒掉（灯全灭，白天得重新加）
//   ② 全队士气/心志受挫（撤了，不是赢了）
//   ③ 每 COOLDOWN_DAYS 天只能用一次
//   ④ 必须在壶潮里顶过 MIN_SECS 才能按（不能在潮刚起时秒按，那是白拿时间）
//   ⑤ 不在壶潮 / 不在表层 / 一盏灯都没点着 → 直接拒绝（没有“牺牲”就不叫牺牲）
export const RETREAT = {
  HOLD: 1.2,                                           // 按住多少秒才生效（与背负同一条语言：重决定 = 长按）
  MIN_SECS: 20,                                        // 壶潮开始后至少顶这么久（= 加压段起点）
  COOLDOWN_DAYS: 3,                                    // 冷却：每 N 天一次
  MORALE: 18,                                          // 全队士气 −
  SANITY: 10,                                          // 全队心志 −
};

// 破墙者砸建筑时的伤害倍率（对拓荒者/玩家仍是 ×1：它们不该被秒）
export const BREAKER_BUILD_MUL = 2;

// 当前潮位 = min(天数, 上限)。【唯一定义】以前 waves.js 与 dev/observe.js 各写了一遍同一个式子，
//   第 4 步起 night.js 也要用 → 收到这里，三处都调它（断言 night.plan 会核它与其他地方一致）
export function tideOf(state) {
  return Math.min((state && state.day) || 1, WAVES.TIDE_MAX);
}

// —— 敌人行为（W14-A 第 3 步）——
// 【纪律同前】这里的数字是唯一来源；data/enemies.js 上只写**行为名字**（`ability: 'spit'`），
//   行为逻辑写在 entities/enemy.js。断言 `enemy.ability` 守着“表与实现不分家”：
//   名字必须在 ABILITY 里、必须至少有一个敌人用它（不得留没入口的死数据）。
//
// 四个行为各自惩罚一种“安稳打法”：
//   spit   远程吐蚀 —— 惩罚“龟缩在墙角后面”（隔墙也打得着；蓄力期看得到预警线）
//   charge 突进冲锋 —— 惩罚“站桩不动”（3 格内蓄力 0.6s 后锁定方向 ×3 速突进）
//   bomb   残血自爆 —— 惩罚“贴脸点射”（≤20% 血引信 1.2s → 1.5 格内玩家与同族一起吃伤害，能连锁）
//   aura   庇护光环 —— 让“先打谁”成为决策（3.5 格内同族 +30% 速；先点掉它就整片变慢）
// 【键名约定】键 = 敌人在 data/enemies.js 上写的 `ability` 值（小写、同名），不得再弄一层映射表。
export const ABILITY = {
  spit: { RANGE: 6, MIN_RANGE: 1.6, WINDUP: 0.75, DMG: 11, CD: 2.6 },
  charge: { RANGE: 3, WINDUP: 0.6, DASH: 0.35, MUL: 3, CD: 1.8 },
  bomb: { HP_FRAC: 0.2, FUSE: 1.2, RADIUS: 1.5, DMG_PLAYER: 16, DMG_BEAST: 26 },
  aura: { RANGE: 3.5, SPEED_MUL: 1.3, REFRESH: 0.15 },
};

// 击破 Boss 的奖励与节奏
export const REWARD = {
  FIRST_HP: 30,                                  // 首次：生命上限 +
  FIRST_FUEL: 12, FIRST_ORE: 8, FIRST_DATA: 8,   // 首次掉落
  ROUND_DATA: 5,                                 // 之后每轮的知识掉落
  SANITY: 12, MORALE: 20,                        // 全队心志 / 士气（"活着回来了"）
  NO_SPAWN: 14,                                  // 击破后的短暂宁静（秒）
};
