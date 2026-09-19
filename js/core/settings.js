// core/settings.js —— 玩家设置（可持久化；被渲染/主循环/UI 读取）
const KEY = 'deep-light-settings-v1';

export const DEFAULTS = {
  scale: 'fit',        // 画布缩放：'fit' 自适应窗口 或 1 / 2 / 3 固定倍率
  glow: 1,             // 辉光强度倍率 0.4 ~ 1.6
  vignette: true,      // 屏幕暗角
  floaties: true,      // 采集/伤害飘字
  sidebar: true,       // 左侧常驻信息栏
  hints: true,         // 顶部帮助与提示行
  reduceMotion: false, // 降低界面动态
  colorAssist: false,  // 色弱辅助
  autosave: true,      // 跨天自动存档
  volMaster: 0.8,      // 主音量（音效引擎，见 core/audio.js）
  volSfx: 0.75,        // 音效总线
  volMusic: 0.6,       // 音乐总线（core/music.js：优先放你写的 mp3，缺文件时退回合成垫音）
  volAmbient: 0.5,     // 环境音总线
  synthMusic: true,    // 没有音乐文件时，用合成垫音顶着（不至于全程静音）
  mute: false,         // 一键静音（M 键）
  keys: {},            // 按键绑定（只存改过的；表见 data/keymap.js）
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      Object.assign(settings, DEFAULTS, data);
      settings.keys = Object.assign({}, data.keys || {});    // 嵌套对象必须克隆：不能与 DEFAULTS 共享引用
    }
  } catch (e) { /* 隐私模式等：忽略 */ }
  if (!settings.keys) settings.keys = {};
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  settings.keys = {};                  // 同上：自己一个新对象，别把默认表当变量用
  saveSettings();
}
