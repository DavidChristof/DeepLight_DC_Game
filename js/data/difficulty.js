// data/difficulty.js —— 难度预设（影响波次密度/血量、拓荒者消耗、初始物资）
export const DIFFICULTY = {
  calm: {
    name: '安逸', tag: '适合先熟悉玩法',
    desc: '蚀潮稀疏、Boss 较虚弱、拓荒者吃得少，开局物资充足',
    waveMul: 1.4,        // 出怪间隔倍率（越大越稀疏）
    capMul: 0.75,        // 场上蚀兽上限倍率
    bossHpMul: 0.8,
    hungerMul: 0.65,     // 拓荒者饥饿速度
    blightMul: 1.35,     // 蚀痕累积所需时间（越大越慢）
    start: { ore: 12, vine: 12, fuel: 6, food: 10 },
    startWorkers: 3,
  },
  normal: {
    name: '标准', tag: '推荐',
    desc: '设计基准：7 天一次大潮，拓荒者需要食物与光照',
    waveMul: 1, capMul: 1, bossHpMul: 1, hungerMul: 1, blightMul: 1,
    start: { ore: 4, vine: 4, fuel: 2, food: 6 },
    startWorkers: 2,
  },
  harsh: {
    name: '严酷', tag: '给老拓荒者',
    desc: '蚀潮密集、Boss 更强、拓荒者饥饿更快，开局几乎一无所有',
    waveMul: 0.72, capMul: 1.35, bossHpMul: 1.3, hungerMul: 1.4, blightMul: 0.78,
    start: { ore: 0, vine: 0, fuel: 0, food: 3 },
    startWorkers: 2,
  },
};
export const DIFF_ORDER = ['calm', 'normal', 'harsh'];
