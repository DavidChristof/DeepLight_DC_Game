// data/expedition.js —— W18-G 远征 / 前哨观测契约
//
// 这里只放不会改变玩法的协议常量。现场建箱、点灯与补给仍沿用
// buildings.js / storage.js / ecology.js 的唯一规则来源；本表只规定
// 观测报告的版本与营地坐标，避免开发工具各自猜一套“准备度”。
export const EXPEDITION = Object.freeze({
  VERSION: 1,
  HOME_CHUNK: Object.freeze({ x: 0, y: 0 }),
  // G1/G2 只提供信息，不锁输入、不自动传送。每区块的设施/补给提示会
  // 去重；黄昏提示按天重置，避免玩家在远征时被同一句话刷屏。
  GUIDE_COOLDOWN_SEC: 18,
  GUIDE: Object.freeze({
    dusk: '天快黑了 · 该回营了',
    noStore: '先在这里建储物箱',
    noLight: '先点一盏灯',
    noFood: '当地没食物 · 先补给',
    noFuel: '当地没燃料 · 先补给',
    noRoom: '当地仓库已满 · 先清空',
    lowHp: '生命偏低 · 先回营',
    ready: '前哨条件满足 · 可派人',
  }),
  // G3 开发回放的远征边界。正式玩法不读取这里的阈值，仍保持自由探索。
  REPLAY: Object.freeze({
    DEPART_T: 160,
    RETURN_T: 260,
    FOOD_FLOOR: 4,
    FUEL_FLOOR: 6,
    EXPLORE_INTERVAL_SEC: 18,
    MAX_REMOTE_CHUNKS: 1,
  }),
  REPORT_SCHEMA: Object.freeze([
    'current', 'discoveredChunks', 'persistentChunks', 'activeChunks',
    'pack', 'kit', 'local', 'outpost', 'returnHint', 'status',
  ]),
});
