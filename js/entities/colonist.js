// entities/colonist.js —— 提灯拓荒者（键盘直控 + 点击寻路，圆形碰撞防卡墙）
const R = 0.4;        // 物理碰撞半径（视觉约 0.42 → 身体不会插进墙体）
const EPS = 1e-4;

// 圆在 (c, y) 列、y 带的垂直范围是否碰到实心
function blockedCol(map, c, y) {
  for (let ry = Math.floor(y - R); ry <= Math.floor(y + R); ry++) {
    if (ry < 0 || ry >= map.h) return true;      // 出界视为墙
    if (!map.isWalk(c, ry)) return true;
  }
  return false;
}
function blockedRow(map, x, r) {
  for (let cx = Math.floor(x - R); cx <= Math.floor(x + R); cx++) {
    if (cx < 0 || cx >= map.w) return true;
    if (!map.isWalk(cx, r)) return true;
  }
  return false;
}

// 横向推挤：把 x 限制到与实心格四边保持 ≥ R（左/右都挡）
function clampX(map, x, y) {
  let nx = x;
  for (let c = Math.floor(x - R); c <= Math.floor(x + R); c++) {
    if (c < 0 || c >= map.w || !blockedCol(map, c, y)) continue;
    if (nx < c + 0.5) nx = Math.min(nx, c - R - EPS);   // 圆在格左半 → 靠左贴边
    else nx = Math.max(nx, c + 1 + R + EPS);             // 在右半 → 靠右贴边
  }
  return nx;
}
function clampY(map, x, y) {
  let ny = y;
  for (let r = Math.floor(y - R); r <= Math.floor(y + R); r++) {
    if (r < 0 || r >= map.h || !blockedRow(map, x, r)) continue;
    if (ny < r + 0.5) ny = Math.min(ny, r - R - EPS);
    else ny = Math.max(ny, r + 1 + R + EPS);
  }
  return ny;
}

export class Colonist {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.speed = 5;                 // tile/s
    this.speedMul = 1;              // 速度倍率（玩家按住 Shift 快走：main.js 每帧写入）
    this.lamp = { power: 7, radius: 6.5 };
    this.path = [];                 // 剩余路径点（瓦格坐标）
  }

  clearPath() { this.path = []; }
  setPath(path) { this.path = path.slice(); }
  hasPath() { return this.path.length > 0; }

  // 键盘直控（分轴推进 + 圆形碰撞，贴墙可滑行）
  moveManual(dt, state, dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; }
    const m = state.map, step = this.speed * (this.speedMul || 1) * dt;
    this.x = clampX(m, this.x + dx * step, this.y);
    this.y = clampY(m, this.x, this.y + dy * step);
    this.clamp(m);
  }

  // 沿路径走向下一个瓦格中心（同样受碰撞约束）
  followPath(dt, state) {
    const m = state.map, step = this.speed * (this.speedMul || 1) * dt;
    while (this.path.length) {
      const w = this.path[0];
      const tx = w.x + 0.5, ty = w.y + 0.5;
      const dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) { this.path.shift(); continue; }
      const s = Math.min(step, d);
      const ox = this.x, oy = this.y;
      this.x = clampX(m, ox + (dx / d) * s, oy);
      this.y = clampY(m, this.x, oy + (dy / d) * s);
      if (Math.abs(this.x - ox) + Math.abs(this.y - oy) < 1e-5) this.path.shift();
      return;
    }
    this.clamp(m);
  }

  clamp(m) {
    this.x = Math.max(0.5, Math.min(m.w - 0.5, this.x));
    this.y = Math.max(0.5, Math.min(m.h - 0.5, this.y));
  }
}
