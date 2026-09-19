// data/sprites.js —— 素材登记表（W13-F）
//
// 这里是「游戏里用到的每一个 AI 素材」的唯一清单：
//   key    = 代码里引用的名字（逻辑只认它）
//   kind   = 'image' 常态（暂时只有图片类；将来加 spritesheet 时扩）
//   src    = 文件路径（**文件不存在也没关系**：自动回退到程序绘制/SVG）
//   pxW/pxH= 交付尺寸（写在这里是为了对齐 assets/PROMPTS.md 的提示词）
//   sheet  = 可选，精灵表 [列, 行]；单图不写
//
// 你只需要按 key 对应的文件名把 PNG 丢进 assets/sprites/，刷新即生效。

import { register } from '../core/assets.js';

export const SPRITES = [
  // —— 主菜单 ——
  { key: 'title_art', kind: 'image', src: 'assets/sprites/title_art.png', pxW: 960, pxH: 540,
    note: '主菜单背景插画：灯塔 × 蚀潮' },

  // —— 图鉴：蚀兽（9 + Boss）——
  //   注：第 3 步的 4 种新蚀兽没有图时自动回退到程序绘制（缺图是正常状态），
  //   想补图就按 key 的名字把 PNG 丢进 assets/sprites/（提示词格式见 assets/PROMPTS.md）
  { key: 'codex_bud', kind: 'image', src: 'assets/sprites/codex_bud.svg', pxW: 96, pxH: 96, note: '蚀芽' },
  { key: 'codex_shell', kind: 'image', src: 'assets/sprites/codex_shell.svg', pxW: 96, pxH: 96, note: '蚀壳' },
  { key: 'codex_moth', kind: 'image', src: 'assets/sprites/codex_moth.svg', pxW: 96, pxH: 96, note: '噬光虫' },
  { key: 'codex_owl', kind: 'image', src: 'assets/sprites/codex_owl.svg', pxW: 96, pxH: 96, note: '夜枭' },
  { key: 'codex_blind', kind: 'image', src: 'assets/sprites/codex_blind.svg', pxW: 96, pxH: 96, note: '盲蚀兽' },
  { key: 'codex_spitter', kind: 'image', src: 'assets/sprites/codex_spitter.svg', pxW: 96, pxH: 96, note: '吐蚀蛾（第 3 步）' },
  { key: 'codex_charger', kind: 'image', src: 'assets/sprites/codex_charger.svg', pxW: 96, pxH: 96, note: '冲锋芽（第 3 步）' },
  { key: 'codex_bomber', kind: 'image', src: 'assets/sprites/codex_bomber.svg', pxW: 96, pxH: 96, note: '自爆壳（第 3 步）' },
  { key: 'codex_warden', kind: 'image', src: 'assets/sprites/codex_warden.svg', pxW: 96, pxH: 96, note: '庇护兽（第 3 步）' },
  { key: 'codex_core', kind: 'image', src: 'assets/sprites/codex_core.svg', pxW: 96, pxH: 96, note: '蚀巢核心（Boss）' },

  // —— 拓荒者半身像：按「专长」映射（随机抽到的专长决定用哪张）——
  { key: 'colonist_miner', kind: 'image', src: 'assets/sprites/colonist_miner.svg', pxW: 128, pxH: 128, note: '矿工' },
  { key: 'colonist_farmer', kind: 'image', src: 'assets/sprites/colonist_farmer.svg', pxW: 128, pxH: 128, note: '农人' },
  { key: 'colonist_nightwatch', kind: 'image', src: 'assets/sprites/colonist_nightwatch.svg', pxW: 128, pxH: 128, note: '守夜人' },
  { key: 'colonist_tinker', kind: 'image', src: 'assets/sprites/colonist_tinker.svg', pxW: 128, pxH: 128, note: '技师' },
  { key: 'colonist_scholar', kind: 'image', src: 'assets/sprites/colonist_scholar.svg', pxW: 128, pxH: 128, note: '学者' },
  { key: 'colonist_fallback', kind: 'image', src: 'assets/sprites/colonist_fallback.svg', pxW: 128, pxH: 128, note: '通用拓荒者（没抽到上面专长时用）' },
];

// 蚀兽 key → 图鉴素材 key
export const CODEX_ART = {
  bud: 'codex_bud', shell: 'codex_shell', moth: 'codex_moth',
  owl: 'codex_owl', blind: 'codex_blind', core: 'codex_core',
  spitter: 'codex_spitter', charger: 'codex_charger', bomber: 'codex_bomber', warden: 'codex_warden',
};
// 专长 key → 半身像素材 key
export const PORTRAIT_BY_TRAIT = {
  miner: 'colonist_miner', farmer: 'colonist_farmer', nightwatch: 'colonist_nightwatch',
  tinker: 'colonist_tinker', scholar: 'colonist_scholar',
};

export function registerSprites() {
  for (const s of SPRITES) register(s);
  return SPRITES.length;
}
