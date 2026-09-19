// core/audio.js —— WebAudio 合成音效引擎（零素材，全部现场合成）
//
// 设计要点（见 OPTIMIZE_PLAN §5.1）：
//   · 浏览器要求"用户手势"后才能出声 → 第一次点击/按键时 unlock()（main.js 里挂一次）
//   · 总线：master → sfx / ambient（设置页三条滑杆 + M 一键静音）
//   · 防声音爆炸：同名音效 N ms 内合并、同帧最多 MAX_VOICES 个、世界音效按距离衰减
//   · 音未就绪（未解锁 / 静音 / 不支持）时 sfx() 直接 return false —— 调用方不用判断
import { settings, saveSettings } from './settings.js';
import { state } from './state.js';
import { SFX_DEFS, attenOf, sfxRand } from '../data/sfx.js';
import { sfxFileBuffer, playSfxFile, loadSfxBank } from './sfxbank.js';

const MAX_VOICES = 8;            // 同一瞬间允许同时发声的数量（超了丢弃非警报音）
let ctx = null, master = null, sfxBus = null, ambBus = null, musicBus = null, limiter = null;
let noiseBuf = null;
let voices = [];                 // 发声结束时间戳，用来算并发
const lastAt = {};               // id → 上次播放时间（ms），用于去重
let muted = false;               // 运行期静音（M 键）
let plays = 0, drops = 0;        // 统计：实际出声 / 被去重或并发上限档下

// 调试：看看音频引擎现在什么状态
export function audioStats() {
  return {
    ctx: ctx ? ctx.state : 'none',
    ready: audioReady(), muted: isMuted(),
    master: settings.volMaster, sfx: settings.volSfx, ambient: settings.volAmbient, music: settings.volMusic,
    voices: voices.length, plays, drops,
  };
}

export function audioCtx() { return ctx; }
// 三条总线的取用口（音乐模块用它接自己的源；未解锁时返回 null）
export function audioBus(name) {
  if (!ctx) return null;
  if (name === 'sfx') return sfxBus;
  if (name === 'ambient') return ambBus;
  if (name === 'music') return musicBus;
  return null;
}
export function audioReady() { return !!ctx && ctx.state === 'running' && !muted && !settings.mute; }
export function isMuted() { return muted || !!settings.mute; }

// 创建/恢复上下文（幂等）。放在第一次用户手势里调用。
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    ambBus = ctx.createGain();
    musicBus = ctx.createGain();
    applyVolumes();
    // 末尾挂一个轻度压缩：同时放好几个音时不会刺破（像素游戏不需要混响，但需要不爆音）
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    sfxBus.connect(master);
    ambBus.connect(master);
    musicBus.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // 白噪声底：整局只生成一次，所有噪声类音效共用
    const n = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  loadSfxBank();                     // 趁解锁顺手把 assets/sfx/ 的文件库拉进来（异步、失败静默）
  return ctx;
}

// 设置页 / M 键都会走这里
export function applyVolumes() {
  if (!ctx) return;
  const m = isMuted() ? 0 : 1;
  master.gain.value = m * (settings.volMaster == null ? 0.8 : settings.volMaster);
  sfxBus.gain.value = settings.volSfx == null ? 0.75 : settings.volSfx;
  ambBus.gain.value = settings.volAmbient == null ? 0.5 : settings.volAmbient;
  if (musicBus) musicBus.gain.value = settings.volMusic == null ? 0.6 : settings.volMusic;
}

export function toggleMute(forceMute) {
  muted = forceMute == null ? !isMuted() : !!forceMute;
  applyVolumes();
  return isMuted();
}

// 世界音效的距离衰减基准 = 玩家（跟着走的人耳）
function distTo(x, y) {
  if (x == null || y == null) return null;
  const p = state.player;
  if (!p) return 0;
  return Math.hypot(x - p.x, y - p.y);
}

// 播放。opts: { vol 倍率, rate 音高倍率, x, y（世界坐标，做距离衰减）, force 忽略并发上限 }
// 【文件优先】assets/sfx/manifest.json 里登记过的 id 用你的音频文件；没登记就走下面的现场合成。
//   dedupe / 距离衰减 / 并发上限 / 音量配平 全部沿用 SFX_DEFS —— 换文件不会动混音平衡。
export function sfx(id, opts) {
  if (!audioReady()) return false;
  const def = SFX_DEFS[id] || {};
  const fileBuf = sfxFileBuffer(id);
  if (!def.tone && !def.noise && !fileBuf) return false;      // 既没定义也没文件：没这个音效
  const o = opts || {};
  const now = ctx.currentTime;
  const nowMs = now * 1000;
  if (def.dedupe && lastAt[id] && nowMs - lastAt[id] < def.dedupe) return false;// 并发上限：警报级（vol ≥ 0.7）永远放行，其余超了就丢
  voices = voices.filter((t) => t > now);
  if (voices.length >= MAX_VOICES && (def.vol || 0) < 0.7 && !o.force) return false;
  const dist = distTo(o.x, o.y);
  const att = attenOf(dist);
  if (att <= 0.01) return false;
  const scale = (def.vol == null ? 0.5 : def.vol) * (o.vol == null ? 1 : o.vol) * att;
  if (scale <= 0.005) return false;
  const rate = o.rate == null ? 1 : o.rate;
  lastAt[id] = nowMs;
  const bus = def.ambient ? ambBus : sfxBus;
  if (fileBuf) {                                             // ① 你的文件
    const dur = playSfxFile(id, bus, scale, rate);
    if (dur > 0) { voices.push(now + dur); plays++; return true; }
  }
  let end = 0.06;                                            // ② 合成音（默认）
  for (const t of def.tone || []) {
    const at = now + (t.at || 0);
    const dur = (t.dur || 0.08);
    const osc = ctx.createOscillator();
    osc.type = t.t || 'square';
    const f = sfxRand(t.f);
    osc.frequency.setValueAtTime(Math.max(20, f * rate), at);
    if (t.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sfxRand(t.f2) * rate), at + dur);
    const g = ctx.createGain();
    const peak = Math.max(0.0005, scale * (t.vol == null ? 1 : t.vol));
    env(g.gain, at, peak, dur, t.atk);
    osc.connect(g); g.connect(bus);
    osc.start(at); osc.stop(at + dur + 0.05);
    end = Math.max(end, (t.at || 0) + dur);
  }
  for (const nz of def.noise || []) {
    const at = now + (nz.at || 0);
    const dur = nz.dur || 0.08;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = nz.hp ? 'highpass' : 'bandpass';
    filter.frequency.value = sfxRand(nz.f == null ? 900 : nz.f) * rate;
    filter.Q.value = nz.q == null ? 1 : nz.q;
    const g = ctx.createGain();
    const peak = Math.max(0.0005, scale * (nz.vol == null ? 1 : nz.vol));
    env(g.gain, at, peak, dur);
    src.connect(filter); filter.connect(g); g.connect(bus);
    src.start(at); src.stop(at + dur + 0.05);
    end = Math.max(end, (nz.at || 0) + dur);
  }
  voices.push(now + end);
  plays++;
  return true;
}

// 一段"起-落"包络：快速起音 + 线性衰减到 0（不用指数，免得爆音）
function env(gain, at, peak, dur, atk) {
  const a = atk == null ? 0.004 : atk;
  gain.setValueAtTime(0.0001, at);
  gain.linearRampToValueAtTime(peak, at + Math.min(a, dur * 0.5));
  gain.linearRampToValueAtTime(0.0001, at + dur);
}

// —— 高频反馈的节流辅助 ——
// 采集别每一下都响：每 count 次响一次（音高随机，避免机关枪感）
export function everyN(key, count) {
  const s = state._sfxN || (state._sfxN = {});
  s[key] = (s[key] || 0) + 1;
  if (s[key] < count) return false;
  s[key] = 0;
  return true;
}

// 设置滑杆变了 / 载入设置后调用（把值推到总线；未解锁时 applyVolumes 自己会跳过）
export function onSettingsChanged() {
  applyVolumes();
}

export function setVolume(kind, v) {
  if (kind === 'sfx') settings.volSfx = v;
  else if (kind === 'ambient') settings.volAmbient = v;
  else if (kind === 'music') settings.volMusic = v;
  else settings.volMaster = v;
  applyVolumes();
  saveSettings();
}
