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

const V8_ENEMY_SRC = Object.freeze({
  bud: 'assets/sprites/v8/enemy_bud.png',
  shell: 'assets/sprites/v8/enemy_shell.png',
  core: 'assets/sprites/v8/enemy_core.png',
  charger: 'assets/sprites/v8/enemy_charger.png',
  bomber: 'assets/sprites/v8/enemy_bomber.png',
  moth: 'assets/sprites/v8/enemy_moth.png',
  owl: 'assets/sprites/v8/enemy_owl.png',
  blind: 'assets/sprites/v8/enemy_blind.png',
  spitter: 'assets/sprites/v8/enemy_spitter.png',
  warden: 'assets/sprites/v8/enemy_warden.png',
});

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

  // —— W19-V：32×48 模块化人物（素材未到时由 render.js 的 V8 程序化回退绘制）——
  // 四帧顺序固定为 down / left / right / up；src 为空表示“等待素材”，不会产生缺图报警。
  { key: 'v8_human_legs', kind: 'spritesheet', src: 'assets/sprites/v8/human_legs.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'legs', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: 'V8 人物腿部层' },
  { key: 'v8_human_face', kind: 'spritesheet', src: 'assets/sprites/v8/human_face.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'face', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: 'V8 人物面部层' },
  { key: 'v8_human_hair', kind: 'spritesheet', src: 'assets/sprites/v8/human_hair.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'hair', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: 'V8 人物头发层' },
  { key: 'v8_human_torso', kind: 'spritesheet', src: 'assets/sprites/v8/human_torso.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'torso', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: 'V8 人物躯干层' },
  { key: 'v8_human_gear', kind: 'spritesheet', src: 'assets/sprites/v8/human_gear.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'gear', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: 'V8 人物工具/背包层' },
  // 玩家默认外观：只替换头部、头发与躯干；腿、工具和背包暂继续使用稳定的程序化层。
  { key: 'v8_player_default_face', kind: 'spritesheet', src: 'assets/sprites/v8/player_default_face_v1.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'playerFace', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: '默认男性探险者头部与面部' },
  { key: 'v8_player_default_hair', kind: 'spritesheet', src: 'assets/sprites/v8/player_default_hair_v1.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'playerHair', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: '默认男性探险者头发' },
  { key: 'v8_player_default_torso', kind: 'spritesheet', src: 'assets/sprites/v8/player_default_torso_v1.png', pxW: 128, pxH: 48, frameW: 32, frameH: 48, frames: ['down', 'left', 'right', 'up'], layer: 'playerTorso', emissive: false, anchor: { x: 16, y: 44 }, fallback: 'procedural.humanV8', note: '默认男性探险者躯干' },
  // 早期整身样板保留作素材回退与对照，不再作为默认玩家显示。
  { key: 'v8_player_default_full', kind: 'spritesheet', src: 'assets/sprites/v8/player_default_full_v2.png', pxW: 256, pxH: 80, frameW: 64, frameH: 80, frames: ['down', 'left', 'right', 'up'], layer: 'playerFull', emissive: false, anchor: { x: 32, y: 76 }, fallback: 'procedural.humanV8', note: '默认男性探险者整身四向样板' },
  // 默认玩家采用一体化长斗篷小人；画面可越出 32×48，但逻辑格、碰撞和脚底坐标不变。
  { key: 'v8_player_pawn', kind: 'spritesheet', src: 'assets/sprites/v8/previews/player_colony_pawn_first_draft_concept.png', pxW: 1536, pxH: 1024, frameW: 512, frameH: 1024, sourceFrameCount: 3, sourceFrameMap: [0, 1, 1, 2], mirrorFrames: [false, true, false, false], sourceCrop: { x: 72, y: 160, w: 368, h: 736 }, renderW: 24, renderH: 48, renderAnchor: { x: 12, y: 41 }, frames: ['down', 'left', 'right', 'up'], layer: 'playerPawn', emissive: false, anchor: { x: 12, y: 41 }, fallback: 'procedural.humanV8', note: '第一稿三视图概念母版；原始侧脸朝右，左向使用镜像；先裁掉透明边，再经两阶段缩小为 24×48 像素缓存' },
  { key: 'v8_terrain_tundra', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_tundra.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 营地苔原样板' },
  { key: 'v8_terrain_tundra_moss', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_tundra_moss.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 营地苔原苔斑变体' },
  { key: 'v8_terrain_tundra_stones', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_tundra_stones.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 营地苔原碎石变体' },
  { key: 'v8_terrain_tundra_ridges', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_tundra_ridges.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 营地苔原纹理变体' },
  { key: 'v8_terrain_tundra_lichen', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_tundra_lichen.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 营地苔原地衣变体' },
  { key: 'v8_terrain_vineMist', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_vineMist.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 藤雾林地表样板' },
  { key: 'v8_terrain_vineMist_roots', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_vineMist_roots.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 藤雾林根系变体' },
  { key: 'v8_terrain_vineMist_mist', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_vineMist_mist.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 藤雾林湿痕变体' },
  { key: 'v8_terrain_vineMist_leaf', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_vineMist_leaf.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 藤雾林落叶变体' },
  { key: 'v8_terrain_vineMist_water', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_vineMist_water.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 藤雾林湿地变体' },
  { key: 'v8_terrain_shaleRise', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_shaleRise.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 碎岩台地地表样板' },
  { key: 'v8_terrain_shaleRise_strata', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_shaleRise_strata.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 碎岩台地层理变体' },
  { key: 'v8_terrain_shaleRise_chips', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_shaleRise_chips.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 碎岩台地砾片变体' },
  { key: 'v8_terrain_shaleRise_veins', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_shaleRise_veins.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 碎岩台地细脉变体' },
  { key: 'v8_terrain_shaleRise_iron', kind: 'terrainPatch', src: 'assets/sprites/v8/terrain_shaleRise_iron.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], logicalW: 2, logicalH: 2, layer: 'albedo', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.terrain', note: 'V8 碎岩台地铁尘变体' },
  { key: 'v8_node_rock', kind: 'image', src: 'assets/sprites/v8/node_rock.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'node', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.node', note: 'V8 岩壁资源节点' },
  { key: 'v8_node_ore', kind: 'image', src: 'assets/sprites/v8/node_ore.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'node', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.node', note: 'V8 辉髓资源节点' },
  { key: 'v8_node_vine', kind: 'image', src: 'assets/sprites/v8/node_vine.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'node', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.node', note: 'V8 藤木资源节点' },
  { key: 'v8_node_relic', kind: 'image', src: 'assets/sprites/v8/node_relic.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'node', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.node', note: 'V8 遗迹资源节点' },
  { key: 'v8_node_mother', kind: 'image', src: 'assets/sprites/v8/node_mother.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'node', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.node', note: 'V8 母脉资源节点' },
  { key: 'v8_blight', kind: 'image', src: 'assets/sprites/v8/blight.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'hazard', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.blight', note: 'V8 蚀痕地块静态主体' },
  { key: 'v8_vent', kind: 'image', src: 'assets/sprites/v8/vent.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'hazard', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.vent', note: 'V8 潮穴静态主体' },
  { key: 'v8_campfire', kind: 'image', src: 'assets/sprites/v8/campfire.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: true, anchor: { x: 16, y: 32 }, fallback: 'procedural.beacon', note: 'V8 营地篝火样板' },
  { key: 'v8_lamp', kind: 'image', src: 'assets/sprites/v8/lamp.png', pxW: 32, pxH: 48, frameW: 32, frameH: 48, frames: ['default'], layer: 'building', emissive: true, anchor: { x: 16, y: 48 }, fallback: 'procedural.lamp', note: 'V8 灯柱样板' },
  { key: 'v8_store', kind: 'image', src: 'assets/sprites/v8/store.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.store', note: 'V8 储物箱样板' },
  { key: 'v8_bench', kind: 'image', src: 'assets/sprites/v8/bench.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.station', note: 'V8 制造台样板' },
  { key: 'v8_furnace', kind: 'image', src: 'assets/sprites/v8/furnace.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.station', note: 'V8 熔炉样板' },
  { key: 'v8_smelter', kind: 'image', src: 'assets/sprites/v8/smelter.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.station', note: 'V8 自动熔炉样板' },
  { key: 'v8_clinic', kind: 'image', src: 'assets/sprites/v8/clinic.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.station', note: 'V8 医疗站样板' },
  { key: 'v8_analyzer', kind: 'image', src: 'assets/sprites/v8/analyzer.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.station', note: 'V8 解析台样板' },
  { key: 'v8_resonanceBeacon', kind: 'image', src: null, pending: true, pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.resonanceBeacon', note: '首座共鸣信标程序化绘制' },
  { key: 'v8_bunk', kind: 'image', src: 'assets/sprites/v8/bunk.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.bunk', note: 'V8 铺位样板' },
  { key: 'v8_purifier', kind: 'image', src: 'assets/sprites/v8/purifier.png', pxW: 32, pxH: 48, frameW: 32, frameH: 48, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 48 }, fallback: 'procedural.purifier', note: 'V8 净光柱样板' },
  { key: 'v8_towerGlow', kind: 'image', src: 'assets/sprites/v8/towerGlow.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.tower', note: 'V8 辉光塔样板' },
  { key: 'v8_prism', kind: 'image', src: 'assets/sprites/v8/prism.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.prism', note: 'V8 棱镜样板' },
  { key: 'v8_prismGun', kind: 'image', src: 'assets/sprites/v8/prismGun.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.prismGun', note: 'V8 光路炮样板' },
  { key: 'v8_wall', kind: 'image', src: 'assets/sprites/v8/wall.png', pxW: 32, pxH: 16, frameW: 32, frameH: 16, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 16 }, fallback: 'procedural.wall', note: 'V8 木墙样板' },
  { key: 'v8_stoneWall', kind: 'image', src: 'assets/sprites/v8/stoneWall.png', pxW: 32, pxH: 16, frameW: 32, frameH: 16, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 16 }, fallback: 'procedural.wall', note: 'V8 石墙样板' },
  { key: 'v8_gate', kind: 'image', src: 'assets/sprites/v8/gate.png', pxW: 32, pxH: 16, frameW: 32, frameH: 16, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 16 }, fallback: 'procedural.gate', note: 'V8 栅门样板' },
  { key: 'v8_farm', kind: 'image', src: 'assets/sprites/v8/farm.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.farm', note: 'V8 农田样板' },
  { key: 'v8_mycobed', kind: 'image', src: 'assets/sprites/v8/mycobed.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.farm', note: 'V8 菌床样板' },
  { key: 'v8_shaft', kind: 'image', src: 'assets/sprites/v8/shaft.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.shaft', note: 'V8 深潜竖井样板' },
  { key: 'v8_towerShock', kind: 'image', src: 'assets/sprites/v8/towerShock.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.tower', note: 'V8 震击塔样板' },
  { key: 'v8_towerChain', kind: 'image', src: 'assets/sprites/v8/towerChain.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.tower', note: 'V8 连锁塔样板' },
  { key: 'v8_decoy', kind: 'image', src: 'assets/sprites/v8/decoy.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.decoy', note: 'V8 诱饵灯样板' },
  { key: 'v8_cache', kind: 'image', src: 'assets/sprites/v8/cache.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.cache', note: 'V8 补给缓存样板' },
  { key: 'v8_barricade', kind: 'image', src: 'assets/sprites/v8/barricade.png', pxW: 32, pxH: 16, frameW: 32, frameH: 16, frames: ['default'], layer: 'building', emissive: false, anchor: { x: 16, y: 16 }, fallback: 'procedural.barricade', note: 'V8 路障样板' },
  { key: 'v8_decor_tundra', kind: 'image', src: 'assets/sprites/v8/decor_tundra.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 苔原碎石装饰' },
  { key: 'v8_decor_tundra_cairn', kind: 'image', src: 'assets/sprites/v8/decor_tundra_cairn.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 苔原石堆变体' },
  { key: 'v8_decor_tundra_ice', kind: 'image', src: 'assets/sprites/v8/decor_tundra_ice.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 苔原冰晶变体' },
  { key: 'v8_decor_tundra_reeds', kind: 'image', src: 'assets/sprites/v8/decor_tundra_reeds.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 苔原霜苇装饰' },
  { key: 'v8_decor_vine', kind: 'image', src: 'assets/sprites/v8/decor_vine.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 藤雾林藤蔓装饰' },
  { key: 'v8_decor_vine_fern', kind: 'image', src: 'assets/sprites/v8/decor_vine_fern.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 藤雾林蕨叶变体' },
  { key: 'v8_decor_vine_mushroom', kind: 'image', src: 'assets/sprites/v8/decor_vine_mushroom.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 藤雾林菌根变体' },
  { key: 'v8_decor_vine_roots', kind: 'image', src: 'assets/sprites/v8/decor_vine_roots.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 藤雾林卷根装饰' },
  { key: 'v8_decor_shale', kind: 'image', src: 'assets/sprites/v8/decor_shale.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 碎岩台地碎岩装饰' },
  { key: 'v8_decor_shale_slab', kind: 'image', src: 'assets/sprites/v8/decor_shale_slab.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 碎岩台地板岩变体' },
  { key: 'v8_decor_shale_pebbles', kind: 'image', src: 'assets/sprites/v8/decor_shale_pebbles.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 碎岩台地砾石变体' },
  { key: 'v8_decor_shale_ironchip', kind: 'image', src: 'assets/sprites/v8/decor_shale_ironchip.png', pxW: 32, pxH: 32, frameW: 32, frameH: 32, frames: ['default'], layer: 'terrainDecor', emissive: false, anchor: { x: 16, y: 32 }, fallback: 'procedural.biomeDecor', note: 'V8 碎岩台地铁屑装饰' },
  // V8-4：蚀兽独立图像；任一文件加载失败时由 drawCreatureV8 提供可玩的剪影回退。
  ...['bud', 'charger', 'shell', 'bomber', 'moth', 'spitter', 'owl', 'blind', 'warden', 'core'].map((kind) => ({
    key: `v8_enemy_${kind}`, kind: 'image', src: V8_ENEMY_SRC[kind] || null, ...(V8_ENEMY_SRC[kind] ? {} : { pending: true }), pxW: 48, pxH: 48, frameW: 48, frameH: 48, frames: ['default'],
    layer: 'creature', emissive: false, anchor: { x: 24, y: 24 }, fallback: 'procedural.creatureV8', note: `V8 ${kind} 蚀兽样板`,
  })),
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
