// data/layers.js —— 层序定义（新增层只需在此登记）
// W11「层之法则」：每层不只是更黑更富，而是换一套操作方式
export const LAYER_ORDER = ['surface', 'depth1', 'depth2', 'depth3'];

export const LAYER_NAMES = {
  surface: '地表',
  depth1: '余烬层',
  depth2: '母脉层',
  depth3: '熔渊之心',
};

// 法则字段：
//   radiusMul 所有光源半径倍率 / decay 光每格衰减倍率
//   echo 回声视觉半径（移动时以自身为圆心短暂显形）
//   lava 岩浆数量（地图生成）
//   ruleText 进入时的提示
export const LAYER_META = {
  depth1: {
    ore: 20, relic: 7, mother: 2, guards: 7, w: 88, h: 64,
    rule: 'ember', decay: 1.6, radiusMul: 0.9,
    ruleText: '光衰减 ×1.6 · 照明半径 −10% —— 燃料是咽喉，带够补给再下来',
  },
  depth2: {
    ore: 28, relic: 12, mother: 5, guards: 12, w: 80, h: 58,
    rule: 'echo', radiusMul: 0.5, echo: 6,
    ruleText: '照明半径 ×0.5 + 回声视觉 —— 只有走动时才会显形',
  },
  depth3: {
    ore: 34, relic: 16, mother: 7, guards: 16, w: 76, h: 56, lava: 30,
    rule: 'lava', radiusMul: 0.85,
    ruleText: '唯一光源是岩浆 —— 免费，但会烧掉生命与空间',
  },
};

export const LAYER_RULE_TEXT = {
  surface: '昼与夜：白天投资，夜里结算',
};
for (const id of LAYER_ORDER) if (LAYER_META[id] && LAYER_META[id].ruleText) LAYER_RULE_TEXT[id] = LAYER_META[id].ruleText;
