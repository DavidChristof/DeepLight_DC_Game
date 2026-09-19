// ui/inspect.js —— 悬停查看：把"这一格是什么、有没有用、值不值得点"讲清楚
// 纯数据描述，不碰 DOM（DOM 部分在 main.js 的 #tip / #wtip）
import { BUILD, LIGHT_LEVELS, workOf } from '../data/buildings.js';
import { SURVIVAL } from '../data/survival.js';
import { usedOf } from '../systems/storage.js';
import { RES_NAME, RES_ORDER, CAMP_CAP } from '../data/storage.js';
import { NIGHTBLOOM, VENTS } from '../data/nightops.js';
import { T } from '../world/map.js';
import { ENEMIES } from '../data/enemies.js';
import { weakTextOf } from '../data/codex.js';
import { buildingAt } from '../systems/building.js';
import { hasTech } from '../systems/research.js';
import { beamNeighbor } from '../systems/towers.js';
import { TOWER_LV, towerHp } from '../data/buildings.js';
import { heldTool } from '../systems/tools.js';
import { RECIPE_OF, recipeName } from '../data/tools.js';
import { fireMatOf, fuelDef, fireOn } from '../data/fire.js';
import { smeltSecs } from '../systems/smelt.js';
import { traitName, traitDesc, sanityTier, SANITY_MAX, graveRadius } from '../data/traits.js';
import { hasAsset, specOf } from '../core/assets.js';
import { PORTRAIT_BY_TRAIT } from '../data/sprites.js';
import { bondLevel } from '../systems/mind.js';
import { LAYER_NAMES } from '../data/layers.js';
import { MODS, payloadStats } from '../data/payload.js';
import { TYPE_NAME } from '../data/combat.js';

const ACT_LABEL = { mine: '采集', bloom: '采摭', refine: '炼油', refuel: '加油', harvest: '采收', shaft: '竖井', soothe: '安抚', revive: '复苏', build: '施工', container: '打开容器', station: '打开制造台', payload: '装配载荷' };

const TILE_NAME = {
  [T.FLOOR]: '蚀苔地',
  [T.ROCK]: '岩壁',
  [T.ORE]: '辉髓矿脉',
  [T.VINE]: '藤木',
  [T.RELIC]: '遗迹碑',
  [T.MOTHER]: '辉髓母脉',
  [T.LAVA]: '岩浆',
};
const NODE_RES = { [T.ORE]: 'ore', [T.VINE]: 'vine', [T.RELIC]: 'data', [T.MOTHER]: 'core' };
const BLIGHT_LV = ['', '蚀痕 I（农田停产）', '蚀痕 II（蚀兽增强）', '蚀痕 III（夜里渗漏蚀兽）'];

// 建筑：名称 + 关键状态 + 一句提示
function describeBuilding(state, b) {
  const def = BUILD[b.type];
  if (!def) return null;
  // 工地（蓝图）：还没盖起来 —— 只说“还差多少工”和怎么盖
  if (b.site) {
    const need = workOf(b.type);
    const w = Math.min(need, b.work || 0);
    return {
      title: `工地：${def.name}`, kind: 'building', build: b.type,
      rows: [['工期', `${Math.floor(w)} / ${need} 工（${Math.round(w / need * 100)}%）`]],
      tip: '按住 E 施工（拓荒队白天也会自己来盖）· X 拆除可全额退回材料',
    };
  }
  const rows = [];
  if (def.maxFuel && b.type !== 'smelter' && b.type !== 'furnace') rows.push(['燃料', `${Math.round(b.fuel || 0)} / ${def.maxFuel}`]);
  if (def.power && !def.fireMat) {          // 炉子的“亮度”由火种决定，不用灯柱那套档位行
    const lv = LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1];
    rows.push(['亮度', `${lv.name}（半径 ×${lv.r}）`]);
  }
  if (def.hp) rows.push(['结构', `${Math.round(b.hp || 0)} / ${towerHp(def, b.level || 1)}`]);
  if (b.type === 'farm') rows.push(['生长', `${Math.round((b.growth || 0) * 100)}%${(b.growth || 0) >= 1 ? ' · 可采收' : ''}`]);
  if (b.type === 'prism') {
    const on = b.relayHop != null;
    rows.push(['接力', on ? `已接亮（第 ${b.relayHop} 段）` : `未点亮（需光照 ≥${BUILD.prism.relay.minLit}）`]);
    rows.push(['输出', on ? `亮度 ${BUILD.prism.relay.power} · 半径 ${BUILD.prism.relay.radius}（不耗燃料）` : '无']);
  }
  if (def.dmg) {
    // 装了载荷/升了级的塔不能直接念 def.dmg/def.range（那是空载 Lv1 基准）—— 一切走 payloadStats（单一来源）
    const ps = payloadStats(def, b.mods || [], b.level || 1);
    rows.push(['等级', `Lv${ps.等级} / ${ps.等级上限}${ps.等级 < ps.等级上限 ? `（升级 +${TOWER_LV[ps.等级].dmg}× 单发）` : '（已满级）'}`]);
    rows.push(['载荷', ps.mods.length ? `${ps.mods.map((m) => MODS[m].name).join(' · ')}（${ps.mods.length} 槽）` : '空载']) ;
    if (def.needsBeam) rows.push(['接光', beamNeighbor(state, b) ? '已接上光路（旁边那面棱镜亮着）' : '⚠ 未接光：旁边要有一面被点亮的棱镜']);
    rows.push(['输出', `${ps.单发}（${TYPE_NAME[ps.类型] || ps.类型}）/ 发 · 每秒 ${ps.每秒}`]);
    rows.push(['射程', `${ps.射程} · 命中上限 ${ps.命中上限}${ps.线 ? `（沿线 ${ps.线}）` : ''}`]);    if (ps.链) rows.push(['连锁', `跳 ${ps.链.跳} 格内下一个 · 最多 ${ps.链.最多} 跳 · 每跳 ×${ps.链.每跳}（潜在 ×${ps.链.倍率}）`]);    if (ps.每发燃耗 > 0) rows.push(['燃耗', `每发 ${ps.每发燃耗} · 每秒 ${ps.燃耗每秒}`]);
  }
  if (def.store) {
    const used = usedOf({ ref: b, cap: def.store });
    rows.push(['容量', `${used} / ${def.store}`]);
    const list = RES_ORDER.filter((k) => (b.stock && b.stock[k]) > 0).map((k) => `${RES_NAME[k]} ${b.stock[k]}`);
    if (list.length) rows.push(['存放', list.join(' · ')]);
  }
  if (b.type === 'clinic') {
    const active = b.medicalWorker;
    const queued = (state.medicalQueue || []).filter((w) => w && w.medicalClinic === b && w.medicalState === 'queued').length;
    rows.push(['治疗位', active ? `${active.name} · ${Math.round((active.medicalT || 0) / SURVIVAL.RESCUE.MEDICAL_SECS * 100)}%` : '空闲']);
    rows.push(['队列', `${queued} / ${SURVIVAL.RESCUE.MEDICAL_QUEUE_MAX}`]);
  }
  if (def.purifyR) rows.push(['净化', `每 ${def.purifySec}s · 半径 ${def.purifyR}`]);
  if (def.supplyRange) rows.push(['补给', `每 ${def.supplySec}s → ${def.supplyRange} 格内最缺油的灯`]);
  if (b.entry) rows.push(['方向', '上行（回上一层）']);
  else if (b.type === 'shaft') rows.push(['方向', '下行（更深处）']);

  let tip = '';
  if (b.type === 'lamp' || b.type === 'purifier') tip = (b.fuel || 0) <= 0 ? '⚠ 没燃料 · 不发光' : 'E 加油 · R 调档';
  else if (b.type === 'prism') {
    tip = b.relayHop != null
      ? '光路中继 · 不耗燃料，但只挨一下（结构 22）· 碎了下游全灭'
      : '⚠ 没被照亮 · 只是一块玻璃（先用灯照到它）';
  } else if (b.type === 'decoy') {
    tip = (b.fuel || 0) <= 0 ? '⚠ 没燃料 · 不再吸引蚀兽'
      : '⚠ 这不是光 · 只把蚀兽引过来（E 加油）';
  }
  else if (b.type === 'farm') tip = (b.growth || 0) >= 1 ? 'E 采收' : '需光照 ≥2.5 生长';
  else if (b.type === 'furnace') {
    const r = RECIPE_OF[b.recipe || 'fuel'];
    const fd = fuelDef(fireMatOf(b, def));
    if (r) {
      rows.push(['配方', recipeName(r)]);
      rows.push(['产出', `${Object.keys(r.cost).map((k) => RES_NAME[k]).join('+')} → ${RES_NAME[r.out] || r.out} ×${r.n || 1}`]);
    }
    rows.push(['火种', `${fd.name} ${b.fuel | 0} / ${def.maxFuel}${fireOn(b) ? '' : '（冷）'}`]);
    rows.push(['火力', `×${fd.heat}（1 个烧 ${fd.burnSec}s）`]);
    tip = fireOn(b)
      ? `E 面板 · 按住 E 手做【${r ? recipeName(r) : '炼油'}】`
      : '⚠ 没火 · E 点火';
  }
  else if (b.type === 'shaft') tip = 'E 使用竖井';
  else if (b.type === 'smelter') {
    const max = def.maxFuel || 12;
    const r = RECIPE_OF[b.recipe || 'fuel'];
    const fd = fuelDef(fireMatOf(b, def));
    rows.push(['配方', recipeName(r)]);
    rows.push(['火种', `${fd.name} ${b.fuel | 0} / ${max}`]);
    rows.push(['火力', `×${fd.heat}（1 个烧 ${fd.burnSec}s → 每 ${smeltSecs(b, state).toFixed(1)}s 一批）`]);
    rows.push(['累计', `已出 ${b.made | 0} 批`]);
    tip = b.off ? '已熄火 · E 打开操作台点火'
      : b.fuel > 0 ? (b.dry ? `⚠ 缺料 · ${RES_NAME[(r && Object.keys(r.cost)[0]) || 'ore'] || '料'}` : `运行中 · ${smeltSecs(b, state).toFixed(1)}s / 批【${recipeName(r)}】`)
        : `⚠ 没火种 · 加一个${fd.name}（藤木也行）`;
  }
  else if (def.station === 'analyze') tip = 'E 打开解析台 · 知识类研究只能在这里解锁';
  else if (b.type === 'clinic') tip = b.medicalWorker ? '治疗中 · 每人耗 1 燃料' : 'E 查看候诊 · 只治疗恢复期伤员';
  else if (def.station) tip = 'E 打开制造台 · 工具握在手里才生效';
  else if (def.store) tip = 'E 打开存取（采到的材料会自动进最近的容器）· 装满后多出来的会丢';
  else if (b.type === 'cache') tip = 'E 加燃料 · 它会自己分给附近的灯（噬光虫闻得到油味）';
  else if (def.dmg) {
    // 所有的塔：提示行写“能开火吗 / 为什么不能 / E 能干什么”
    const ps = payloadStats(def, b.mods || [], b.level || 1);
    if (def.needsBeam) {
      tip = (beamNeighbor(state, b) ? '已接上光路：正在开火' : '⚠ 未接光：旁边要有一面被点亮的棱镜（光路断一环就熄火）')
        + ` · E 装配载荷（现【${ps.name}】· Lv${ps.等级}）`;
    } else {
      const lv = state.light ? state.light[b.y * state.map.w + b.x] : 0;
      tip = (lv >= 3.2 ? '已充能：正在开火' : '⚠ 光照不足 3.2：不开火（点灯 = 铺输出）')
        + ` · E 装配载荷（现【${ps.name}】· Lv${ps.等级}）`;
    }
  }
  return { title: def.name, kind: 'building', rows, tip, build: b.type };
}

export function inspectTile(state, tx, ty) {
  const m = state.map;
  if (!m || tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return null;
  const i = ty * m.w + tx;
  const dis = state.discovered;
  if (dis && !dis[i]) return { title: '未探明', rows: [], tip: '走出营地或用灯照亮它', dim: true };

  const b = buildingAt(state, tx, ty);
  if (b) return describeBuilding(state, b);

  const t = m.tiles[i];
  const rows = [];
  const bl = m.blight ? m.blight[i] : 0;
  if (bl > 0) rows.push(['蚀痕', BLIGHT_LV[Math.min(3, bl)]]);
  const lv = state.light ? state.light[i] : 0;
  rows.push(['光照', lv.toFixed(1)]);

  if (t === T.ORE || t === T.VINE || t === T.RELIC || t === T.MOTHER) {
    const res = NODE_RES[t];
    const amt = m.nodeAmt[i];
    rows.unshift(['剩余', `${amt} 单位`]);
    const gain = res === 'ore' ? '辉髓' : res === 'vine' ? '藤木' : res === 'data' ? '档案点数' : '母髓';
    return { title: TILE_NAME[t], kind: 'node', rows, tip: `E 采集 → ${gain}${m.occWalk[i] ? '（无法站立：绕到旁边采）' : ''}` };
  }
  if (t === T.LAVA) {
    return { title: '岩浆', kind: 'lava', rows, tip: '唯一免费的光 —— 但站上去每秒 15 HP（蚀兽 13）', danger: true };
  }
  if (t === T.ROCK) {
    if (!hasTech(state, 'stonework')) return { title: '岩壁', rows, tip: '挡住光也挡住路（研究「石工」后可以凿穿）', dim: true };
    const amt = m.nodeAmt[i] || 0;
    const have = heldTool(state) === 'pick';
    if (amt > 0) rows.unshift(['剩余', `${amt} 块石头`]);
    return {
      title: '岩壁', kind: 'node', rows,
      tip: have ? 'E 凿开 → 石头（凿穿后这一格变成地面）' : 'E 徒手凿开 → 石头（慢 2.2 倍；在制造台做把石镐快 40%）',
      dim: false,
    };
  }
  return { title: TILE_NAME[t] || '地面', kind: 'floor', rows, tip: null };
}

// 建造/拆除模式下：这一格能不能放/拆（错误文案直接用 building.placeError）
export function inspectEnemyNear(state, tx, ty) {
  for (const e of state.enemies || []) {
    if (!e.alive) continue;
    if (Math.floor(e.x) !== tx || Math.floor(e.y) !== ty) continue;
    return e;
  }
  return null;
}

// 敌人：只看得到（已探明）才显示
export function inspectEnemy(state, e) {
  const d = ENEMIES[e.ekind];
  if (!d) return null;
  const rows = [['生命', `${Math.round(e.hp)} / ${e.maxHp}`]];
  if (d.dmg) rows.push(['伤害', `${d.dmg} · ${d.atkCd}s`]);
  if (d.lampPref) rows.push(['习性', '优先啃光源与补给站']);
  if (d.air) rows.push(['习性', '飞行：越墙，且踩不到作物']);
  if (d.breaker) rows.push(['习性', '破墙：会砸建筑与农田']);
  if (d.lightFear) rows.push(['习性', '畏光：光照 >3 会灼伤它']);
  if (d.armor && Object.keys(d.armor).length) rows.push(['抗性', weakTextOf(e.ekind)]);
  if (d.boss) rows.push(['习性', '大潮首领：孵化小怪 · 腐蚀营地灯']);
  return { title: d.name, kind: 'enemy', rows, danger: true, tip: `图鉴击杀 ${state.codex && state.codex[e.ekind] ? state.codex[e.ekind].kills || 0 : 0} 次` };
}

// HUD 提示行 / 画布标签用的：把交互目标说成一句人话
export function actLabel(act) {
  if (!act) return null;
  if (act.kind === 'mine') {
    const n = { ore: '辉髓', vine: '藤木', data: '解析遗迹碑（残页）', core: '采集母髓', stone: '开凿石头' }[act.res] || '采集';
    return n;
  }
  if (act.kind === 'station') {
    const st = BUILD[act.b.type] && BUILD[act.b.type].station;
    return st === 'smelter' ? '自动熔炉（配方 · 自动生产）'
      : st === 'furnace' ? '熔炉（配方 · 按住 E 手做）'
        : st === 'analyze' ? '打开解析台（知识在这里解锁）'
          : st === 'clinic' ? '打开医疗站（查看治疗队列）' : '打开制造台';
  }
  if (act.kind === 'bloom') return '采撷夜辉草';
  if (act.kind === 'container') {
    const c = act.c;
    const free = Math.max(0, c.cap - usedOf(c));
    return `打开容器（剩 ${free} 格）`;
  }
  if (act.kind === 'build') {
    const need = workOf(act.b.type);
    const left = Math.max(0, need - (act.b.work || 0));
    return `施工 ${BUILD[act.b.type].name}（还差 ${Math.ceil(left)} 工）`;
  }
  if (act.kind === 'refine') return '把辉髓炼成燃料';
  if (act.kind === 'refuel') return `给${BUILD[act.b.type].name}加燃料`;
  if (act.kind === 'harvest') return '采收幽菌田';
  if (act.kind === 'shaft') return act.b.entry ? '上升一层' : '下潜至更深处';
  if (act.kind === 'payload') {
    const ps = payloadStats(BUILD[act.b.type] || {}, act.b.mods || []);
    return `装配载荷【${ps.name}】`;
  }
  if (act.kind === 'soothe') return `安抚 ${act.w.name}（每次 8 燃料）`;
  if (act.kind === 'revive') return `复苏 ${act.g.name || '拓荒者'}（一次性救治）`;
  return ACT_LABEL[act.kind] || act.kind;
}

// 画布高亮用的颜色（与动作语义一致）
export const ACT_COLOR = {
  mine: '#4be0c4', bloom: '#b9a6ff', refine: '#ff9d5c',
  refuel: '#aee9ff', harvest: '#9ef7a8', shaft: '#7fe0ff', soothe: '#c07bff',
  revive: '#ffd76e',
  build: '#ffd76e',
  container: '#c9b48a',
  station: '#bfe0c0',
  payload: '#cdd9ff',
};

// ===== 拓荒者状态卡（侧栏名册 #wtip 与地图悬停 #tip 共用同一份） =====
export const JOB_LABEL = { gather: '采集', eat: '进食', flee: '回营避难', idle: '待命', guard: '守卫', forage: '夜采', patrol: '巡逻', mourn: '哀悼', wander: '梦游', hollow: '蚀化', refine: '炼油', build: '施工', stoke: '添火', rescue: '救援', medical: '治疗' };
export const JOB_COLOR = { gather: '#5ad9ff', eat: '#ffd76e', flee: '#ff7b7b', idle: '#8fa0b5', guard: '#9ef7d8', forage: '#b9a6ff', patrol: '#7fc7ff', mourn: '#9fb0c8', wander: '#c07bff', hollow: '#c07bff', refine: '#ff9d5c', build: '#ffd76e', stoke: '#ffb060', rescue: '#9ef7d8', medical: '#9fe8d5' };

export function moraleTier(v) {
  return v < 25 ? { name: '濒临崩溃', color: '#ff6b6b' } : v < 55 ? { name: '低落', color: '#ffd166' } : { name: '稳定', color: '#7dffb0' };
}
function tipBar(label, v, color) {
  const pct = Math.max(0, Math.min(100, v)) | 0;
  return `<div class="tt-bl"><span>${label}</span><em><i style="width:${pct}%;background:${color}"></i></em><u>${pct}</u></div>`;
}
export function workerTip(state, w) {
  const san = w.sanity == null ? SANITY_MAX : w.sanity;
  const tier = sanityTier(san);
  const mood = moraleTier(w.morale);
  const rows = [
    ['状态', `<span style="color:${JOB_COLOR[w.job] || '#8fa0b5'}">${w.downed ? '倒地待救' : (w.rescueState === 'escort' ? '护送中' : (w.medicalState === 'treating' ? '治疗中' : (w.medicalState === 'queued' ? '等待医疗位' : (JOB_LABEL[w.job] || w.job))))}</span>`],
    ['生命', `${Math.round(w.hp)} / ${w.maxHp}`],
    ['饱食', `${Math.round(w.hunger)}`],
    ['士气', `<span style="color:${mood.color}">${Math.round(w.morale)} ${mood.name}</span>`],
    ['心志', `<span style="color:${tier.color}">${Math.round(san)} ${tier.name}</span>`],
  ];
  if (w.layerId && w.layerId !== state.layerId) rows.push(['所在', LAYER_NAMES[w.layerId] || w.layerId]);
  const bars = `<div class="tt-bars">
      ${tipBar('生命', w.hp / w.maxHp * 100, '#ff9d9d')}
      ${tipBar('饱食', w.hunger, '#ffd76e')}
      ${tipBar('士气', w.morale, mood.color)}
      ${tipBar('心志', san, tier.color)}</div>`;
  const bonds = Object.keys(w.bonds || {}).map((n) => `${n} ♥${bondLevel(w.bonds[n])}`).filter((s) => !s.endsWith('♥0'));
  const notes = '<div class="tt-div"></div>'
    + `<div class="tt-note good"><b>专长</b>${traitName(w.traits && w.traits.good)} —— ${traitDesc(w.traits && w.traits.good)}</div>`
    + `<div class="tt-note bad"><b>短处</b>${traitName(w.traits && w.traits.bad)} —— ${traitDesc(w.traits && w.traits.bad)}</div>`
    + `<div class="tt-note${bonds.length ? '' : ' dim'}"><b>羁绊</b>${bonds.length ? bonds.join(' · ') : '尚无（同一盏灯下共事会慢慢建立）'}</div>`;
  return {
    title: w.name,
    sub: `拓荒者 · ${JOB_LABEL[w.job] || w.job}`,
    rows, bars, notes,
    portrait: portraitHTML(w),
    tip: w.downed ? `按 E 救援 · 还能撑 ${Math.ceil(w.downT || 0)}s` : (w.rescueState === 'escort' ? '护送中 · 跟着救援者到简易铺位' : (w.medicalState === 'treating' ? '医疗站治疗中 · 伤势会逐步清除' : (w.medicalState === 'queued' ? '等待医疗位 · 先保持在灯下' : (w.hollow ? '⚠ 已蚀化：按住 E 安抚把它拉回来（8 燃料）' : null)))),
    danger: !!w.hollow || !!w.downed,
    color: JOB_COLOR[w.job] || '#8fa0b5',
  };
}

// 半身立绘（W13-F）：按「专长」取图；没素材就返回 null（提示框不含图片）
function portraitHTML(w) {
  let key = PORTRAIT_BY_TRAIT[w.traits && w.traits.good];
  if (!hasAsset(key)) key = 'colonist_fallback';
  const sp = specOf(key);
  if (!hasAsset(key) || !sp) return null;
  return `<img class="tt-face" src="${sp.src}" alt="" width="44" height="44">`;
}

// ===== 地图上的点状实体（不是地块也不是建筑）：篝火 / 墓碑 / 夜辉草 / 潮穴 / 掉落物 =====
function describeBeacon(state, b) {
  const maxHp = b.maxHp || 300;
  const used = usedOf({ ref: b, cap: CAMP_CAP });
  const rows = [
    ['结构', `${Math.round(b.hp == null ? maxHp : b.hp)} / ${maxHp}`],
    ['光照', `亮度 ${b.power} · 半径 ${b.radius}`],
    ['仓储', `${used} / ${CAMP_CAP}`],
  ];
  const list = RES_ORDER.filter((k) => b.stock && b.stock[k] > 0).map((k) => `${RES_NAME[k]} ${b.stock[k]}`);
  if (list.length) rows.push(['存放', list.join(' · ')]);
  return {
    title: '营地篝火', kind: 'beacon', rows,
    tip: '采到的材料会自动存进这里（最近的容器）· 站在旁边按 E 开仓存取 · 招募新拓荒者在建造面板（B → 引路篝火）',
  };
}
function describeGrave(state, g) {
  const days = Math.max(1, state.day - (g.day || state.day) + 1);
  const rec = (state.memorial || []).find((m) => !m.revived && m.name === g.name && (m.x | 0) === (g.x | 0) && (m.y | 0) === (g.y | 0));
  const revive = rec ? (hasTech(state, 'revival') ? '按 E 尝试复苏（消耗稀缺资源，本局限一次）' : '研究「余烬回声」后，可在这里尝试复苏') : '这座墓碑只留下纪念';
  return {
    title: `墓碑 · ${g.name || '无名者'}`, kind: 'grave',
    rows: [['倒下', `第 ${g.day} 天`], ['已亮', `${days} 天`], ['照明', `半径 ${graveRadius(days).toFixed(1)}`]],
    tip: `他们化作了光：随天数变亮（上限 5 格），夜里自己守着营地 · ${revive}`,
  };
}
function describeBloom(b) {
  return {
    title: '夜辉草', kind: 'bloom',
    rows: [['花蕊', `剩 ${b.charges} 次`], ['每株产', `夜髓 ${NIGHTBLOOM.yield}`]],
    tip: '按住 E 采撷夜髓（研究树要用它换知识）· 被照亮的地方不会长，只在蚀潮的黑暗里开花',
  };
}
function describeVent(v) {
  const hot = (v.burst || 0) > 0;
  return {
    title: '潮穴', kind: 'vent', danger: hot,
    rows: [['状态', hot ? '正在喷发！' : '平静'], ['周期', `蚀潮中每 ${VENTS.interval} 秒`]],
    tip: hot ? '现在很危险：涌出蚀兽' : `喷发时涌出 ${VENTS.spawnMin}~${VENTS.spawnMax} 只蚀兽，并抛出母髓掉落物`,
  };
}
function describePickup(it) {
  const left = Math.max(0, (it.life || 0) - (it.t || 0));
  return {
    title: `掉落物 · ${RES_NAME[it.kind] || it.kind}`, kind: 'pickup',
    rows: [['剩余', `${left.toFixed(0)} 秒`]],
    tip: '走过去自动拾取（会进最近的容器）',
  };
}

// 点状实体命中的距离阈值（以格为单位，比较“鼠标所在格心”与实体视觉中心）
const HIT_R = 0.85;
export function inspectMapPoint(state, tx, ty) {
  const cx = tx + 0.5, cy = ty + 0.5;
  let best = null, bd = HIT_R;
  const probe = (x, y, make) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= bd) { bd = d; best = make; }
  };
  for (const b of state.beacons || []) probe(b.x + 0.5, b.y + 0.5, () => describeBeacon(state, b));
  if (state.layerId === 'surface') {
    for (const g of state.graves || []) probe(g.x + 0.5, g.y + 0.5, () => describeGrave(state, g));
  }
  const ops = state.layers && state.layers[state.layerId] ? state.layers[state.layerId].nightops : null;
  if (ops) {
    for (const b of ops.blooms) if (b.alive) probe(b.x + 0.5, b.y + 0.5, () => describeBloom(b));
    for (const v of ops.vents) probe(v.x + 0.5, v.y + 0.5, () => describeVent(v));
  }
  for (const it of state.pickups || []) probe(it.x, it.y, () => describePickup(it));
  for (const w of state.workers || []) {
    if (w.layerId !== state.layerId) continue;
    probe(w.x, w.y, () => workerTip(state, w));
  }
  return best ? best() : null;
}

