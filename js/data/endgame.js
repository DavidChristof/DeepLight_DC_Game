// data/endgame.js —— W20-R 余辉共鸣：终局协议与可达性审计口径
// R0 只登记稳定规则；正式材料成本必须在固定种子资源审计后再填写。
export const ENDGAME = Object.freeze({
  VERSION: 2,
  NIGHT_OUTCOME: Object.freeze({ VERSION: 1, HISTORY_LIMIT: 16, BANNER_LIFE: 3.5, DEATH_FX_LIFE: 0.6, DEATH_FX_OFFSET: 0.3 }),
  BEACON_COUNT: 3,
  SITE_MARGIN: 2,
  SITE_TIE_BREAK: 0.01,
  BIOME_ORDER: Object.freeze(['tundra', 'vineMist', 'shaleRise']),
  // 路线顺序：邻近藤雾林远征 → 碎岩台地深入 → 回苔原营地完成最终共鸣。
  // 这是群系/区块探针，不是最终信标格位；格位须按种子地图和存档占格安全挑选。
  SITE_CHUNK_PROBES: Object.freeze([
    Object.freeze({ id: 'first', biome: 'vineMist', x: 1, y: 0 }),
    Object.freeze({ id: 'second', biome: 'shaleRise', x: 3, y: 0 }),
    Object.freeze({ id: 'third', biome: 'tundra', x: 0, y: 0 }),
  ]),
  // 首站选址只在有限、固定顺序的藤雾林区块中回退；不会随机重抽或越过群系。
  FIRST_SITE_CHUNK_SEARCH: Object.freeze([
    Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: 0, y: 1 }),
    Object.freeze({ x: -1, y: 0 }), Object.freeze({ x: 0, y: -1 }),
  ]),
  // 二站在碎岩台地内稳定回退；终站只在苔原原点完整扫描合法格。
  SITE_CHUNK_SEARCH: Object.freeze({
    first: Object.freeze([
      Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: 0, y: 1 }),
      Object.freeze({ x: -1, y: 0 }), Object.freeze({ x: 0, y: -1 }),
    ]),
    second: Object.freeze([
      Object.freeze({ x: 3, y: 0 }), Object.freeze({ x: 0, y: -3 }),
      Object.freeze({ x: -3, y: -3 }), Object.freeze({ x: 1, y: -3 }),
      Object.freeze({ x: 3, y: -1 }), Object.freeze({ x: -3, y: 1 }),
      Object.freeze({ x: 3, y: 2 }), Object.freeze({ x: 2, y: 3 }),
      Object.freeze({ x: -2, y: -3 }), Object.freeze({ x: -3, y: -2 }),
      Object.freeze({ x: 3, y: 3 }), Object.freeze({ x: 2, y: -4 }),
    ]),
    third: Object.freeze([Object.freeze({ x: 0, y: 0 })]),
  }),
  // R0 首轮预算：施工成本一次性支付；每次反冲预约都支付仪式成本，失败不另扣材料，信标不回滚。
  // R3 固定种子闭环会按实际采集耗时校准；系统只能读取本表，不复制数字。
  SITE_COSTS: Object.freeze({
    first: Object.freeze({ ore: 12, fuel: 6 }),
    second: Object.freeze({ ore: 18, core: 6, night: 3, data: 4 }),
    third: Object.freeze({ ore: 24, core: 10, night: 5, data: 8 }),
  }),
  TRIAL_START_COST: Object.freeze({ fuel: 4, night: 1 }),
  STANDARD_TRIAL: Object.freeze({
    minLight: 1,
    statuses: Object.freeze(['idle', 'reserved', 'active', 'failed', 'complete']),
  }),
  ENDING: Object.freeze({
    VERSION: 1,
    MIN_DAWN_CREW: 1,
    AWARD_ID: 'resonance-triad',
    COUNT_MAX: 2147483647,
    OUTCOMES: Object.freeze({
      dawn: Object.freeze({ title: '黎明', subtitle: '三座信标同辉，仍有人与你同行' }),
      solitude: Object.freeze({ title: '孤灯', subtitle: '三座信标已亮，最后的灯由你守着' }),
      afterglow: Object.freeze({ title: '余辉', subtitle: '三座共鸣已完成' }),
    }),
  }),
  // 首胜开发回放用的固定策略参数；不改变玩家规则，仅用于构造真实战斗检查点。
  FIRST_BOSS_REPLAY: Object.freeze({
    maxLamps: 1, maxGlowTowers: 4,
    furnaceSpotMin: 2, furnaceSpotMax: 5,
    lampSpotMin: 2, lampSpotMax: 5,
    towerSpotMin: 1, towerSpotMax: 4,
    furnaceCooldown: 8, craftCooldown: 1.25,
    lampRefuelBelow: 18, refuelCooldown: 1,
    pulseRange: 4.4, kiteRange: 2.5, kiteDistance: 4, kiteCooldown: 1.25,
    normalPulseRange: 3.2,
  }),
  RESOURCE_AUDIT_SEEDS: Object.freeze([1, 2026, 4242]),
  RESOURCE_KEYS: Object.freeze(['ore', 'vine', 'relic', 'core']),
  REPORT_SCHEMA: Object.freeze([
    'version', 'milestone', 'sites', 'resourceAudit', 'stock', 'costs', 'status',
  ]),
});
