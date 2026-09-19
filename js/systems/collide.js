// systems/collide.js —— 实体间的「碰撞体积」：圆-圆分离 + 弹性回弹
//
// 之前的碰撞只管「实体 vs 地形」（各实体内置的 canStand/clampX），实体之间可以互相重叠：
// 蚀兽会叠成一坨、拓荒者会站在同一个人身上、玩家能被怪群"穿过去"。
// 这里补上第三层：**实体 vs 实体**。
//
// 做法（轻量、确定性、零分配）：
//   · 每步收集本层实体（玩家 / 拓荒者 / 地面蚀兽；飞行单位掠过不算）
//   · 质量 = 半径²（面积），位移按逆质量分配 —— 大的推小的，小的推不动大的
//   · 两趟分离迭代（先累积位移，再统一应用；每趟都做地形校验，宁可不动也不穿墙）
//   · 分离时顺手给一点「回弹速度」（存在实体隐藏字段 _bvx/_bvy 上，8/s 衰减）
//     —— 这就是"弹性"的来源：撞上去会弹开、人群会像水一样散开
//
// 性能：50 个实体 = 1225 对 × 2 趟 ≈ 2450 次距离判断/步，可忽略不计。

export const PLAYER_R = 0.4;      // 玩家碰撞半径（与 colonist.js 的 R 一致）
export const WORKER_R = 0.34;
const ENEMY_R = 0.32;             // 兜底（正常用命中半径 e.r，Boss 更大）

const REST_WORLD = 0.14;          // 普通回弹（怪群之间：只要散开，不要弹球台）
const REST_PLAYER = 0.42;         // 玩家参与时更弹（撞一下有手感）
const BOUNCE_K = 5.5;             // 回弹速度系数
const BOUNCE_DECAY = 9;           // 回弹速度衰减（1/s）
const MAX_BOUNCE = 2.6;           // 回弹速度上限（tile/s）
// 玩家在「实体分离」里是**不可推动**的：一只怪能把玩家挤得满地跑会毁掉操作手感。
// 注意这不影响反向：玩家主动走进去时，对方拿 100% 的位移（所以"我能顶开人群"的手感照样在）。
const PLAYER_PUSHABLE = false;
const ITERS = 3;                  // 分离迭代趟数（拥挤人群里 3 趟才收得够紧；成本仍是微秒级）

// 对象池：避免每帧 new（沿用项目的零分配纪律）
const pool = [];
function slot(i) { return pool[i] || (pool[i] = { e: null, x: 0, y: 0, r: 0, im: 1, dx: 0, dy: 0, isPlayer: false }); }

// 这一位置能不能站（与各实体的地形判定同一套：四角都要可走）
function fits(map, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (!map.isWalk(tx, ty)) return false;
  return true;
}

// 被挡住的格子数（0 = 当前位置完全合规）
function violations(map, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  let n = 0;
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (!map.isWalk(tx, ty)) n++;
  return n;
}

// 沿墙体尝试落位：整体 → 只走 x → 只走 y（与各实体的"贴墙滑行"一致，不会把人卡死）
function tryMove(map, slot0, dx, dy) {
  const r = slot0.r;
  if (dx === 0 && dy === 0) return false;
  if (fits(map, slot0.x + dx, slot0.y + dy, r)) { slot0.x += dx; slot0.y += dy; return true; }
  if (dx !== 0 && fits(map, slot0.x + dx, slot0.y, r)) { slot0.x += dx; return true; }
  if (dy !== 0 && fits(map, slot0.x, slot0.y + dy, r)) { slot0.y += dy; return true; }
  // B34①：整段走不动就**逐级缩幅度**（½、¼、⅛）—— 哪怕只挤开一点，也比"原地不动"强。
  //   为什么必须有：密集人群里"两边都被墙卡住"很常见（大块头的半径盒先碰到墙），
  //   以前这种位移直接算失败，帧末 `if (!moved) break` 一断 ——
  //   实测：Boss 停在召唤物体内的深重叠**永久不收敛**（帧 4 到帧 50 一模一样）。
  for (let f = 0.5; f >= 0.125; f *= 0.5) {
    const sx = dx * f, sy = dy * f;
    if (fits(map, slot0.x + sx, slot0.y + sy, r)) { slot0.x += sx; slot0.y += sy; return true; }
    if (sx !== 0 && fits(map, slot0.x + sx, slot0.y, r)) { slot0.x += sx; return true; }
    if (sy !== 0 && fits(map, slot0.x, slot0.y + sy, r)) { slot0.y += sy; return true; }
  }
  // B34②：**卡死脱困** —— 如果它当前位置本身就不合规（贴墙太近 / 已经被挤进墙里），
  //   那么 `fits()` 对任何落点都是 false → 这个实体被永久冻结：AI 推不动、分离也推不动，
  //   和它重叠的东西就一直卡在里面（这正是 B34 长跑里"重叠持续数秒 / 0.63 不收敛"的真相）。
  //   这种情况放宽为"只要比现在更合规就允许挪"（不要求一步到位）。
  const now = violations(map, slot0.x, slot0.y, r);
  if (now > 0) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let bestV = now, bx = 0, by = 0;
    // 脱困允许**大步**（最大一步半径）：贴着墙时它往往要挪近一格才能让半径盒脱开墙，
    // 而正常帧的修正量只有零点几格 —— 用那种小步永远出不来（这正是 0.634 定格的原因）。
    for (const m of [r, r * 0.6, r * 0.3, 0.15]) {
      for (const [sx, sy] of [[ux, uy], [ux, 0], [0, uy]]) {
        const px = slot0.x + sx * m, py = slot0.y + sy * m;
        const v = violations(map, px, py, r);
        if (v < bestV) { bestV = v; bx = sx * m; by = sy * m; }
      }
    }
    if (bx || by) { slot0.x += bx; slot0.y += by; return true; }
  }
  return false;
}

// 收集本层实体（返回写入 pool 的个数）
// 质量 = 半径² × weight（weight 与“农田踩踏”用的是同一个字段，Boss 3.5）——
// 所以大块头不但半径大、还“比重高”，挤小怪时几乎不动（B34：玩家要的“Boss 把小的推开”）。
const weightOf = (def) => (def && def.weight != null ? def.weight : 1);
function gather(state) {
  const L = state.layerId;
  let n = 0;
  const p = state.player;
  if (p) {
    const s = slot(n++);
    s.e = p; s.x = p.x; s.y = p.y; s.r = PLAYER_R;
    s.im = PLAYER_PUSHABLE ? 1 / (PLAYER_R * PLAYER_R) : 0;   // 0 = 推不动
    s.isPlayer = true;
  }
  for (const w of state.workers || []) {
    if (w.layerId !== L || w.dead) continue;
    if (w.job === 'hollow') continue;                  // 蚀化者：半透明状态，让玩家能穿过她（不然会卡住救援）
    const s = slot(n++);
    s.e = w; s.x = w.x; s.y = w.y; s.r = WORKER_R;
    s.im = 1 / (WORKER_R * WORKER_R); s.isPlayer = false;
  }
  for (const e of state.enemies || []) {
    if (!e.alive || e.air) continue;                    // 夜枭飞过头顶，不参与地面碰撞
    const r = e.r || ENEMY_R;
    const s = slot(n++);                                // 注：这里只做「分开」，不管刷怪位置是否在墙里
    s.e = e; s.x = e.x; s.y = e.y; s.r = r;             // （刷在墙里的怪本来就走不动，靠各自的 AI 脱困）
    s.im = 1 / (r * r * weightOf(e.def)); s.isPlayer = false;
  }
  return n;
}

// B34 修正趟：把“动不了”那一方该承担的位移交给对面。
//   为什么要它：质量分摊虽然让大块头少动，但只有 9% 的时候，被 AI 往回挤的对方守住不住；
//   实测另一半被卡住时，Boss 一侧要磨十几帧才吐出来（密集人群里甚至永远出不来）。
// 规则：只有一边能整段移动 → 它承担**全部**剩余重叠；
//       两边都能动（交给质量分摊）/ 两边都不能动（不硬穿墙）→ 不动。
// 被多方夹击时取“最大所需位移”而不是累加（否者会被推飞）。
function repairPinned(n, map) {
  for (let i = 0; i < n; i++) pool[i].rw = 0;
  for (let i = 0; i < n; i++) {
    const a = pool[i];
    for (let j = i + 1; j < n; j++) {
      const b = pool[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const overlap = rr - d;
      if (overlap <= 0.001) continue;
      if (d < 1e-5) { const ang = (i * 2.399 + j * 0.7) % 6.283; dx = Math.cos(ang); dy = Math.sin(ang); }
      else { dx /= d; dy /= d; }
      const aCan = fits(map, a.x - dx * overlap, a.y - dy * overlap, a.r);
      const bCan = fits(map, b.x + dx * overlap, b.y + dy * overlap, b.r);
      if (aCan === bCan) continue;
      const s = aCan ? a : b;
      if (overlap > s.rw) { s.rw = overlap; s.rx = aCan ? -dx * overlap : dx * overlap; s.ry = aCan ? -dy * overlap : dy * overlap; }
    }
  }
  for (let i = 0; i < n; i++) {
    const s = pool[i];
    if (s.rw > 0 && tryMove(map, s, s.rx, s.ry) && s.e) { s.e.x = s.x; s.e.y = s.y; }
  }
}

// 主入口：在固定步里调用一次（simStep 末尾）
export function separateEntities(state, dt) {
  const n = gather(state);
  if (n < 2) { applyBounce(state, n, dt); return; }
  const map = state.map;
  let collided = 0;
  for (let it = 0; it < ITERS; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const a = pool[i];
      a.dx = 0; a.dy = 0;
      for (let j = i + 1; j < n; j++) {
        const b = pool[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        let d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) {                                   // 完全重合：给一个确定性的分开方向（不用随机，保确定性）
          const ang = (i * 2.399 + j * 0.7) % 6.283;
          dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
        } else { dx /= d; dy /= d; }
        const overlap = rr - d;
        collided++;
        const wsum = a.im + b.im;
        const wa = wsum > 0 ? a.im / wsum : 0.5, wb = wsum > 0 ? b.im / wsum : 0.5;
        a.dx -= dx * overlap * wa; a.dy -= dy * overlap * wa;
        b.dx += dx * overlap * wb; b.dy += dy * overlap * wb;
        // 回弹：玩家参与时更弹；怪群之间只求散开（玩家自己不会被弹）
        const rest = (a.isPlayer || b.isPlayer) ? REST_PLAYER : REST_WORLD;
        const imp = Math.min(MAX_BOUNCE, overlap * (1 + rest) * BOUNCE_K);
        const va = imp * wa, vb = imp * wb;
        if (a.e && wa > 0) { a.e._bvx = (a.e._bvx || 0) - dx * va; a.e._bvy = (a.e._bvy || 0) - dy * va; }
        if (b.e && wb > 0) { b.e._bvx = (b.e._bvx || 0) + dx * vb; b.e._bvy = (b.e._bvy || 0) + dy * vb; }
      }
    }
    // 统一应用位移（带地形校验：宁可重叠，也不许被挤进墙里）
    for (let i = 0; i < n; i++) {
      const a = pool[i];
      if (a.dx || a.dy) {
        if (tryMove(map, a, a.dx, a.dy)) moved++;
      }
      // 写回实体：pool 里是"工作副本"，不写回的话位移就白算了
      if (a.e) { a.e.x = a.x; a.e.y = a.y; }
    }
    if (collided) repairPinned(n, map);                    // B34：把“动不了”那边该出的力交给对面
    if (!moved) break;
  }

  applyBounce(state, n, dt);
  if (collided) state._collided = collided;              // 调试用
}

// 回弹速度：衰减 + 落位（同样受地形约束）
const scratch = { x: 0, y: 0, r: 0 };                    // 复用的小黑板（零分配）
function applyBounce(state, n, dt) {
  const map = state.map;
  const dec = Math.exp(-BOUNCE_DECAY * dt);
  for (let i = 0; i < n; i++) {
    const a = pool[i];
    const e = a.e;
    if (!e) continue;
    let vx = (e._bvx || 0) * dec, vy = (e._bvy || 0) * dec;
    const l = Math.hypot(vx, vy);
    if (l > MAX_BOUNCE) { vx = (vx / l) * MAX_BOUNCE; vy = (vy / l) * MAX_BOUNCE; }
    if (l > 0.004) {
      scratch.x = e.x; scratch.y = e.y; scratch.r = a.r;
      if (tryMove(map, scratch, vx * dt, vy * dt)) { e.x = scratch.x; e.y = scratch.y; a.x = e.x; a.y = e.y; }
      else { vx = vy = 0; }
    }
    e._bvx = vx; e._bvy = vy;
    if (Math.abs(vx) < 0.004 && Math.abs(vy) < 0.004) { e._bvx = 0; e._bvy = 0; }
  }
}

// 调试：统计"最严重的一对重叠"（验收用：分离后应≈0）
export function overlapStats(state) {
  const list = [];
  const p = state.player;
  if (p) list.push({ e: p, r: PLAYER_R, tag: 'player' });
  for (const w of state.workers || []) if (w.layerId === state.layerId && w.job !== 'hollow') list.push({ e: w, r: WORKER_R, tag: w.name || 'worker' });
  for (const e of state.enemies || []) if (e.alive && !e.air) list.push({ e, r: e.r || ENEMY_R, tag: e.ekind });
  let worst = 0, who = null, pairs = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const d = Math.hypot(b.e.x - a.e.x, b.e.y - a.e.y);
      const ov = a.r + b.r - d;
      if (ov > 0.001) pairs += 1;
      if (ov > worst) { worst = ov; who = `${a.tag} ↔ ${b.tag}`; }
    }
  }
  return { bodies: list.length, pairs, worst: +worst.toFixed(3), who };
}
