// data/music.js —— 音乐曲目表（**留给你放 mp3 的接口**）
//
// 用法：把音乐文件丢进 `assets/music/`，文件名对上下面 `base` 就会自动生效；
//       扩展名随便（.mp3 / .ogg / .wav / .m4a / .flac 都会按顺序试）。
//       文件不存在也没关系 —— 游戏会退回「合成环境垫音」（见 core/music.js），
//       所以**现在就能玩，做完一首就多一首**。
//
// 交付规格（详见 assets/music/README.md）：
//   · 循环曲：建议 1.5~4 分钟，首尾要能无缝循环（loop 点处不要有淡入淡出/尾音）
//   · 音量：-14 LUFS 左右（比音效轻），峰值 ≤ -3 dBFS，立体声 44.1kHz 即可
//   · 一次性曲（loop:false）：播完自动回到当前时段音乐（用于"序章完成"这类小高潮）

const EXTS = ['.mp3', '.ogg', '.wav', '.m4a', '.flac'];
export const MUSIC_EXT_ORDER = EXTS;

// base = 文件名主干；gain = 播放增益（不是音量滑杆，是这首曲子相对其它曲子的配平）
export const TRACKS = {
  title: { base: 'title', gain: 0.55, loop: true, mood: 'calm', desc: '主菜单 · 主题曲（第一印象，建议先做）' },
  day: { base: 'day', gain: 0.45, loop: true, mood: 'calm', desc: '白天 · 营地与采集（听得最久的一首）' },
  dusk: { base: 'dusk', gain: 0.5, loop: true, mood: 'tense', desc: '黄昏 20 秒 · 从白天过渡到蚀潮（可以只有 20~40 秒）' },
  tide: { base: 'tide', gain: 0.6, loop: true, mood: 'tense', desc: '蚀潮 60 秒 · 压力（强烈建议做）' },
  boss: { base: 'boss', gain: 0.66, loop: true, mood: 'dark', desc: '大潮 Boss · 玩家记住的一首（优先级最高）' },
  deep: { base: 'deep', gain: 0.45, loop: true, mood: 'dark', desc: '深渊层 · 压抑、少旋律（可选）' },
  clear: { base: 'clear', gain: 0.62, loop: false, mood: 'calm', desc: '序章完成的一小段（10~20 秒，一次性）' },
};

export const TRACK_ORDER = ['title', 'day', 'dusk', 'tide', 'boss', 'deep', 'clear'];

// 这首曲子的候选文件名（按扩展名顺序）
export function candidatesOf(id) {
  const t = TRACKS[id];
  if (!t) return [];
  const base = t.base;
  if (base.includes('.')) return [base];           // 表里直接写全名（含扩展名）就只试这一个
  return EXTS.map((e) => base + e);
}

// 合成垫音的"情绪"（没有音乐文件时按这个参数即兴合成）
// 注意：垫音挂在**音乐总线**上（它是"音乐的替身"），而不是环境音总线 ——
//       环境音总线留给 core/ambient.js 的三张床（夜风/地下/火焰）。
export const MOODS = {
  calm: { root: 110.0, fifth: 164.8, lfo: 0.06, cutoff: 620, vol: 0.16, mod: 90 },
  tense: { root: 98.0, fifth: 146.8, lfo: 0.14, cutoff: 520, vol: 0.19, mod: 150 },
  dark: { root: 82.4, fifth: 123.5, lfo: 0.05, cutoff: 380, vol: 0.2, mod: 70 },
};
