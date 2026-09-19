// data/sfx.js —— 音色表（纯数据：零素材，全部由 WebAudio 现场合成）
//
// 每条音效可以有两个声部：
//   tone:  [{ f, f2?, t?, dur, at?, vol?, atk? }]   振荡器：f = 起始频率，f2 = 结束频率（滑音）
//   noise: [{ f?, q?, dur, at?, vol?, hp? }]        噪声：f = 带通中心（默认低通 900），q = 锐度
// f 也可以写成数组 [min,max] = 每次播放随机取（避免"机关枪式重复"听着累）
//
// 音色设计原则（见 OPTIMIZE_PLAN §5.3）：短、干、脆（绝大多数 ≤ 200ms）；不加混响（Boss 除外）；
// 音量比 UI(0.25) < 反馈(0.5) < 警报(0.8)；世界音效按距离衰减。

const rand = (f) => (Array.isArray(f) ? f[0] + Math.random() * (f[1] - f[0]) : f);

// —— UI ——
export const SFX_DEFS = {
  // 点界面、切 tab、选快捷栏：极短的方波"嗒"
  click: { vol: 0.22, dedupe: 30, tone: [{ f: [820, 980], t: 'square', dur: 0.04, vol: 0.5 }] },
  // 做不成：低音双跳
  deny: { vol: 0.3, dedupe: 120, tone: [
    { f: 233, t: 'square', dur: 0.07, vol: 0.6 },
    { f: 175, t: 'square', dur: 0.11, at: 0.08, vol: 0.6 },
  ] },

  // —— 建造 ——
  place: { vol: 0.42, dedupe: 45, tone: [{ f: 170, t: 'triangle', dur: 0.06, vol: 0.7 }], noise: [{ f: 520, q: 1.1, dur: 0.08, vol: 0.35 }] },
  built: { vol: 0.5, dedupe: 80, tone: [
    { f: 523, t: 'triangle', dur: 0.09, vol: 0.5 },
    { f: 659, t: 'triangle', dur: 0.09, at: 0.07, vol: 0.5 },
    { f: 880, t: 'triangle', dur: 0.16, at: 0.14, vol: 0.5 },
  ] },
  demolish: { vol: 0.5, dedupe: 60, noise: [{ f: 300, q: 0.8, dur: 0.16, vol: 0.8 }], tone: [{ f: 120, f2: 70, t: 'sawtooth', dur: 0.14, vol: 0.4 }] },
  collapse: { vol: 0.55, dedupe: 200, noise: [{ f: 240, q: 0.6, dur: 0.3, vol: 0.9 }] },

  // —— 采集 / 手做 ——
  mine: { vol: 0.4, dedupe: 60, noise: [{ f: [420, 620], q: 1.6, dur: 0.07, vol: 0.55 }], tone: [{ f: [180, 230], t: 'triangle', dur: 0.05, vol: 0.4 }] },
  chop: { vol: 0.4, dedupe: 60, noise: [{ f: [260, 360], q: 0.9, dur: 0.1, vol: 0.6 }], tone: [{ f: [130, 165], t: 'triangle', dur: 0.07, vol: 0.5 }] },
  dig: { vol: 0.4, dedupe: 60, noise: [{ f: 220, q: 0.7, dur: 0.12, vol: 0.55 }] },
  pick: { vol: 0.32, dedupe: 50, tone: [{ f: [1180, 1420], t: 'sine', dur: 0.07, vol: 0.35 }] },
  craft: { vol: 0.45, dedupe: 70, tone: [{ f: 660, f2: 990, t: 'triangle', dur: 0.12, vol: 0.45 }], noise: [{ f: 900, q: 1.4, dur: 0.06, vol: 0.25 }] },
  harvest: { vol: 0.4, dedupe: 80, tone: [{ f: [700, 860], f2: [980, 1200], t: 'sine', dur: 0.1, vol: 0.4 }] },
  build: { vol: 0.35, dedupe: 55, noise: [{ f: 700, q: 1.2, dur: 0.06, vol: 0.4 }], tone: [{ f: [280, 330], t: 'square', dur: 0.05, vol: 0.3 }] },
  // 成功「叮」/ 失败「噗」
  ok: { vol: 0.32, dedupe: 60, tone: [{ f: 880, f2: 1180, t: 'sine', dur: 0.1, vol: 0.4 }] },
  fail: { vol: 0.3, dedupe: 90, tone: [{ f: 180, f2: 120, t: 'square', dur: 0.12, vol: 0.5 }] },

  // —— 火 ——
  ignite: { vol: 0.5, dedupe: 200, noise: [{ f: 700, q: 0.7, dur: 0.45, vol: 0.7, hp: true }] },
  extinguish: { vol: 0.4, dedupe: 200, noise: [{ f: 480, q: 0.6, dur: 0.3, vol: 0.5 }] },
  fuel: { vol: 0.35, dedupe: 90, tone: [{ f: 300, f2: 460, t: 'triangle', dur: 0.1, vol: 0.4 }], noise: [{ f: 1200, q: 1.2, dur: 0.12, vol: 0.2 }] },

  // —— 战斗 ——
  pulse: { vol: 0.6, dedupe: 100, tone: [{ f: 90, f2: 420, t: 'sawtooth', dur: 0.3, vol: 0.35 }], noise: [{ f: 1400, q: 0.8, dur: 0.35, vol: 0.45 }] },
  kill: { vol: 0.35, dedupe: 50, noise: [{ f: 900, q: 0.9, dur: 0.1, vol: 0.4 }] },
  hurt: { vol: 0.5, dedupe: 150, tone: [{ f: 320, f2: 160, t: 'sawtooth', dur: 0.16, vol: 0.4 }] },
  shoot: { vol: 0.28, dedupe: 40, tone: [{ f: [900, 1100], f2: [500, 620], t: 'square', dur: 0.07, vol: 0.3 }] },
  soothe: { vol: 0.5, dedupe: 300, tone: [
    { f: 587, t: 'sine', dur: 0.3, vol: 0.35 },
    { f: 880, t: 'sine', dur: 0.4, at: 0.12, vol: 0.3 },
  ] },
  relic: { vol: 0.5, dedupe: 300, tone: [
    { f: 784, t: 'triangle', dur: 0.12, vol: 0.4 },
    { f: 1175, t: 'triangle', dur: 0.22, at: 0.1, vol: 0.35 },
  ] },

  // —— 警报（音量最高，但不刺耳：三角波）——
  alarm: { vol: 0.75, dedupe: 900, tone: [
    { f: 660, t: 'triangle', dur: 0.18, vol: 0.6 },
    { f: 520, t: 'triangle', dur: 0.26, at: 0.2, vol: 0.6 },
  ] },
  tide: { vol: 0.8, dedupe: 3000, tone: [
    { f: 160, f2: 110, t: 'triangle', dur: 1.1, vol: 0.5 },
    { f: 240, f2: 180, t: 'sine', dur: 1.2, at: 0.25, vol: 0.3 },
  ], noise: [{ f: 260, q: 0.5, dur: 1.6, vol: 0.4 }] },
  dawn: { vol: 0.6, dedupe: 3000, tone: [
    { f: 880, t: 'sine', dur: 0.3, vol: 0.35 },
    { f: 1320, t: 'sine', dur: 0.5, at: 0.16, vol: 0.28 },
  ] },

  // —— Boss ——
  bossSpawn: { vol: 0.85, dedupe: 4000, tone: [
    { f: 70, f2: 48, t: 'sawtooth', dur: 1.6, vol: 0.4 },
    { f: 105, f2: 70, t: 'triangle', dur: 1.8, at: 0.2, vol: 0.35 },
  ], noise: [{ f: 180, q: 0.4, dur: 2.0, vol: 0.5 }] },
  bossDown: { vol: 0.85, dedupe: 4000, tone: [
    // 长混响钟声（唯一允许"回响"的地方）
    { f: 262, t: 'sine', dur: 1.6, vol: 0.35 },
    { f: 392, t: 'sine', dur: 1.8, at: 0.05, vol: 0.25 },
    { f: 523, t: 'sine', dur: 2.2, at: 0.1, vol: 0.2 },
    { f: 262, t: 'sine', dur: 1.4, at: 0.9, vol: 0.18 },
  ] },
};

// 距离衰减：<2 格满音量，≥12 格听不见（世界音效用；UI 音效不衰减）
export function attenOf(dist) {
  if (dist == null) return 1;
  if (dist <= 2) return 1;
  if (dist >= 12) return 0;
  return 1 - (dist - 2) / 10;
}

export { rand as sfxRand };
