// systems/codex.js —— 图鉴进度：击杀记录 → 解锁 → 伤害加成（知识解锁）
import { CODEX, UNLOCK_BONUS } from '../data/codex.js';

export function entryOf(state, kind) {
  return state.codex[kind] || { kills: 0, unlocked: false };
}

// 记录一次击杀；达到阈值则解锁（未登记的种类安全跳过）
export function recordKill(state, kind) {
  const def = CODEX[kind];
  if (!def) return;                 // 新兽种忘了登记图鉴时不崩
  const e = entryOf(state, kind);
  e.kills += 1;
  if (!e.unlocked && e.kills >= def.need) {
    e.unlocked = true;
    state.floaties.push({
      x: state.player.x, y: state.player.y - 1.0,
      txt: `图鉴解锁：${def.name}`, color: '#9ef7d8', t: 0, life: 1.6,
    });
  }
  state.codex[kind] = e;
  state.codexVersion = (state.codexVersion || 0) + 1;   // 触发面板刷新
}

// 已解锁物种的伤害加成（对其伤害 +15%）
export function damageMul(state, kind) {
  const e = state.codex[kind];
  return e && e.unlocked ? 1 + UNLOCK_BONUS : 1;
}
