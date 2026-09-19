// ui/icons.js —— 一套 inline SVG 图标（W13-E）
//
// 规矩：
//   · 16×16 视觉框、1.5 描边、单色 currentColor（颜色交给 CSS/调用方）
//   · **不引外部文件、不引图标库**：字符串直接插进 innerHTML（本项目零构建）
//   · 图标只用来「加一个形状维度」——状态永远是 颜色 + 图标 双编码
//
// 用法：icon('ore') / icon('lamp', 18) / iconOf('busy')…
// CSS：.ic { vertical-align: -2px } 让它在行内跟文字对齐

const SVG = (body, sw = 1.5) =>
  `<svg class="ic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"`
  + ` stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // —— 材料 ——
  ore: SVG('<path d="M8 1.6 11.4 7 8 14.4 4.6 7Z"/><path d="M4.6 7h6.8"/>'),
  vine: SVG('<path d="M2.6 5.4h10.8v5.2H2.6Z"/><path d="M5.4 5.4v5.2M10.6 5.4v5.2"/><path d="M2.6 8h10.8"/>'),
  stone: SVG('<path d="M3 10.2 5.2 4.8 11 4 13.4 9.4 8.8 12.6Z"/><path d="M5.2 4.8 8.8 12.6"/>'),
  coal: SVG('<path d="M4 11.4 5.6 5.6 10.6 4.4 12.2 10 8.4 12.4Z"/><path d="M6.4 8.2h3.2"/>'),
  fuel: SVG('<path d="M8 2.2c2 2.4 3.4 4.2 3.4 6.2A3.4 3.4 0 0 1 8 11.8a3.4 3.4 0 0 1-3.4-3.4c0-2 1.4-3.8 3.4-6.2Z"/><path d="M8 13.6v.6"/>'),
  food: SVG('<path d="M2.8 8.4a5.2 3.6 0 0 1 10.4 0Z"/><path d="M6.6 8.4v4.4h2.8V8.4"/><path d="M8 3.4v1.2"/>'),
  data: SVG('<path d="M4 2.2h5l3 3v8.6H4Z"/><path d="M9 2.2v3h3"/><path d="M6 9h4M6 11.2h4"/>'),
  core: SVG('<path d="M8 2 13 5v6l-5 3-5-3V5Z"/><circle cx="8" cy="8" r="2"/>'),
  night: SVG('<path d="M10.4 2.4a5.6 5.6 0 1 0 0 11.2 6.4 6.4 0 0 1 0-11.2Z"/><path d="M12.6 5.2l.9-.9M13.4 8h1.2"/>'),

  // —— 工具 ——
  pick: SVG('<path d="M4.2 13.4 10.6 7"/><path d="M6.6 2.6a6.6 6.6 0 0 1 6.8 6.8"/>'),
  axe: SVG('<path d="M4.4 13.6 9.8 8.2"/><path d="M8.6 3.2c1.8-.6 3.8-.2 5 1s1.6 3.2 1 5L9.4 7Z"/>'),
  sickle: SVG('<path d="M3 12.8c6 .6 9.6-2.4 10-8.2"/><path d="M3 12.8h.9"/>'),
  hammer: SVG('<path d="M3.6 13.4 8 9"/><path d="M7 3.4l5.6 5.6-2 2L5 5.4Z"/>'),
  wand: SVG('<path d="M4.6 13.4 9.2 8.8"/><circle cx="11.2" cy="6.8" r="2.2"/><path d="M11.2 1.6v1.3M11.2 10.7v1.3M6.4 6.8h1.3M14.7 6.8h1.3"/>'),

  // —— 状态与属性 ——
  hp: SVG('<path d="M8 13.4S2.4 10 2.4 6.4a2.8 2.8 0 0 1 5.6-1 2.8 2.8 0 0 1 5.6 1c0 3.6-5.6 7-5.6 7Z"/>'),
  hunger: SVG('<path d="M2.8 8.6h10.4a5.2 5.2 0 0 1-10.4 0Z"/><path d="M6.2 5.6c0-1.2 1-1.4 1-2.6"/><path d="M9.6 5.6c0-1.2 1-1.4 1-2.6"/>'),
  morale: SVG('<path d="M4 2.4v11.2"/><path d="M4 3.2h8.2l-1.8 2.8 1.8 2.8H4"/>'),
  sanity: SVG('<path d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8s-2.4 4.2-6.2 4.2S1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.6"/>'),
  storage: SVG('<path d="M2.6 5.6h10.8v7.2H2.6Z"/><path d="M2.6 8.4h10.8"/><path d="M6.4 8.4v1.6h3.2V8.4"/>'),
  blight: SVG('<path d="M8 1.8 10.4 6l3.4 1.6-3 2.2.4 3.8-3.2-2-3.2 2 .4-3.8-3-2.2L4.6 6Z"/>'),
  grave: SVG('<path d="M8 2.6c2.4 0 4 1.8 4 4v6.8H4V6.6c0-2.2 1.6-4 4-4Z"/><path d="M8 5.4v4.2M6.2 7.2h3.6"/>'),
  fire: SVG('<path d="M8 1.8c2.4 2.6 4.2 4.6 4.2 7.2A4.2 4.2 0 0 1 8 14.2a4.2 4.2 0 0 1-4.2-4.2C3.8 7 5.6 4.6 8 1.8Z"/><path d="M8 14.2c1.2-1 1.8-2 1.8-3.4 0-1.2-.8-2.2-1.8-3.4-1 1.2-1.8 2.2-1.8 3.4 0 1.4.6 2.4 1.8 3.4Z"/>'),
  light: SVG('<path d="M8 2.2v2M3.4 4.4l1.4 1.4M12.6 4.4l-1.4 1.4"/><circle cx="8" cy="8.6" r="3"/><path d="M6.4 12.6h3.2M7 14h2"/>'),
  tower: SVG('<path d="M4.4 13.6V5.4h7.2v8.2"/><path d="M3.4 5.4h9.2M4.4 5.4V3.2h2v2.2M9.6 5.4V3.2h2v2.2"/><path d="M7 8h2v2.6H7Z"/>'),
  prism: SVG('<path d="M8 2.4 13.6 12.6H2.4Z"/><path d="M8 6.2v3.2"/>'),
  farm: SVG('<path d="M3 12.6h10"/><path d="M8 12.6V7.4"/><path d="M4.6 12.6V9.2M11.4 12.6V9.2"/><path d="M6.6 5.4a2.4 2.4 0 0 1 2.8 0"/>'),
  wall: SVG('<path d="M2.4 4.4h11.2v7.2H2.4Z"/><path d="M2.4 7.6h11.2M6.8 4.4v3.2M9.6 7.6v4M5.2 7.6v4"/>'),
  shaft: SVG('<path d="M4.4 2.6v10.8M11.6 2.6v10.8"/><path d="M4.4 5.4h7.2M4.4 8.6h7.2M4.4 11.8h7.2"/>'),
  cache: SVG('<path d="M2.6 6.2 8 3.4l5.4 2.8v6L8 14.6l-5.4-2.8Z"/><path d="M2.6 6.2 8 9l5.4-2.8M8 9v5.6"/>'),
  bench: SVG('<path d="M2.4 6.6h11.2v2.2H2.4Z"/><path d="M4 8.8v4.6M12 8.8v4.6"/><path d="M6.6 4.6 8 6.2l2.4-3"/>'),
  analyzer: SVG('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.4 3.4"/><path d="M5.6 7h2.8M7 5.6v2.8"/>'),
  decoy: SVG('<path d="M8 2.6v3"/><circle cx="8" cy="8.4" r="3"/><path d="M2.6 12.4a7 7 0 0 1 10.8 0"/>'),
  purifier: SVG('<path d="M8 2v3.2M8 10.8V14"/><circle cx="8" cy="8" r="2.4"/><path d="M3.4 4.4 5 6M12.6 4.4 11 6M3.4 11.6 5 10M12.6 11.6 11 10"/>'),
  smelter: SVG('<path d="M3 9.6h10V13H3Z"/><path d="M4.6 9.6V6l3.4-2.4L11.4 6v3.6"/><path d="M8 6.6v1.8"/>'),
  shock: SVG('<path d="M4.6 13.4V5.6h6.8v7.8"/><path d="M6.2 4.4 8 1.8l1.8 2.6"/><path d="M2.6 8.6 1 8M14 8.6 12.6 8"/>'),
  glow: SVG('<path d="M8 6.6V1.8"/><path d="M4.6 4.4 6 2.4M11.4 4.4 10 2.4"/><path d="M3 13.4V9.4h10v4Z"/>'),
  chain: SVG('<path d="M6.6 1.8 3.2 8.4h3.4L5.6 14 12 6.6H8.4Z"/>'),   // 闪电：连锁光塔（2e）

  // —— 状态双编码（颜色之外的那个"形状"）——
  ok: SVG('<path d="M3 8.4 6.4 12 13 4.6"/>', 2),
  no: SVG('<path d="M4 4l8 8M12 4l-8 8"/>', 2),
  done: SVG('<path d="M2.6 8.6 5.6 11.6 11 4.4"/><path d="M13.4 4.4 7.6 13"/>', 1.8),
  lock: SVG('<path d="M4.6 7.2h6.8v6H4.6Z"/><path d="M6.2 7.2V5.4a1.8 1.8 0 0 1 3.6 0v1.8"/>'),
  know: SVG('<path d="M8 2 14 8l-6 6-6-6Z"/><circle cx="8" cy="8" r="1.4"/>'),
  warn: SVG('<path d="M8 2.4 14.4 13.6H1.6Z"/><path d="M8 6.4v3.2M8 11.6v.6"/>'),
  lockOpen: SVG('<path d="M4.6 7.2h6.8v6H4.6Z"/><path d="M6.2 7.2V5.4a1.8 1.8 0 0 1 3.4-.8"/>'),

  // —— 建造分类（面板 chip / 快捷栏）——
  catLight: SVG('<circle cx="8" cy="8" r="3"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4 4l1.1 1.1M10.9 10.9 12 12M12 4l-1.1 1.1M5.1 10.9 4 12"/>'),
  catStruct: SVG('<path d="M2.4 5h11.2v6H2.4Z"/><path d="M2.4 8h11.2M6.4 5v3M9.6 8v3"/>'),
  catProd: SVG('<path d="M4 12.4 7.4 9"/><path d="M6.4 4.2 12 9.8l-1.8 1.8L4.6 6Z"/>'),
  catDef: SVG('<path d="M8 2 13 4v4.4c0 2.6-2 4.6-5 5.6-3-1-5-3-5-5.6V4Z"/>'),
  catLogi: SVG('<path d="M2.6 5.4 8 2.6l5.4 2.8v5.2L8 13.4l-5.4-2.8Z"/><path d="M2.6 8.6 8 11.4l5.4-2.8"/>'),
};

// 建筑类型 → 图标
export const BUILD_ICON = {
  lamp: 'light', wall: 'wall', furnace: 'fire', towerGlow: 'glow', towerShock: 'shock', towerChain: 'chain',
  shaft: 'shaft', farm: 'farm', purifier: 'purifier', cache: 'cache', prism: 'prism',
  decoy: 'decoy', store: 'storage', bench: 'bench', smelter: 'smelter', analyzer: 'analyzer', clinic: 'hp',
};

// 资源键 → 图标（工具也在这里）
export const RES_ICON = {
  ore: 'ore', vine: 'vine', stone: 'stone', coal: 'coal', fuel: 'fuel', food: 'food',
  data: 'data', core: 'core', night: 'night',
  pick: 'pick', axe: 'axe', sickle: 'sickle', hammer: 'hammer', wand: 'wand',
};

// 建造分类 → 图标
export const CAT_ICON = { light: 'catLight', struct: 'catStruct', prod: 'catProd', def: 'catDef', logi: 'catLogi' };

export function icon(name, size = 16) {
  const s = ICONS[name];
  if (!s) return '';
  return size === 16 ? s : s.replace('width="16" height="16"', `width="${size}" height="${size}"`);
}
// 直接给资源键 / 建筑类型 / 分类 取图标
export function resIcon(k, size) { return icon(RES_ICON[k] || 'storage', size); }
export function buildIcon(t, size) { return icon(BUILD_ICON[t] || 'catStruct', size); }
