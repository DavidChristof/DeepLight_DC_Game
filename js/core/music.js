// core/music.js —— 音乐：**你自己的 mp3** 与**合成垫音**两条腿走路
//
// 设计目标（用户的诉求）：
//   · 一部分直接合成（音效已在 core/audio.js；这里再提供"缺文件时的合成垫音"）
//   · 另一部分**留接口加载音频文件** —— 用户自己写曲子，丢进 assets/music/ 即生效
//
// 行为：
//   1. 按游戏状态挑一首（title / day / dusk / tide / boss / deep / clear）
//   2. 交叉淡化切换（2.2 秒），同一首不重启
//   3. 文件缺失 / 解码失败 → 标记 missing，改放「合成垫音」按情绪（calm/tense/dark）即兴
//      —— 所以**现在一首都没有也能玩**，用户做完一首就自动多一首
//   4. 会随主音量 / 静音一起走（挂在 audio.js 的 musicBus 上）
//
// 加载方式用 <audio> + MediaElementSource：流式解码，内存占用极小（2G 云主机友好）。

import { settings } from './settings.js';
import { state } from './state.js';
import { audioCtx, audioBus, isMuted } from './audio.js';
import { TRACKS, candidatesOf, MOODS } from '../data/music.js';
import { isTide, TIDE_START, DUSK_START } from './time.js';

const FADE = 2.2;                        // 交叉淡化时长（秒）
const FADE_OUT_ON_LOSE = 1.6;
const DIR = new URL('../../assets/music/', import.meta.url).href;   // 相对本文件定位（不受页面路径影响）

let unlocked = false;
const slots = {};                        // id → { el, src(src node), gain, ok:true|false|null, tried:[], mood }
const missing = {};                      // id → true（试完全部候选都没成）
let cur = null;                          // 当前曲目 id
let incoming = null, fadeT = 1;          // 交叉淡化进度（1 = 已完成为止）
let stingerT = 0;                        // 一次性曲（clear）剩余时间
let logOnce = false;

// —— 合成垫音（没有音乐文件时的替身）——
const pad = { on: false, mood: null, nodes: null, fade: 0, target: 0 };

function slotOf(id) {
  if (slots[id]) return slots[id];
  slots[id] = { el: null, src: null, gain: null, ok: null, cand: 0, mood: (TRACKS[id] && TRACKS[id].mood) || 'calm' };
  return slots[id];
}

// 试着把某一首挂上音频图（幂等；失败会顺次试下一个扩展名）
function ensureLoaded(id) {
  const ctx = audioCtx();
  if (!ctx) return null;
  const s = slotOf(id);
  if (s.ok === true || s.ok === false) return s;
  const bus = audioBus('music');
  if (!bus) return null;
  if (!s.el) {
    s.el = new Audio();
    s.el.preload = 'auto';
    s.el.loop = !!(TRACKS[id] && TRACKS[id].loop);
    s.el.volume = 1;                                     // 音量交给 WebAudio 的 gain，元素本身不调
    s.src = ctx.createMediaElementSource(s.el);
    s.gain = ctx.createGain();
    s.gain.gain.value = 0;
    s.src.connect(s.gain);
    s.gain.connect(bus);
    s.el.addEventListener('error', () => nextCandidate(id));
    s.el.addEventListener('ended', () => {
      if (s.el.loop === false) stingerT = 0;
      // 某些浏览器/解码器会在循环边界错误地派发 ended；循环曲不能因此永久静音。
      else if (cur === id && unlocked && !isMuted() && audioCtx()?.state === 'running') s.el.play().catch(() => {});
    });
  }
  if (s.ok === null) {
    const cands = candidatesOf(id);
    if (s.cand >= cands.length) { markMissing(id); return s; }
    s.el.src = DIR + cands[s.cand];
    s.el.load();
    if (typeof s.el.play === 'function') { /* 真正的播放推迟到需要时 */ }
    s.ok = true;                                          // 乐观：先认为能放，error 事件会纠正
  }
  return s;
}

function nextCandidate(id) {
  const s = slotOf(id);
  s.cand += 1;
  s.ok = null;
  const cands = candidatesOf(id);
  if (s.cand >= cands.length) { markMissing(id); return; }
  s.el.src = DIR + cands[s.cand];
  s.el.load();
  s.ok = true;
}

function markMissing(id) {
  missing[id] = true;
  const s = slotOf(id);
  s.ok = false;
  if (!logOnce) {
    logOnce = true;
    console.info(`[music] 没找到 assets/music/${TRACKS[id].base}.*（mp3/ogg/wav/m4a/flac 都试过了）—— 暂时用合成垫音顶替。放进去就自动生效。`);
  }
}

// —— 该放哪一首 ——
export function wantTrack(s) {
  if (!s || !s.started) return 'title';
  if (s.bossRef && s.bossRef.alive) return 'boss';
  if (isTide(s)) return 'tide';
  if (s.layerId && s.layerId !== 'surface') return 'deep';
  if (s.t >= DUSK_START && s.t < TIDE_START) return 'dusk';
  return 'day';
}

// 首次用户手势里调用（与音效解锁同一时机）
export function unlockMusic() {
  unlocked = true;
  const t = wantTrack(state);
  const s = ensureLoaded(t);
  // 在真实用户手势的同一调用栈里启动首曲，避免浏览器把下一帧的 play()
  // 判定为自动播放并静默拒绝。后续切歌仍交给 updateMusic 的交叉淡化。
  if (s && s.ok !== false && s.el) {
    s.el.play().catch(() => {});
    if (!cur) {
      cur = t;
      fadeT = 1;
      if (s.gain) s.gain.gain.value = TRACKS[t].gain;
    }
  }
  padTarget(null);
}

export function updateMusic(s, dt) {
  if (!unlocked) return;
  const ctx = audioCtx();
  if (!ctx || ctx.state !== 'running') return;

  // 1) 目标曲目
  let want = wantTrack(s);
  if (stingerT > 0) {
    stingerT -= dt;
    want = cur;                                            // 一次性曲播放期间不切歌
    if (stingerT <= 0) { /* 回落到常态 */ }
  }

  // 2) 交叉淡化
  if (want !== cur && fadeT >= 1) { incoming = want; fadeT = 0; }
  if (incoming) {
    fadeT = Math.min(1, fadeT + dt / FADE);
    const a = cur ? ensureLoaded(cur) : null;
    const b = ensureLoaded(incoming);
    const ga = (TRACKS[cur] ? TRACKS[cur].gain : 0.5) * (1 - fadeT);
    const gb = (TRACKS[incoming] ? TRACKS[incoming].gain : 0.5) * fadeT;
    if (a && a.gain) a.gain.gain.value = ga;
    if (b && b.gain) b.gain.gain.value = gb;
    if (b && b.ok !== false) {
      if (b.el.paused) b.el.play().catch(() => {});
    }
    // 没有可淡出的旧曲时，不要把 cur 提前改成 incoming。
    // 否则下一帧 a 会重新指向 b，收尾逻辑会把新曲自己 pause + 置零，
    // 典型症状是「切回主菜单后约两秒标题曲就断了」。
    if (fadeT >= 1 || !a || a.ok === false) {
      if (a && a !== b && a.el && !a.el.paused) a.el.pause();
      if (a && a !== b && a.gain) a.gain.gain.value = 0;
      if (b && b.gain && b.ok !== false) b.gain.gain.value = TRACKS[incoming].gain;
      cur = incoming;
      incoming = null;
      fadeT = 1;
    }
  } else if (!cur) {
    const s2 = ensureLoaded(want);
    if (s2) {
      if (s2.ok !== false) { if (s2.el.paused) s2.el.play().catch(() => {}); s2.gain.gain.value = TRACKS[want].gain; }
      cur = want;
    }
  }

  // 播放看门狗：媒体元素可能因焦点切换、解码短暂失败或浏览器节流而自行 paused；
  // 只对当前循环曲重启，不触碰暂停/静音和一次性 stinger。
  if (cur && stingerT <= 0 && !isMuted()) {
    const live = slotOf(cur);
    if (live.el && live.ok !== false && live.el.paused) live.el.play().catch(() => {});
  }

  // 3) 垫音：**每帧唯一一次判定**（当前这首放不出来才开；能放就关，不允许两条腿同时响）
  const cs = cur ? slotOf(cur) : null;
  padTarget(cs && cs.ok === false ? cs.mood : null);

  // 4) 静音 / 暂停菜单：把垫音压下去（音乐本身跟着 master 走，不用管）
  const want2 = (!state.started || state.quickPause) ? 0.35 : 1;
  pad.fade += (want2 - pad.fade) * Math.min(1, dt * 3);
  stepPad(dt);
}

// 手动放一次性曲（例：序章完成）
export function playStinger(id) {
  if (!unlocked || missing[id]) return false;
  const s = ensureLoaded(id);
  if (!s || s.ok === false) return false;
  stingerT = 6;
  s.gain.gain.value = TRACKS[id].gain;
  s.el.loop = false;
  s.el.currentTime = 0;
  s.el.play().catch(() => {});
  return true;
}

// —— 合成垫音：两条失谐正弦 + 低通 + 慢 LFO ——
function padTarget(mood) {
  if (!settings.synthMusic) mood = null;
  if (pad.mood === mood && ((mood && pad.on) || (!mood && !pad.on))) return;
  pad.mood = mood;
  if (!mood) { stopPad(); return; }
  if (isMuted()) return;
  startPad(mood);
}

function startPad(mood) {
  const ctx = audioCtx();
  const bus = audioBus('music');      // 合成垫音是「音乐」的替身，挂音乐总线（环境音滑杆留给 ambient.js 的三张床）
  if (!ctx || !bus) return;
  stopPad();
  const cfg = MOODS[mood] || MOODS.calm;
  const g = ctx.createGain();
  g.gain.value = 0;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = cfg.cutoff;
  filt.Q.value = 0.6;
  const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = cfg.root;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = cfg.fifth;
  o2.detune.value = 7;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = cfg.lfo;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = cfg.mod;
  lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
  o1.connect(filt); o2.connect(filt); filt.connect(g); g.connect(bus);
  const t0 = ctx.currentTime;
  g.gain.linearRampToValueAtTime(cfg.vol, t0 + 2.5);              // 缓入，别吓人
  o1.start(t0); o2.start(t0); lfo.start(t0);
  pad.nodes = { o1, o2, lfo, g, filt };
  pad.on = true;
  pad.cur = cfg.vol;
}

function stopPad() {
  const n = pad.nodes;
  if (!n) { pad.on = false; return; }
  const ctx = audioCtx();
  const t0 = ctx ? ctx.currentTime : 0;
  try {
    n.g.gain.cancelScheduledValues(t0);
    n.g.gain.setValueAtTime(n.g.gain.value, t0);
    n.g.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
    for (const o of [n.o1, n.o2, n.lfo]) o.stop(t0 + 1.35);
  } catch (e) { /* 忽略 */ }
  pad.nodes = null; pad.on = false;
}

function stepPad(dt) {
  if (!pad.nodes) return;
  pad.nodes.g.gain.value = pad.cur * pad.fade;
}

export function musicStatus() {
  const files = {};
  for (const id of Object.keys(TRACKS)) files[id] = missing[id] ? 'missing' : (slots[id] && slots[id].ok === null ? 'pending' : (slots[id] && slots[id].ok === false ? 'missing' : 'ok'));
  const media = cur && slots[cur] && slots[cur].el ? {
    paused: !!slots[cur].el.paused, ended: !!slots[cur].el.ended,
    currentTime: +((slots[cur].el.currentTime || 0).toFixed(2)),
    duration: Number.isFinite(slots[cur].el.duration) ? +(slots[cur].el.duration.toFixed(2)) : null,
    loop: !!slots[cur].el.loop, readyState: slots[cur].el.readyState,
    gain: slots[cur].gain ? +slots[cur].gain.gain.value.toFixed(3) : null,
  } : null;
  return {
    unlocked, cur, want: wantTrack(state), files,
    pad: pad.on ? pad.mood : null, dir: DIR,
    vol: settings.volMusic, synth: !!settings.synthMusic, stinger: +stingerT.toFixed(1), media,
  };
}

export function musicDir() { return DIR; }
