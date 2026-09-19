// world/pathfinding.js —— 网格寻路 + 路径平滑（斜向直连，避免"L 形直角走位"）
// findPath 返回瓦格点列表（不含起点，含终点）；不可达返回 null。
import { pnow, pmark } from '../core/perf.js';

// 模块级复用缓冲：原来每次 findPath 都要 new Int32Array(w*h) + fill(-1)（27KB + 6912 次写/次）
// 现在用「代际戳」代替 fill：gen[i] !== 本代 → 视为未访问，零清空、零分配
let PW = 0, PH = 0, prev = null, gen = null, curGen = 0, q = null;
function ensureBufs(w, h) {
  if (PW !== w || PH !== h) {
    PW = w; PH = h;
    prev = new Int32Array(w * h);
    gen = new Int32Array(w * h);
    q = new Int32Array(w * h);
    curGen = 0;
  }
}
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];

// 两点之间能否直线通行（定距采样 + 禁止斜穿墙角）
export function lineClear(map, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return map.isWalk(Math.floor(x0), Math.floor(y0));
  const steps = Math.ceil(dist / 0.2);          // 每 0.2 格采样一次
  let px = Math.floor(x0), py = Math.floor(y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t, y = y0 + dy * t;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!map.isWalk(tx, ty)) return false;
    if (tx !== px && ty !== py) {               // 斜跨格：两侧不能同时是墙（防穿墙角）
      if (!map.isWalk(tx, py) && !map.isWalk(px, ty)) return false;
    }
    px = tx; py = ty;
  }
  return true;
}

// 路径平滑（string pulling）：能直连就把中间点全部跳过
// 输出一串稀疏拐点，角色沿折线行走 → 开阔地带自然走斜线
function smoothPath(map, pts) {
  if (pts.length <= 2) return pts.slice(1);
  const out = [];
  const WINDOW = 18;                            // 单次最多前瞻格数（限制开销）
  let i = 0;
  while (i < pts.length - 1) {
    const jMax = Math.min(pts.length - 1, i + WINDOW);
    let picked = -1;
    for (let j = jMax; j > i + 1; j--) {
      if (lineClear(map, pts[i].x + 0.5, pts[i].y + 0.5, pts[j].x + 0.5, pts[j].y + 0.5)) { picked = j; break; }
    }
    if (picked === -1) picked = i + 1;          // 看不到更远，就走到下一个拐点
    out.push(pts[picked]);
    i = picked;
  }
  return out;
}

export function findPath(map, sx, sy, tx, ty) {
  const t0 = pnow();
  const r = findPathInner(map, sx, sy, tx, ty);
  pmark('path.findPath', t0);
  return r;
}

function findPathInner(map, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  if (!map.isWalk(tx, ty)) return null;

  const w = map.w, h = map.h;
  ensureBufs(w, h);
  curGen++;
  const g = curGen;
  const start = sy * w + sx, goal = ty * w + tx;
  let head = 0, tail = 0;
  q[tail++] = start;
  gen[start] = g; prev[start] = start;

  while (head < tail) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!map.isWalk(nx, ny)) continue;
      const ni = ny * w + nx;
      if (gen[ni] === g) continue;
      gen[ni] = g; prev[ni] = cur;
      if (ni === goal) { head = tail; break; }    // 提前结束
      q[tail++] = ni;
    }
  }
  if (gen[goal] !== g) return null;

  const raw = [];
  let cur = goal;
  while (cur !== start) { raw.push({ x: cur % w, y: (cur / w) | 0 }); cur = prev[cur]; }
  raw.reverse();
  return smoothPath(map, [{ x: sx, y: sy }, ...raw]);
}

