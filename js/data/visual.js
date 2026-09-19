// data/visual.js —— W16-E 视觉与交互重制的唯一规格表
import { UI, STATE, CAT, contrast } from './palette.js';

export const VISUAL = Object.freeze({
  pixel: Object.freeze({ tile: 16, human: 24, creatureMin: 24, creatureMax: 48, building: 32, icon: 16 }),
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
    version: 1,
    pixel: { ...VISUAL.pixel },
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
