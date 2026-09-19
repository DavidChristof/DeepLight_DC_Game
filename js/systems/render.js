// systems/render.js —— Canvas 渲染（暗底 + 辉光 + 最近邻放大）
import { TILE, VIEW_W, VIEW_H, state } from '../core/state.js';
import { T } from '../world/map.js';
import { BUILD, workOf } from '../data/buildings.js';
import { RES_COLOR } from '../data/storage.js';
import { ENEMIES } from '../data/enemies.js';
import { ABILITY } from '../data/combat.js';
import { ambientOf } from '../core/time.js';
import { settings } from '../core/settings.js';
import { drawMinimap } from './minimap.js';
import { sanityTier, graveRadius } from '../data/traits.js';
import { actLabel, ACT_COLOR } from '../ui/inspect.js';
import { pnow, pmark } from '../core/perf.js';
import { WORLD, VISUAL } from '../data/visual.js';
import { SURVIVAL } from '../data/survival.js';

const DARK = WORLD.dark;
const FLOOR_C = WORLD.floor;          // 蚀苔地
const ROCK_C = WORLD.rock;            // 岩壁：冷灰，与地表拉开亮度差
const ORE_GROUND = WORLD.oreGround;   // 辉髓矿基底（偏暗青）
const ORE_C = WORLD.ore;              // 辉髓晶屑高亮
const LAVA_C = WORLD.lava;            // 岩浆（自发光，不靠光照也看得见）
const VINE_C = WORLD.vine;            // 藤木：暖黄
const RELIC_GROUND = WORLD.relicGround; // 遗迹碑基底（低饱和紫）
const RELIC_C = WORLD.relic;          // 遗迹符纹高亮
const MOTHER_GROUND = WORLD.motherGround; // 辉髓母脉基底（金褐）
const MOTHER_C = WORLD.mother;        // 母脉晶光

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const speck = (a, b, i) => {              // 确定性伪随机 0..1（无分配：全模块共用）
  const x = Math.sin(a * 127.1 + b * 311.7 + i * 74.7) * 43758.5453;
  return x - Math.floor(x);
};
const col = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;   // 颜色转 CSS 串（烘培用）

// W16-E V1：24×24 静态像素人。用少量矩形表达头发、脸、外套和背包，
// 方向由实体的 face/facing 提供；没有方向字段时默认面向镜头，保证旧存档兼容。
function drawPixelHuman(ctx, x, y, face = 'down', coat = '#dfe9ff', trim = '#ffd27a', tool = null, flash = false) {
  const d = face === 'up' || face === 'down' || face === 'left' || face === 'right' ? face : 'down';
  const sx = d === 'left' ? -1 : 1;
  const side = d === 'left' || d === 'right';
  const skin = flash ? '#ffffff' : '#f5c7a5';
  const hair = flash ? '#ffffff' : '#43344b';
  const px = Math.round(x - 12), py = Math.round(y - 12);
  ctx.save(); ctx.imageSmoothingEnabled = false;
  // 阴影让人物从同色地块中脱出
  ctx.fillStyle = 'rgba(3,6,12,0.55)'; ctx.fillRect(px + 5, py + 20, 14, 3);
  // 背包/披肩：背向镜头时更宽，侧向时只留一条轮廓
  ctx.fillStyle = '#263b50';
  if (d === 'up') ctx.fillRect(px + 4, py + 7, 16, 10);
  else if (side) ctx.fillRect(px + (sx > 0 ? 3 : 8), py + 8, 6, 10);
  else ctx.fillRect(px + 5, py + 10, 14, 8);
  // 头部（上视角只显示发顶）
  ctx.fillStyle = d === 'up' ? hair : skin;
  if (side) ctx.fillRect(px + (sx > 0 ? 8 : 4), py + 3, 9, 8);
  else ctx.fillRect(px + 6, py + 3, 12, 9);
  ctx.fillStyle = hair;
  if (d === 'up') ctx.fillRect(px + 5, py + 3, 14, 5);
  else if (side) ctx.fillRect(px + (sx > 0 ? 8 : 4), py + 3, 9, 3);
  else ctx.fillRect(px + 5, py + 3, 14, 3);
  // 身体与高领
  ctx.fillStyle = coat; ctx.fillRect(px + (side ? (sx > 0 ? 8 : 5) : 5), py + 11, side ? 9 : 14, 8);
  ctx.fillStyle = trim; ctx.fillRect(px + (side ? (sx > 0 ? 8 : 5) : 6), py + 11, side ? 8 : 12, 2);
  // 面部朝向提示（背面不画眼睛）
  if (d === 'down') { ctx.fillStyle = '#263449'; ctx.fillRect(px + 8, py + 8, 2, 2); ctx.fillRect(px + 14, py + 8, 2, 2); }
  else if (side) { ctx.fillStyle = '#263449'; ctx.fillRect(px + (sx > 0 ? 15 : 5), py + 8, 2, 2); }
  // 手持工具：从“色块”升级为 2 段像素柄 + 工具头
  if (tool) {
    const tc = RES_COLOR[tool] || '#cfe0f0';
    ctx.fillStyle = '#795a45';
    ctx.fillRect(px + (side ? (sx > 0 ? 17 : 2) : 18), py + 13, 2, 7);
    ctx.fillStyle = tc;
    if (tool === 'pick') ctx.fillRect(px + (side ? (sx > 0 ? 16 : 1) : 17), py + 11, 5, 2);
    else ctx.fillRect(px + (side ? (sx > 0 ? 17 : 1) : 18), py + 11, 3, 4);
  }
  ctx.restore();
}

function drawCrewMarker(ctx, w, x, y) {
  const accent = VISUAL.colonist[w && w.crew && w.crew.palette] || VISUAL.colonist.fallback;
  const letter = String(w && w.name || '拓').slice(-1);
  ctx.fillStyle = 'rgba(5,8,14,0.8)'; ctx.fillRect(x - 6, y - 24, 12, 7);
  ctx.fillStyle = accent; ctx.fillRect(x - 5, y - 23, 10, 5);
  ctx.fillStyle = '#111925'; ctx.font = 'bold 6px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText(letter, x, y - 19);
}

function drawCreature(ctx, x, y, r, kind, fill, outline, flash = false) {
  const c = flash ? '#ffffff' : fill;
  const s = Math.max(5, r * 0.9), jag = kind === 'bud' || kind === 'charger' || kind === 'spitter';
  ctx.fillStyle = c; ctx.strokeStyle = outline; ctx.lineWidth = Math.max(1.2, r * 0.12);
  ctx.beginPath();
  if (kind === 'owl') {
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.9, y - s * 0.2); ctx.lineTo(x + s * 0.65, y + s); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x - s * 0.65, y + s); ctx.lineTo(x - s * 0.9, y - s * 0.2);
  } else if (kind === 'shell' || kind === 'bomber' || kind === 'warden' || kind === 'core') {
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4; const rr = i % 2 ? s * 0.86 : s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  } else if (jag) {
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * .58, y - s * .35); ctx.lineTo(x + s, y); ctx.lineTo(x + s * .35, y + s * .58); ctx.lineTo(x, y + s); ctx.lineTo(x - s * .35, y + s * .58); ctx.lineTo(x - s, y); ctx.lineTo(x - s * .58, y - s * .35);
  } else { ctx.arc(x, y, s, 0, 7); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = outline; ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
}

// —— 地形烘焙（W13-C 性能）：整块地表连材质细节烤进离屏画布，每帧只 blit 可见部分 ——
// 光照不再逐格 mix 颜色，而是把「暗底色 × (1−f)」写进一张 1px=1格 的遮罩，最近邻放大 16× 叠上去：
//   遮罩合成 = baked·f + DARK·(1−f) ≡ mix(DARK, base, f) —— 数学上与旧逐格画法等价
// 烘焙只在采掘改地形时增量重做（脏格队列 m._dirty），地形不变时一直是同两张图（见 OPTIMIZE_PLAN §5.1）
let ter = null;                            // { map, cv, g, fac }
const MASK_W = 64, MASK_H = 64;            // 视口 45×30 格，留余量；比视口大就不必重建
let maskCv = null, maskG = null, maskImg = null;

// 视野范围（±pad 格）
function viewBounds(m, pad) {
  const ox = Math.round(state.camera.x * TILE - VIEW_W / 2), oy = Math.round(state.camera.y * TILE - VIEW_H / 2);
  return {
    x0: Math.max(0, ((ox - pad * TILE) / TILE) | 0), x1: Math.min(m.w - 1, Math.ceil((ox + VIEW_W + pad * TILE) / TILE)),
    y0: Math.max(0, ((oy - pad * TILE) / TILE) | 0), y1: Math.min(m.h - 1, Math.ceil((oy + VIEW_H + pad * TILE) / TILE)),
  };
}

const DIRTY_PER_FRAME = 1200;              // 每帧补烘上限（≈3ms/帧；正常采集只会脏 1~3 格）

function ensureTerrain(m) {
  const W = m.w * TILE, H = m.h * TILE;
  const fresh = !ter || ter.map !== m || !ter.cv || ter.cv.width !== W || ter.cv.height !== H;
  const d = m._dirty || (m._dirty = []);
  if (fresh) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    ter = { map: m, cv, g: cv.getContext('2d'), fac: new Float32Array(m.w * m.h) };
    // 首帧只烤「视野 + 10 格余量」，地图其余部分排进增量队列慢慢补（开局/切层不再卡一下）
    const v = viewBounds(m, 10);
    d.length = 0;
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        if (tx >= v.x0 && tx <= v.x1 && ty >= v.y0 && ty <= v.y1) bakeTile(ter.g, ter.fac, m, tx, ty);
        else d.push(ty * m.w + tx);
      }
    }
    return ter;
  }
  // 增量：只重烘采掘改过的那几格（原来一次采集要把 6912 格全重画 → 单帧 15ms 卡顿）
  if (d.length) {
    const n = Math.min(d.length, DIRTY_PER_FRAME);
    for (let k = 0; k < n; k++) { const i = d[k]; bakeTile(ter.g, ter.fac, m, i % m.w, (i / m.w) | 0); }
    if (n === d.length) d.length = 0; else d.splice(0, n);
  }
  return ter;
}

// 单格烘焙：只写自己那 16×16（所有材质细节都画在本格内 → 增量重烤不会漏）
function bakeTile(g, fac, m, tx, ty) {
  const i = ty * m.w + tx, tile = m.tiles[i];
  const x = tx * TILE, y = ty * TILE;
  const vary = 0.88 + 0.24 * speck(tx, ty, 0);
  const noise = 0.14 * speck(tx, ty, 1);
  fac[i] = vary + noise;

  if (tile === T.ROCK) {
    g.fillStyle = col(ROCK_C); g.fillRect(x, y, TILE, TILE);
    g.fillStyle = 'rgba(255,255,255,0.16)';           // 左上高光 + 右下阴影 → 块状立体可读
    g.fillRect(x + 2, y + 2, TILE - 6, 2);
    g.fillRect(x + 2, y + 2, 2, TILE - 6);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x + 5, y + TILE - 3, TILE - 5, 2);
    g.fillRect(x + TILE - 3, y + 5, 2, TILE - 5);
    return;
  }

  let base = FLOOR_C;
  if (tile === T.ORE) base = ORE_GROUND;
  else if (tile === T.VINE) base = VINE_C;
  else if (tile === T.RELIC) base = RELIC_GROUND;
  else if (tile === T.MOTHER) base = MOTHER_GROUND;
  else if (tile === T.LAVA) base = LAVA_C;
  g.fillStyle = col(mix(DARK, base, clamp(fac[i], 0, 1)));
  g.fillRect(x, y, TILE, TILE);

  if (tile === T.ORE) {                              // 辉髓：散布青色晶屑
    g.fillStyle = `rgba(${ORE_C[0]},${ORE_C[1]},${ORE_C[2]},0.65)`;
    g.fillRect((x + 2 + speck(tx, ty, 2) * 10) | 0, (y + 2 + speck(tx, ty, 3) * 10) | 0, 2, 2);
    g.fillRect((x + 3 + speck(tx, ty, 4) * 10) | 0, (y + 4 + speck(tx, ty, 5) * 8) | 0, 2, 2);
    g.fillRect((x + 8 + speck(tx, ty, 6) * 6) | 0, (y + 1 + speck(tx, ty, 7) * 6) | 0, 2, 2);
  } else if (tile === T.VINE) {                      // 藤木：木纹横线 + 亮结
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(x + 2, y + 4, TILE - 4, 2);
    g.fillRect(x + 2, y + 11, TILE - 8, 2);
    g.fillStyle = 'rgba(255,222,160,0.3)';
    g.fillRect((x + 2 + speck(tx, ty, 2) * 10) | 0, (y + 7 + speck(tx, ty, 3) * 6) | 0, 3, 2);
  } else if (tile === T.MOTHER) {                    // 母脉：金色晶簇
    g.fillStyle = `rgba(${MOTHER_C[0]},${MOTHER_C[1]},${MOTHER_C[2]},0.7)`;
    g.fillRect(x + 4, y + 5, 3, 3);
    g.fillRect(x + 9, y + 3, 3, 3);
    g.fillRect(x + 7, y + 10, 3, 3);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + 2, y + 13, TILE - 4, 1);
  } else if (tile === T.RELIC) {                     // 遗迹碑：紫符纹
    g.fillStyle = `rgba(${RELIC_C[0]},${RELIC_C[1]},${RELIC_C[2]},0.55)`;
    g.fillRect(x + 5, y + 4, 6, 2);
    g.fillRect(x + 3, y + 9, 10, 2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + 2, y + 2, TILE - 4, 1);
  } else if (tile === T.LAVA) {                      // 岩浆：静态裂纹（亮泡在自发光里逐帧画）
    g.fillStyle = 'rgba(120,30,10,0.5)';
    g.fillRect((x + 1 + speck(tx, ty, 10) * 9) | 0, (y + 4 + speck(tx, ty, 11) * 9) | 0, 5, 2);
    g.fillRect((x + 3 + speck(tx, ty, 12) * 8) | 0, (y + 10 + speck(tx, ty, 13) * 4) | 0, 4, 2);
  } else {                                          // 苔地：暗斑 + 苔藓亮斑
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect((x + 2 + speck(tx, ty, 2) * 10) | 0, (y + 2 + speck(tx, ty, 3) * 10) | 0, 3, 3);
    g.fillRect((x + 6 + speck(tx, ty, 4) * 7) | 0, (y + 8 + speck(tx, ty, 5) * 5) | 0, 3, 2);
    g.fillStyle = 'rgba(150,232,190,0.12)';
    g.fillRect((x + 2 + speck(tx, ty, 6) * 10) | 0, (y + 7 + speck(tx, ty, 7) * 6) | 0, 2, 2);
  }
}

// 光照遮罩：把「暗底色 × (1−f)」写进 1px=1格 的小图，最近邻放大 16× 叠在烘焙底图上。
// 关键：逐格只写 4 个字节、不再建字符串、不再逐格调用 canvas 绘制 —— 这是原来 draw.tiles 2.3ms 的大头。
function drawLightMask(ctx, m, light, lightMax, amb, terr, dx, dy, vw, vh, x0, y0, x1, y1) {
  if (!maskCv) {
    maskCv = document.createElement('canvas');
    maskCv.width = MASK_W; maskCv.height = MASK_H;
    maskG = maskCv.getContext('2d');
    maskImg = new ImageData(MASK_W, MASK_H);
  }
  const data = maskImg.data, fac = terr.fac, tiles = m.tiles;
  const d = lightMax * 0.7;
  const pad = (MASK_W - vw) * 4;
  let o = 0;
  for (let ty = y0; ty <= y1; ty++) {
    const row = ty * m.w;
    for (let tx = x0; tx <= x1; tx++) {
      const i = row + tx;
      const lv = light ? light[i] : 0;
      let b = (lv - 0.5) / d;
      if (b < amb) b = amb;
      if (b < 0) b = 0; else if (b > 1) b = 1;
      // 岩壁用裸 b，其它地块乘逐格明度系数（烘培时算好的 fac，避免每帧再跑 sin）
      const f = tiles[i] === T.ROCK ? b : (b * fac[i] > 1 ? 1 : b * fac[i]);
      data[o] = DARK[0]; data[o + 1] = DARK[1]; data[o + 2] = DARK[2];
      data[o + 3] = (255 - f * 255) | 0;
      o += 4;
    }
    o += pad;
  }
  maskG.putImageData(maskImg, 0, 0);
  ctx.drawImage(maskCv, 0, 0, vw, vh, dx, dy, vw * TILE, vh * TILE);
}

// —— 建造范围预览（W13-E）：放下之前先看见"会发生什么" ——
// 光照圈 / 塔射程 / 棱镜接力 / 净化圈 / 补给范围 / 农田的当场光照值
// 只在建造模式里跑（每帧几个 stroke），不影响性能
function drawBuildPreview(ctx, def, gx, gy, ox, oy, amb) {
  const cx = gx + TILE / 2, cy = gy + TILE / 2;
  const ring = (rTiles, col, dash) => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, rTiles * TILE, 0, 7);
    ctx.stroke();
    ctx.restore();
  };
  if (def.radius) ring(def.radius, def.color || '#aee9ff', [5, 4]);        // 光源半径
  if (def.range) {                                                          // 塔：外圈射程 + 内圈溅射
    ring(def.range, '#9fe8ff', [3, 4]);
    if (def.aoe) ring(def.aoe, '#c9a0ff', [2, 3]);
  }
  if (def.relay) ring(def.relay.radius, '#bfe4ff', [4, 4]);                 // 棱镜接力
  if (def.purifyR) ring(def.purifyR, '#d8c6ff', [2, 3]);                    // 净化范围
  if (def.supplyRange) ring(def.supplyRange, '#ffcf8a', [5, 4]);            // 补给范围

  // 文字：只讲“选它图什么”——一格一行，不抢地形
  let label = '', col = def.color || '#cfe0ff';
  if (def.radius) label = `光照 ${def.radius} 格`;
  if (def.range) label = `射程 ${def.range} 格${def.air ? ' · 可对空' : ''}${def.aoe ? ` · 范围 ${def.aoe}` : ''}`;
  if (def.relay) { label = `接力 ${def.relay.radius} 格 · 需先被照亮`; col = '#bfe4ff'; }
  if (def.lightMin) {                                                        // 幽菌田：这格到底亮不亮
    const m = state.map;
    const tx = Math.floor((gx + ox) / TILE), ty = Math.floor((gy + oy) / TILE);
    const i = ty * m.w + tx;
    const lv = Math.max(amb, state.light ? state.light[i] : 0);
    const okLight = lv >= def.lightMin;
    label = `光照 ${lv.toFixed(1)} / 需 ${def.lightMin}${okLight ? '' : ' · 太暗'}`;
    col = okLight ? '#9ef7a8' : '#ff8a6a';
    ring(1.2, col, [2, 2]);
  }
  if (label) drawPreviewLabel(ctx, label, cx, gy, col);
}

// 拖矩形时的范围框：整块淡色 + 虚线边 + “多少格 / 松手放下”标签
// tooBig 时变红且不落地（跟 main.js 的 RECT_MAX 对齐 —— 这里只做提示，不做逻辑）
function drawDragRect(ctx, r, ox, oy) {
  const x = r.x0 * TILE - ox, y = r.y0 * TILE - oy;
  const w = (r.x1 - r.x0 + 1) * TILE, h = (r.y1 - r.y0 + 1) * TILE;
  const tooBig = r.n > 1600;
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = tooBig ? '#ff5a50' : '#8cf0c8';
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = tooBig ? 'rgba(255,90,80,0.95)' : 'rgba(140,240,200,0.95)';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.restore();
  const txt = tooBig
    ? `矩形 ${r.n} 格 · 太多了（上限 1600）`
    : `矩形 ${r.w}×${r.h} = ${r.n} 格 · 松手放下`;
  drawPreviewLabel(ctx, txt, x + w / 2, y + h - TILE, tooBig ? '#ff8a6a' : '#9ef7a8');
}

function drawPreviewLabel(ctx, txt, cx, topY, col) {
  ctx.save();
  ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  const w = ctx.measureText(txt).width;
  const y = topY + TILE + 3;
  ctx.fillStyle = 'rgba(6,10,18,0.82)';
  ctx.fillRect(Math.round(cx - w / 2 - 5), y, Math.round(w + 10), 13);
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(cx - w / 2 - 5) + 0.5, y + 0.5, Math.round(w + 10) - 1, 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.fillText(txt, Math.round(cx), y + 10);
  ctx.restore();
  ctx.textAlign = 'start';
}

// 出口引导：只在玩家进入出口走廊附近时显示，避免常驻标记遮挡探索视野。
function drawExitMarkers(ctx, m, ox, oy) {
  if (state.layerId !== 'surface' || !m || !state.player) return;
  const p = state.player;
  const half = SURVIVAL.CHUNK.EXIT_HALF;
  const edge = Math.max(2, SURVIVAL.CHUNK.EXIT_CORRIDOR | 0);
  const reveal = SURVIVAL.CHUNK.EXIT_TRIGGER + 12;
  const mx = m.w / 2, my = m.h / 2;
  const nearWest = p.x <= reveal && Math.abs(p.y - my) <= half + 5;
  const nearEast = p.x >= m.w - 1 - reveal && Math.abs(p.y - my) <= half + 5;
  const nearNorth = p.y <= reveal && Math.abs(p.x - mx) <= half + 5;
  const nearSouth = p.y >= m.h - 1 - reveal && Math.abs(p.x - mx) <= half + 5;
  const pulse = 0.72 + 0.18 * Math.sin(performance.now() / 260);
  ctx.save();
  ctx.strokeStyle = `rgba(170,235,255,${pulse.toFixed(2)})`;
  ctx.fillStyle = `rgba(170,235,255,${(pulse * 0.9).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const arrow = (x, y, dx, dy) => {
    const px = x * TILE - ox + TILE / 2, py = y * TILE - oy + TILE / 2;
    const tx = px + dx * 7, ty = py + dy * 7;
    ctx.beginPath(); ctx.moveTo(px - dx * 5, py - dy * 5); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(tx - dx * 4 - dy * 3, ty - dy * 4 + dx * 3);
    ctx.lineTo(tx - dx * 4 + dy * 3, ty - dy * 4 - dx * 3);
    ctx.closePath(); ctx.fill();
  };
  if (nearWest) arrow(edge + 1, Math.round(my), -1, 0);
  if (nearEast) arrow(m.w - edge - 2, Math.round(my), 1, 0);
  if (nearNorth) arrow(Math.round(mx), edge + 1, 0, -1);
  if (nearSouth) arrow(Math.round(mx), m.h - edge - 2, 0, 1);
  ctx.restore();
}

export function draw(ctx) {
  const tAll = pnow();
  const m = state.map, light = state.light, lightMax = state.lightMax;
  const amb = ambientOf(state);             // 环境光 0..1（白天全亮/蚀潮黑）
  const ox = Math.round(state.camera.x * TILE - VIEW_W / 2);
  const oy = Math.round(state.camera.y * TILE - VIEW_H / 2);

  ctx.fillStyle = `rgb(${DARK[0]},${DARK[1]},${DARK[2]})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const x0 = Math.max(0, (ox / TILE) | 0), x1 = Math.min(m.w - 1, Math.ceil((ox + VIEW_W) / TILE));
  const y0 = Math.max(0, (oy / TILE) | 0), y1 = Math.min(m.h - 1, Math.ceil((oy + VIEW_H) / TILE));

  // --- 地形：烘焙底图一次 blit + 光照遮罩一次叠加（W13-C）——取代原来 1426 格逐格 mix/字符串拼接 ---
  const tTiles = pnow();
  const terr = ensureTerrain(m);
  const vw = x1 - x0 + 1, vh = y1 - y0 + 1;
  const sx = x0 * TILE, sy = y0 * TILE;
  const dx = sx - ox, dy = sy - oy;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terr.cv, sx, sy, vw * TILE, vh * TILE, dx, dy, vw * TILE, vh * TILE);
  drawLightMask(ctx, m, light, lightMax, amb, terr, dx, dy, vw, vh, x0, y0, x1, y1);

  // --- 蚀痕：黑暗腐蚀出的紫黑结晶（白天也看得见，提示"该清理了"） ---
  pmark('draw.tiles', tTiles);
  const tBlight = pnow();
  const blight = m.blight;
  if (blight) {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ii = ty * m.w + tx;
        const lvl = blight[ii];
        if (!lvl) continue;
        const px = tx * TILE - ox, py = ty * TILE - oy;
        const a = 0.20 + 0.16 * lvl;
        ctx.fillStyle = `rgba(58,18,86,${a.toFixed(2)})`;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = `rgba(150,80,220,${(0.16 + 0.10 * lvl).toFixed(2)})`;
        ctx.fillRect((px + 2 + speck(tx, ty, 11) * 9) | 0, (py + 3 + speck(tx, ty, 12) * 8) | 0, 3, 3);
        ctx.fillStyle = `rgba(96,40,150,${(0.3 + 0.15 * lvl).toFixed(2)})`;
        ctx.fillRect((px + 6 + speck(tx, ty, 13) * 6) | 0, (py + 8 + speck(tx, ty, 14) * 5) | 0, 2, 2);
        if (lvl >= 3) {                    // 3 级：脉动警示（会渗漏出蚀兽）
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280 + tx + ty);
          ctx.fillStyle = `rgba(200,120,255,${(0.20 + 0.25 * pulse).toFixed(2)})`;
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
      }
    }
  }

  // --- 区块出口箭头：接近走廊时指向可穿越的边界 ---
  drawExitMarkers(ctx, m, ox, oy);

  // --- 辉髓矿脉 / 遗迹碑 / 岩浆：黑暗中隐约自发光脉冲（逐帧动画层） ---
  const tTerr = pnow();
  ctx.globalCompositeOperation = 'lighter';
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tt = m.tiles[ty * m.w + tx];
      if (tt === T.ORE || tt === T.RELIC || tt === T.MOTHER) {
        const relic = tt === T.RELIC, mother = tt === T.MOTHER;
        const gx = tx * TILE - ox + 8, gy = ty * TILE - oy + 8;
        const speed = mother ? 240 : relic ? 420 : 300;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / speed + (tx * 7 + ty * 13));
        ctx.fillStyle = mother
          ? `rgba(255,205,110,${(0.16 + 0.10 * pulse).toFixed(3)})`
          : relic
            ? `rgba(190,155,255,${(0.14 + 0.09 * pulse).toFixed(3)})`
            : `rgba(90,235,205,${(0.10 + 0.07 * pulse).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(gx, gy, (mother ? 5 : relic ? 4 : 3) + pulse * 2.2, 0, 7); ctx.fill();
      } else if (tt === T.LAVA) {                  // 岩浆亮泡（底图里的裂纹是静态的，这里只补会动的那层）
        const gx = tx * TILE - ox, gy = ty * TILE - oy;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420 + tx * 0.7 + ty * 1.3);
        ctx.fillStyle = `rgba(255,236,170,${(0.35 + pulse * 0.4).toFixed(2)})`;
        ctx.fillRect(gx + 3 + ((speck(tx, ty, 8) * 6) | 0), gy + 3 + ((speck(tx, ty, 9) * 6) | 0), 4, 3);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- 营地篝火（引路篝火）：石圈 + 交叠柴堆 + 跳动的火焰（它同时是仓库，悬停可看） ---
  pmark('draw.beacons', tTerr);
  {
    const ft = performance.now();
    for (const b of state.beacons) {
      const cx = Math.round((b.x + 0.5) * TILE - ox), cy = Math.round((b.y + 0.5) * TILE - oy);
      if (cx < -TILE * 2 || cy < -TILE * 2 || cx > VIEW_W + TILE * 2 || cy > VIEW_H + TILE * 2) continue;
      const flick = 0.5 + 0.5 * Math.sin(ft / 170 + b.x * 3.1 + b.y * 1.7);
      const flick2 = 0.5 + 0.5 * Math.sin(ft / 91 + b.y * 2.3);
      const lit = 0.45 + 0.55 * (1 - amb * 0.8);                  // 白天偏弱、夜里最亮
      // 地面：先给暖光池、再压一层很小的焦痕
      //   【为什么改】旧版先叠了一圈 7.2×3.5、alpha 0.55 的**近黑**椭圆（rgba(26,20,16,0.55)），
      //   把篝火自己那格（光图上本来就是最亮，见 world/light.js 的 d===0 分支）的苔地整块盖掉
      //   → 实测“篝火格下半带亮度 155.7，比周围邻格平均 162.3 还暗”，玩家看到的就是
      //     “篝火底下没被照到”。现在：焦痕缩到 3.6×1.6、alpha 0.2（只在柴堆正下方），
      //     再补一层暖色光池（additive）——脚不那格才是全屏最亮的。
      ctx.globalCompositeOperation = 'lighter';
      const pool = ctx.createRadialGradient(cx, cy + 1, 1, cx, cy + 1, 12);
      pool.addColorStop(0, `rgba(255,182,112,${(0.46 * lit).toFixed(3)})`);
      pool.addColorStop(0.5, `rgba(255,140,66,${(0.20 * lit).toFixed(3)})`);
      pool.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = pool;
      ctx.beginPath(); ctx.ellipse(cx, cy + 1.2, 12, 8, 0, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(34,24,17,0.20)';                       // 柴堆正下方那一点点焦痕
      ctx.beginPath(); ctx.ellipse(cx, cy + 4.2, 3.6, 1.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#544b42';                                   // 围石
      for (const [dx, dy] of [[-6.2, 1.4], [6.2, 1.4], [-4.4, 4.4], [4.4, 4.4], [0, 5.2], [-6.4, -1.4], [6.4, -1.4]]) {
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy * 0.7, 1.7, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = '#6d4a2a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';   // 交叠柴堆
      ctx.beginPath();
      ctx.moveTo(cx - 4.6, cy + 3.4); ctx.lineTo(cx + 4.2, cy + 0.6);
      ctx.moveTo(cx + 4.6, cy + 3.4); ctx.lineTo(cx - 4.2, cy + 0.6);
      ctx.stroke(); ctx.lineCap = 'butt';
      const hgt = 5.4 + flick * 2.2, wid = 3.7 + flick2 * 0.8;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,120,40,${(0.50 * lit).toFixed(2)})`;             // 外焰
      ctx.beginPath(); ctx.ellipse(cx, cy - 1.4 - hgt * 0.26, wid, hgt * 0.72, 0, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,196,70,${(0.62 * lit).toFixed(2)})`;             // 内焰
      ctx.beginPath(); ctx.ellipse(cx, cy - 1.8 - hgt * 0.22, wid * 0.62, hgt * 0.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,246,214,${(0.75 * lit).toFixed(2)})`;            // 火芯
      ctx.beginPath(); ctx.ellipse(cx, cy - 0.7, wid * 0.3, hgt * 0.24 + flick2, 0, 0, 7); ctx.fill();
      const sy = cy - 4 - ((ft / 26 + b.x * 7) % 12);                            // 火星往上飘      ctx.fillStyle = `rgba(255,210,140,${(0.5 * lit).toFixed(2)})`;
      ctx.fillRect(cx + Math.sin(ft / 300 + b.x) * 3, sy, 1.4, 1.4);
      ctx.globalCompositeOperation = 'source-over';
      if (b.hp != null && b.hp < (b.maxHp || 300)) {      // 营地灯受损
        const w = 18, hw = (w * Math.max(0, b.hp / (b.maxHp || 300))) | 0;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 9, cy - 15, w, 3);
        ctx.fillStyle = '#ff9de0'; ctx.fillRect(cx - 9, cy - 15, hw, 3);
      }
    }
  }

  // --- 玩家建造物（木墙 / 灯柱 / 熔炉） ---
  const tBuild = pnow();
  const lit = (i) => {
    const lv = state.light ? state.light[i] : 0;
    return clamp(Math.max(amb, (lv - 0.5) / (state.lightMax * 0.7)), 0, 1);
  };
  for (const b of state.buildings) {
    const bx = b.x * TILE - ox, by = b.y * TILE - oy;
    if (bx < -TILE || by < -TILE || bx > VIEW_W || by > VIEW_H) continue;
    const f = lit(b.y * state.map.w + b.x);
    if (b.site) {                                        // 工地：脚手架 + 工期进度条（还没盖起来）
      const sdef = BUILD[b.type] || {};
      const need = workOf(b.type);
      const frac = Math.max(0, Math.min(1, (b.work || 0) / need));
      ctx.save();
      ctx.strokeStyle = 'rgba(148,178,208,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 1.5, by + 1.5, TILE - 3, TILE - 3);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(120,152,186,0.10)';
      ctx.fillRect(bx + 2, by + 2, TILE - 4, TILE - 4);
      ctx.strokeStyle = sdef.color || '#9fe8ff';            // 四角标出“这里将来是什么”
      ctx.lineWidth = 1.5;
      const c = 3;
      ctx.beginPath();
      ctx.moveTo(bx + 1, by + 1 + c); ctx.lineTo(bx + 1, by + 1); ctx.lineTo(bx + 1 + c, by + 1);
      ctx.moveTo(bx + TILE - 1 - c, by + 1); ctx.lineTo(bx + TILE - 1, by + 1); ctx.lineTo(bx + TILE - 1, by + 1 + c);
      ctx.moveTo(bx + TILE - 1, by + TILE - 1 - c); ctx.lineTo(bx + TILE - 1, by + TILE - 1); ctx.lineTo(bx + TILE - 1 - c, by + TILE - 1);
      ctx.moveTo(bx + 1 + c, by + TILE - 1); ctx.lineTo(bx + 1, by + TILE - 1); ctx.lineTo(bx + 1, by + TILE - 1 - c);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 2, by + TILE - 3.5, TILE - 4, 3);
      const sp = 0.6 + 0.4 * Math.sin(performance.now() / 300 + b.x + b.y);
      ctx.fillStyle = frac >= 1 ? '#9ef7d8' : `rgba(255,215,110,${(0.5 + 0.35 * sp).toFixed(2)})`;
      ctx.fillRect(bx + 2, by + TILE - 3.5, Math.max(1, ((TILE - 4) * frac) | 0), 3);
      ctx.restore();
      continue;
    }
    if (b.type === 'wall' || b.type === 'stoneWall' || b.type === 'gate' || b.type === 'barricade') {
      if (b.type === 'gate' && b.open) {
        ctx.strokeStyle = `rgba(215,181,138,${(0.45 + 0.35 * f).toFixed(2)})`;
        ctx.lineWidth = 2; ctx.strokeRect(bx + 3, by + 3, TILE - 6, TILE - 6);
        ctx.beginPath(); ctx.moveTo(bx + 4, by + 8); ctx.lineTo(bx + TILE - 4, by + 8); ctx.stroke();
        continue;
      }
      const base = b.type === 'stoneWall' ? [145, 155, 168] : b.type === 'barricade' ? [164, 116, 75] : [143, 108, 72];
      const c = mix(DARK, base, f * 0.9);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      if (b.type === 'barricade') {
        ctx.fillRect(bx + 1, by + 5, TILE - 2, 6);
        ctx.strokeStyle = 'rgba(60,35,20,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx + 3, by + 3); ctx.lineTo(bx + 13, by + 13); ctx.moveTo(bx + 13, by + 3); ctx.lineTo(bx + 3, by + 13); ctx.stroke();
      } else ctx.fillRect(bx + 1, by + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = `rgba(20,14,8,${(0.4 + 0.4 * f).toFixed(2)})`;
      ctx.strokeRect(bx + 0.5, by + 0.5, TILE - 1, TILE - 1);
    } else if (b.type === 'lamp') {
      const fuel = b.fuel > 0;
      const lv = b.level == null ? 1 : b.level;
      const c = mix(DARK, fuel ? [150, 220, 255] : [74, 82, 96], f);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 4, by + 8, 8, 6);                  // 杆座
      ctx.save(); ctx.translate(bx + 8, by + 8); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = fuel ? '#eafcff' : '#8a93a8';
      ctx.fillRect(-3, -3, 6, 6); ctx.restore();
      if (fuel) {                                          // 灯芯（亮度越大越亮）
        ctx.fillStyle = `rgba(210,245,255,${(0.65 + 0.35 * lv / 2).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 3, 1.6 + lv * 0.7, 0, 7); ctx.fill();
      }
      for (let k = 0; k <= lv; k++) {                      // 档位指示：底部 1~3 点
        ctx.fillStyle = fuel ? '#bfe9ff' : '#6d7787';
        ctx.fillRect(bx + 3 + k * 3, by + TILE - 3, 2, 2);
      }
    } else if (b.type === 'purifier') {                    // 净光柱：紫色，会净化蚀痕
      const fuel = b.fuel > 0;
      const c = mix(DARK, fuel ? [190, 170, 255] : [78, 74, 96], f);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 5, by + 5, 6, TILE - 7);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300 + b.x * 3);
      if (fuel) {
        ctx.fillStyle = `rgba(216,198,255,${(0.5 + 0.35 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 4, 2.2 + pulse, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(200,170,255,${(0.25 + 0.25 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 8, 6 + pulse * 1.5, 0, 7); ctx.stroke();
      }
      const lvP = b.level == null ? 1 : b.level;
      for (let k = 0; k <= lvP; k++) {
        ctx.fillStyle = fuel ? '#d8c6ff' : '#6d7787';
        ctx.fillRect(bx + 2 + k * 3, by + TILE - 3, 2, 2);
      }
    } else if (b.type === 'furnace') {                  // 熔炉：有火种才暖、才冒烟（冷了就是块石头）
      const hot = !b.off && (b.fuel || 0) > 0;
      const c = mix(DARK, hot ? [116, 88, 78] : [86, 84, 92], (hot ? 0.5 + f * 0.5 : f * 0.75));
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 2, by + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = 'rgba(34,26,24,0.9)';                       // 炉口
      ctx.fillRect(bx + 5, by + TILE - 7, TILE - 10, 4);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220 + (b.x * 7 + b.y * 13));
      if (hot) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,150,70,${(0.4 + 0.35 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 8, 2.5 + pulse, 0, 7); ctx.fill();
        ctx.fillRect(bx + 6, by + TILE - 7, TILE - 12, 3);        // 炉口亮
        ctx.globalCompositeOperation = 'source-over';
        const black = (b.recipe || 'fuel') === 'coal';            // 烧炭：黑烟；炼油：淡青烟
        for (let k = 0; k < 2; k++) {
          const t = ((performance.now() / (black ? 900 : 1300) + k * 0.5 + b.x * 0.3) % 1);
          ctx.fillStyle = black ? `rgba(60,56,60,${(0.3 * (1 - t)).toFixed(2)})`
            : `rgba(150,180,190,${(0.2 * (1 - t)).toFixed(2)})`;
          ctx.beginPath(); ctx.arc(bx + 8 + Math.sin(t * 6 + k) * 2, by + 1 - t * 8, 1.2 + t * 1.5, 0, 7); ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(120,120,130,0.35)';                 // 冷炉：炉口一点灰
        ctx.fillRect(bx + 6, by + TILE - 7, TILE - 12, 3);
      }
    } else if (b.type === 'farm' || b.type === 'mycobed') {                     // 农田/菌床：随生长度长高
      const g = b.growth || 0;
      const soil = mix(DARK, b.type === 'mycobed' ? [72, 55, 88] : [92, 70, 52], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${soil[0] | 0},${soil[1] | 0},${soil[2] | 0})`;
      ctx.fillRect(bx + 1, by + 1, TILE - 2, TILE - 2);
      const grow = mix(DARK, b.type === 'mycobed' ? [190, 130, 230] : [110, 220, 130], 0.4 + f * 0.6);
      ctx.fillStyle = `rgb(${grow[0] | 0},${grow[1] | 0},${grow[2] | 0})`;
      const n = 1 + Math.floor(g * 4);
      for (let k = 0; k < n; k++) ctx.fillRect(bx + 3 + k * 3, by + TILE - 4 - g * 5, 2, 3 + g * 4);
      if (g >= 1) {                                     // 成熟：发光提示可采收
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260 + b.x);
        ctx.fillStyle = b.type === 'mycobed' ? `rgba(225,190,255,${(0.35 + 0.3 * pulse).toFixed(2)})` : `rgba(190,255,190,${(0.35 + 0.3 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 6, 2 + pulse, 0, 7); ctx.fill();
      }
    } else if (b.type === 'bench') {                    // 制造台：工作台 + 锤子；制作中有火花
      const c = mix(DARK, [120, 150, 130], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 1, by + 4, TILE - 2, TILE - 7);          // 台面
      ctx.fillStyle = `rgba(90,68,46,${(0.55 + 0.35 * f).toFixed(2)})`;
      ctx.fillRect(bx + 1, by + 10, TILE - 2, 3);                 // 台腿阴影
      ctx.fillStyle = '#cfe0f0';
      ctx.fillRect(bx + 3, by + 2, 2, 6);                         // 镐
      ctx.fillRect(bx + 2, by + 2, 4, 1.6);
      ctx.fillStyle = '#e0b96a';
      ctx.fillRect(bx + 10, by + 2, 1.6, 6);                      // 柄
      ctx.fillRect(bx + 9, by + 1, 3.6, 1.6);
      if (b.craft) {                                              // 正在做东西：火星
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90 + b.x);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,220,140,${(0.35 + 0.4 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 7, 2 + pulse * 1.6, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        const frac = Math.max(0, Math.min(1, b.craft.t / b.craft.sec));
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 2, by + TILE - 3.5, TILE - 4, 3);
        ctx.fillStyle = '#bfe0c0';
        ctx.fillRect(bx + 2, by + TILE - 3.5, Math.max(1, ((TILE - 4) * frac) | 0), 3);
      }
    } else if (b.type === 'bunk') {                    // 简易铺位：木架 + 枕头，避免和空地混在一起
      const c = mix(DARK, [156, 120, 82], 0.4 + f * 0.6);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 1, by + 3, TILE - 2, TILE - 5);
      ctx.fillStyle = `rgba(226,204,174,${(0.65 + 0.3 * f).toFixed(2)})`;
      ctx.fillRect(bx + 3, by + 5, TILE - 6, 5);            // 床垫
      ctx.fillStyle = `rgba(190,214,230,${(0.7 + 0.25 * f).toFixed(2)})`;
      ctx.fillRect(bx + 4, by + 5, 4, 3);                  // 枕头
      ctx.strokeStyle = `rgba(80,58,40,${(0.6 + 0.3 * f).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 1.5, by + 3.5, TILE - 3, TILE - 5);
      ctx.fillStyle = '#d7b58a';
      ctx.fillRect(bx + 2, by + TILE - 3, 3, 2); ctx.fillRect(bx + TILE - 5, by + TILE - 3, 3, 2);
    } else if (b.type === 'clinic') {                 // 医疗站：白色十字 + 青色诊疗灯
      const c = mix(DARK, [88, 150, 145], 0.4 + f * 0.6);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 1, by + 2, TILE - 2, TILE - 4);
      ctx.fillStyle = `rgba(220,248,240,${(0.72 + 0.22 * f).toFixed(2)})`;
      ctx.fillRect(bx + 6, by + 4, 4, 9); ctx.fillRect(bx + 4, by + 6.5, 8, 4);
      if (b.medicalWorker) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180 + b.x);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(159,232,213,${(0.28 + 0.35 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 3, 2 + pulse, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        const frac = Math.max(0, Math.min(1, (b.medicalWorker.medicalT || 0) / SURVIVAL.RESCUE.MEDICAL_SECS));
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 2, by + TILE - 3.5, TILE - 4, 3);
        ctx.fillStyle = '#9fe8d5'; ctx.fillRect(bx + 2, by + TILE - 3.5, Math.max(1, ((TILE - 4) * frac) | 0), 3);
      }
    } else if (b.type === 'smelter') {                  // 自动熔炉：砖体 + 炉口火光 + 炊烟
      const hot = !b.off && b.fuel > 0;
      const c = mix(DARK, hot ? [140, 100, 86] : [86, 78, 78], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 2, by + 3, TILE - 4, TILE - 5);
      ctx.fillStyle = 'rgba(40,26,20,0.85)';
      ctx.fillRect(bx + 5, by + TILE - 8, TILE - 10, 4);          // 炉口
      ctx.fillRect(bx + 3, by + 1, TILE - 6, 2);                  // 烟囱口
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150 + b.x * 3);
      if (hot) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,150,60,${(0.4 + 0.4 * pulse).toFixed(2)})`;
        ctx.fillRect(bx + 6, by + TILE - 8, TILE - 12, 3);
        ctx.fillStyle = `rgba(255,220,140,${(0.3 + 0.35 * ((pulse + 0.5) % 1)).toFixed(2)})`;
        ctx.fillRect(bx + 7, by + TILE - 7, TILE - 14, 2);
        if (b.prog > 0) {                                          // 正在炼：炉口亮一截进度
          ctx.fillStyle = 'rgba(255,236,170,0.85)';
          ctx.fillRect(bx + 5, by + TILE - 3, 1 + ((TILE - 10) * Math.min(1, b.prog / 4)) | 0, 1.6);
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let k = 0; k < 2; k++) {                              // 炊烟
          const t = ((performance.now() / 900 + k * 0.5 + b.x * 0.3) % 1);
          ctx.fillStyle = `rgba(180,180,190,${(0.22 * (1 - t)).toFixed(2)})`;
          ctx.beginPath(); ctx.arc(bx + 8 + Math.sin(t * 6 + k) * 2, by + 1 - t * 9, 1.4 + t * 1.6, 0, 7); ctx.fill();
        }
      }
    } else if (b.type === 'shaft') {                    // 深潜竖井（入口=上行 / 自建=下行）
      const entry = !!b.entry;
      const base = entry ? [90, 200, 235] : [235, 190, 90];
      const c = mix(DARK, base, 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 3, by + 3, TILE - 6, TILE - 6);
      ctx.strokeStyle = entry ? 'rgba(200,245,255,0.75)' : 'rgba(255,222,150,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx + 8, by + 8, 4.5, 0, 7); ctx.stroke();
      // 方向箭头：入口井向上（回地表），自建井向下（更深）
      ctx.strokeStyle = entry ? 'rgba(210,248,255,0.95)' : 'rgba(255,226,160,0.95)';
      for (let k = 0; k < 2; k++) {
        const yy = entry ? by + 5 + k * 3 : by + 11 - k * 3;
        ctx.beginPath();
        ctx.moveTo(bx + 5, yy); ctx.lineTo(bx + 8, yy + (entry ? -2.5 : 2.5)); ctx.lineTo(bx + 11, yy);
        ctx.stroke();
      }
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300 + b.x);
      ctx.fillStyle = entry
        ? `rgba(127,224,255,${(0.5 + 0.4 * pulse).toFixed(2)})`
        : `rgba(255,206,120,${(0.5 + 0.4 * pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(bx + 8, by + 8, 1.6 + pulse, 0, 7); ctx.fill();
    } else if (b.type === 'towerGlow' || b.type === 'towerShock' || b.type === 'towerChain') {
      const isShock = b.type === 'towerShock';
      const isChain = b.type === 'towerChain';
      const lv = state.light ? state.light[b.y * state.map.w + b.x] : 0;
      const live = lv >= 3.2;                       // 有光才充能
      const base = isShock ? [150, 120, 210] : isChain ? [232, 196, 96] : [120, 210, 235];
      const c = mix(DARK, live ? base : [70, 74, 84], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 1, by + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = live ? (isShock ? '#d7c2ff' : isChain ? '#fff3c2' : '#cdf6ff') : '#5b6270';
      if (isChain) {                                // 连锁光塔：菱形内核（与圆点塔一眼分开）
        ctx.beginPath();
        ctx.moveTo(bx + 8, by + 4.6); ctx.lineTo(bx + 11.4, by + 8);
        ctx.lineTo(bx + 8, by + 11.4); ctx.lineTo(bx + 4.6, by + 8);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(bx + 8, by + 8, 3.2, 0, 7); ctx.fill();
      }
      if (live) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260 + (b.x + b.y));
        ctx.strokeStyle = isShock
          ? `rgba(200,160,255,${(0.35 + 0.3 * pulse).toFixed(2)})`
          : isChain
            ? `rgba(255,229,150,${(0.35 + 0.3 * pulse).toFixed(2)})`
            : `rgba(159,232,255,${(0.35 + 0.3 * pulse).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bx + 8, by + 8, 6 + pulse, 0, 7); ctx.stroke();
      }
      // 载荷指示（W14-A 第 2 步）：塔顶小格 = 装了几个修饰器 —— 站远处也能看出哪座塔"调过"
      const nMod = (b.mods || []).length;
      if (nMod > 0) {
        for (let k = 0; k < Math.min(nMod, 3); k++) {
          ctx.fillStyle = isShock ? 'rgba(215,194,255,0.95)' : isChain ? 'rgba(255,243,194,0.95)' : 'rgba(205,246,255,0.95)';
          ctx.fillRect(bx + 2.5 + k * 3.2, by + 1.5, 2.4, 2.4);
        }
      }
    } else if (b.type === 'prism') {                    // 棱镜：三角玻璃（点亮=接力中，灭=一块废玻璃）
      const on = b.relayHop != null;
      const base = on ? [170, 226, 255] : [88, 96, 110];
      const c = mix(DARK, base, 0.3 + f * 0.7);
      ctx.beginPath();                                    // 三角镜面（和灯柱的菱形一眼能分开）
      ctx.moveTo(bx + 8, by + 1.5);
      ctx.lineTo(bx + 14.5, by + 14);
      ctx.lineTo(bx + 1.5, by + 14);
      ctx.closePath();
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fill();
      ctx.strokeStyle = on ? 'rgba(220,248,255,0.9)' : 'rgba(140,150,168,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();                                    // 内芯
      ctx.moveTo(bx + 8, by + 5.5);
      ctx.lineTo(bx + 11.4, by + 12);
      ctx.lineTo(bx + 4.6, by + 12);
      ctx.closePath();
      ctx.fillStyle = on ? '#eafaff' : 'rgba(120,132,150,0.7)';
      ctx.fill();
      if (on) {                                           // 接力中：顶端一点火花 + 呼吸
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 340 + b.x * 2);
        ctx.fillStyle = `rgba(230,250,255,${(0.5 + 0.5 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 2.5, 1 + pulse, 0, 7); ctx.fill();
      }
      if (b.hp != null) {                                 // 结构条（它很脆，碎了就是断光）
        const frac = Math.max(0, Math.min(1, b.hp / (BUILD.prism.hp || 22)));
        if (frac < 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 2, by + TILE - 2.5, TILE - 4, 2);
          ctx.fillStyle = frac > 0.5 ? '#9ef7d8' : '#ffb3a0';
          ctx.fillRect(bx + 2, by + TILE - 2.5, ((TILE - 4) * frac) | 0, 2);
        }
      }
    } else if (b.type === 'decoy') {                    // 诱饵灯：看着像灯，但没有一点真光（虚线框标记它是假的）
      const fuel = b.fuel > 0;
      const c = mix(DARK, fuel ? [120, 148, 178] : [66, 72, 84], 0.3 + f * 0.7);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 4, by + 8, 8, 6);                  // 杆座（与灯柱一样）
      ctx.save(); ctx.translate(bx + 8, by + 8); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = fuel ? '#c3d4e6' : '#7c8798';
      ctx.fillRect(-3, -3, 6, 6); ctx.restore();
      ctx.setLineDash([2, 2]);                             // 虚线：那不是光
      ctx.strokeStyle = fuel ? 'rgba(170,200,230,0.85)' : 'rgba(120,130,145,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 1.5, by + 1.5, TILE - 3, TILE - 3);
      ctx.setLineDash([]);
      const frac = Math.max(0, Math.min(1, (b.fuel || 0) / (BUILD.decoy.maxFuel || 20)));
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 3, by + TILE - 3, TILE - 6, 2);
      ctx.fillStyle = '#9fc3e0'; ctx.fillRect(bx + 3, by + TILE - 3, ((TILE - 6) * frac) | 0, 2);
    } else if (b.type === 'store') {                    // 储物箱：容量条 + 满仓变红
      const c = mix(DARK, [150, 124, 88], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 2, by + 3, TILE - 4, TILE - 6);
      ctx.strokeStyle = 'rgba(220,196,150,0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 2.5, by + 3.5, TILE - 5, TILE - 7);
      ctx.fillStyle = 'rgba(220,196,150,0.6)';           // 箱盖缝
      ctx.fillRect(bx + 3, by + 5, TILE - 6, 1);
      const cap = BUILD.store.store || 60;
      const used = b.stock ? Object.keys(b.stock).reduce((a, k) => a + (b.stock[k] || 0), 0) : 0;
      const frac = Math.max(0, Math.min(1, used / cap));
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx + 3, by + TILE - 3, TILE - 6, 2);
      ctx.fillStyle = frac >= 1 ? '#ff8f6e' : '#e0c48a';
      ctx.fillRect(bx + 3, by + TILE - 3, Math.max(1, ((TILE - 6) * frac) | 0), 2);
      // 满仓只把容量条变红；不再整格闪红，避免箱子本体被警示色吞掉。
    } else if (b.type === 'cache') {                    // 补给站：木箱 + 燃料条（只建在深渊）
      const c = mix(DARK, [150, 112, 62], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 2, by + 3, TILE - 4, TILE - 6);
      ctx.strokeStyle = 'rgba(255,214,150,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 2.5, by + 3.5, TILE - 5, TILE - 7);
      ctx.fillStyle = 'rgba(255,214,150,0.75)';
      ctx.fillRect(bx + 2, by + 8, TILE - 4, 1);
      const frac = Math.max(0, Math.min(1, (b.fuel || 0) / BUILD.cache.maxFuel));
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx + 3, by + TILE - 3, TILE - 6, 2);
      ctx.fillStyle = '#ffcf8a'; ctx.fillRect(bx + 3, by + TILE - 3, ((TILE - 6) * frac) | 0, 2);
      if (b.fuel > 0) {                                 // 有油：微微呼吸的暖光
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 600 + b.x);
        ctx.fillStyle = `rgba(255,207,138,${(0.16 + 0.16 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 8, 6, 0, 7); ctx.fill();
      }
    } else if (b.type === 'analyzer') {                 // 解析台：斜面书桌 + 展开的残页（有残页时泛紫光）
      const relics = state.relicTotal || 0;
      const c = mix(DARK, relics > 0 ? [150, 130, 190] : [110, 106, 126], 0.35 + f * 0.65);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(bx + 2, by + 5, TILE - 4, TILE - 8);           // 桌体
      ctx.fillStyle = 'rgba(216,198,255,0.85)';                    // 斜面上的纸
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + 8); ctx.lineTo(bx + 12, by + 3);
      ctx.lineTo(bx + 13.5, by + 6); ctx.lineTo(bx + 5.5, by + 10.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,96,160,0.9)';                    // 纸上的字
      ctx.lineWidth = 0.7;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(bx + 5.2 + k * 0.6, by + 8.6 - k * 0.4);
        ctx.lineTo(bx + 11.6 + k * 0.6, by + 4.4 - k * 0.4);
        ctx.stroke();
      }
      if (relics > 0) {                                            // 有线索：微微的紫光（"这里能解析"的暗示）
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 520 + b.x);
        ctx.fillStyle = `rgba(216,198,255,${(0.12 + 0.14 * pulse).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx + 8, by + 7, 6.5, 0, 7); ctx.fill();
      }
    }
  }
  // --- 光路（棱镜接力链）：让玩家一眼看懂光是从哪接过来的 ---
  pmark('draw.buildings', tBuild);
  const tPrism = pnow();
  if (state.prismLinks && state.prismLinks.length) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const l of state.prismLinks) {
      const x1 = l.x1 * TILE - ox, y1 = l.y1 * TILE - oy;
      const x2 = l.x2 * TILE - ox, y2 = l.y2 * TILE - oy;
      if ((x1 < -40 && x2 < -40) || (y1 < -40 && y2 < -40)) continue;
      if ((x1 > VIEW_W + 40 && x2 > VIEW_W + 40) || (y1 > VIEW_H + 40 && y2 > VIEW_H + 40)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380 + l.x2);
      ctx.strokeStyle = `rgba(170,226,255,${(0.28 + 0.32 * pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  // --- 建造幽灵光标（绿=可放 / 红=不可放）/ 拆除红框 ---
  const cur = state.cursor;
  if (cur.show && state.demolish) {
    // 拆除模式：鼠标下有建筑就红框标出来（附返还提示）
    if (cur.target) {
      const gx = cur.target.x * TILE - ox, gy = cur.target.y * TILE - oy;
      ctx.strokeStyle = 'rgba(255,110,96,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 0.5, gy + 0.5, TILE - 1, TILE - 1);
      ctx.fillStyle = 'rgba(255,90,80,0.22)';
      ctx.fillRect(gx + 1, gy + 1, TILE - 2, TILE - 2);
      ctx.lineWidth = 1;
    }
  } else if (cur.show && state.building) {
    const gx = cur.tx * TILE - ox, gy = cur.ty * TILE - oy;
    const def = BUILD[state.building];
    if (state.dragRect) {                       // 拖矩形中：画整块范围 + 格数（松手才落地）
      drawDragRect(ctx, state.dragRect, ox, oy);
    } else {
      ctx.fillStyle = cur.ok ? 'rgba(140,240,200,0.18)' : 'rgba(255,90,80,0.22)';
      ctx.fillRect(gx + 1, gy + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = cur.ok ? 'rgba(140,240,200,0.85)' : 'rgba(255,90,80,0.85)';
      ctx.strokeRect(gx + 0.5, gy + 0.5, TILE - 1, TILE - 1);
      ctx.fillStyle = def ? def.color : '#fff';
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(gx + 8, gy + 8, 3, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (def) drawBuildPreview(ctx, def, gx, gy, ox, oy, amb);
  }

  // --- 悬停格描边（鼠标下的那一格） ---
  if (cur.show && !state.building && !state.demolish && cur.tx >= 0) {
    const hx = cur.tx * TILE - ox, hy = cur.ty * TILE - oy;
    ctx.strokeStyle = 'rgba(190,225,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx + 0.5, hy + 0.5, TILE - 1, TILE - 1);
  }

  // --- E 交互高亮：站到能交互的东西旁边，就把它框出来并标上能干什么 ---
  const act = state.nearAct;
  if (act) {
    let tx = null, ty = null;
    if (act.kind === 'mine') { tx = act.x; ty = act.y; }
    else if (act.c) { tx = act.c.x; ty = act.c.y; }          // 容器（储物箱 / 营地篝火仓）
    else if (act.b) { tx = act.b.x; ty = act.b.y; }
    else if (act.w) { tx = Math.floor(act.w.x); ty = Math.floor(act.w.y); }
    if (tx != null) {
      const ax = tx * TILE - ox, ay = ty * TILE - oy;
      const col = ACT_COLOR[act.kind] || '#ffe9b0';
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55 + 0.35 * pulse;
      ctx.strokeRect(ax - 0.5, ay - 0.5, TILE + 1, TILE + 1);
      // 四个角标（比整框更轻，不遮地形）
      ctx.lineWidth = 2.5;
      const k = 4;
      for (const [cx2, cy2, dx2, dy2] of [[ax, ay, 1, 1], [ax + TILE, ay, -1, 1], [ax, ay + TILE, 1, -1], [ax + TILE, ay + TILE, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx2 + dx2 * k, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 + dy2 * k);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 标签：E · 采集辉髓
      const label = `E  ${actLabel(act) || ''}`;
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      const tw = ctx.measureText(label).width;
      const lx = Math.round(ax + TILE / 2 - tw / 2), ly = Math.round(ay - 6);
      // 交互提示只留清晰文字，不再铺黑底/描边框挡住地形；角标已经负责指向目标。
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
      ctx.fillStyle = col;
      ctx.fillText(label, lx, ly);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      // 按住 E 时的进度弧（interactCd 从 SPEED 倒数）
      if (state.interactCd > 0) {
        const total = state._actCdTotal || state.interactCd;
        const frac = Math.max(0, Math.min(1, 1 - state.interactCd / total));
        ctx.strokeStyle = 'rgba(255,240,190,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ax + TILE / 2, ay + TILE / 2, TILE * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }
    }
  }

  // --- 侧栏名册 hover：地图上高亮那个拓荒者（找人用） ---
  if (state.hilitWorker) {
    const w = (state.workers || []).find((x) => x.name === state.hilitWorker && x.layerId === state.layerId);
    if (w) {
      const wx = w.x * TILE - ox, wy = w.y * TILE - oy;
      ctx.strokeStyle = 'rgba(255,236,170,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wy, TILE * 0.75, 0, 7); ctx.stroke();
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      const tw = ctx.measureText(w.name).width;
      ctx.fillStyle = 'rgba(6,10,18,0.82)';
      ctx.fillRect(wx - tw / 2 - 4, wy - 26, tw + 8, 13);
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(w.name, wx - tw / 2, wy - 16);
    }
  }

  // --- 光源辉光叠加（暖白=玩家 / 冷白=灯柱/灯柱建筑） ---
  pmark('draw.overlay', tPrism);
  const tGlow = pnow();
  const glows = [];
  {                                                          // 篝火：暖色辉光 + 火光呼吸（跟画面一起闪）
    const gt = performance.now();
    for (const b of state.beacons) {
      glows.push({
        x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE, r: b.radius * TILE,
        c: [255, 224, 170], k: 0.92 + 0.08 * Math.sin(gt / 170 + b.x * 3.1 + b.y * 1.7),
      });
    }
  }
  const pl = state.player;
  glows.push({ x: pl.x * TILE, y: pl.y * TILE, r: pl.lamp.radius * TILE, c: [255, 205, 110] });
  if (state.buildings) {
    for (const b of state.buildings) {
      if (b.site) continue;                                  // 工地不发光
      if (b.type === 'lamp' && b.fuel > 0) {
        glows.push({ x: (b.x + 0.5) * TILE, y: (b.y + 0.35) * TILE, r: BUILD.lamp.radius * TILE, c: [168, 225, 255] });
      } else if (b.type === 'prism' && b.relayHop != null) {
        glows.push({ x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE, r: BUILD.prism.relay.radius * TILE, c: [186, 232, 255], k: 0.75 });
      } else if (b.type === 'decoy' && b.fuel > 0) {
        glows.push({ x: (b.x + 0.5) * TILE, y: (b.y + 0.35) * TILE, r: 3 * TILE, c: [150, 178, 208], k: 0.3 });
      }
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  const glowA = 0.34 * (1 - amb * 0.85) * settings.glow;   // 白天减弱辉光，夜里有存在感
  const glowB = 0.10 * (1 - amb * 0.85) * settings.glow;
  for (const g of glows) {
    const gx = g.x - ox, gy = g.y - oy;
    if (gx < -80 || gy < -80 || gx > VIEW_W + 80 || gy > VIEW_H + 80) continue;
    const k = g.k == null ? 1 : g.k;
    const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, g.r);
    grad.addColorStop(0, `rgba(${g.c[0]},${g.c[1]},${g.c[2]},${(glowA * k).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(${g.c[0]},${g.c[1]},${g.c[2]},${(glowB * k).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${g.c[0]},${g.c[1]},${g.c[2]},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(gx, gy, g.r, 0, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- 玩家（提灯者） ---
  pmark('draw.glow', tGlow);
  const tUnit = pnow();
  const px = Math.round(pl.x * TILE - ox), py = Math.round(pl.y * TILE - oy);
  if (state.echoOn) {                          // 回声视觉：只有母脉层走动时才画（层法则）
    const k = Math.min(1, state.echoT / 0.5);
    ctx.strokeStyle = `rgba(180,225,255,${(0.30 * k).toFixed(2)})`;
    ctx.lineWidth = 2;
    for (let r = 1; r <= 3; r++) {
      const rr = (2 + r * 1.6 + (1 - k) * 3) * TILE;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.stroke();
    }
  }
  drawPixelHuman(ctx, px, py, pl.face || pl.facing || 'down', state.burning > 0 ? '#ffb27a' : '#dfe9ff', state.burning > 0 ? '#ff7a3c' : '#ffd27a', state.equip && state.equip.held, false);
  // 第 5 步 5b：背上的结构体 —— 一圈“背包”轮廓（塔本体在 buildings 里按玩家坐标画，自然就在脚下）
  if (state.carried) {
    ctx.strokeStyle = 'rgba(158,247,216,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, TILE * 0.78, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(158,247,216,0.35)';
    ctx.beginPath(); ctx.arc(px, py, TILE * 0.98, 0, 7); ctx.stroke();
  }
  // 按住 V 的进度环（装卸共用）——玩家必须看得见“还差多少”
  if (state.carryProgress > 0) {
    const frac = Math.max(0, Math.min(1, state.carryProgress));
    ctx.strokeStyle = 'rgba(255,240,190,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, TILE * 1.25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
  }

  // --- 蚀兽（自带微弱辉光，夜里可见其逼近） ---
  for (const e of state.enemies) {
    const ex = e.x * TILE - ox, ey = e.y * TILE - oy;
    if (ex < -24 || ey < -24 || ex > VIEW_W + 24 || ey > VIEW_H + 24) continue;
    const def = ENEMIES[e.ekind];
    const r = e.r * TILE;
    // 黎明消解：整体跟着血量淡出（dawnA 由 waves.dissolveAtDawn 每帧写入；平时为 undefined）
    const fade = e.dawnA == null ? 1 : e.dawnA;
    if (fade < 1) ctx.globalAlpha = Math.max(0, fade);
    const bob = Math.sin(performance.now() / 150 + e.id) * 0.7;      // 躯干微浮动（行为可视化也要用到）
    // —— W14-A 第 3 步：四种行为的“可读性”（预警线/准星环/引信/光环）——
    // 【设计前提】玩家必须**先看到**前摆才有得躲：远程吐蚀的预警线要穿墙画（它的伤害本来就不被墙挡）；
    //   冲锋有收缩准星环；自爆引信越接近闪得越急；庇护兽画出自己的光环半径。
    const ab = def.ability;
    if (e.auraT > 0) {                                  // 被庇护的：脚下一个小圈
      ctx.strokeStyle = `rgba(${def.glow},0.45)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(ex, ey + bob, r + 3, 0, 7); ctx.stroke();
    }
    if (ab === 'aura') {                                // 庇护兽：自己那一圈的范围可读
      ctx.strokeStyle = `rgba(${def.glow},0.15)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ex, ey, ABILITY.aura.RANGE * TILE, 0, 7); ctx.stroke();
    }
    if (ab === 'spit' && e.windT > 0) {                 // 吐蚀预警线（穿墙）+ 收缩准星
      const k = 1 - e.windT / ABILITY.spit.WINDUP;
      const px2 = state.player.x * TILE - ox, py2 = state.player.y * TILE - oy;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(200,255,143,${(0.18 + 0.4 * k).toFixed(2)})`;
      ctx.lineWidth = 1 + k * 1.2;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px2, py2); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(200,255,143,${(0.35 + 0.5 * k).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ex, ey, r + 4 + (1 - k) * 7, 0, 7); ctx.stroke();
    }
    if (ab === 'charge' && e.windT > 0) {               // 冲锋：准星环往里收
      const k = 1 - e.windT / ABILITY.charge.WINDUP;
      ctx.strokeStyle = `rgba(${def.glow},${(0.3 + 0.6 * k).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey, r + 7 - k * 5, 0, 7); ctx.stroke();
    }
    if (e.dashT > 0) {                                  // 突进残影（看得出它冲过来的方向）
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${def.glow},0.45)`;
      ctx.lineWidth = r * 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - e.dashVX * 13, ey - e.dashVY * 13); ctx.lineTo(ex, ey);
      ctx.stroke(); ctx.lineCap = 'butt';
      ctx.globalCompositeOperation = 'source-over';
    }
    if (ab === 'bomb' && e.fuseT > 0) {                 // 引信：越接近越急的闪烁
      const k = 1 - e.fuseT / ABILITY.bomb.FUSE;
      const blink = (Math.sin(performance.now() / (70 - 55 * k)) + 1) / 2;
      ctx.strokeStyle = `rgba(255,90,66,${(0.3 + 0.6 * blink).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey + bob, r + 4, 0, 7); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';          // 辉光
    const gr = ctx.createRadialGradient(ex, ey, 1, ex, ey, r * 2.4);
    gr.addColorStop(0, `rgba(${def.glow},0.20)`);
    gr.addColorStop(1, `rgba(${def.glow},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ex, ey, r * 2.4, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // 躯干：按兵种使用尖芽、硬壳、飞翼等剪影，不再全部是圆形。
    drawCreature(ctx, ex, ey + bob, r, e.ekind, '#251a22', def.color, e.flash > 0);
    if (def.boss) {                                   // Boss：旋转外环 + 尖刺
      const t = performance.now() / 600;
      ctx.strokeStyle = `rgba(${def.glow},0.55)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey + bob, r + 6, t, t + 4.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey + bob, r + 11, -t, -t + 3.4); ctx.stroke();
      ctx.strokeStyle = def.color;
      for (let k = 0; k < 6; k++) {
        const a = t * 0.6 + (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * (r + 1), ey + bob + Math.sin(a) * (r + 1));
        ctx.lineTo(ex + Math.cos(a) * (r + 7), ey + bob + Math.sin(a) * (r + 7));
        ctx.stroke();
      }
    }
    if (e.hp < e.maxHp) {                             // 血条
      const w = 14, hpw = (w * Math.max(0, e.hp / e.maxHp)) | 0;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(ex - 7, ey - r - 8, w, 3);
      ctx.fillStyle = e.hp / e.maxHp > 0.35 ? '#7dffb0' : '#ff6b6b';
      ctx.fillRect(ex - 7, ey - r - 8, hpw, 3);
    }
    if (fade < 1) ctx.globalAlpha = 1;                 // 复位（后面还有别的东西要画）
  }

  // --- 防守塔开火光束 ---
  for (const bm of state.beams) {
    const k = 1 - bm.t / bm.life;
    const x1 = bm.x1 * TILE - ox, y1 = bm.y1 * TILE - oy;
    const x2 = bm.x2 * TILE - ox, y2 = bm.y2 * TILE - oy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${bm.color},${(k * 0.85).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (bm.ripple) {
      ctx.strokeStyle = `rgba(${bm.color},${(k * 0.5).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x2, y2, (1 - k) * bm.ripple * TILE + 4, 0, 7); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- 光爆扩散环 ---
  if (state.pulse) {
    const pr = Math.min(1, state.pulse.t / state.pulse.life);
    const rad = 2 + pr * ((state.pulse.range || 4.6) * TILE);
    ctx.strokeStyle = `rgba(190,245,255,${((1 - pr) * 0.9).toFixed(3)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(state.pulse.x * TILE - ox, state.pulse.y * TILE - oy, rad, 0, 7);
    ctx.stroke();
  }

  // --- 夜行要素：夜辉草 / 潮穴 / 掉落物 / 巡逻标记 ---
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  if (ops && state.layerId === 'surface') {
    const now = performance.now();
    // 夜辉草：黑暗中的幽紫小花（发光、只在蚀潮里出现）
    for (const b of ops.blooms) {
      if (!b.alive) continue;
      const bx = b.x * TILE - ox, by = b.y * TILE - oy;
      if (bx < -TILE || by < -TILE || bx > VIEW_W || by > VIEW_H) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now / 380 + b.x * 2.1 + b.y);
      ctx.fillStyle = `rgba(180,150,255,${(0.22 + 0.18 * pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(bx + 8, by + 8, 5 + pulse * 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#e6dcff';
      ctx.fillRect(bx + 7, by + 6, 2, 5);
      ctx.fillStyle = '#b9a6ff';
      ctx.fillRect(bx + 5, by + 5, 2, 2); ctx.fillRect(bx + 9, by + 5, 2, 2);
      ctx.fillRect(bx + 6, by + 3, 2, 2); ctx.fillRect(bx + 9, by + 3, 2, 2);
    }
    // 潮穴：地面裂缝，喷发时脉动（并短暂吸引蚀兽）
    for (const v of ops.vents) {
      const vx = v.x * TILE - ox, vy = v.y * TILE - oy;
      if (vx < -TILE || vy < -TILE || vx > VIEW_W || vy > VIEW_H) continue;
      const hot = Math.min(1, v.burst);
      ctx.fillStyle = `rgba(20,10,30,0.85)`;
      ctx.fillRect(vx + 3, vy + 4, TILE - 6, TILE - 8);
      ctx.fillStyle = hot > 0 ? `rgba(255,150,220,${(0.5 + 0.5 * hot).toFixed(2)})` : 'rgba(120,80,160,0.5)';
      ctx.fillRect(vx + 5, vy + 6, TILE - 10, 2);
      ctx.fillRect(vx + 4, vy + 10, TILE - 8, 2);
      if (hot > 0) {
        ctx.fillStyle = `rgba(255,180,235,${(0.35 * hot).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(vx + 8, vy + 8, 6 + 10 * (1 - hot), 0, 7); ctx.fill();
      }
    }
    // 巡逻方向标记
    const p = state.patrol;
    if (p && p.day === state.day) {
      const m2 = state.map;
      const cx2 = (m2.w / 2 + p.dx * 12) * TILE - ox, cy2 = (m2.h / 2 + p.dy * 12) * TILE - oy;
      ctx.strokeStyle = 'rgba(185,166,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx2 - (p.dy ? 7 : 0) + (p.dx ? -7 : 0), cy2 - (p.dx ? 7 : 0) + (p.dy ? -7 : 0));
      ctx.lineTo(cx2, cy2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx2, cy2, 5, 0, 7); ctx.stroke();
    }
  }
  // 掉落物（潮穴喷出的母髓）
  for (const it of state.pickups || []) {
    const ix = it.x * TILE - ox, iy = it.y * TILE - oy;
    if (ix < -TILE || iy < -TILE || ix > VIEW_W || iy > VIEW_H) continue;
    const fade = it.life - it.t < 4 ? (0.4 + 0.6 * Math.abs(Math.sin(it.t * 8))) : 1;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240 + it.x);
    ctx.fillStyle = `rgba(255,214,110,${(0.35 * fade).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(ix, iy, 5 + pulse * 2, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,236,170,${fade.toFixed(2)})`;
    ctx.fillRect(ix - 2, iy - 3, 4, 6);
  }

  // 玩家遗落包：不会像潮穴掉落一样自动消失，直到回到原层回收。
  const dp = state.deathPack;
  if (dp && dp.layerId === state.layerId) {
    const dx = dp.x * TILE - ox, dy = dp.y * TILE - oy;
    if (dx >= -TILE && dy >= -TILE && dx <= VIEW_W + TILE && dy <= VIEW_H + TILE) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.fillStyle = `rgba(255,179,160,${(0.22 + pulse * 0.18).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(dx, dy, 9 + pulse * 2, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd2c4'; ctx.fillRect(dx - 5, dy - 4, 10, 8);
      ctx.fillStyle = '#9d5d56'; ctx.fillRect(dx - 1, dy - 4, 2, 8);
    }
  }

  // --- 墓碑：他们化作了光（半径随天数变亮，上限 5） ---
  if (state.layerId === 'surface') {
    for (const g of state.graves || []) {
      const gx = (g.x + 0.5) * TILE - ox, gy = (g.y + 0.5) * TILE - oy;      // 画在格心（与光照 / 悬停判定一致）
      if (gx < -TILE * 2 || gy < -TILE * 2 || gx > VIEW_W + TILE * 2 || gy > VIEW_H + TILE * 2) continue;
      const days = Math.max(1, state.day - (g.day || state.day) + 1);
      const rr = graveRadius(days) * TILE;
      const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
      grd.addColorStop(0, 'rgba(255,236,190,0.26)');
      grd.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(gx, gy, rr, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(198,204,220,0.92)';          // 石碑
      ctx.fillRect(gx - 3, gy - 7, 6, 10);
      ctx.fillStyle = 'rgba(120,126,150,0.9)';
      ctx.fillRect(gx - 4, gy + 3, 8, 2);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 700 + g.x);
      ctx.fillStyle = `rgba(255,240,200,${(0.35 + pulse * 0.35).toFixed(2)})`;
      ctx.fillRect(gx - 1, gy - 6, 2, 5);
    }
  }

  // --- 拓荒者（拓荒队） ---
  for (const w of state.workers || []) {
    if (w.layerId !== state.layerId) continue;          // 别层的拓荒者不画
    const wx = w.x * TILE - ox, wy = w.y * TILE - oy;
    if (wx < -20 || wy < -20 || wx > VIEW_W + 20 || wy > VIEW_H + 20) continue;
    drawCrewMarker(ctx, w, wx, wy);
    if (w.downed) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 360);
      ctx.save();
      ctx.translate(wx, wy + 3);
      ctx.rotate(-0.18);
      ctx.fillStyle = '#c8d8ea';
      ctx.fillRect(-7, -3, 14, 6);
      ctx.fillStyle = '#ff9d9d';
      ctx.fillRect(3, -4, 5, 5);
      ctx.restore();
      ctx.strokeStyle = `rgba(255,207,138,${(0.35 + pulse * 0.45).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wy, 10 + pulse * 2, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffcf8a';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`救援 ${Math.ceil(w.downT || 0)}s`, wx, wy - 12);
      continue;
    }
    if (w.hollow) {                                     // 蚀化者：被黑暗认领的人
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 520);
      ctx.fillStyle = '#4a3560';
      ctx.beginPath(); ctx.arc(wx, wy, TILE * 0.30, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(192,123,255,${(0.45 + pulse * 0.45).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wy, TILE * 0.34 + 3 + pulse * 2, 0, 7); ctx.stroke();
      continue;
    }
    const mood = w.morale < 25 ? '#ff6b6b' : w.morale < 55 ? '#ffd166' : '#7dffb0';
    const sanC = sanityTier(w.sanity == null ? 100 : w.sanity).color;
    if (w.rescueState === 'escort' && w.rescueBed) {
      const bx = (w.rescueBed.x + 0.5) * TILE - ox, by = (w.rescueBed.y + 0.5) * TILE - oy;
      ctx.strokeStyle = 'rgba(158,247,216,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#9ef7d8'; ctx.font = 'bold 9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('护送', wx, wy - 15);
    }
    drawPixelHuman(ctx, wx, wy, w.face || w.facing || 'down', w.flash > 0 ? '#ffffff' : '#c8d8ea', mood, w.tool, w.flash > 0);
    // 血 / 饱食 / 士气 / 心志 四条细线
    const hw = 12, hpw = (hw * Math.max(0, w.hp / w.maxHp)) | 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(wx - 6, wy - 15, hw, 2);
    ctx.fillStyle = '#ff9d9d'; ctx.fillRect(wx - 6, wy - 15, hpw, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(wx - 6, wy - 12, hw, 2);
    ctx.fillStyle = mood; ctx.fillRect(wx - 6, wy - 12, (hw * w.morale / 100) | 0, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(wx - 6, wy - 9, hw, 2);
    ctx.fillStyle = sanC; ctx.fillRect(wx - 6, wy - 9, (hw * (w.sanity == null ? 100 : w.sanity) / 100) | 0, 2);
  }

  // --- 移动路径引导线 ---
  const path = state.player.path;
  if (path && path.length) {
    ctx.strokeStyle = 'rgba(255,220,150,0.20)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pl.x * TILE - ox, pl.y * TILE - oy);
    for (const w of path) ctx.lineTo((w.x + 0.5) * TILE - ox, (w.y + 0.5) * TILE - oy);
    ctx.stroke();
  }

  // --- 目标标记：可到达=呼吸圈 / 受阻=红叉 ---
  const dest = state.dest;
  if (dest) {
    const dx = (dest.x + 0.5) * TILE - ox, dy = (dest.y + 0.5) * TILE - oy;
    const age = performance.now() - dest.at;
    if (!dest.ok) {
      ctx.strokeStyle = 'rgba(255,90,80,0.9)'; ctx.lineWidth = 2;
      const s = 5;
      ctx.beginPath();
      ctx.moveTo(dx - s, dy - s); ctx.lineTo(dx + s, dy + s);
      ctx.moveTo(dx + s, dy - s); ctx.lineTo(dx - s, dy + s);
      ctx.stroke();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(age / 220);
      ctx.strokeStyle = `rgba(120,240,220,${(0.45 + 0.4 * pulse).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(dx, dy, 4 + pulse * 3, 0, 7); ctx.stroke();
    }
  }

  // --- 飘字（采集/精炼反馈） ---
  if (settings.floaties)
  for (const f of state.floaties) {
    const pct = f.t / f.life;
    const fx = f.x * TILE - ox, fy = f.y * TILE - oy - pct * 14;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.max(0, 1 - pct);
    ctx.fillStyle = '#000'; ctx.fillText(f.txt, fx + 1, fy + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.txt, fx, fy);
    ctx.globalAlpha = 1;
  }

  // --- 屏幕暗角氛围（白天淡、夜晚重） ---
  pmark('draw.units', tUnit);
  const tVig = pnow();
  if (settings.vignette) {
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.98);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${(0.14 + 0.5 * (1 - amb)).toFixed(3)})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // --- 小地图（右下角） ---
  pmark('draw.vignette', tVig);
  const tMini = pnow();
  drawMinimap(ctx, state);
  pmark('draw.minimap', tMini);
  pmark('draw.total', tAll);
  ctx.textAlign = 'start';
}
