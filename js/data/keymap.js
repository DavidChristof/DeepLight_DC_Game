// data/keymap.js —— 按键绑定的**唯一数据源**
//
// 三处都读这一张表，所以永远不会互相打架：
//   1) 游戏逻辑（main.js / panels.js 用 keyHit('help', event) 判断）
//   2) H 键位表覆盖层（由 KEY_ACTIONS 生成，不再手写）
//   3) 设置 → 控制（每行一个动作 + 改键按钮）
//
// 绑定值格式：`Code` 或 `Ctrl+Code` / `Alt+Code`；Shift 默认不参与匹配（因为它常被当成"反向/直线"的修饰键，
// 例如 Shift+Q = 反着换分类、Shift+Tab = 反向轮换面板），除非绑定里显式写了 Shift。
import { settings, saveSettings } from '../core/settings.js';

export const KEY_GROUPS = [
  { id: 'move', name: '移动', note: '方向键永远可用（不必改）' },
  { id: 'act', name: '交互' },
  { id: 'build', name: '建造' },
  { id: 'ui', name: '界面与菜单' },
  { id: 'mouse', name: '鼠标（固定）' },
];

export const KEY_ACTIONS = [
  // —— 移动 ——
  { id: 'up', group: 'move', label: '向上', code: 'KeyW' },
  { id: 'down', group: 'move', label: '向下', code: 'KeyS' },
  { id: 'left', group: 'move', label: '向左', code: 'KeyA' },
  { id: 'right', group: 'move', label: '向右', code: 'KeyD' },
  { id: 'run', group: 'move', label: '快走（按住）', code: 'ShiftLeft', fixed: true, hint: '左右 Shift 都行 · 只加速，不消耗' },
  // —— 交互 ——
  { id: 'interact', group: 'act', label: '交互 / 施工 / 采集', code: 'KeyE', hint: '按住 = 连续做' },
  { id: 'pulse', group: 'act', label: '光爆', code: 'Space', hint: '耗 1 燃料' },
  { id: 'fire', group: 'act', label: '手持开火', code: 'KeyF', hint: '手持辉光棒时有用（约 3 发 1 燃料）' },
  { id: 'eat', group: 'act', label: '吃口粮 / 热食', code: 'KeyZ', hint: '靠营地火或点燃的炉子会吃热食' },
  { id: 'carry', group: 'act', label: '背负 / 放下结构体', code: 'KeyV', hint: '站在塔旁按住 = 背上；背着时按住 = 放下（需研究「背负支架」）' },
  { id: 'seal', group: 'act', label: '封灯撤退（按住）', code: 'KeyY', hint: '只在壶潮里顶过 20 秒后才能按：倒掉所有灯油、全队士气受挫，潮立刻退去（每 3 天一次）' },
  { id: 'rest', group: 'act', label: '休整', code: 'KeyU', hint: '站在铺位或营地火旁；蚀潮与敌人靠近时会中断' },
  { id: 'lamp', group: 'act', label: '切换最近光源亮度档', code: 'KeyR', hint: '低 / 中 / 高' },
  // —— 建造 ——
  { id: 'hotbar', group: 'build', label: '快捷栏第 1~9 格', code: 'Digit1', fixed: true, hint: '固定用数字键（会顺手把快捷建造栏叫出来）' },
  { id: 'hotbarToggle', group: 'build', label: '快捷建造栏', code: 'KeyQ', hint: '再按一次收起（同时放下手里的蓝图）' },
  { id: 'catPrev', group: 'build', label: '上一个建造分类', code: 'BracketLeft', hint: '也可点面板里的分类' },
  { id: 'catNext', group: 'build', label: '下一个建造分类', code: 'BracketRight' },
  { id: 'demolish', group: 'build', label: '拆除模式', code: 'KeyX', hint: '工地全退 · 建成退半' },
  { id: 'undo', group: 'build', label: '撤销上一次放置', code: 'Control+KeyZ', hint: '30 秒内 · 全额退料' },
  // —— 界面与菜单 ——
  { id: 'panelBuild', group: 'ui', label: '建造面板', code: 'KeyB' },
  { id: 'panelNight', group: 'ui', label: '夜行面板', code: 'KeyN' },
  { id: 'panelResearch', group: 'ui', label: '研究面板', code: 'KeyT' },
  { id: 'panelCodex', group: 'ui', label: '图鉴面板', code: 'KeyC' },
  { id: 'panelPack', group: 'ui', label: '背包面板', code: 'KeyI', hint: '查看随身物品；可丢到脚边' },
  { id: 'panelCrew', group: 'ui', label: '拓荒队调度面板', code: 'KeyO', hint: '查看任务、驻守、工作区与夜班许可' },
  { id: 'panelTab', group: 'ui', label: '依次轮换面板', code: 'Tab', hint: 'Shift+Tab 反向' },
  { id: 'confirm', group: 'ui', label: '确认（面板内）', code: 'Enter', hint: '等于点一下鼠标指着的那一行' },
  { id: 'pause', group: 'ui', label: '暂停 / 继续', code: 'KeyP', hint: '快速冻结，不开菜单' },
  { id: 'mute', group: 'ui', label: '静音 / 恢复', code: 'KeyM' },
  { id: 'help', group: 'ui', label: '键位表', code: 'KeyH' },
  { id: 'roster', group: 'ui', label: '折叠拓荒队名册', code: 'KeyG' },
  { id: 'cancel', group: 'ui', label: '取消 / 返回 / 菜单', code: 'Escape', fixed: true, hint: '逐层：取消操作 → 关面板 → 菜单' },
  // —— 鼠标（只展示，不可改） ——
  { id: 'mFollow', group: 'mouse', label: '前往 / 按住跟随', code: 'Mouse0', fixed: true, hint: '建造中 = 放置；按住拖 = 矩形填充' },
  { id: 'mUse', group: 'mouse', label: '对光标处做事', code: 'Mouse2', fixed: true, hint: '采集 / 点火 / 加油 / 开面板；建造中 = 退出建造' },
  { id: 'mPan', group: 'mouse', label: '拖动镜头', code: 'Mouse1', fixed: true, hint: '一走动就收回身边' },
  { id: 'mZoom', group: 'mouse', label: '缩放 / 切快捷栏', code: 'Wheel', fixed: true, hint: '建造中 = 切格位' },
];

export const ACTION_BY_ID = {};
for (const a of KEY_ACTIONS) ACTION_BY_ID[a.id] = a;

export const DEFAULT_KEYS = {};
for (const a of KEY_ACTIONS) DEFAULT_KEYS[a.id] = a.code;

// —— 代号 → 人话 ——
const NAME = {
  Space: '空格', Tab: 'Tab', Escape: 'Esc', Enter: '回车', Backspace: '退格', Delete: 'Del',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Control: 'Ctrl', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
  Shift: 'Shift', ShiftLeft: '左Shift', ShiftRight: '右Shift',
  Alt: 'Alt', AltLeft: '左Alt', AltRight: '右Alt',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  Mouse0: '左键', Mouse1: '中键', Mouse2: '右键', Wheel: '滚轮',
  CapsLock: '大写锁定',
};
export function keyLabel(code) {
  if (!code) return '未设置';
  return String(code).split('+').map((p) => {
    if (NAME[p]) return NAME[p];
    if (/^Key[A-Z]$/.test(p)) return p.slice(3);
    if (/^Digit\d$/.test(p)) return p.slice(5);
    if (/^Numpad/.test(p)) return '小键盘' + p.slice(6);
    return p;
  }).join(' + ');
}

// 当前生效的绑定（设置里没写就用默认）
export function boundCode(id) {
  const k = settings.keys || {};
  const v = k[id];
  return v == null ? DEFAULT_KEYS[id] : v;
}
export const isChanged = (id) => {
  const k = settings.keys || {};
  return k[id] != null && k[id] !== DEFAULT_KEYS[id];
};

// 这个键事件是不是这个动作（Shift 默认忽略：它常被当"反向"用）
export function matchCode(bound, e) {
  if (!bound || !e || !e.code) return false;
  const parts = String(bound).split('+');
  const code = parts[parts.length - 1];
  if (e.code !== code) return false;
  const needCtrl = parts.includes('Control'), needAlt = parts.includes('Alt'), needShift = parts.includes('Shift');
  if (!!e.ctrlKey !== needCtrl) return false;
  if (!!e.altKey !== needAlt) return false;
  if (needShift && !e.shiftKey) return false;
  return true;
}
export const keyHit = (id, e) => matchCode(boundCode(id), e);

// 纯修饰键不能当绑定用（按住 Ctrl 想配组合键，不是在绑 Ctrl 本身）
export function isModifierOnly(code) {
  return ['Control', 'ControlLeft', 'ControlRight', 'Shift', 'ShiftLeft', 'ShiftRight', 'Alt', 'AltLeft', 'AltRight', 'Meta', 'MetaLeft', 'MetaRight', 'CapsLock'].includes(code);
}

// 写入绑定：与别的动作冲突就**交换**；与固定动作冲突就拒绝
// 返回 { ok, why?, swapped? }
export function setKey(id, code) {
  const me = ACTION_BY_ID[id];
  if (!me) return { ok: false, why: '未知动作' };
  if (me.fixed) return { ok: false, why: '这个键固定' };
  if (!settings.keys) settings.keys = {};
  const other = KEY_ACTIONS.find((a) => a.id !== id && boundCode(a.id) === code);
  if (other && other.fixed) return { ok: false, why: `「${other.label}」固定占用这个键` };
  const mine = boundCode(id);
  settings.keys[id] = code;
  if (other) settings.keys[other.id] = mine;          // 交换，绝不出现"两个动作同一个键"
  saveSettings();
  return { ok: true, swapped: other ? other.label : null };
}

export function resetKey(id) {
  if (!settings.keys) settings.keys = {};
  delete settings.keys[id];
  saveSettings();
}
export function resetAllKeys() {
  settings.keys = {};
  saveSettings();
}
export const changedCount = () => KEY_ACTIONS.filter((a) => isChanged(a.id)).length;

// 面板用：按索引拿分组
export function actionsOf(group) { return KEY_ACTIONS.filter((a) => a.group === group); }
