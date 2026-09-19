// core/ambient.js —— 环境音床（Ambience）：一直在放、跟着世界淡入淡出的几层循环音
//
// 为什么单独做一层，而不是当音效播：
//   音效是"事件"（一次性的、按距离衰减、会被去重和并发上限挡掉），
//   环境音是"状态"（循环、不停、按状态交叉淡化）—— 两者生命周期完全不同。
//   `volAmbient` 这条滑杆本来就是给它们准备的（设置 → 音频 → 环境音），以前是空着的。
//
// 三张床（都是循环文件，缺文件就静音 —— 不影响其它声音）：
//   night  蚀潮/黎明/黄昏的夜风低鸣   —— 黄昏淡入、蚀潮满、黎明淡出（对着 time.js 的相位走）
//   deep   地下层的滴水与回声          —— 玩家不在"地表"时淡入
//   fire   近处的火焰噼啪               —— 按"最近的燃烧建筑"距离 4→14 格淡出（= 灶边的感觉）
//
// 交付方式见 assets/SOUND.md：把文件放进 assets/ambient/，在 manifest.json 里登记 id → 文件名。
import { settings } from './settings.js';
import { audioCtx, audioBus, audioReady } from './audio.js';
import { isTide, isDawn, DUSK_START } from './time.js';

const DIR = new URL('../../assets/ambient/', import.meta.url).href;
export const AMBIENT_BEDS = ['night', 'deep', 'fire'];
// 每张床的满音量（在 ambBus 之前再乘一次，用来配平彼此，不要用滑杆去凑）
const BED_GAIN = { night: 0.55, deep: 0.6, fire: 0.5 };
const RAMP = 1.6;                      // 秒：单张床的淡入淡出时间

let inited = false;
let loadedOnce = false;
let stats = { total: 0, ok: 0, missing: 0 };
const nodes = {};                      // id → { src, gain, cur, target }
let logOnce = false;

export function ambientStats() {
  return { ...stats, beds: AMBIENT_BEDS.map((id) => `${id}:${nodes[id] ? 'on' : 'off'}`), dir: DIR };
}
export function ambientDir() { return DIR; }

// 读 manifest → fetch + decode → 建一条 loop 源，起始增益 0（等 updateAmbient 推上去）
export async function loadAmbient(url) {
  if (loadedOnce) return stats;
  loadedOnce = true;
  const ctx = audioCtx();
  const bus = audioBus('ambient');
  if (!ctx || !bus) { loadedOnce = false; return stats; }
  let man = null;
  try {
    const r = await fetch(url || (DIR + 'manifest.json'), { cache: 'no-cache' });
    if (!r.ok) return stats;
    man = await r.json();
  } catch (e) { return stats; }
  const map = (man && man.beds) || man || {};
  await Promise.all(AMBIENT_BEDS.map(async (id) => {
    const file = map[id];
    if (!file || typeof file !== 'string') return;
    stats.total += 1;
    try {
      const r = await fetch(DIR + file, { cache: 'force-cache' });
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain); gain.connect(bus);
      src.start();
      nodes[id] = { src, gain, cur: 0, target: 0 };
      stats.ok += 1;
    } catch (e) {
      stats.missing += 1;
      if (!logOnce) {
        logOnce = true;
        console.info(`[ambient] 没找到 assets/ambient/${file} —— 这张床保持静音。放进去就自动生效。`);
      }
    }
  }));
  inited = true;
  return stats;
}
export function ambientReady() { return inited && Object.keys(nodes).length > 0; }

// 每帧（或每几帧）调一次：算出三张床的目标强度，再平滑逼近
export function updateAmbient(state, dt) {
  if (!inited) { if (audioReady()) loadAmbient(); return; }   // 解锁后第一次调用顺手加载
  if (!audioReady()) return;
  const target = { night: 0, deep: 0, fire: 0 };
  // 夜：黄昏开始淡入（前半段 0→0.6），蚀潮满，黎明退到 0.35 再收
  if (isTide(state)) target.night = 1;
  else if (isDawn(state)) target.night = 0.35;
  else if (state.t >= DUSK_START) target.night = 0.6 * Math.min(1, (state.t - DUSK_START) / 8);
  // 地下：不是地表就算（深潜层永夜）
  if (state.layerId && state.layerId !== 'surface') target.deep = 1;
  // 火：最近的"烧着的"建筑（工地/冷炉不算）
  let best = Infinity;
  for (const b of state.buildings || []) {
    if (b.site || !(b.fuel > 0) || b.off) continue;
    const d = Math.hypot(b.x + 0.5 - state.player.x, b.y + 0.5 - state.player.y);
    if (d < best) best = d;
  }
  target.fire = best <= 4 ? 1 : (best >= 14 ? 0 : 1 - (best - 4) / 10);
  const k = Math.min(1, dt / RAMP);
  for (const id of AMBIENT_BEDS) {
    const n = nodes[id];
    if (!n) continue;
    n.target = target[id] * (BED_GAIN[id] == null ? 0.5 : BED_GAIN[id]);
    n.cur += (n.target - n.cur) * k;
    if (Math.abs(n.target - n.cur) < 0.002) n.cur = n.target;
    n.gain.gain.value = n.cur * (settings.mute ? 0 : 1);
  }
}

// 静音/音量变化时立刻把当前值重新推一遍（applyVolumes 只管总线增益，这里只管床自己的包络）
export function refreshAmbientGain() {
  for (const id of AMBIENT_BEDS) {
    const n = nodes[id];
    if (n) n.gain.gain.value = n.cur * (settings.mute ? 0 : 1);
  }
}
