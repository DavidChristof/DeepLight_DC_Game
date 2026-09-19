// data/storage.js —— 存储（L2「容器化库存」）常量与资源表
//
// 设计（与用户确认过的规则）：
//   · 采到的材料【自动进入最近的容器】；本层所有容器都满 → 提示「存储已满」，**材料丢失**
//   · 不做搬运 AI：容器之间/跨层的移动由玩家在容器面板里手动搬（背包是跨层携带的唯一手段）
//   · 容量按「总单位」算（各种材料共用一格池子）—— 简单、可读、有压力

import { RES } from './palette.js';

export const STORE_CAP = 60;     // 储物箱（可建造，深渊里必须自带）
export const CAMP_CAP = 240;     // 营地篝火自带仓库（开局唯一容器）
export const PACK_CAP = 24;      // 玩家背包：只能手动装填，用来把材料带过层
// 满仓报警的滞回：自动化消耗偶尔腾出一格时，不把同一轮溢出拆成连续警报。
export const STORE_ALARM = Object.freeze({ CLEAR_AFTER_SECS: 4 });

// 资源顺序 / 名称 / 颜色（侧栏、容器面板、飘字共用）
// 注：工具（pick/axe/sickle/hammer/wand）也是「物品」—— 会占用容器格子，但不上材料栏，只出现在装备位与容器面板
// ⚠️ 这张 TOOL_ORDER 必须与 data/tools.js 的那张**一致**（两处各一份，检测器 hand.fire 会拦分家）
export const RES_ORDER = ['ore', 'vine', 'fuel', 'food', 'stone', 'coal', 'data', 'core', 'night'];
export const TOOL_ORDER = ['pick', 'axe', 'sickle', 'hammer', 'wand', 'repair'];
// 容器面板 / 搬运 / 入库的完整顺序（材料 + 工具）
export const STORE_ORDER = [...RES_ORDER, ...TOOL_ORDER];
export const RES_NAME = {
  ore: '辉髓', vine: '藤木', fuel: '燃料', food: '食物', stone: '石头', coal: '木炭',
  data: '档案', core: '母髓', night: '夜髓',
  pick: '石镐', axe: '石斧', sickle: '石镰', hammer: '石锤', wand: '辉光棒', repair: '修缮钳',
};
// 颜色统一从 data/palette.js 取（避免同一类东西三个色号）
export const RES_COLOR = RES;
