// core/state.js —— 全局状态（模块无关依赖，仅承载数据）
export const TILE = 16;         // 每 tile 逻辑像素
export const VIEW_W = 720;      // 内部画布宽（可视 45×30 tile）
export const VIEW_H = 480;      // 内部画布高

export const state = {
  seed: (Math.random() * 1e9) | 0,
  day: 1,
  t: 0,             // 当前天内的秒数
  map: null,
  player: null,
  beacons: [],       // 静态灯柱 [{x, y, power, radius}]
  camera: { x: 0, y: 0 },
  light: null,       // Float32Array 光照值
  lightMax: 1,
  dest: null,        // 目标标记 {x, y, ok, at}：ok=可到达
  discovered: null,  // 探索迷雾：1=已探明（小地图只显示已探明区）
  res: { ore: 0, vine: 0, fuel: 0, data: 0, core: 0, food: 0, night: 0 },   // 库存（night = 夜髓）
  workers: [],       // 拓荒者（NPC）列表
  rescue: null,      // 当前救援会话（玩家或拓荒者）
  medicalQueue: [],  // 当前活跃区块的医疗站候诊引用（存档只保存拓荒者字段）
  pickups: [],       // 可拾取掉落物 [{x,y,kind,t,life}]
  deathPack: null,   // 玩家死亡时留下的遗落包 {x,y,layerId,stock,held,day}
  memorial: [],      // 拓荒者死亡履历（有限事件，不保存运行时引用）
  reviveCount: 0,    // N5b：已使用的有限复苏次数
  patrol: null,      // 巡逻令 { dx, dy, day }
  order: 'auto',     // 团队夜间指令：auto / forage / guard / patrol
  building: null,    // 当前建造类型（BUILD key）或 null
  cursor: { tx: 0, ty: 0, show: false, ok: false },  // 建造幽灵光标
  buildings: [],     // 已放置建筑 [{type,x,y,hp?,fuel?,burnT?}]
  floaties: [],      // 飘字 [{x,y,txt,color,t,life}]
  interactCd: 0,     // E 键交互冷却计时
  enemies: [],       // 蚀兽实体列表
  playerHp: 100,
  playerHunger: 80,
  playerInjury: 0,
  playerRestT: 0,
  playerInvuln: 0,
  playerDead: false,
  kills: 0,
  spawnT: 0,         // 波次生成计时
  wasTide: false,
  wasDawn: false,    // 黎明边沿（黎明提示音/退场飘字只做一次）
  seen: {},          // 首次提示已经说过的那些（键在 systems/hints.js）—— 随存档走
  hotbarOpen: false, // 快捷建造栏（底部那一条）是否展开 —— Q / 点标签都能开关，不占右侧面板
  skillCd: 0,        // 光爆冷却
  skillQueued: 0,
  pulse: null,       // 光爆扩散动画 {x,y,t,life}
  beams: [],         // 防御塔开火光束
  codex: {},         // 图鉴进度 { kind: {kills, unlocked} }
  codexOpen: false,
  activePanel: null, // 当前打开的右侧面板 id（null = 没开）—— 由 ui/panels.js 的 syncFlags 维护
  codexVersion: 0,
  bossTier: 0,               // 大潮 Boss 已降临次数（每次更强）
  bossSpawnedThisNight: false,
  noSpawnT: 0,               // 休战计时（击败 Boss 后短暂宁静）
  // 封灯撤退（W14-A 第 7 步）："上一次封灯是哪一天"必须随存档走（否则读档就能刷新冷却）
  lastSealDay: 0,
  sealT: 0,                  // 长按进度（会话态，不进存档）
  sealPrompt: null,
  sealWarnT: 0,              // “为什么现在按不了”的节流（复用 storeWarnTxt 那条警示通道）
  milestone: { bossDefeated: false, bossDay: 7, clearedDay: 0 },
  playerMaxHp: 100,
  pulseMul: 1,               // 光爆威力倍率（里程碑奖励）
  banner: null,              // 中央横幅 { title, sub, t, life }
  bossRef: null,             // 当前 Boss 引用（HUD 血条）
  paused: false,             // 暂停（P 键）
  layerId: 'surface',        // 当前层：surface / depth
  layers: null,              // 各层容器 { map, discovered, buildings, beacons, enemies }
  chunkStore: null,          // 地表区块缓存：仅保存已发现区块的持久引用
  chunkX: 0,
  chunkY: 0,
  lastShaft: null,           // 上次下潜的竖井位置（回升用）
  research: { unlocked: {} },// 研究进度
  researchVersion: 0,
  researchOpen: false,
  started: false,            // 是否已开局（false = 停主菜单）
  quickPause: false,         // P 键直接冻结（不开菜单）
  diffKey: 'normal',         // 难度键（calm/normal/harsh）
  diff: null,                // 难度参数（data/difficulty.js）
  nightLightPressure: 0,
  nightChallengeMul: 1,
  _replayMode: false,       // 开发回放上下文标记，不进存档、不驱动玩法
  firstSlice: null,      // W17-F：首局软编排进度（纯数据；不驱动玩法数值）
  _sliceGuide: null,      // F1：待显示的一次性首日提示，不进存档
  _expGuideSeen: null,    // W18-G1：远征提示去重，会话态，不进存档
  _expGuideCooldown: 0,   // W18-G1：远征提示冷却，会话态，不进存档
};
