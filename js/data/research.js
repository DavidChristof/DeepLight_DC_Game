// data/research.js —— 研究树（三种东西别混在一起：数值 Mod / 机制锁 / 知识锁）
//
// 结构（W12-D 重排）：
//   · sect  分区：拓荒(founder) / 深渊(deep) / 夜行(night) / 知识(know)
//   · req   货币/前置节点（旧的机制）
//   · req2  非货币前置：obs(见过/挨过 N 次) / relic(残页系列) / body(身体换来的) / human(人带来的) / built(先建成) / depth(到过某层)
//   · hint  人话线索：未解之谜区显示它；面板**只显示你已经知道存在的东西**
//   · branchOf 柔性分支：同一位置的第二条，在第一条解锁后贵 ×3（不做硬互斥，两条都能拿）
//   · 知识节点（sect:'know'）**不花点数**，只能在「解析台」旁解锁
//
// 铁律：机制锁/知识锁优先于数值；数值 Mod 也要带前置或代价，不做纯叠叠乐。

// —— 分区定义（面板上的 chip）——
export const SECTS = [
  { id: 'founder', name: '拓荒', hint: '营地里的常识：谁都能想明白' },
  { id: 'deep', name: '深渊', hint: '下去过的人才会想的事' },
  { id: 'night', name: '夜行', hint: '只在黑暗里长出来的知识' },
  { id: 'know', name: '知识', hint: '不能购买，只能发现 —— 把线索带回「解析台」' },
];

export const RESEARCH = {
  // ═══════════ 拓荒：基础（开局就能看见） ═══════════
  mining: {
    sect: 'founder', name: '高效采掘', cost: { data: 6 }, req: [],
    desc: '采集速度 +60%',
  },
  stonework: {
    sect: 'founder', name: '石工', cost: { data: 8 }, req: [],
    desc: '解锁「制造台」（石头 + 藤木 → 工具）；装备石镐即可开采岩壁',
  },
  analyzer: {
    sect: 'founder', name: '解析学', cost: { data: 10 }, req: ['stonework'],
    desc: '解锁「解析台」：知识类研究只能在解析台旁解锁（把残页 / 观察 / 伤口带回去解析）',
  },
  lamp: {
    sect: 'founder', name: '省芯灯术', cost: { data: 8 }, req: [],
    desc: '灯柱 / 净光柱燃料消耗 -35%',
  },
  pulse: {
    sect: 'founder', name: '辉光增幅', cost: { data: 10 }, req: ['mining'],
    desc: '光爆威力 +25%',
  },
  // —— 第三座塔（2e）：光弧沿敌人跳 ——
  chain: {
    sect: 'founder', name: '链式放电', cost: { data: 22, ore: 10 }, req: ['pulse'],
    desc: '解锁「连锁光塔」：命中后光弧跳到 2 格内下一个目标（最多 3 跳，每跳伤害 ×0.6）',
  },
  healing: {
    sect: 'founder', name: '蚀抗体质', cost: { data: 14 }, req: ['lamp'],
    desc: '生命上限 +40 · 解锁医疗站',
  },
  autosmelt: {
    sect: 'founder', name: '自动熔炉', cost: { data: 12, stone: 4 }, req: ['stonework'],
    desc: '解锁「自动熔炉」：火种可选，自己从容器取料出货（拓荒者会来添火）',
  },
  // —— 载荷（W14-A 第 2 步）：给塔装修饰器，自己"编程"出武器 ——
  payload1: {
    sect: 'founder', name: '载荷学', cost: { data: 12 }, req: ['stonework'],
    desc: '塔解锁载荷槽 ×1：站到塔旁按 E 装配（每装一个修饰器，每发多烧 0.1 燃料）',
  },
  payload2: {
    sect: 'founder', name: '双槽框架', cost: { data: 18, ore: 8 }, req: ['payload1'],
    desc: '载荷槽 +1（可组两个修饰器：比如聚焦 + 迟滞）',
  },
  payload3: {
    sect: 'founder', name: '三槽框架', cost: { data: 26, ore: 16 }, req: ['payload2'],
    desc: '载荷槽 +1（满配三槽：伤害最高、也最吃燃料）',
  },
  // —— 柔性分支：同位置第二条贵 ×3，但两条都能拿（先快后省，或反过来）——
  smeltFast: {
    sect: 'founder', name: '高产炉膛', cost: { data: 14 }, req: ['autosmelt'], branchOf: 'smeltThrift',
    desc: '熔炉类节奏 +25%（火种消耗不变）',
  },
  smeltThrift: {
    sect: 'founder', name: '省料炉膛', cost: { data: 14 }, req: ['autosmelt'], branchOf: 'smeltFast',
    desc: '炉子的火种消耗 -20%（烧得更久）',
  },

  // ═══════════ 深渊：下去过才看得见 ═══════════
  deep: {
    sect: 'deep', name: '深潜学', cost: { data: 16 }, req: ['mining'],
    desc: '解锁「深潜竖井」：可下探第一阶深渊（遗迹碑可采得档案点数）',
  },
  tower: {
    sect: 'deep', name: '塔学精研', cost: { data: 12 }, req: ['pulse'],
    desc: '防守塔伤害 +25%',
  },
  pulse2: {
    sect: 'deep', name: '辉爆精通', cost: { data: 18, core: 2 }, req: ['pulse'],
    desc: '光爆范围 +30%',
  },
  lamp2: {
    sect: 'deep', name: '辉核灯', cost: { data: 12, core: 1 }, req: ['lamp'], branchOf: 'lampSave2',
    desc: '所有光源光照半径 +30%',
  },
  lampSave2: {
    sect: 'deep', name: '灯芯浸油', cost: { data: 12, core: 1 }, req: ['lamp'], branchOf: 'lamp2',
    desc: '所有光源燃料消耗再 -35%',
  },
  towerRate: {
    sect: 'deep', name: '塔机联调', cost: { data: 16, core: 1 }, req: ['tower'],
    desc: '防守塔射速 +25%',
  },
  vitality2: {
    sect: 'deep', name: '母髓淬体', cost: { data: 16, core: 3 }, req: ['healing'],
    desc: '生命上限 +60（立即生效）',
  },
  revival: {
    sect: 'deep', name: '余烬回声', cost: { data: 24, core: 4, night: 8 }, req: ['healing'],
    desc: '解锁一次性复苏：墓碑旁消耗稀缺资源，把一名拓荒者带回，但会带伤、饥饿并经历恢复期（本局限 1 次）',
  },
  deeper: {
    sect: 'deep', name: '深层深潜', cost: { data: 20, core: 2 }, req: ['deep'], req2: [{ depth: 2 }],
    desc: '允许在深潜层建造竖井，下探第二阶熔渊',
  },
  carrier: {   // W14-A 第 5 步 5b：结构装载体
    sect: 'deep', name: '背负支架', cost: { data: 18, core: 1 }, req: ['deep'],
    desc: '站在塔旁按住 V 把它背到背上：跟着你走、跟着你打（移动中射速减半 · 燃耗 ×1.5 · 占 1 背包格 · 被啃掉就真丢）',
  },

  // ═══════════ 夜行：黑暗里的知识 ═══════════
  nightrun: {
    sect: 'night', name: '暗行术', cost: { data: 10, night: 3 }, req: [],
    desc: '黑暗中的士气流失 -40%（夜采 / 巡逻不那么伤士气）',
    hint: '得先在夜里活着回来一次',
  },
  nightlamp: {
    sect: 'night', name: '夜髓萃取', cost: { data: 14, night: 5 }, req: ['nightrun'],
    desc: '夜辉草一次可采 2 夜髓，且夜采者额外士气损失减半',
  },

  // ═══════════ 知识：不可购买，只能发现（不花点数） ═══════════
  relicForging: {
    sect: 'know', name: '熔渊锻造', cost: {}, req: [], req2: [{ relic: 'handbook' }],
    desc: '熔炉类节奏 +20%',
    hint: '残页散在遗迹碑里 —— 集齐「熔渊手记」三页',
  },
  owlWard: {
    sect: 'know', name: '对空索', cost: {}, req: [], req2: [{ obs: 'owl', n: 5 }],
    desc: '辉光塔对空伤害 +30%',
    hint: '夜枭从头顶掠过五次之后，你大概就知道怎么把绳子挂上天',
  },
  blightWard: {
    sect: 'know', name: '蚀痕抗体', cost: {}, req: [], req2: [{ obs: 'seep', n: 1 }],
    desc: '蚀痕渗漏的出怪间隔 ×2',
    hint: '被渗漏咬过一次，才想得出办法',
  },
  heatSkin: {
    sect: 'know', name: '耐热皮膜', cost: {}, req: [], req2: [{ body: 'lava', n: 3 }],
    desc: '岩浆伤害 -60%',
    hint: '熔渊的岩浆会教人 —— 也可能直接烧死你',
  },
  memory: {
    sect: 'know', name: '她带回的记忆', cost: {}, req: [], req2: [{ human: 1 }],
    desc: '安抚成功后，全队心志 +10',
    hint: '把一个人从蚀化里叫回来，她会想起一些别的事',
  },
};

// 面板显示顺序（分区内按此顺序）
export const RESEARCH_ORDER = [
  'mining', 'stonework', 'analyzer', 'lamp', 'pulse', 'chain', 'healing', 'autosmelt', 'smeltFast', 'smeltThrift',
  'payload1', 'payload2', 'payload3',
  'deep', 'tower', 'pulse2', 'lamp2', 'lampSave2', 'towerRate', 'vitality2', 'revival', 'deeper', 'carrier',
  'nightrun', 'nightlamp',
  'relicForging', 'owlWard', 'blightWard', 'heatSkin', 'memory',
];

export const RESEARCH_COUNT = RESEARCH_ORDER.length;

