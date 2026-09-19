// data/palette.js —— 唯一调色板（W13-E 视觉规范）
//
// 规矩：界面上的每个颜色都从这里取（HTML/Canvas 都算）。
//   · CSS 侧有一份对应的 :root 变量（css/style.css）—— 两边要一起改
//   · 文字色必须满足对比度 ≥ 4.5:1（对着面板底 #0a0c14 量过，见 contrast()）
//   · 状态色**必须**配形状/图标一起用（色盲友好）：颜色 + 图标=双编码
//
// 为什么要单开一个文件：以前颜色散在 style.css / storage.js / panels.js / render.js，
// 同一类东西三个色号，玩家看不出"这是同一类"；改一次要翻五个文件。

export const UI = {
  bg: '#02030a',        // 页面底
  panel: '#0a0c14',     // 面板实底（对比度计算基准）
  ink: '#dfe9ff',       // 正文
  inkStrong: '#eaf3ff', // 标题
  inkDim: '#929aac',    // 辅助文字（最坏背景下也 ≥4.5:1）
  inkFaint: '#878fa1',  // 极弱（仅非关键装饰）
  line: '#96b4ff',      // 描边基色（用时带 alpha）
  accent: '#a88cff',    // 紫：知识 / 研究 / 母髓类
  info: '#8fd0ff',      // 青：信息 / 光
  ok: '#7dffb0',        // 绿：可做 / 已完成
  warn: '#ffd76e',      // 黄：注意 / 燃料
  danger: '#ff8a6a',    // 红：不可做 / 危险
  lock: '#8b93a6',      // 灰：锁定
};

// 状态语义（严格按这套用，别各处自己发明）
export const STATE = {
  ok: UI.ok,        // 可建造 / 可研究 / 就绪
  poor: UI.danger,  // 资源不足 / 不可做
  done: '#7fe8d8',  // 已完成（青，与"可做"的绿区分开）
  lock: UI.lock,    // 未解锁
  know: UI.accent,  // 知识/残页
  warn: UI.warn,
};

// 资源与工具（侧栏 / 容器 / 飘字 / 悬停共用）
export const RES = {
  ore: '#4be0c4', vine: '#e0b96a', fuel: '#ff9d5c', food: '#9ef7a8',
  stone: '#9aa6b5', coal: '#95909b',      // 木炭原来 #6e6a72 → 太暗（2.9:1），提亮
  data: '#c9a0ff', core: '#ffd76e', night: '#b9a6ff',
  pick: '#cfe0f0', axe: '#e0b96a', sickle: '#9ef7a8', hammer: '#ff9d5c',
};

// 建造分类色（面板分类 chip / 快捷栏抬头）
export const CAT = {
  light: '#aee9ff',
  struct: '#b98c5f',
  prod: '#ffcf8a',
  def: '#c9a0ff',
  logi: '#9ef7a8',
};

// —— 对比度自检（WCAG 相对亮度）——
// 用法：contrast('#8b93a6', '#0a0c14') ≥ 4.5 才算合格
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export function contrast(fg, bg = UI.panel) {
  const a = lum(fg), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
// 半透明面板压在亮地形上时的等效底色（最坏情况：白天岩壁/岩浆附近）
export function blendOver(fg, alpha, back) {
  const f = parseInt(fg.slice(1), 16), b = parseInt(back.slice(1), 16);
  const mix = (s, e) => Math.round(s + (e - s) * (1 - alpha));
  const r = mix((f >> 16) & 255, (b >> 16) & 255);
  const g = mix((f >> 8) & 255, (b >> 8) & 255);
  const bl = mix(f & 255, b & 255);
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}
