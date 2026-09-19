// data/codex.js —— 蚀兽图鉴（击杀记录 → 解锁 → 获得克制加成）
//
// 【W14-A 第 1 步的分工】图鉴里那句「弱点」拆成两层：
//   · 抗性那半句 = **由抗性表生成**（weakTextOf，读 data/enemies.js 的 armor）——“数字与文案不许两处写死”
//   · tactic 那半句 = 打法建议（不可从数据推导的那部分：拖住/集火/放哪里）
import { ENEMIES } from './enemies.js';
import { TYPE_ORDER, TYPE_NAME } from './combat.js';

export const CODEX = {
  bud: {
    name: '蚀芽', need: 3,
    desc: '脆皮快兽，成群直线冲光。',
    tactic: '一发光爆即可清场；数量多时用震荡塔一次扫一片。',
  },
  shell: {
    name: '蚀壳', need: 3,
    desc: '高血慢兽，会砸墙开路。',
    tactic: '震荡塔只能拖慢它（它扛震）；伤害交给辉光塔与光爆，用木墙把它拦在半路。',
  },
  moth: {
    name: '噬光虫', need: 3,
    desc: '优先扑向灯柱，啃食灯芯极快。',
    tactic: '它抗光——在灯旁布震荡塔更划算；光爆点名仍是一发带走。',
  },
  owl: {
    name: '夜枭', need: 3,
    desc: '飞行越墙，无视一切阻挡。',
    tactic: '只有辉光塔（对空）与光爆能打到它。',
  },
  core: {
    name: '蚀巢核心', need: 1,
    desc: '大潮中降临的巢核，会持续孵化蚀兽、并腐蚀营地灯。',
    tactic: '体型庞大但缓慢；先用震荡塔拖住减速，再用辉光塔与光爆集火本体。',
  },
  blind: {
    name: '盲蚀兽', need: 3,
    desc: '畏光的深渊猎手，只在黑暗中出手。',
    tactic: '把战场点亮：光照会灼伤它并逼它逃窜，而且它吃光伤——灯与光爆就是武器。',
  },
  spitter: {
    name: '吐蚀蛾', need: 3,
    desc: '噬光虫的近亲，站在 6 格外隔墙吐蚀。',
    tactic: '躲墙角不再万能：蓄力时它身上会亮起预警线——走出去、贴脸砍了它，或先杀掉它。',
  },
  charger: {
    name: '冲锋芽', need: 3,
    desc: '蚀芽的变体：3 格内蓄力 0.6 秒，然后锁定方向直冲。',
    tactic: '别站桩：看到它顶住不动就是蓄力，侧移一步就能让冲锋空掉。',
  },
  bomber: {
    name: '自爆壳', need: 3,
    desc: '蚀壳的变体：血量降到两成时引信 1.2 秒，然后自爆。',
    tactic: '别贴脸点射：残血时先退开，或直接用光爆/辉光塔远程清掉（它爆了也会伤到同族）。',
  },
  warden: {
    name: '庇护兽', need: 3,
    desc: '光环兽：身边的同族移速 +30%（青绿色光环）。',
    tactic: '先点它：它的血比小兽厚、还偏向扑灯——光环消失后那一整片都会慢下来。',
  },
};

export const UNLOCK_BONUS = 0.15;   // 解锁后对该物种伤害 +15%

// —— 抗性文案：从装甲表生成（改表就改文案，不可能分家）——
export function weakTextOf(kind) {
  const a = (ENEMIES[kind] && ENEMIES[kind].armor) || {};
  const fear = [], tough = [];
  for (const t of TYPE_ORDER) {
    const v = a[t];
    if (!v || Math.abs(v - 1) < 1e-9) continue;
    const nm = TYPE_NAME[t] || t;
    const pct = Math.round(Math.abs(v - 1) * 100);
    if (v > 1) fear.push(`怕${nm}（${nm}伤 +${pct}%）`);
    else tough.push(`扛${nm}（${nm}伤 −${pct}%）`);
  }
  if (!fear.length && !tough.length) return '无明显抗性：任何伤害都等额有效';
  return fear.concat(tough).join(' · ');
}
