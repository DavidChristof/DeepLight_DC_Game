// world/light.js —— 多光源 BFS 光传播（衰减 + 岩壁/木墙遮挡）
import { T } from './map.js';
import { BUILD, LIGHT_LEVELS, PRISM_MAX_HOPS } from '../data/buildings.js';
import { lampRadiusMul } from '../systems/research.js';
import { graveRadius, gravePower } from '../data/traits.js';
import { LAYER_META } from '../data/layers.js';

const lvOf = (b) => LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1];

// 岩浆地形光源（每张地图算一次，瓷砖不会中途变化）
function lavaSources(m) {
  if (m._lavaSrcs) return m._lavaSrcs;
  const out = [];
  for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === T.LAVA) out.push({ x: i % m.w, y: (i / m.w) | 0 });
  m._lavaSrcs = out;
  return out;
}

// —— 单光源扩散 ——
// 复用一块 scratch 距离表（低 6 位存距离、高位存本次调用的时间戳），避免每个光源都 new 一个数组：
// 灯 + 棱镜接力之后光源数量会涨，逐帧分配会被 GC 拖住。
const SHIFT = 6, DMASK = 63;
let _dist = new Int32Array(0);
let _stamp = 0;

function spread(light, m, w, h, s, rmul, decay) {
  const n = w * h;
  if (_dist.length !== n) { _dist = new Int32Array(n); _stamp = 0; }
  if (_stamp >= (0x7fffffff >> SHIFT)) { _dist.fill(0); _stamp = 0; }
  const sx = s.x | 0, sy = s.y | 0;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const r = s.raw ? s.r : s.r * rmul;
  const tag = (++_stamp) << SHIFT;
  const start = sy * w + sx;
  const q = _queue;
  let head = 0, tail = 0;
  q[tail++] = start;
  _dist[start] = tag;                       // 距离 0 = 光源自己那格（见下方“光源自己那一格吃满自己的光”）
  const p = s.p;
  while (head < tail) {
    const i = q[head++];
    const d = _dist[i] & DMASK;
    // 【光源自己那一格吃满自己的光】原实现把 d===0 跳过（"光源自己占的格子不吃自己的光"），
    //   后果是：灯/篝火脚下那格在光图上只有邻居给的光 —— 夜里等于全黑。
    //   于是①光照遮罩把那格苔地压暗（玩家看到的就是"篝火底下没被照到"）
    //   ②建筑自身亮度 `lit(i)` 也拿不到自己的光（灯身只好靠额外画的辉光圆救）
    //   ③蚀痕/夜辉草的判定也把那格当成黑暗格。三处都不合理，所以这一格直接吃满 p。
    if (d === 0) { if (p > light[i]) light[i] = p; }
    else { const v = p - d * decay; if (v > 0 && v > light[i]) light[i] = v; }
    if (d >= r) continue;
    const x = i % w, y = (i / w) | 0;
    const nd = d + 1;
    // 四向内联（原实现每格都 new 一个 [[x,y]×4] 数组 → 一次 compute 能造出上万个垃圾对象）
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
      const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if ((_dist[ni] >> SHIFT) === _stamp) continue;
      _dist[ni] = tag | (nd & DMASK);
      if (m.tiles[ni] === T.ROCK || m.blockLight[ni]) {   // 岩壁/木墙：吸收光、不透射
        const v = p - nd * decay;
        if (v > 0 && v * 0.5 > light[ni]) light[ni] = v * 0.5;
        continue;
      }
      q[tail++] = ni;
    }
  }
}

// 复用一块 BFS 队列（大小一次到位：最坏情况也就是把所有格子都入队）
let _queue = new Int32Array(0);

// —— 脏标记：光照不再每个模拟步都重算 ——
// 签名涵盖全部会影响光图的东西：玩家位置（1/4 格精度）、发光建筑的（坐标+有无火+档位+熄火）、
// 建筑数量、层、天数（墓碑半径）、探索状态。另加 20Hz 兜底，万一漏了哪个变量也会在 50ms 内自纠。
const LIGHT_HZ = 20;
let _lastSig = null;
let _lastAt = -1e9;

export function lightDirty(state) {
  const t = state._simT == null ? 0 : state._simT;     // 模拟时间（由 main 每步累加，保证确定性）
  const p = state.player;
  let s = (Math.floor(p.x * 4) * 73856093) ^ (Math.floor(p.y * 4) * 19349663) ^ ((state.day | 0) * 83492791);
  const bs = state.buildings || [];
  s = Math.imul(s ^ (bs.length * 2654435761), 2246822519);
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.site) continue;
    const d = BUILD[b.type];
    if (!d || !d.power || d.decoy) continue;           // 不发光的东西不影响光图
    s = Math.imul(s ^ (b.x * 31 + b.y * 17) ^ ((b.fuel > 0 ? 1 : 0) << 3) ^ (((b.level == null ? 1 : b.level)) << 5) ^ ((b.off ? 1 : 0) << 7), 2246822519);
  }
  for (const g of state.graves || []) s = Math.imul(s ^ (g.x * 7 + g.y * 13), 2246822519);
  s ^= (state.layerId && state.layerId.length) * 97;
  if (state.echoOn) s ^= 1 << 21;
  const forced = (t - _lastAt) >= 1 / LIGHT_HZ;
  if (s !== _lastSig || forced) {
    _lastSig = s;
    _lastAt = t;
    return true;
  }
  return false;
}

export function compute(state) {
  state._lightRuns = (state._lightRuns || 0) + 1;      // 体检用：真的重算了几次
  const m = state.map, w = m.w, h = m.h, n = w * h;
  // 复用光图缓冲（渲染/玩法一直持有同一个引用，所以只能 fill(0) 不能换数组）
  let light = state.light;
  if (!light || light.length !== n) { light = state.light = new Float32Array(n); }
  else light.fill(0);
  if (_queue.length !== n) _queue = new Int32Array(n);
  const meta = LAYER_META[state.layerId] || null;          // W11：层法则
  const rmul = (meta && meta.radiusMul) || 1;
  const decay = (meta && meta.decay) || 1;

  const srcs = [];
  for (const b of state.beacons) srcs.push({ x: b.x, y: b.y, p: b.power, r: b.radius });
  const pl = state.player;
  srcs.push({ x: pl.x, y: pl.y, p: pl.lamp.power, r: pl.lamp.radius });
  // 墓碑：他们化作了光 —— 半径随天数变亮（上限 5），仅在表层地图生效
  if (state.layerId === 'surface') {
    for (const g of state.graves || []) {
      const days = Math.max(1, state.day - (g.day || state.day) + 1);
      srcs.push({ x: g.x, y: g.y, p: gravePower(), r: graveRadius(days) });
    }
  }
  // 岩浆：熔渊之心唯一的光（免费，但踩上去会烧）
  if (meta && meta.lava) {
    for (const l of lavaSources(m)) srcs.push({ x: l.x, y: l.y, p: 7, r: 4.5 });
  }
  // 回声视觉：母脉层只有走动时才会以自身为圆心短暂显形（比原地提灯看得远一倍）
  const echoOn = !!(meta && meta.echo && state.echoT > 0);
  state.echoOn = echoOn;                    // 供渲染层判断要不要画那圈扩散环（只有母脉层有这条法则）
  if (echoOn) {
    srcs.push({ x: pl.x, y: pl.y, p: 7, r: meta.echo, raw: true });
  }
  // 已放置光源（有燃料才发光）：灯柱 / 净光柱，按亮度档位缩放半径
  // 诱饵灯（def.decoy）不进任何一张光图 —— 它只吸引敌人，不提供视野
  if (state.buildings) {
    const bmul = lampRadiusMul(state);
    for (const b of state.buildings) {
      if (b.site || b.fuel <= 0 || b.off) continue;      // 工地/冷炉/熄火的自动熔炉都不发光
      const def = BUILD[b.type];
      if (!def || !def.power || def.decoy) continue;
      const lv = lvOf(b);
      srcs.push({ x: b.x, y: b.y, p: def.power, r: def.radius * bmul * lv.r });
    }
  }

  let lightMax = 1;
  for (const s0 of srcs) {
    if (s0.p > lightMax) lightMax = s0.p;
    spread(light, m, w, h, s0, rmul, decay);
  }

  // —— 棱镜接力（D6 光路）——
  // 棱镜自己不产光、也不烧燃料：它只是「被照亮 → 再发出去」。
  // 逐波传播：这一波点亮的镜子可能在下一波点亮更远的镜子 —— 所以打断任何一环，下游全部熄灭。
  state.prismLinks = [];
  const prisms = state.buildings ? state.buildings.filter((b) => b.type === 'prism' && !b.site) : [];
  let litCount = 0;
  if (prisms.length) {
    const R = BUILD.prism.relay;
    if (R.power > lightMax) lightMax = R.power;
    for (const b of prisms) b.relayHop = null;        // 每帧重算：断了就是断了
    const lit = [];
    for (let hop = 0; hop < PRISM_MAX_HOPS; hop++) {
      // 先按当前光图收集这一波点亮的镜子，再统一发光 —— 这样 relayHop 就是真实的光路深度
      const wave = [];
      for (const b of prisms) {
        if (b.relayHop != null) continue;
        if (light[b.y * w + b.x] < R.minLit) continue;
        b.relayHop = hop + 1;
        wave.push(b);
      }
      if (!wave.length) break;                        // 没有新镜子被点亮 → 光路到此为止
      for (const b of wave) {
        lit.push(b);
        spread(light, m, w, h, { x: b.x + 0.5, y: b.y + 0.5, p: R.power, r: R.radius, raw: true }, rmul, decay);
      }
    }
    litCount = lit.length;
    // 光路可视化：每面点亮的镜子连到最近的上游（另一面镜子 / 真实光源），让玩家看得懂这条链
    const up = srcs.map((s) => ({ x: s.x, y: s.y }));
    for (const b of lit) up.push({ x: b.x + 0.5, y: b.y + 0.5, self: b });
    for (const b of lit) {
      let best = null, bd = 14;
      for (const c of up) {
        if (c.self === b) continue;
        if (c.self && c.self.relayHop >= b.relayHop) continue;   // 上游只能更靠前，避免画出反向连线
        const d = Math.hypot(c.x - (b.x + 0.5), c.y - (b.y + 0.5));
        if (d < bd) { bd = d; best = c; }
      }
      if (best) state.prismLinks.push({ x1: best.x, y1: best.y, x2: b.x + 0.5, y2: b.y + 0.5 });
    }
  }
  state.prismLit = litCount;

  state.light = light;
  state.lightMax = lightMax;

  // 探索迷雾：光照触及的地块永久记入已探明（阈值≈光照边缘）
  // ！只有真的从 0→1 才写（原来每帧把几千个亮格重写一遍）；_discVer 是给调试用的累计计数
  const dis = state.discovered;
  if (dis) {
    for (let i = 0; i < n; i++) {
      if (light[i] > 0.7 && !dis[i]) { dis[i] = 1; state._discVer = (state._discVer || 0) + 1; }
    }
  }
}
