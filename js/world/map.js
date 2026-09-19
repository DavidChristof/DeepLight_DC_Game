// world/map.js —— 一维数组网格地图
export const T = {
  FLOOR: 0,  // 蚀苔地（可走）
  ROCK: 1,   // 岩壁（不可走 / 挡光）
  ORE: 2,    // 辉髓矿脉（可走 / 采集源）
  VINE: 3,   // 藤木（可走 / 采集源）
  RELIC: 4,  // 遗迹碑（不可走 / 采集得档案点数）
  MOTHER: 5, // 辉髓母脉（不可走 / 采集得母髓，仅深层）
  LAVA: 6,   // 岩浆（可走 · 自发光 · 持续灼伤，仅熔渊之心）
};

export function createMap(w, h) {
  const tiles = new Uint8Array(w * h);
  const occBuild = new Uint8Array(w * h);     // 1=这一格有建筑（不能再建、不该刷怪）
  const occWalk = new Uint8Array(w * h);      // 1=实体建筑（挡人：墙 / 机器 / 灯柱）
  const blockLight = new Uint8Array(w * h);   // 1=挡光（木墙等）
  const nodeAmt = new Int8Array(w * h);       // 资源节点剩余量（矿石/藤木）
  return {
    w, h, tiles, occBuild, occWalk, blockLight, nodeAmt,
    _ver: 0,                                  // 地形版本号：任何格子变化都 +1
    _dirty: [],                               // 变化过的格子（渲染层只重烘这些格，不整块重烤）
    get(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return T.ROCK;
      return tiles[y * w + x];
    },
    set(x, y, v) {
      if (x >= 0 && y >= 0 && x < w && y < h) {
        const i = y * w + x;
        if (tiles[i] !== v) { tiles[i] = v; this._ver++; this._dirty.push(i); }
      }
    },
    isWalk(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const t = tiles[y * w + x];
      return (t === T.FLOOR || t === T.ORE || t === T.VINE || t === T.LAVA) && !occWalk[y * w + x];
    },
  };
}
