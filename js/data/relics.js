// data/relics.js —— 残页：知识锁最"考古"的一条路（只能发现，不能购买）
//
// 设计意图（W12-D 知识锁）：
//   · 遗迹碑除了给档案点数，还夹带一页**具名残页**（「熔渊手记 · 炉语」）
//   · 集齐一个系列 → **不花任何点数**直接解锁对应的知识类研究
//   · 残页不是新货币，是**计数器**（不买不卖，只记录你走到过哪里）
//   · 掉落是确定性的：同 seed + 同坐标的碑永远掉同一页，所以每一局都有一条走得通的路
export const RELIC_SERIES = {
  handbook: {
    name: '熔渊手记',
    parts: ['封皮', '蚀痕', '炉语'],
    research: 'relicForging',        // 集齐后自动解锁的研究节点
    from: '遗迹碑（地表 3 座 · 深渊更多）',
    desc: '一位不知名的炉匠留下的笔记：他怎么把火留住、怎么让炉膛更旺。',
  },
};

export const SERIES_ORDER = ['handbook'];
export const PARTS_NEED = 3;
export const partName = (sid, idx) => `${RELIC_SERIES[sid].name} · ${RELIC_SERIES[sid].parts[idx] || '？'}`;
