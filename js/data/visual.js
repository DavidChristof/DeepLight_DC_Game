// data/visual.js —— W16-E 视觉与交互重制的唯一规格表
import { UI, STATE, CAT, contrast } from './palette.js';

// W19-V：视觉重制契约。
// 逻辑格仍是 16px；V8 素材可以跨越多个逻辑格，但不改变碰撞、寻路或光照网格。
export const VISUAL = Object.freeze({
  version: 2,
  artVersion: 'v8',
  themes: Object.freeze(['legacy', 'v8-preview', 'v8']),
  defaultTheme: 'v8-preview',
  pixel: Object.freeze({
    tile: 16,
    human: 24,
    humanV8: Object.freeze({ w: 32, h: 48, frameW: 32, frameH: 48, frames: Object.freeze(['down', 'left', 'right', 'up']) }),
    terrainPatch: Object.freeze({ w: 32, h: 32, logicalW: 2, logicalH: 2 }),
    creatureMin: 24,
    creatureMax: 48,
    building: 32,
    icon: 16,
  }),
  anchors: Object.freeze({ humanFootY: 44, humanCenterX: 16, buildingBaseY: 32 }),
  layers: Object.freeze(['legs', 'face', 'hair', 'torso', 'gear']),
  humanArt: Object.freeze({ legs: 'v8_human_legs', face: 'v8_human_face', hair: 'v8_human_hair', torso: 'v8_human_torso', gear: 'v8_human_gear' }),
  playerLayers: Object.freeze(['face', 'hair', 'torso']),
  playerHumanArt: Object.freeze({ face: 'v8_player_default_face', hair: 'v8_player_default_hair', torso: 'v8_player_default_torso' }),
  playerFullArt: 'v8_player_pawn',
  // 当前阶段玩家与拓荒者共用同一套整体人物模板；职业、姓名、血条和任务标记仍由各自 HUD 表达。
  humanFullArt: 'v8_player_pawn',
  materialRules: Object.freeze({ dynamicLight: true, bakedGlow: false, bakedShadow: false, transparentSprites: true, terrainCoverage: 'all-surface-blocks' }),
  buildingArt: Object.freeze({
    lamp: 'v8_lamp', wall: 'v8_wall', stoneWall: 'v8_stoneWall', gate: 'v8_gate', barricade: 'v8_barricade',
    furnace: 'v8_furnace', towerGlow: 'v8_towerGlow', towerShock: 'v8_towerShock', towerChain: 'v8_towerChain',
    shaft: 'v8_shaft', farm: 'v8_farm', mycobed: 'v8_mycobed', bunk: 'v8_bunk', clinic: 'v8_clinic',
    purifier: 'v8_purifier', cache: 'v8_cache', prism: 'v8_prism', prismGun: 'v8_prismGun', decoy: 'v8_decoy',
    store: 'v8_store', bench: 'v8_bench', smelter: 'v8_smelter', analyzer: 'v8_analyzer', resonanceBeacon: 'v8_resonanceBeacon',
  }),
  blightArt: Object.freeze({
    base: Object.freeze([42, 18, 58]), crack: Object.freeze([121, 65, 163]), crystal: Object.freeze([196, 124, 238]),
    pulse: Object.freeze([228, 167, 255]), border: Object.freeze([236, 170, 255]), maxStage: 3,
    spriteKey: 'v8_blight',
  }),
  ventArt: Object.freeze({
    base: Object.freeze([22, 12, 31]), crack: Object.freeze([140, 92, 172]), hot: Object.freeze([255, 174, 222]),
    pulse: Object.freeze([255, 170, 224]), maxBurst: 1,
    spriteKey: 'v8_vent',
  }),
  biomeArt: Object.freeze({
    // 地衣是局部装饰，不可作为整块 32px 底图随机替换；否则会形成误导性的亮色棋盘格。
    tundra: Object.freeze({ base: Object.freeze([52, 72, 68]), detail: Object.freeze([150, 232, 190]), accent: 'rgba(150,232,190,0.10)', shadow: 'rgba(10,22,28,0.14)', motif: 'moss', edge: Object.freeze({ stroke: 'rgba(22,31,38,0.42)', highlight: 'rgba(174,196,184,0.22)', width: 1.25, accentRate: 0.25 }), terrainKey: 'v8_terrain_tundra', terrainKeys: Object.freeze(['v8_terrain_tundra', 'v8_terrain_tundra_moss', 'v8_terrain_tundra_stones', 'v8_terrain_tundra_ridges']), decorKey: 'v8_decor_tundra', decorKeys: Object.freeze(['v8_decor_tundra', 'v8_decor_tundra_cairn', 'v8_decor_tundra_ice', 'v8_decor_tundra_reeds']), decorRate: 0.18 }),
    vineMist: Object.freeze({ base: Object.freeze([46, 80, 62]), detail: Object.freeze([142, 198, 150]), accent: 'rgba(142,198,150,0.14)', shadow: 'rgba(24,52,38,0.16)', motif: 'mistVine', edge: Object.freeze({ stroke: 'rgba(16,45,34,0.42)', highlight: 'rgba(142,198,150,0.14)', width: 1.25, accentRate: 0.25 }), terrainKey: 'v8_terrain_vineMist', terrainKeys: Object.freeze(['v8_terrain_vineMist', 'v8_terrain_vineMist_roots', 'v8_terrain_vineMist_mist', 'v8_terrain_vineMist_leaf', 'v8_terrain_vineMist_water']), decorKey: 'v8_decor_vine', decorKeys: Object.freeze(['v8_decor_vine', 'v8_decor_vine_fern', 'v8_decor_vine_mushroom', 'v8_decor_vine_roots']), decorRate: 0.26 }),
    shaleRise: Object.freeze({ base: Object.freeze([76, 70, 72]), detail: Object.freeze([214,177,132]), accent: 'rgba(214,177,132,0.14)', shadow: 'rgba(30,28,38,0.18)', motif: 'shaleCrack', edge: Object.freeze({ stroke: 'rgba(17,25,36,0.48)', highlight: 'rgba(190,132,94,0.28)', width: 1.25, accentRate: 0.25 }), terrainKey: 'v8_terrain_shaleRise', terrainKeys: Object.freeze(['v8_terrain_shaleRise', 'v8_terrain_shaleRise_strata', 'v8_terrain_shaleRise_chips', 'v8_terrain_shaleRise_veins', 'v8_terrain_shaleRise_iron']), decorKey: 'v8_decor_shale', decorKeys: Object.freeze(['v8_decor_shale', 'v8_decor_shale_slab', 'v8_decor_shale_pebbles', 'v8_decor_shale_ironchip']), decorRate: 0.22 }),
  }),
  enemyArt: Object.freeze({
    bud: Object.freeze({ mark: '#d7f5cb', eye: '#263449', spriteKey: 'v8_enemy_bud' }),
    charger: Object.freeze({ mark: '#ffe1a3', eye: '#342a2a', spriteKey: 'v8_enemy_charger' }),
    shell: Object.freeze({ mark: 'rgba(240,220,190,0.52)', eye: '#2b2730', spriteKey: 'v8_enemy_shell' }),
    bomber: Object.freeze({ mark: 'rgba(240,220,190,0.52)', core: '#ffbd68', eye: '#2b2730', spriteKey: 'v8_enemy_bomber' }),
    moth: Object.freeze({ mark: '#e4d8b0', core: '#c7b1ec', eye: '#292636', spriteKey: 'v8_enemy_moth' }),
    spitter: Object.freeze({ mark: '#e4d8b0', core: '#b8eece', eye: '#292636', spriteKey: 'v8_enemy_spitter' }),
    owl: Object.freeze({ mark: '#e4d8b0', eye: '#1b1d28', spriteKey: 'v8_enemy_owl' }),
    blind: Object.freeze({ mark: '#c9a0a8', eye: '#251d2a', spriteKey: 'v8_enemy_blind' }),
    warden: Object.freeze({ mark: 'rgba(240,220,190,0.52)', core: '#d8c6ff', eye: '#2b2730', spriteKey: 'v8_enemy_warden' }),
    core: Object.freeze({ mark: '#f0d5ff', core: '#ffe8a8', eye: '#251d2a', spriteKey: 'v8_enemy_core' }),
  }),
  nodeArt: Object.freeze({
    rock: Object.freeze({ base: '#45505e', detail: 'rgba(198,210,220,0.28)', hi: 'rgba(178,189,201,0.30)', shadow: 'rgba(15,20,28,0.45)', spriteKey: 'v8_node_rock' }),
    ore: Object.freeze({ base: '#263d43', detail: '#3e9f9d', hi: '#8ce4c8', shadow: '#58c6b4', spriteKey: 'v8_node_ore' }),
    vine: Object.freeze({ base: '#594936', detail: '#94764b', hi: '#b7aa72', shadow: '#78875a', spriteKey: 'v8_node_vine' }),
    relic: Object.freeze({ base: '#514661', detail: '#786a91', hi: '#c7a9ef', shadow: 'rgba(0,0,0,0.30)', spriteKey: 'v8_node_relic' }),
    mother: Object.freeze({ base: '#5b462d', detail: '#c18d3e', hi: '#ffe09a', shadow: 'rgba(0,0,0,0.28)', spriteKey: 'v8_node_mother' }),
  }),
  ui: Object.freeze({ panelMin: 280, panelMax: 440, radius: 6, gap: 8, focusWidth: 2 }),
  colonist: Object.freeze({ amber: '#f1c76b', moss: '#9ed89e', blue: '#9ac6ef', copper: '#e5a981', violet: '#c7a9ef', rose: '#f2a9c4', fallback: '#d4e3ff' }),
  contrastMin: 4.5,
  semantic: Object.freeze({ UI, STATE, CAT }),
});

// 世界材质色：低饱和底材 + 少量高亮资源，避免紫/绿同时铺满画面。
export const WORLD = Object.freeze({
  dark: Object.freeze([5, 6, 10]),
  floor: Object.freeze([52, 72, 68]),
  rock: Object.freeze([92, 98, 112]),
  oreGround: Object.freeze([56, 116, 108]),
  ore: Object.freeze([132, 220, 198]),
  lava: Object.freeze([236, 102, 54]),
  vine: Object.freeze([156, 126, 74]),
  relicGround: Object.freeze([100, 86, 128]),
  relic: Object.freeze([188, 158, 224]),
  motherGround: Object.freeze([142, 112, 56]),
  mother: Object.freeze([248, 204, 104]),
});

export function visualSpec() {
  const colors = Object.entries(UI).map(([name, color]) => {
    const ratio = contrast(color);
    // bg/panel 是结构底色，不作为文字色验收；其余语义色必须能独立承载信息。
    const structural = name === 'bg' || name === 'panel';
    return { name, color, contrast: +ratio.toFixed(2), pass: structural || ratio >= VISUAL.contrastMin };
  });
  return {
    version: VISUAL.version,
    artVersion: VISUAL.artVersion,
    themes: [...VISUAL.themes],
    defaultTheme: VISUAL.defaultTheme,
    pixel: { ...VISUAL.pixel },
    humanV8: { ...VISUAL.pixel.humanV8, frames: [...VISUAL.pixel.humanV8.frames] },
    terrainPatch: { ...VISUAL.pixel.terrainPatch },
    anchors: { ...VISUAL.anchors },
    layers: [...VISUAL.layers],
    humanArt: { ...VISUAL.humanArt },
    playerLayers: [...VISUAL.playerLayers],
    playerHumanArt: { ...VISUAL.playerHumanArt },
    playerFullArt: VISUAL.playerFullArt,
    humanFullArt: VISUAL.humanFullArt,
    materialRules: { ...VISUAL.materialRules },
    buildingArt: { ...VISUAL.buildingArt },
    blightArt: { ...VISUAL.blightArt },
    ventArt: { ...VISUAL.ventArt },
    biomeArt: Object.fromEntries(Object.entries(VISUAL.biomeArt).map(([k, v]) => [k, { ...v }])),
    enemyArt: Object.fromEntries(Object.entries(VISUAL.enemyArt).map(([k, v]) => [k, { ...v }])),
    nodeArt: Object.fromEntries(Object.entries(VISUAL.nodeArt).map(([k, v]) => [k, { ...v }])),
    ui: { ...VISUAL.ui },
    world: Object.fromEntries(Object.entries(WORLD).map(([k, v]) => [k, [...v]])),
    colonist: { ...VISUAL.colonist },
    contrastMin: VISUAL.contrastMin,
    colors,
    semantic: {
      ui: Object.keys(UI).length,
      state: Object.keys(STATE).length,
      categories: Object.keys(CAT).length,
    },
  };
}
