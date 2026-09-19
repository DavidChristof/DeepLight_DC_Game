// data/nodes.js —— 资源节点的「初始剩余量」唯一数据源（B13 修复）
//
// 为什么单独一个文件：以前这个数字有两份 ——
//   · world/gen.js 地表写死 5/4/3，深层写死 7/4/3/4
//   · systems/interact.js 又自己写了一份 NODE_AMT（5/4/3/4）
// 于是「深层矿脉更富」只在生成器里成立：任何**懒初始化**（nodeAmt 还是 0 时第一次采集）
// 都会退回地表量 5。两份表各说各话就是这类"看起来对、数值偶尔不对"的温床。
//
// 现在：生成器与交互都读这里，改一个数字只改这一处。
import { T } from '../world/map.js';
import { ROCK_AMT } from './tools.js';

// 生成期会写入初值的地形（**不含岩壁**：岩壁保持 0，代表"还没开凿"）
// 岩壁一旦被写上限值，工人（worker.js 判定 `tile===ROCK && nodeAmt>0`）就会把它当成可采目标 ——
// 那是行为改变，不是数据整理。所以两张表必须分开：生成期表 / 懒初始化表。
export const NODE_AMT = {
  [T.ORE]: 5,
  [T.VINE]: 4,
  [T.RELIC]: 3,
  [T.MOTHER]: 4,
};

// 深潜层（depth1/2/3）：矿脉更富 —— 目前只有矿石与地表不同，是**有意的**设计
export const NODE_DEEP = {
  [T.ORE]: 7,
};

// 岩壁：生成期不给初值（=0），第一次开凿时懒初始化到这个数
export const ROCK_START = ROCK_AMT;

// 生成期初值（生成器用）
export const nodeStart = (tile, deep) => ((deep && NODE_DEEP[tile]) || NODE_AMT[tile] || 0);

// 懒初始化回退值（交互用）：nodeAmt 还是 0 时第一次采集该填多少
export const nodeFallback = (tile) => NODE_AMT[tile] || (tile === T.ROCK ? ROCK_START : 1);

// 该地形可能出现的最大量（检测器与上限判定用）
export const nodeMax = (tile) => Math.max(NODE_AMT[tile] || 0, NODE_DEEP[tile] || 0, tile === T.ROCK ? ROCK_START : 0);
