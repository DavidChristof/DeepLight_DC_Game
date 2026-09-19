// core/perf.js —— 分阶段计时 + 压力测试（W13-C 的"体检仪"）
//
// 用法（调用点）：
//   import { pnow, pmark, pon } from '../core/perf.js';
//   const t0 = pnow();  ...;  pmark('light', t0);
//
// 设计原则：
//   · 默认开着，但只有两个数字：performance.now() 与一次加法 —— 开销在噪声级别
//   · 报告按"每秒调用次数"和"每帧占用"两个角度给结论，直接指向该改哪里
//   · 不依赖任何外部东西，也不改游戏逻辑

const stages = {};                 // name → { ms, n, max }
let frames = 0;
let wallMs = 0;
let on = true;

export const perfOn = (v) => { on = v == null ? !on : !!v; return on; };
export const perfEnabled = () => on;
export const pnow = () => (on ? performance.now() : 0);

export function pmark(name, t0) {
  if (!on || !t0) return;
  const dt = performance.now() - t0;
  const s = stages[name] || (stages[name] = { ms: 0, n: 0, max: 0 });
  s.ms += dt;
  s.n += 1;
  if (dt > s.max) s.max = dt;
}

// 每渲染帧调用一次：拿到真实帧率
export function pframe(dtMs) {
  if (!on) return;
  frames += 1;
  wallMs += dtMs;
}

export function perfReset() {
  for (const k in stages) delete stages[k];
  frames = 0;
  wallMs = 0;
}

// seconds = 这段统计覆盖的真实秒数；framesHint = 这段时间里跑了多少"帧"（压力测试里 = 模拟步数）
export function perfReport(seconds, framesHint) {
  const secs = seconds || (wallMs / 1000) || 1;
  const fr = framesHint || frames || 1;
  const rows = [];
  for (const k in stages) {
    const s = stages[k];
    rows.push({
      stage: k,
      calls: s.n,
      perSec: +(s.n / secs).toFixed(1),
      avgMs: +(s.ms / Math.max(1, s.n)).toFixed(3),
      maxMs: +s.max.toFixed(2),
      totalMs: +s.ms.toFixed(1),
      msPerFrame: +(s.ms / fr).toFixed(3),
    });
  }
  rows.sort((a, b) => b.msPerFrame - a.msPerFrame);
  const fps = frames ? +(frames / secs).toFixed(1) : null;
  return {
    secs: +secs.toFixed(1),
    frames,
    fps,
    frameMs: frames ? +(wallMs / frames).toFixed(2) : null,
    budget: { pctOf16ms: rows.reduce((a, r) => a + r.msPerFrame, 0) / 16.6 * 100 | 0 },
    rows,
  };
}

// 控制台里看得舒服一点
export function perfTable(seconds) {
  const r = perfReport(seconds);
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [
    `perf: ${r.frames} 帧 / ${r.secs}s · 实测 ${r.fps} fps · 帧耗时 ${r.frameMs} ms`,
    `${pad('stage', 16)}${pad('calls', 8)}${pad('/s', 8)}${pad('avg ms', 9)}${pad('max ms', 8)}${pad('ms/帧', 8)}`,
  ];
  for (const x of r.rows) lines.push(`${pad(x.stage, 16)}${pad(x.calls, 8)}${pad(x.perSec, 8)}${pad(x.avgMs, 9)}${pad(x.maxMs, 8)}${pad(x.msPerFrame, 8)}`);
  return lines.join('\n');
}
