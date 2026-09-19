// systems/input.js —— 键盘 + 鼠标（按键 / 滚轮 / 中键拖拽）
// 方向键绑定由 data/keymap.js 统一提供（设置里改键后立即生效，不用重载）
import { boundCode } from '../data/keymap.js';

const KEYS = new Set();
const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const MOVE_IDS = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
// 这些键要拦掉浏览器默认行为（滚动/焦点跳转）
// ⚠️ Tab **不在这里**（B35）：拦掉它会让整屏界面里的键盘焦点走不动 ——
//   在新游戏屏里按 Tab 焦点会永远卡在「随机」按钮上，键盘玩家根本到不了「开始拓荒」。
//   游戏内仍然照旧生效：main.js 的 keydown 自己处理「轮换面板」并 preventDefault（屏幕打开时它会提前 return，
//   于是焦点交还给浏览器）—— 谁处理谁拦，别在这里一刀切。
const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace']);
// 指针状态：除了位置，还记「哪个键按着」/「滚轮转了多少」/「中键拖了多少」
const ptr = {
  sx: -1, sy: -1, cx: -1, cy: -1, inside: false,
  l: false, r: false, m: false,          // 左/右/中键按住
  alt: false, shift: false, ctrl: false, // 修饰键（拖拽时要实时读）
  wheel: 0,                              // 累积滚轮格数（由 takeWheel 取走）
  dragX: 0, dragY: 0,                    // 中键拖拽累积位移（画布像素，由 takeDrag 取走）
};
let pressBtn = 0;                        // 本帧刚按下的鼠标键（由 takePress 取走）

function syncMods(e) {
  ptr.alt = !!e.altKey; ptr.shift = !!e.shiftKey; ptr.ctrl = !!e.ctrlKey;
}

export function bindInput(canvas) {
  window.addEventListener('keydown', (e) => {
    syncMods(e);
    // 正在输入框里打字（面板筛选框 / 菜单种子框）：
    //   ① 不拦浏览器默认行为 —— BLOCK_DEFAULT 里有 Space/Backspace，拦了就等于“打不出空格、退格删不掉字”
    //   ② 不把按键记成“按着”（否则按住空格一直被当成在放光爆）
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    KEYS.add(e.code);
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();   // 免弹浏览器菜单
  });
  // 点进输入框：把“按着的键”和鼠标键全放掉（不然你会一边打字一边往前走）
  window.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { KEYS.clear(); ptr.l = ptr.r = ptr.m = false; }
  });
  window.addEventListener('keyup', (e) => { KEYS.delete(e.code); syncMods(e); });
  window.addEventListener('blur', () => { KEYS.clear(); ptr.l = ptr.r = ptr.m = false; });
  if (canvas) {
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener('mousemove', (e) => {
      syncMods(e);
      const p = toCanvas(e);
      if (ptr.m && ptr.sx >= 0) {          // 中键按住：累积拖拽位移（用于平移镜头）
        ptr.dragX += p.x - ptr.sx;
        ptr.dragY += p.y - ptr.sy;
      }
      ptr.sx = p.x; ptr.sy = p.y;
      ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.inside = true;
    });
    canvas.addEventListener('mouseleave', () => {
      ptr.sx = -1; ptr.sy = -1; ptr.inside = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      syncMods(e);
      if (e.button === 0) { ptr.l = true; pressBtn = 1; }
      else if (e.button === 2) ptr.r = true;
      else if (e.button === 1) { ptr.m = true; e.preventDefault(); }   // 中键：拖屏（顺便阻止浏览器自动滚动）
    });
    // 抬起要挂在 window 上：在画布外松手也要能清掉状态
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) ptr.l = false;
      else if (e.button === 2) ptr.r = false;
      else if (e.button === 1) ptr.m = false;
    });
    canvas.addEventListener('wheel', (e) => {
      ptr.wheel += e.deltaY > 0 ? 1 : -1;
      e.preventDefault();
    }, { passive: false });
  }
}

export function axis() {
  let dx = 0, dy = 0;
  for (const [id, ix, iy] of MOVE_IDS) if (KEYS.has(boundCode(id))) { dx += ix; dy += iy; }
  for (const k of KEYS) { const v = ARROWS[k]; if (v) { dx += v[0]; dy += v[1]; } }   // 方向键永远可用
  return { dx: Math.max(-1, Math.min(1, dx)), dy: Math.max(-1, Math.min(1, dy)) };
}

export function held(code) { return KEYS.has(code); }
export function pointer() { return ptr; }
// 取走（并清零）本帧累积的滚轮格数 / 中键拖拽位移
export function takeWheel() { const w = ptr.wheel; ptr.wheel = 0; return w; }
export function takeDrag() { const d = { x: ptr.dragX, y: ptr.dragY }; ptr.dragX = 0; ptr.dragY = 0; return d; }
// 本帧是否刚按下左键（一次性）：按住拖拽要靠它拿到“起点格”
export function takePress() { const b = pressBtn; pressBtn = 0; return b; }

