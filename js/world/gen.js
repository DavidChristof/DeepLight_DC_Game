// world/gen.js —— 种子地图生成（苔原 + 岩壁 + 矿脉 + 藤木）
import { T, createMap } from './map.js';
import { LAYER_META } from '../data/layers.js';
import { nodeStart } from '../data/nodes.js';
import { BIOMES } from '../data/ecology.js';

// mulberry32 可复现随机（导出：天然竖井等"同种子同位"的附加生成也要用它）
export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genMap(w, h, seed, biomeId = 'tundra') {
  const m = createMap(w, h);
  const biome = BIOMES[biomeId] || BIOMES.tundra;
  m.biome = biome.id;
  const rnd = mulberry(seed);
  const cx = (w / 2) | 0, cy = (h / 2) | 0;
  const d2 = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy);

  m.tiles.fill(T.FLOOR);
  // 表面地图边界保持开放：区块出口直接连到相邻区块；洞穴层仍由 genDepth 保留岩壁边界。

  // 中心出生点清空（半径 6）
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++)
      if (dx * dx + dy * dy <= 36) m.set(cx + dx, cy + dy, T.FLOOR);

  // 簇状物：避开中心(出生区)，minD=35
  const blob = (px, py, rad, t) => {
    for (let y = py - rad; y <= py + rad; y++)
      for (let x = px - rad; x <= px + rad; x++) {
        if (d2(x, y) > 35 && (x - px) * (x - px) + (y - py) * (y - py) <= rad * rad)
          m.set(x, y, t);
      }
  };
  const randPt = () => [2 + (rnd() * (w - 4)) | 0, 2 + (rnd() * (h - 4)) | 0];

  for (let i = 0; i < 10; i++) { const [x, y] = randPt(); blob(x, y, 1 + (rnd() * 2) | 0, T.ROCK); }
  const oreBlobs = Math.max(3, Math.round(6 * biome.resourceBias.ore));
  const vineBlobs = Math.max(3, Math.round(8 * biome.resourceBias.vine));
  for (let i = 0; i < oreBlobs; i++)  { const [x, y] = randPt(); blob(x, y, 1 + (rnd() * 2) | 0, T.ORE); }
  for (let i = 0; i < vineBlobs; i++)  { const [x, y] = randPt(); blob(x, y, 1 + (rnd() * 2) | 0, T.VINE); }
  // 地表遗迹碑：档案点数的第一桶金 —— 不然研究树在开局根本碰不到（旧版只有深渊才有碑）
  for (let i = 0; i < 3; i++) { const [x, y] = randPt(); blob(x, y, 0, T.RELIC); }

  // 资源节点量（数值见 data/nodes.js —— 与深层共用同一张表）
  for (let i = 0; i < m.tiles.length; i++) m.nodeAmt[i] = nodeStart(m.tiles[i], false);
  return m;
}

// 深潜层：岩洞地图（全黑无环境光），富矿 + 遗迹碑
export function genDepth(w, h, seed, level = 1) {
  const meta = LAYER_META['depth' + level] || LAYER_META.depth1;
  const m = createMap(w, h);
  const rnd = mulberry(seed);
  m.tiles.fill(T.ROCK);
  const cx = (w / 2) | 0, cy = (h / 2) | 0;
  const carve = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) m.set(x + dx, y + dy, T.FLOOR);
  };
  carve(cx, cy, 3);

  // 随机游走挖出洞道
  for (let i = 0; i < 30; i++) {
    let x = cx + ((rnd() * 10) | 0) - 5;
    let y = cy + ((rnd() * 10) | 0) - 5;
    let dir = (rnd() * 4) | 0;
    const len = 40 + ((rnd() * 90) | 0);
    for (let s = 0; s < len; s++) {
      carve(x, y, rnd() < 0.2 ? 2 : 1);
      if (rnd() < 0.14) dir = (rnd() * 4) | 0;
      if (dir === 0) x++; else if (dir === 1) x--; else if (dir === 2) y++; else y--;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) { x = cx; y = cy; dir = (rnd() * 4) | 0; }
    }
  }

  // 资源：富矿 / 藤木 / 遗迹碑（只在可走地块上）
  const blob = (x, y, r, t) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (dx * dx + dy * dy > r * r) continue;
        if (m.tiles[ny * w + nx] === T.FLOOR) m.set(nx, ny, t);
      }
  };
  for (let i = 0; i < meta.ore; i++) { const x = 2 + ((rnd() * (w - 4)) | 0), y = 2 + ((rnd() * (h - 4)) | 0); blob(x, y, 1 + ((rnd() * 2) | 0), T.ORE); }
  for (let i = 0; i < 8; i++) { const x = 2 + ((rnd() * (w - 4)) | 0), y = 2 + ((rnd() * (h - 4)) | 0); blob(x, y, 1, T.VINE); }
  for (let i = 0; i < meta.relic; i++) { const x = 2 + ((rnd() * (w - 4)) | 0), y = 2 + ((rnd() * (h - 4)) | 0); blob(x, y, 1, T.RELIC); }
  for (let i = 0; i < meta.mother; i++) { const x = 2 + ((rnd() * (w - 4)) | 0), y = 2 + ((rnd() * (h - 4)) | 0); blob(x, y, 1, T.MOTHER); }
  // 中心留空作为落点
  carve(cx, cy, 3);

  // 熔渊之心：岩浆河 —— 唯一光源（免费，但灼伤生命）
  if (meta.lava) {
    const d2c = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const pour = (x, y, r) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 2 || ny < 2 || nx >= w - 2 || ny >= h - 2) continue;
          if (dx * dx + dy * dy > r * r) continue;
          if (d2c(nx, ny) < 64) continue;                    // 落点周围留出安全区
          if (m.tiles[ny * w + nx] === T.FLOOR && m.nodeAmt[ny * w + nx] === 0) m.set(nx, ny, T.LAVA);
        }
    };
    for (let i = 0; i < meta.lava; i++) {
      const x = 3 + ((rnd() * (w - 6)) | 0), y = 3 + ((rnd() * (h - 6)) | 0);
      pour(x, y, 1 + ((rnd() * 2) | 0));
    }
    // 让岩浆沿洞道连成河流：从每个岩浆点随机游走几步
    for (let i = 0; i < 10; i++) {
      let x = 3 + ((rnd() * (w - 6)) | 0), y = 3 + ((rnd() * (h - 6)) | 0);
      const len = 10 + ((rnd() * 20) | 0);
      for (let s = 0; s < len; s++) {
        pour(x, y, 1);
        if (rnd() < 0.3) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) break;
      }
    }
  }

  // 节点量：深潜层矿更富（见 data/nodes.js 的 NODE_DEEP）
  for (let i = 0; i < m.tiles.length; i++) m.nodeAmt[i] = nodeStart(m.tiles[i], true);
  delete m._lavaSrcs;                                   // 岩浆源缓存按地图重算
  return m;
}

