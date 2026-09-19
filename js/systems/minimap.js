// systems/minimap.js —— 探索式小地图（左上角，随光照逐步探明）
import { VIEW_W, VIEW_H, TILE } from '../core/state.js';
import { T } from '../world/map.js';
import { BIOMES } from '../data/ecology.js';

const SCALE = 1.15;                 // 显示缩放（刻意偏小，1px≈1tile 放大）
const MX = 10, MY = 48;             // 左上角，避开顶部 HUD 信息条
const RGB = {
  [T.FLOOR]: [16, 22, 30],
  [T.ROCK]:  [48, 58, 80],
  [T.ORE]:   [24, 210, 178],        // 矿脉：探明后才点亮
  [T.VINE]:  [180, 134, 58],
  [T.RELIC]: [186, 150, 255],       // 遗迹碑：紫色
  [T.MOTHER]: [255, 214, 110],      // 辉髓母脉：金色
  [T.LAVA]:  [255, 120, 60],        // 岩浆：橙红（熔渊之心）
};

// 点击是否落在地图面板上（画布坐标）——避免点小地图误发移动指令
export function minimapHit(sx, sy, state) {
  const m = state.map;
  return sx >= MX - 2 && sy >= MY - 2 && sx <= MX + m.w * SCALE + 2 && sy <= MY + m.h * SCALE + 2;
}

let cache = null;                   // { map, blight, cv, g, img, sig }
let lastBottom = -1;                // 小地图底部（CSS 像素），供左侧面板避让
let lastWidth = -1;                 // 小地图宽度（CSS 像素），供侧栏对齐

function ensure(state) {
  const m = state.map;
  if (cache && cache.map === m && cache.blight === m.blight) return cache;
  const cv = document.createElement('canvas');
  cv.width = m.w; cv.height = m.h;  // 1px = 1 tile 的隐藏底图
  cache = { map: m, blight: m.blight, cv, g: cv.getContext('2d'), img: new ImageData(m.w, m.h), layer: null, at: -1e9 };
  return cache;
}

export function drawMinimap(ctx, state) {
  const c = ensure(state);
  const m = state.map, dis = state.discovered;
  if (!dis) return;
  const tiles = m.tiles;

  // —— 底图：限频重写（~8Hz，切层立即重烘）——探索/蚀痕的变化 130ms 内补上，人眼看不出
  // 这里原来每帧重写 6912 个像素 + putImageData，是这个游戏最贵的一项渲染开销（~3ms/帧）
  const now = performance.now();
  if (c.layer !== state.layerId || now - c.at > 130) {
    c.layer = state.layerId;
    c.at = now;
    const data = c.img.data;
    const bl = m.blight;
    let o = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (dis[i]) {
        let rgb = RGB[tiles[i]] || RGB[T.FLOOR];      // 新增地块务必在 RGB 登记（否则这里会炸）
        if (tiles[i] === T.FLOOR && m.biome && BIOMES[m.biome]) {
          const tint = BIOMES[m.biome].color.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
          rgb = [Math.round((rgb[0] + tint[0]) * 0.5), Math.round((rgb[1] + tint[1]) * 0.5), Math.round((rgb[2] + tint[2]) * 0.5)];
        }
        if (bl && bl[i] > 0) {
          const k = 0.35 + 0.2 * bl[i];
          rgb = [rgb[0] + (150 - rgb[0]) * k, rgb[1] + (70 - rgb[1]) * k, rgb[2] + (230 - rgb[2]) * k];
        }
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      } else {
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
      }
      o += 4;
    }
    c.g.putImageData(c.img, 0, 0);
  }

  const tw = Math.ceil(m.w * SCALE), th = Math.ceil(m.h * SCALE);

  ctx.save();
  // 底板 + 细边框
  ctx.fillStyle = 'rgba(3,5,10,0.82)';
  ctx.fillRect(MX - 2, MY - 2, tw + 4, th + 4);
  ctx.strokeStyle = 'rgba(140,180,255,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(MX - 2, MY - 2, tw + 4, th + 4);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c.cv, MX, MY, tw, th);

  // 视野框（跟随摄像机）
  const vw = VIEW_W / TILE, vh = VIEW_H / TILE;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(MX + (state.camera.x - vw / 2) * SCALE, MY + (state.camera.y - vh / 2) * SCALE, vw * SCALE, vh * SCALE);

  // 玩家（暖黄点）
  const p = state.player;
  ctx.fillStyle = '#ffd27a';
  ctx.fillRect(Math.round(MX + p.x * SCALE) - 1, Math.round(MY + p.y * SCALE) - 1, 3, 3);

  drawMarkers(ctx, state);
  ctx.restore();

  syncPanelOffset(ctx, tw, th);
}

// 单位/建筑标记：营地·塔·灯（建筑）、拓荒者、蚀兽、Boss
function drawMarkers(ctx, state) {
  const at = (x, y, s, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(MX + x * SCALE - s / 2), Math.round(MY + y * SCALE - s / 2), s, s);
  };

  // 建筑：灯=暖黄，塔=冰蓝，竖井=金，农田=绿，墙=灰，棱镜=青（灭的变暗），诱饵=灰蓝
  for (const b of state.buildings) {
    if (b.type === 'wall' && !b.site) continue;
    const c = b.site ? '#7d8fa3'          // 工地：灰色（小地图上也要看得见蓝图）
      : b.type === 'lamp' ? '#ffc46a'
        : b.type === 'farm' ? '#7dff9a'
          : b.type === 'shaft' ? '#ffe0a0'
            : b.type === 'furnace' ? '#c89a6a'
              : b.type === 'prism' ? (b.relayHop != null ? '#a8ecff' : '#3e5568')
                : b.type === 'decoy' ? '#8fa8c0'
                  : b.type === 'store' ? '#c9b48a'
                    : b.type === 'analyzer' ? '#d8c6ff'
                      : b.type === 'bench' ? '#bfe0c0'
                        : b.type === 'smelter' ? '#ffb27a' : '#9fe8ff';
    at(b.x + 0.5, b.y + 0.5, 2, c);
  }

  // 营地信标（金白菱形）
  for (const b of state.beacons) {
    if (b.hp <= 0) continue;
    ctx.fillStyle = '#fff2c0';
    const bx = Math.round(MX + (b.x + 0.5) * SCALE), by = Math.round(MY + (b.y + 0.5) * SCALE);
    ctx.fillRect(bx - 2, by, 5, 1);
    ctx.fillRect(bx, by - 2, 1, 5);
  }

  // 拓荒者（绿；士气崩溃转红；蚀化转紫）
  for (const w of state.workers || []) {
    if (w.layerId !== state.layerId) continue;
    at(w.x, w.y, 2, w.hollow ? '#c07bff' : (w.morale < 25 ? '#ff6b6b' : '#7dffb0'));
  }

  // 蚀兽（红点，Boss 加粗描边）：仅已探明区域或靠近营地/玩家时可见（营地警戒）
  for (const e of state.enemies || []) {
    if (!e.alive) continue;
    const ix = Math.floor(e.x), iy = Math.floor(e.y);
    const i = iy * state.map.w + ix;
    let seen = (state.discovered && state.discovered[i]) || false;
    if (!seen && (Math.abs(ix - state.player.x) + Math.abs(iy - state.player.y) <= 16)) seen = true;
    if (!seen) {
      for (const b of state.beacons) {
        if (Math.abs(ix - b.x) + Math.abs(iy - b.y) <= 15) { seen = true; break; }
      }
    }
    if (!seen) continue;
    if (e.def && e.def.boss) {
      const bx = Math.round(MX + e.x * SCALE), by = Math.round(MY + e.y * SCALE);
      ctx.fillStyle = '#ff4fb0';
      ctx.fillRect(bx - 2, by - 2, 5, 5);
      ctx.strokeStyle = '#ffe0f4';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 3, by - 3, 7, 7);
    } else at(e.x, e.y, 2, '#ff5f5f');
  }
}

// 小地图底部/宽度（CSS 像素）→ CSS 变量，供左侧侧栏对齐与面板避让
function syncPanelOffset(ctx, tw, th) {
  const cv = ctx.canvas;
  if (!cv || !cv.clientWidth) return;
  const k = cv.clientWidth / cv.width;
  const bottom = Math.round((MY + th + 6) * k);
  const w = Math.max(142, Math.round((tw + 4) * k));
  if (bottom === lastBottom && w === lastWidth) return;
  lastBottom = bottom;
  lastWidth = w;
  const root = document.documentElement;
  if (root && root.style) {
    root.style.setProperty('--map-bottom', bottom + 'px');
    root.style.setProperty('--map-w', w + 'px');
  }
}

