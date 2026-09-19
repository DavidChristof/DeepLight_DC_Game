// core/sfxbank.js —— 音效文件库：把你做好的音频文件接到游戏里（没文件就用合成音，能玩不受影响）
//
// 为什么要有这一层：
//   `js/data/sfx.js` 里 30 条音色全是 WebAudio 现场合成的（零素材、随时可调、体积为零），
//   但"合成音"天花板很低 —— 想要真的打击感/材质感，得换成你录/做的 wav。
//   所以这里加一条**文件优先**的通道：manifest 里登记了 id → 就用你的文件；没登记 → 照旧用合成音。
//
// 交付方式（详见 assets/SOUND.md）：
//   1. 把你的文件放进 `assets/sfx/`（子目录也行）
//   2. 在 `assets/sfx/manifest.json` 里加一行：`"mine": "mine_hit_v2.wav"`
//   3. 刷新页面 —— 那条音效就换成你的了，**其余仍是合成音**（可以一条一条替换，不用一次交齐）
//
// 注意：dedupe（同名合并）/ 距离衰减 / 并发上限 全部沿用 `js/data/sfx.js` 里的参数，
//       所以换文件不会改变混音平衡 —— 你只管把音色做好听。
import { audioCtx } from './audio.js';

const DIR = new URL('../../assets/sfx/', import.meta.url).href;
const buf = new Map();                 // id → AudioBuffer
const failed = new Set();
let loadedOnce = false;
let stats = { total: 0, ok: 0, missing: 0, version: null };

export function sfxFileBuffer(id) { return buf.get(id) || null; }
export function sfxBankStats() {
  return { ...stats, ids: [...buf.keys()].sort(), missingIds: [...failed].sort() };
}
export function sfxBankDir() { return DIR; }

// 播放一份文件缓冲：返回时长（秒，供上层算并发占用）；失败返回 0
export function playSfxFile(id, dest, gain, rate) {
  const ctx = audioCtx();
  const b = buf.get(id);
  if (!ctx || !b || !dest || gain <= 0) return 0;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate || 1;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g); g.connect(dest);
  src.start();
  return b.duration / (rate || 1);
}

// 读 manifest → 逐个 fetch + decode。任何一步失败都静默跳过（缺文件不是错误）
export async function loadSfxBank(url) {
  if (loadedOnce) return stats;
  loadedOnce = true;
  const ctx = audioCtx();
  if (!ctx) { loadedOnce = false; return stats; }        // 还没解锁音频，下次再试
  let man = null;
  try {
    const r = await fetch(url || (DIR + 'manifest.json'), { cache: 'no-cache' });
    if (!r.ok) return stats;
    man = await r.json();
  } catch (e) { return stats; }
  const map = (man && man.sounds) || man || {};
  const jobs = [];
  for (const id of Object.keys(map)) {
    const file = map[id];
    if (!file || typeof file !== 'string') continue;
    stats.total += 1;
    jobs.push((async () => {
      try {
        const r = await fetch(DIR + file, { cache: 'force-cache' });
        if (!r.ok) throw new Error('http ' + r.status);
        const arr = await r.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        buf.set(id, decoded);
        stats.ok += 1;
      } catch (e) {
        failed.add(id);
        stats.missing += 1;
      }
    })());
  }
  await Promise.all(jobs);
  stats.version = buf.size;
  return stats;
}
