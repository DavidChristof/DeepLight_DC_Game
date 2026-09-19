// dev/selftest.js —— 开发期不变量检测器（W13-N 第 0／1／2 步的地基）
//
// 目的：把"人工一个个点着找 bug"换成"机器按清单翻"。它**不属于玩法**，
//       只在 window 上挂几个句柄，正常玩不受影响（__watch 关闭时每帧只多一次 if）。
//
// 用法（浏览器控制台）：
//   __check()                    → { ok, ran, fails:[{id, msg, data}], ms }
//   __baseline()                 → 把当前清单记为"已知基线"，之后只报**新增**的
//   __watch(true, 30)            → 每 30 帧自检一次（长跑用），违例累积到日志
//   __testLog() / __testReset()  → 看/清累积日志（按 id 去重计数 + 首次现场）
//   __only('res.ledger')         → 只跑某几项（调试某一类问题）
//   __listCheck()                → 全部检查项 id
//
// 原则（写在 docs/BUG_HUNT.md §0）：
//   ① 检测先于修复：先拿基线，再改代码，改完对比
//   ② 白名单而非静默：已知问题登记进基线，不淹掉新问题
//   ③ 每条违例都要能打印现场数据（哪个实体/哪个坐标/哪个数）
//   ④ 自己写错检查项 → 报成 check.error，绝不让检测器本身把游戏搞崩
//
// ⚠️ 覆盖面（当前版本）：
//   · 运行时：只查**当前层**（state.map / state.buildings / state.enemies…）的活数据
//   · 容器：查**所有层**（allContainers(state,false)）
//   · 数据表：全量静态交叉校验
//   · 未覆盖（留给后续步骤）：跨层建筑格校验、存档往返指纹、交互矩阵、面板矩阵
import { state } from '../core/state.js';
import { isTide, isDawn, isNight, phaseIndexOf, DAY_SECS, TIDE_START, TIDE_END, DAY_END, DUSK_START, MORNING_SECS, DAWN_T } from '../core/time.js';
import { allContainers, packContainer, usedOf, deposit, withdrawOne } from '../systems/storage.js';
import { PULSE, TOWER, WAVES, BOSS, TYPES, TYPE_ORDER, TYPE_NAME, armorMul, LIGHT_FEAR_BURN, ABILITY, tideOf, HAND_FIRE, CARRY, RETREAT } from '../data/combat.js';   // W14-A：战斗数值唯一数据源
import { SURVIVAL } from '../data/survival.js';
import { MODS, MOD_ORDER, SHAPE_MODS, FUEL_PER_MOD, MAX_SLOTS, SLOT_TECHS, loadError, payloadStats, allLoads, allCombos, towerTypes, dmgMulRange, lvMulRange } from '../data/payload.js';
import { slotsOf } from '../systems/research.js';
import { pulseMul, pulseRangeMul, towerDmgMul, towerRateMul, owlDmgMul } from '../systems/research.js';
import { blightStats, BLIGHT, BLIGHT_MAX, ensureBlight } from '../systems/blight.js';
import { STARVE } from '../data/traits.js';
import { makeRng, curveRow, POLICIES } from './replay.js';
import { overlapStats } from '../systems/collide.js';
import { RES_ORDER, RES_NAME, CAMP_CAP, PACK_CAP, STORE_CAP, STORE_ORDER } from '../data/storage.js';
import { BUILD, CATEGORIES, CATEGORY_OF, TOWER_LV, TOWER_LV_MAX, towerHp, upgradeCostFor, PRISM_LIT, PRISM_MAX_HOPS } from '../data/buildings.js';
import { beamNeighbor } from '../systems/towers.js';
import { RESEARCH, RESEARCH_ORDER, SECTS } from '../data/research.js';
import { RECIPES, TOOLS, TOOL_ORDER, recipesOf, canFire } from '../data/tools.js';
import { canMineRock, mineTimeMul } from '../systems/tools.js';
import { placeError } from '../systems/building.js';
import { resolveInteract, resolveInteractAt, E_REACH } from '../systems/interact.js';
import { CODEX, weakTextOf } from '../data/codex.js';
import { VISUAL, visualSpec } from '../data/visual.js';
import { SPRITES, CODEX_ART } from '../data/sprites.js';
import { HINTS } from '../systems/hints.js';
import { SRC_FILES } from './filelist.js';
import { KEY_ACTIONS } from '../data/keymap.js';
import { SFX_DEFS } from '../data/sfx.js';
import { FUELS, FUEL_ORDER } from '../data/fire.js';
import { ENEMIES, KINDS, kindFor, bandOf } from '../data/enemies.js';
import { SEGMENTS, THEMES, NIGHT, TIDE_SECS, themeIdOf, themeOf, signatureOf, planNight, nightPlan, mainKindOf, nightHud, wavesLeft, wavesInWindow, spawnInterval, segAtRel } from '../data/night.js';
import { sealError, sealNow, litLampStats } from '../systems/seal.js';
import { DIFFICULTY, DIFF_ORDER } from '../data/difficulty.js';
import { PANELS, panelQuerySnapshot } from '../ui/panels.js';
import { T } from '../world/map.js';
import { NODE_AMT, NODE_DEEP, nodeMax, nodeStart, nodeFallback, ROCK_START } from '../data/nodes.js';
import { LAYER_ORDER, LAYER_NAMES, LAYER_META } from '../data/layers.js';
import { snapshot } from '../core/save.js';
import { ECOLOGY, BIOMES, biomeIdAt, frontStageOf } from '../data/ecology.js';
import { COLONISTS, crewCardOf, roleTaskMul, roleInfluence, assignRole } from '../data/colonists.js';
import { TASKS, DIRECTIVES, taskFromSave, directiveFromSave } from '../data/tasks.js';
import { taskBoardStats } from '../systems/taskBoard.js';

// 节点地形与上限都取自 data/nodes.js（唯一数据源，B13 之后不再手写第二份）
const NODE_TILES = Object.keys(NODE_AMT).map(Number).concat([T.ROCK]);

const LAYER_IDS = ['surface', 'depth1', 'depth2', 'depth3'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MAX_DETAIL = 8;        // 同一类违例最多报几条（避免刷屏，但会写明"共 N 条"）

// —— 小工具 ——
// 逐个字段查 NaN / Infinity：给"现场路径"比给一个笼统的"有 NaN" 有用得多
function scanFinite(obj, path, out, skip = new Set()) {
  if (out.length >= 400) return;
  if (obj == null) return;
  for (const k in obj) {
    if (skip.has(k)) continue;
    const v = obj[k];
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${path}.${k}=${v}`);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'stock') {
      // 只下钻一层（stock/bonds 这类字典另有检查）
      for (const k2 in v) {
        const v2 = v[k2];
        if (typeof v2 === 'number' && !Number.isFinite(v2)) out.push(`${path}.${k}.${k2}=${v2}`);
      }
    }
  }
}
const floorKeys = new Set(['layerId', 'name', 'job', 'type', 'kind', 'ekind', 'recipe', 'fireMat', 'id', 'txt', 'color', 'traits']);
const bad = (id, msg, data) => ({ id, msg, data });

// =====================================================================
// A. 运行时不变量（需要已开局）
// =====================================================================
const RUNTIME_CHECKS = [
  // A1 账本守恒：state.res 必须恒等于「所有容器 + 背包」之和
  {
    id: 'res.ledger',
    run() {
      if (!state.started || !state.map) return null;
      const sum = {};
      for (const k of RES_ORDER) sum[k] = 0;
      for (const c of allContainers(state, false)) for (const k in (c.ref.stock || {})) sum[k] = (sum[k] || 0) + c.ref.stock[k];
      const pack = packContainer(state);
      for (const k in (pack.ref.stock || {})) sum[k] = (sum[k] || 0) + pack.ref.stock[k];
      // 区块远征：休眠区块已由 allContainers(state,false) 统一纳入，这里不要再加一遍。
      const diff = [];
      for (const k of RES_ORDER) if ((state.res[k] || 0) !== (sum[k] || 0)) diff.push(`${RES_NAME[k] || k}: 总账=${state.res[k] || 0} 实际=${sum[k] || 0}`);
      // 反向：容器里出现 STORE_ORDER 之外的东西（例如拼错的资源 key）
      // 注：容器里放工具（pick/axe…）是正常的，所以用 STORE_ORDER 而不是 RES_ORDER 判「未知」
      const alien = new Set();
      for (const c of allContainers(state, false)) for (const k in (c.ref.stock || {})) if (!STORE_ORDER.includes(k)) alien.add(k);
      for (const k in (pack.ref.stock || {})) if (!STORE_ORDER.includes(k)) alien.add(k);
      if (alien.size) diff.push(`容器里有未知资源 key: ${[...alien].join(',')}`);
      return diff.length ? bad('res.ledger', '库存总账与容器实际不符', diff) : null;
    },
  },
  // A2 关键字段不许是 NaN / Infinity
  {
    id: 'num.finite',
    run() {
      if (!state.started) return null;
      const out = [];
      scanFinite(state, 'state', out, new Set(['map', 'layers', 'light', 'discovered', 'camera', 'cursor', 'res', 'player', 'floaties', 'beams', 'pickups', 'enemies', 'workers', 'buildings', 'beacons', 'seen', 'codex', 'research', 'milestone', 'bossRef', 'patrol', 'dest', 'banner', 'diff', 'pulse']));
      scanFinite(state.player || {}, 'player', out);
      scanFinite(state.res || {}, 'res', out);
      for (const b of state.buildings || []) scanFinite(b, `building[${b.type}@${b.x},${b.y}]`, out, new Set(['stock']));
      for (const w of state.workers || []) scanFinite(w, `worker[${w.name}]`, out, new Set(['bonds', 'traits']));
      for (const e of state.enemies || []) scanFinite(e, `enemy[${e.ekind}#${e.id ?? ''}]`, out);
      for (const p of state.pickups || []) scanFinite(p, 'pickup', out);
      return out.length ? bad('num.finite', `${out.length} 处 NaN/Infinity`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A3 取值范围：0 下限 / 百分比上限
  {
    id: 'num.range',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const b of state.buildings || []) {
        const where = `${b.type}@${b.x},${b.y}`;
        if (b.fuel != null && b.fuel < 0) out.push(`${where}.fuel=${b.fuel}`);
        if (b.hp != null && b.hp < 0) out.push(`${where}.hp=${b.hp}`);
        if (b.growth != null && (b.growth < 0 || b.growth > 1.001)) out.push(`${where}.growth=${b.growth}`);
        if (b.work != null && b.work < 0) out.push(`${where}.work=${b.work}`);
        if (b.prog != null && b.prog < 0) out.push(`${where}.prog=${b.prog}`);
        // 火种槽不许超过容量
        const def = BUILD[b.type];
        if (def && def.maxFuel && b.fuel != null && b.fuel > def.maxFuel) out.push(`${where}.fuel=${b.fuel} > maxFuel=${def.maxFuel}`);
      }
      for (const w of state.workers || []) {
        if (w.hp != null && (w.hp < 0 || w.hp > (w.maxHp || 100) + 0.01)) out.push(`worker[${w.name}].hp=${w.hp}/${w.maxHp}`);
        if (w.hunger != null && (w.hunger < 0 || w.hunger > 100.01)) out.push(`worker[${w.name}].hunger=${w.hunger}`);
        if (w.morale != null && (w.morale < 0 || w.morale > 100.01)) out.push(`worker[${w.name}].morale=${w.morale}`);
        if (w.sanity != null && (w.sanity < 0 || w.sanity > 100.01)) out.push(`worker[${w.name}].sanity=${w.sanity}`);
      }
      if (state.playerHp != null && (state.playerHp < 0 || state.playerHp > (state.playerMaxHp || 100) + 0.01)) out.push(`playerHp=${state.playerHp}/${state.playerMaxHp}`);
      return out.length ? bad('num.range', `${out.length} 处越界`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A4 坐标必须在地图内
  {
    id: 'pos.inBounds',
    run() {
      const m = state.map;
      if (!state.started || !m) return null;
      const out = [];
      const inside = (x, y, tag) => {
        if (!isNum(x) || !isNum(y)) return;                 // NaN 由 num.finite 报
        if (x < -0.01 || y < -0.01 || x > m.w + 0.01 || y > m.h + 0.01) out.push(`${tag}=(${x.toFixed(2)},${y.toFixed(2)}) 地图 ${m.w}×${m.h}`);
      };
      if (state.player) inside(state.player.x, state.player.y, 'player');
      for (const w of state.workers || []) if (w.layerId === state.layerId) inside(w.x, w.y, `worker[${w.name}]`);
      for (const e of state.enemies || []) inside(e.x, e.y, `enemy[${e.ekind}]`);
      for (const p of state.pickups || []) inside(p.x, p.y, `pickup[${p.kind}]`);
      return out.length ? bad('pos.inBounds', `${out.length} 个实体跑到地图外`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A5 容器：不超容量、条目合法（非负整数）
  {
    id: 'container.cap',
    run() {
      if (!state.started) return null;
      const out = [];
      const all = allContainers(state, false).concat([packContainer(state)]);
      for (const c of all) {
        const used = usedOf(c);
        if (used > c.cap) out.push(`${c.kind}@${c.layerId}(${c.x},${c.y}) 用了 ${used} > 容量 ${c.cap}`);
        if (used < 0) out.push(`${c.kind}@${c.layerId} 用了负数 ${used}`);
        for (const k in (c.ref.stock || {})) {
          const v = c.ref.stock[k];
          if (!isNum(v) || v < 0 || Math.floor(v) !== v) out.push(`${c.kind}.stock.${k}=${v}（应为非负整数）`);
        }
      }
      return out.length ? bad('container.cap', `${out.length} 处容器异常`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A6 建筑格标记：occBuild 必为 1；solid 建成的必占行走格；工地不许挡路/挡光
  {
    id: 'build.occ',
    run() {
      const m = state.map;
      if (!state.started || !m || !m.occBuild) return null;
      const out = [];
      const seen = new Set();
      for (const b of state.buildings || []) {
        const i = b.y * m.w + b.x;
        const def = BUILD[b.type] || {};
        const where = `${b.type}@${b.x},${b.y}${b.site ? '(工地)' : ''}`;
        // 背在身上的结构体（第 5 步 5b）**故意不占格**：它每帧跟着玩家跑，占格会把人锁死/把地形改坏。
        //   它的不变量由 carry.state 单独守（必须不在任何一层的"地上"）。
        //   ⚠️ 只能查"它自己没占"：玩家脚下完全可能正压着别的建筑（比如死亡就地放下了一座塔、
        //   或者干脆站在竖井上）—— 那时 occWalk/occBuild 本来就该是 1，不是它的锅。
        if (b.mounted) {
          if (state.carried !== b) out.push(`${where} 挂了 mounted 但不是 state.carried`);
          const other = (state.buildings || []).find((x) => x !== b && x.x === b.x && x.y === b.y);
          if (!other && (m.occBuild[i] !== 0 || m.occWalk[i] !== 0)) out.push(`${where} 背在身上却占了格`);
          continue;
        }
        if (seen.has(i)) out.push(`${where} 与另一建筑同格`);
        seen.add(i);
        if (m.occBuild[i] !== 1) out.push(`${where} occBuild=0（建造格没标上）`);
        if (!b.site && def.solid && m.occWalk[i] !== 1) out.push(`${where} 已建成且实体，但 occWalk=0（会被人穿过去）`);
        if (!b.site && !def.solid && m.occWalk[i] === 1) out.push(`${where} 可通行建筑却占了行走格（occWalk=1）`);
        if (b.site && m.blockLight[i] === 1) out.push(`${where} 工地不该挡光，但 blockLight=1`);
      }
      return out.length ? bad('build.occ', `${out.length} 处建筑格标记不对`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A7 面板引用：stationRef / storeRef 指向的东西必须还在
  // 【为什么只查“面板开着的时候”】消费方全部是 `allContainers(...).find(x => x.ref === storeRef)`
  // 这类查表式用法，找不到就当“没东西”。所以**悬空引用本身无害**，有害的只有
  // “面板/HUD 正在读它”那一种：那会让面板渲染成空、血条卡在旧 Boss 上。
  // （第一版不看 activePanel 就报，结果新开局后跑矩阵必报一条假警）
  {
    id: 'ui.ref',
    run() {
      if (!state.started) return null;
      const out = [];
      if (state.activePanel && !PANELS.some((p) => p.id === state.activePanel)) out.push(`activePanel=${state.activePanel} 不是已知面板`);
      const panelOpen = !!state.activePanel;
      if (panelOpen && state.stationRef && !(state.buildings || []).includes(state.stationRef)) {
        out.push('操作台面板开着，stationRef 指向的建筑已不在 buildings 里（面板会卡在“不在了”）');
      }
      if (panelOpen && state.storeRef && !allContainers(state, false).some((c) => c.ref === state.storeRef)) {
        out.push('容器面板开着，storeRef 指向的容器已不存在（面板会渲染成空）');
      }
      // Boss 血条：只有“引用还在但目标已经死了/被移走了”才会卡住
      if (state.bossRef && state.bossRef.alive !== false && !(state.enemies || []).includes(state.bossRef)) {
        out.push('bossRef 还活着但已不在 enemies 里（HUD 血条会卡住）');
      }
      if (state.activePanel && state.stationRef && state.stationRef.site && state.activePanel !== 'store') {
        out.push(`面板 ${state.activePanel} 开在一个工地上`);
      }
      return out.length ? bad('ui.ref', `${out.length} 处 UI 引用问题`, out) : null;
    },
  },
  // A8 时间与相位：相位与 state.t 必须自洽
  {
    id: 'time.phase',
    run() {
      if (!state.started) return null;
      const out = [];
      const t = state.t;
      if (t < 0 || t >= DAY_SECS) out.push(`state.t=${t} 超出一天范围 [0,${DAY_SECS})`);
      const idx = phaseIndexOf(state);
      const expect = t < DAY_END ? 0 : t < TIDE_START ? 1 : t < TIDE_END ? 2 : 3;
      if (idx !== expect) out.push(`相位索引 ${idx} 与 t=${t.toFixed(1)} 不符（应为 ${expect}）`);
      if (isTide(state) !== (expect === 2)) out.push(`isTide 与相位不一致`);
      if (isDawn(state) !== (expect === 3)) out.push(`isDawn 与相位不一致`);
      // 注：isNight 是「光线黑下来」的**宽**概念：黄昏(300+)～次日清晨(MORNING_SECS)都算，
      //     不等于蚀潮相位。第一版把它写成 === 相位 1|2|3，新开局 t∈[0,6) 就误报。
      const expectNight = t < MORNING_SECS || t >= DUSK_START;
      if (isNight(state) !== expectNight) out.push(`isNight=${isNight(state)} 但按 t=${t.toFixed(2)} 应为 ${expectNight}`);
      if (state.day < 1 || Math.floor(state.day) !== state.day) out.push(`state.day=${state.day}`);
      return out.length ? bad('time.phase', '时间/相位自洽性不对', out) : null;
    },
  },
  // A9 蚀痕网格：长度对得上、等级在范围内、统计与网格一致
  {
    id: 'blight.grid',
    run() {
      const m = state.map;
      if (!state.started || !m || !m.blight) return null;
      const out = [];
      if (m.blight.length !== m.w * m.h) out.push(`blight.length=${m.blight.length} ≠ ${m.w * m.h}`);
      let tiles = 0, neg = 0, over = 0, nan = 0;
      for (let i = 0; i < m.blight.length; i++) {
        const v = m.blight[i];
        if (!Number.isFinite(v)) { nan++; continue; }
        if (v < 0) neg++;
        if (v > 0) tiles++;
        if (v > 3) over++;
      }
      if (nan) out.push(`${nan} 格蚀痕是 NaN`);
      if (neg) out.push(`${neg} 格蚀痕是负数`);
      if (over) out.push(`${over} 格蚀痕超过 3 级上限`);
      const st = blightStats(state);
      if (st.tiles !== tiles) out.push(`blightStats.tiles=${st.tiles} ≠ 实际 ${tiles}`);
      const fronts = m.blightFronts || [];
      if (fronts.length > 8) out.push(`blightFronts=${fronts.length} 超过每区块上限 8`);
      for (const f of fronts) {
        if (!(f.level >= 1 && f.level <= 3)) out.push(`front(${f.x},${f.y}) level=${f.level}`);
        if (!Array.isArray(f.cells) || f.cells.length > 96) out.push(`front(${f.x},${f.y}) cells 超限`);
        for (const i of (f.cells || [])) if (!(i >= 0 && i < m.w * m.h) || !(m.blight[i] > 0)) { out.push(`front(${f.x},${f.y}) 引用了无效蚀痕格 ${i}`); break; }
      }
      return out.length ? bad('blight.grid', '蚀痕网格异常', out) : null;
    },
  },
  // A10 光照数组：长度/数值合法（抽样，避免每帧全扫）
  {
    id: 'light.sane',
    run() {
      const m = state.map;
      if (!state.started || !m || !state.light) return null;
      const out = [];
      if (state.light.length !== m.w * m.h) out.push(`light.length=${state.light.length} ≠ ${m.w * m.h}`);
      let nan = 0, neg = 0;
      const step = 7;                                     // 抽样步长：够抓结构性问题
      for (let i = 0; i < state.light.length; i += step) {
        const v = state.light[i];
        if (!Number.isFinite(v)) nan++;
        else if (v < 0) neg++;
      }
      if (nan) out.push(`抽样发现 ${nan} 处光照为 NaN`);
      if (neg) out.push(`抽样发现 ${neg} 处光照为负`);
      if (!(state.lightMax > 0)) out.push(`lightMax=${state.lightMax}`);
      return out.length ? bad('light.sane', '光照数组异常', out) : null;
    },
  },
  // A10b 光源自己那一格必须吃满自己的光
  // 【为什么】旧实现把 spread() 里 d===0 跳过了（“光源自己不算自己的光”），于是灯/篝火脚下
  //   那格只有邻居漏过来的光：夜里那张格等于全黑 —— ①光照遮罩把那格压暗（玩家看到的就是
  //   “篝火底下没被照到”）②建筑自身亮度 lit(i) 也拿不到自己的光 ③蚀痕/夜辉草把它当黑格。
  //   现在这一格 = p，所以“源头格 ≥ 自己的强度”是个硬不变量，写成检测项守死。
  {
    id: 'light.srcTile',
    run() {
      const m = state.map;
      if (!state.started || !m || !state.light) return null;
      const out = [];
      const chk = (x, y, p, who) => {
        const tx = x | 0, ty = y | 0;
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
        const lv = state.light[ty * m.w + tx];
        if (!(lv >= p - 1e-6)) out.push(`${who}(${tx},${ty}) 自身强度 ${p} 但那格光照只有 ${+lv.toFixed(2)}`);
      };
      for (const b of state.beacons || []) chk(b.x, b.y, b.power, '篝火');
      const pl = state.player;
      if (pl && pl.lamp) chk(pl.x, pl.y, pl.lamp.power, '提灯');
      for (const b of state.buildings || []) {
        if (b.site || b.fuel <= 0 || b.off) continue;
        const def = BUILD[b.type];
        if (!def || !def.power || def.decoy) continue;
        chk(b.x, b.y, def.power, def.name || b.type);
      }
      return out.length ? bad('light.srcTile', '光源自己那格没吃满自己的光', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A10c 交互目标必须听鼠标
  // 【为什么】多个可交互对象挤在一起时（炉子贴着矿脉、两口井挨着…）“自动选最近”等于玩家选不了，
  //   经常“看到框在矿脉上、按 E 却砍了旁边的树”。现在规则是：光标指得到就用光标那个，指不到才回退最近优先。
  //   两个硬不变量：①光标有目标时，解析结果必须**就是** resolveInteractAt 的结果（两者不能各算一套）
  //                ②解析出的任何目标都必须在 E_REACH（贴身范围）内 —— 不允许“隔空交互”
  //   ⚠️ 候选光标格不能只看玩家周围（开局周围常常光秃秃，那样这条检查就是空跑）：
  //      要把**全图所有可交互物所在的格**都当光标点试一遍，检查才有牙齿。
  {
    id: 'interact.cursor',
    run() {
      const m = state.map;
      if (!state.started || !m) return null;
      const p = state.player;
      const out = [];
      const posOf = (a) => {
        if (!a) return null;
        if (a.x != null) return { x: a.x, y: a.y };
        if (a.b) return { x: a.b.x, y: a.b.y };
        if (a.c) return { x: a.c.x, y: a.c.y };
        if (a.w) return { x: a.w.x, y: a.w.y };
        if (a.pack) return { x: a.pack.x, y: a.pack.y };
        return null;
      };
      const same = (a, b) => {
        if (!a || !b) return a === b;
        const A = posOf(a), B = posOf(b);
        return a.kind === b.kind && !!A && !!B && A.x === B.x && A.y === B.y;
      };
      // 候选光标格：①玩家 3 格内全部 ②所有可交互物所在格 ③所有资源/岩壁格（只要玩家够得着）
      const cands = new Set();
      const key = (x, y) => y * m.w + x;
      const px0 = Math.floor(p.x), py0 = Math.floor(p.y);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const tx = px0 + dx, ty = py0 + dy;
        if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) cands.add(key(tx, ty));
      }
      const push = (b) => { if (!b || b.site) return; const i = key(b.x, b.y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const tx = b.x + dx, ty = b.y + dy; if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) cands.add(key(tx, ty)); } void i; };
      for (const b of state.beacons || []) push(b);
      for (const b of state.buildings || []) { const def = BUILD[b.type]; if (def && (def.station || def.dmg || def.maxFuel || def.store || def.container || def.shaft)) push(b); }
      // 资源节点/岩壁：只挑玩家够得着那一圈（全图扫会让检查变成 O(w·h)）
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 2], [-1, 2], [2, 1], [2, -1], [-1, -2], [1, -2], [-2, 1], [-2, -1]]) {
        const tx = px0 + dx, ty = py0 + dy;
        if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) cands.add(key(tx, ty));
      }
      for (const i of cands) {
        const tx = i % m.w, ty = (i / m.w) | 0;
        const at = resolveInteractAt(state, tx, ty, E_REACH);
        const got = resolveInteract(state, { tx, ty });
        if (at && !same(at, got)) {
          const g = posOf(got);
          out.push(`光标(${tx},${ty}) 贴身法是 ${at.kind}，解析却成了 ${got ? got.kind : 'null'}${g ? `@(${g.x},${g.y})` : ''}`);
        }
        const g = posOf(got);
        if (g) {
          const d = Math.max(Math.abs(g.x + 0.5 - p.x), Math.abs(g.y + 0.5 - p.y));
          if (d > E_REACH + 1e-6) out.push(`光标(${tx},${ty}) 解析到 ${got.kind}@(${g.x},${g.y})，距玩家 ${+d.toFixed(2)} > E_REACH ${E_REACH}`);
        }
        if (out.length >= MAX_DETAIL) break;
      }
      return out.length ? bad('interact.cursor', '交互目标不听鼠标 / 超出贴身范围', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A11 资源节点量与地形匹配
  // 注：nodeAmt 是「懒初始化」的（初次采集才写表值），所以 0 永远合法；
  //     非节点地形必须恒为 0；节点地形 0..上限。
  {
    id: 'node.amt',
    run() {
      const m = state.map;
      if (!state.started || !m || !m.nodeAmt) return null;
      const out = [];
      for (let i = 0; i < m.nodeAmt.length; i++) {
        const t = m.tiles[i], a = m.nodeAmt[i], max = nodeMax(t);
        const isNode = max !== undefined;
        if (!isNode) {
          if (a !== 0) { out.push(`格(${i % m.w},${(i / m.w) | 0}) 地形${t} 不是节点却有 nodeAmt=${a}`); if (out.length >= MAX_DETAIL) break; }
          continue;
        }
        if (!(a >= 0)) { out.push(`节点(${i % m.w},${(i / m.w) | 0}) 地形${t} nodeAmt=${a}（负数）`); if (out.length >= MAX_DETAIL) break; }
        if (a > max) { out.push(`节点(${i % m.w},${(i / m.w) | 0}) 地形${t} nodeAmt=${a} > 上限${max}`); if (out.length >= MAX_DETAIL) break; }
      }
      return out.length ? bad('node.amt', '资源节点剩余量异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A6b 固定玩法点可以通行，但不能被建筑蓝图覆盖（B54）。
  {
    id: 'build.reserved',
    run() {
      if (!state.started || !state.map) return null;
      const out = [];
      for (const b of state.beacons || []) {
        const err = placeError(state, 'wall', b.x, b.y, { ignoreCost: true });
        if (err !== '营地火') out.push(`篝火@${b.x},${b.y} 放置返回「${err}」（应为营地火）`);
      }
      if (state.layerId === 'surface') {
        const ops = state.layers && state.layers.surface && state.layers.surface.nightops;
        for (const v of (ops && ops.vents) || []) {
          const err = placeError(state, 'wall', v.x, v.y, { ignoreCost: true });
          if (err !== '潮穴') out.push(`潮穴@${v.x},${v.y} 放置返回「${err}」（应为潮穴）`);
        }
      }
      return out.length ? bad('build.reserved', '固定玩法点可被建造覆盖', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // W15-B 第 0 步：玩家/工人的生存状态必须在数据表声明的边界内。
  {
    id: 'survival.state',
    run() {
      if (!state.started) return null;
      const out = [];
      if (!(state.playerMaxHp > 0 && state.playerHp >= 0 && state.playerHp <= state.playerMaxHp)) out.push(`玩家 HP=${state.playerHp}/${state.playerMaxHp}`);
      if (!(state.playerHunger >= 0 && state.playerHunger <= SURVIVAL.PLAYER.HUNGER_MAX)) out.push(`玩家饱食=${state.playerHunger}/${SURVIVAL.PLAYER.HUNGER_MAX}`);
      if (!(Number.isInteger(state.playerInjury) && state.playerInjury >= 0 && state.playerInjury <= SURVIVAL.PLAYER.INJURY.MAX)) out.push(`玩家伤势=${state.playerInjury}`);
      if (!(state.playerRestT >= 0 && state.playerRestT <= SURVIVAL.REST.DURATION)) out.push(`玩家休整计时=${state.playerRestT}`);
      if (state.deathPack) {
        if (!Number.isFinite(state.deathPack.x) || !Number.isFinite(state.deathPack.y) || !state.deathPack.layerId) out.push('遗落包坐标/层无效');
        if (!Object.values(state.deathPack.stock || {}).some((n) => n > 0) && !state.deathPack.held) out.push('空遗落包仍存在');
      }
      if (state.rescue) {
        const r = state.rescue;
        if (!r.worker || !state.workers.includes(r.worker) || !r.worker.alive) out.push('救援会话目标无效');
        if (!['stabilize', 'escort'].includes(r.phase || 'stabilize')) out.push(`救援阶段未知：${r.phase}`);
        if (r.phase === 'stabilize' && !r.worker.downed) out.push('救援读条目标未倒地');
        if (r.phase === 'escort' && (r.worker.downed || !r.bed)) out.push('护送会话目标异常');
      }
      const members = [], seenWorkers = new Set();
      const addWorker = (w) => { if (w && !seenWorkers.has(w)) { seenWorkers.add(w); members.push(w); } };
      for (const w of state.workers || []) addWorker(w);
      for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) addWorker(w);
      for (const w of members) {
        if (!(w.hunger >= 0 && w.hunger <= SURVIVAL.WORKER.HUNGER_MAX)) out.push(`${w.name}.hunger=${w.hunger}`);
        if (!(w.maxHp > 0 && w.hp >= 0 && w.hp <= w.maxHp && Number.isFinite(w.hp))) out.push(`${w.name}.hp=${w.hp}/${w.maxHp}`);
        if (w.downed && (!w.alive || w.hp !== 0 || !(w.downT > 0 && w.downT <= SURVIVAL.RESCUE.DOWNED_SECS))) out.push(`${w.name}.downed 状态不一致`);
        if (w.rescueState === 'escort' && (w.downed || !w.rescueBed || !Number.isFinite(w.rescueBed.x) || !Number.isFinite(w.rescueBed.y))) out.push(`${w.name}.护送状态不一致`);
        if (!(w.rescueWoundT >= 0 && w.rescueWoundT <= Math.max(SURVIVAL.RESCUE.INJURY_SECS, SURVIVAL.REVIVE.INJURY_SECS))) out.push(`${w.name}.rescueWoundT=${w.rescueWoundT}`);
        if (!(w.rescueRestT >= 0 && w.rescueRestT <= Math.max(SURVIVAL.RESCUE.RECOVERY_SECS, SURVIVAL.REVIVE.RECOVERY_SECS))) out.push(`${w.name}.rescueRestT=${w.rescueRestT}`);
        if (!['none', 'queued', 'treating'].includes(w.medicalState || 'none')) out.push(`${w.name}.medicalState=${w.medicalState}`);
        if (!(w.medicalT >= 0 && w.medicalT <= SURVIVAL.RESCUE.MEDICAL_SECS)) out.push(`${w.name}.medicalT=${w.medicalT}`);
        if ((w.medicalState === 'queued' || w.medicalState === 'treating') && (!w.medicalClinic || !Number.isFinite(w.medicalClinic.x) || !Number.isFinite(w.medicalClinic.y))) out.push(`${w.name}.medicalClinic 无效`);
        if (!(Number.isInteger(w.overwork) && w.overwork >= 0 && w.overwork <= SURVIVAL.REST.OVERWORK_MAX)) out.push(`${w.name}.overwork=${w.overwork}`);
      }
      return out.length ? bad('survival.state', '生存状态越界', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A12 拓荒者名册：名字不重、字段合法、jobb 是已知值
  {
    id: 'workers.roster',
    run() {
      if (!state.started) return null;
      const out = [];
      const names = new Set();
      const JOBS = ['idle', 'gather', 'eat', 'flee', 'guard', 'rest', 'forage', 'patrol', 'mourn', 'wander', 'hollow', 'build', 'refine', 'stoke', 'rescue', 'medical'];
      for (const w of state.workers || []) {
        if (names.has(w.name)) out.push(`重名拓荒者：${w.name}`);
        names.add(w.name);
        if (!JOBS.includes(w.job)) out.push(`${w.name}.job="${w.job}" 不是已知任务`);
        if (!LAYER_IDS.includes(w.layerId)) out.push(`${w.name}.layerId="${w.layerId}" 不是已知层`);
        if (w.hollow && w.job !== 'hollow') out.push(`${w.name} 已蚀化但 job=${w.job}`);
        if (w.downed && w.job !== 'rescue') out.push(`${w.name} 倒地但 job=${w.job}`);
        if (w.bonds) for (const n in w.bonds) {
          const v = w.bonds[n];
          if (!isNum(v) || v < 0) out.push(`${w.name}.bonds.${n}=${v}`);
          if (n === w.name) out.push(`${w.name} 和自己有羁绊计数`);
        }
      }
      return out.length ? bad('workers.roster', '名册异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A13 敌人：不许出现"死了还活着"、数量失控
  {
    id: 'enemy.sane',
    run() {
      if (!state.started) return null;
      const out = [];
      let alive = 0;
      for (const e of state.enemies || []) {
        if (!ENEMIES[e.ekind]) out.push(`未知敌人类型 ${e.ekind}`);
        if (e.alive) alive++;
        if (e.alive && !(e.hp > 0)) out.push(`${e.ekind} alive=true 但 hp=${e.hp}`);
        if (!e.alive && e.hp > 0) out.push(`${e.ekind} alive=false 但 hp=${e.hp}（应当移除）`);
      }
      if (alive > 300) out.push(`同屏敌人 ${alive} 只（疑似刷怪失控）`);
      if (state.bossRef && state.bossRef.alive === false) out.push('bossRef 指向的 Boss 已死（HUD 血条会卡住）');
      return out.length ? bad('enemy.sane', '敌人状态异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A16 操作模式：拆除与建造互斥；且「刚刚创建」的那一刻不得带残留模式
  // 【为什么需要这条】复现发现 newGame 不清 demolish/quickPause：
  //   上一局按过 X（拆除模式）→ 回主菜单开新局 → 左键点下去是在“拆”而不是“建”。
  // 判据用 **state.t === 0**（newGame 会把 t 精确置 0）：
  //   不能用“day1 且 t<2s”那种时间窗 —— 玩家完全可能在开局 2 秒内合法地按 X，会误报。
  {
    id: 'state.fresh',
    run() {
      if (!state.started) return null;
      const out = [];
      if (state.demolish && state.building) out.push(`拆除模式与建造模式同时为真（building=${state.building}）`);
      if (state.t === 0) {                                   // 刚 newGame / 刚读档的那一帧
        if (state.demolish) out.push('新局一创建就带着拆除模式');
        if (state.quickPause) out.push('新局一创建就带着快速暂停');
        const q = panelQuerySnapshot();                      // B25：面板搜索词也不该跨局残留
        const dirtyQ = Object.keys(q).filter((k) => q[k]);
        if (dirtyQ.length) out.push(`新局一创建就带着旧搜索词：${dirtyQ.map((k) => k + '="' + q[k] + '"').join(',')}`);
      }
      return out.length ? bad('state.fresh', '操作模式残留', out) : null;
    },
  },
  // ===== W14-A 战斗扩展：四条新断言（第 0 步建的"量化尺子"）=====
  // A17 战斗常量：数值必须都在合理区间。战斗数值中央化（data/combat.js）之后，
  //   调平衡时只要写错一个量级（比如把 2.6s 冷却写成 26），这里当场就会报。
  {
    id: 'combat.consts',
    run() {
      if (!state.started) return null;
      const out = [];
      const chk = (name, v, lo, hi) => { if (!(v >= lo && v <= hi)) out.push(`${name}=${v}（应在 ${lo}~${hi}）`); };
      chk('PULSE.DAMAGE', PULSE.DAMAGE, 10, 200);
      chk('PULSE.RANGE', PULSE.RANGE, 1, 12);
      chk('PULSE.COOLDOWN', PULSE.COOLDOWN, 0.5, 10);
      chk('PULSE.FUEL', PULSE.FUEL, 0, 5);
      chk('TOWER.LIGHT_MIN', TOWER.LIGHT_MIN, 0, 6);
      chk('TOWER.TINKER_RATE', TOWER.TINKER_RATE, 1, 2);
      chk('BOSS.EVERY', BOSS.EVERY, 1, 30);
      chk('BOSS.HP_SCALE', BOSS.HP_SCALE, 0, 2);
      chk('BOSS.SUMMON_CD_MIN', BOSS.SUMMON_CD_MIN, 0.5, 30);
      chk('WAVES.TIDE_MAX', WAVES.TIDE_MAX, 1, 40);
      chk('WAVES.DARK_MAX', WAVES.DARK_MAX, 0, 1);
      chk('WAVES.BLIGHT_BOOST', WAVES.BLIGHT_BOOST, 0, 1);
      return out.length ? bad('combat.consts', '战斗常量越界', out) : null;
    },
  },
  // A18 战斗乘子：乘子会相乘（研究 × 里程碑 × 图鉴），任何一环失控都是指数级膨胀
  {
    id: 'combat.mul',
    run() {
      if (!state.started) return null;
      const muls = {
        里程碑: state.pulseMul == null ? 1 : state.pulseMul,
        研究光爆: pulseMul(state), 研究范围: pulseRangeMul(state),
        研究塔伤: towerDmgMul(state), 研究射速: towerRateMul(state), 对空: owlDmgMul(state),
      };
      const out = [];
      for (const k in muls) if (!(muls[k] >= 0.2 && muls[k] <= 5)) out.push(`${k}=${muls[k]}`);
      return out.length ? bad('combat.mul', '战斗乘子越界', out) : null;
    },
  },
  // A19 同屏上限：刷怪不得超过"数据算出来的上限"（防止刷怪失控拖慢帧率）
  {
    id: 'enemy.cap',
    run() {
      if (!state.started) return null;
      const tide = Math.min(state.day, WAVES.TIDE_MAX);
      const dm = state.diff || { capMul: 1 };
      const cap = Math.round((WAVES.CAP_BASE + tide * WAVES.CAP_PER_TIDE
        + (state.day % BOSS.EVERY === 0 ? WAVES.CAP_BOSS_NIGHT : 0)) * (dm.capMul || 1));
      const n = (state.enemies || []).filter((e) => e.alive).length;
      if (n > Math.max(8, cap) * 1.5) return bad('enemy.cap', `同屏 ${n} 只 > 上限 ${cap} 的 1.5 倍`, []);
      return null;
    },
  },
  // A20 技能账本：光爆不许停在"已排队"上白嫆，冷却也不许超过常量
  {
    id: 'skill.ledger',
    run() {
      if (!state.started) return null;
      const out = [];
      const q = state.skillQueued || 0;
      if (!(q === 0 || q === 1)) out.push(`skillQueued=${q}`);
      if ((state.skillCd || 0) > PULSE.COOLDOWN + 0.01) out.push(`skillCd=${state.skillCd} > ${PULSE.COOLDOWN}`);
      return out.length ? bad('skill.ledger', '技能状态异常', out) : null;
    },
  },
  // A21 抗性表：类型合法 + 倍率在声明区间 + armorMul 的边界行为（W14-A 第 1 步）
  {
    id: 'combat.armor',
    run() {
      const out = [];
      const NEUTRAL = '无明显抗性：任何伤害都等额有效';
      for (const k in ENEMIES) {
        const d = ENEMIES[k];
        const a = d.armor || {};
        for (const t in a) {
          if (!TYPE_ORDER.includes(t)) out.push(`${k}.armor.${t} 不是合法伤害类型`);
          const v = a[t];
          if (!(typeof v === 'number' && v >= 0.5 && v <= 2)) out.push(`${k}.armor.${t}=${v}（应在 0.5~2）`);
        }
        // 倍率 1 写进表里 = 噪声（没抗性就别声明），NULL 值也不允许
        for (const t in a) if (Math.abs(a[t] - 1) < 1e-9) out.push(`${k}.armor.${t}=1（等于没抗性，别声明）`);
        // 文案由表生成：无抗性 ↔ 中性句；有抗性 ↔ 出现"怕/扛"且数字与表一致
        const wt = weakTextOf(k);
        const has = Object.keys(a).length > 0;
        if (!wt) out.push(`weakTextOf(${k}) 为空`);
        else if (!has && wt !== NEUTRAL) out.push(`weakTextOf(${k}) 无抗性却不是中性句：“${wt}”`);
        else if (has && wt === NEUTRAL) out.push(`weakTextOf(${k}) 有抗性却是中性句`);
        for (const t of TYPE_ORDER) {
          const v = a[t];
          if (!v || Math.abs(v - 1) < 1e-9) continue;
          const pct = Math.round(Math.abs(v - 1) * 100);
          const want = `${v > 1 ? '怕' : '扛'}${TYPE_NAME[t]}（${TYPE_NAME[t]}伤 ${v > 1 ? '+' : '−'}${pct}%）`;
          if (!wt.includes(want)) out.push(`${k} 文案缺 “${want}”（表=${v}）`);
        }
      }
      // armorMul 边界：未知类型 / 常规 / 无表 / 非法值 一律 ×1
      const probe = { armor: { light: 1.5 } };
      if (armorMul(probe, TYPES.LIGHT) !== 1.5) out.push('armorMul 未按表返回值');
      if (armorMul(probe, TYPES.GENERAL) !== 1) out.push('armorMul(常规) 应为 1');
      if (armorMul(probe, 'nope') !== 1) out.push('armorMul(未知类型) 应为 1');
      if (armorMul({}, TYPES.LIGHT) !== 1) out.push('armorMul(无抗性表) 应为 1');
      if (armorMul(null, TYPES.LIGHT) !== 1) out.push('armorMul(null) 应为 1');
      if (armorMul({ armor: { light: 0 } }, TYPES.LIGHT) !== 1) out.push('armorMul(0) 应为 1（防除零/白嫆）');
      return out.length ? bad('combat.armor', '抗性表/文案有问题', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A22 克制一致性：畏光的兽必须既被灼伤又吃光伤（两层表达不许只剩一层）
  {
    id: 'combat.counter',
    run() {
      const out = [];
      if (!(LIGHT_FEAR_BURN >= 20 && LIGHT_FEAR_BURN <= 80)) out.push(`畏光灼烧 ${LIGHT_FEAR_BURN}/秒 超出合理区间`);
      for (const k in ENEMIES) {
        const d = ENEMIES[k];
        const am = armorMul(d, TYPES.LIGHT);
        if (d.lightFear && am < 1.2) out.push(`${k} 畏光但光伤倍率只有 ×${am}（应 ≥1.2）`);
        if (!d.lightFear && am >= 1.2) out.push(`${k} 光伤 ×${am} 但没标畏光（玩法与文案会对不上）`);
      }
      // 塔的伤害类型必须写在数据里（不能靠名字猜）
      for (const k in BUILD) {
        const b = BUILD[k];
        if (!b.dmg) continue;
        if (!b.dmgType || !TYPE_ORDER.includes(b.dmgType)) out.push(`${k} 是塔但没声明 dmgType（可能是常规伤害）`);
      }
      return out.length ? bad('combat.counter', '克制关系不自洽', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23 载荷表自身完整性（W14-A 第 2 步）
  // 【为什么需要这条】修饰器表是玩家能装的全部东西：名字/乘子/效果缺一样都会让面板或战斗静默出错。
  {
    id: 'data.payload',
    run() {
      const out = [];
      for (const id in MODS) {
        const m = MODS[id];
        if (!m.name) out.push(`${id} 缺 name（面板会显示空白）`);
        if (!m.desc) out.push(`${id} 缺 desc（玩家看不懂它干什么）`);
        if (!(typeof m.dmg === 'number' && m.dmg >= 0.5 && m.dmg <= 1.6)) out.push(`${id}.dmg=${m.dmg}（应在 0.5~1.6）`);
        if (m.range != null && !(m.range > 0.5 && m.range <= 1)) out.push(`${id}.range=${m.range}（应 ∈ (0.5, 1]）`);
        const effect = m.targets || m.line || m.slow || m.purify || m.dmg !== 1 || m.range !== 1;
        if (!effect) out.push(`${id} 没有任何效果（装了等于白占槽位）`);
        if (!!m.shape !== SHAPE_MODS.includes(id)) out.push(`${id} 的 shape 标记与 SHAPE_MODS 不一致`);
      }
      for (const id of MOD_ORDER) if (!MODS[id]) out.push(`MOD_ORDER 里的 ${id} 不在 MODS 表里`);
      if (MOD_ORDER.length !== Object.keys(MODS).length) out.push(`MOD_ORDER ${MOD_ORDER.length} 项 ≠ MODS ${Object.keys(MODS).length} 项`);
      if (new Set(MOD_ORDER).size !== MOD_ORDER.length) out.push('MOD_ORDER 有重复项');
      if (!(FUEL_PER_MOD > 0 && FUEL_PER_MOD <= 0.5)) out.push(`FUEL_PER_MOD=${FUEL_PER_MOD}（应 ∈ (0, 0.5]）`);
      if (!(MAX_SLOTS >= 1 && MAX_SLOTS <= 10)) out.push(`MAX_SLOTS=${MAX_SLOTS}`);
      const tw = towerTypes();
      if (tw.length < 2) out.push(`只有 ${tw.length} 种塔（载荷必须有可装的塔）`);
      for (const t of tw) if (!(BUILD[t].dmg > 0) || !(BUILD[t].cd > 0)) out.push(`${t} 有 dmg 但 dmg/cd 不合法`);
      return out.length ? bad('data.payload', '载荷表有问题', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A24 组合空间可穷举（数量是文档承诺，不是实现巧合）
  {
    id: 'payload.count',
    run() {
      const out = [];
      const loads = allLoads();
      const combos = allCombos();
      const WANT = 22;            // docs/PAYLOAD.md §3.1：0/1/2/3 槽 → 1 + 5 + 9 + 7
      if (loads.length !== WANT) out.push(`合法载荷 ${loads.length} 个 ≠ 文档声明的 ${WANT} 个（改表就要改文档）`);
      if (combos.length !== loads.length * towerTypes().length) out.push(`组合数 ${combos.length} ≠ 载荷×塔数 ${loads.length * towerTypes().length}`);
      for (const l of loads) {
        const e = loadError(l);
        if (e) out.push(`枚举出的载荷却被判非法：[${l}] ${e}`);
      }
      for (const c of combos) if (c.stats.冲突) out.push(`组合 ${c.stats.name} 自带冲突：${c.stats.冲突}`);
      return out.length ? bad('payload.count', '组合空间不自洽', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A25 数值门：组合不得超出"基准 ×[0.3, 6]"（不调平衡，只守平衡）
  {
    id: 'payload.bounds',
    run() {
      const out = [];
      const DISP = 1e-3 + 1e-9;   // 单靶/燃耗等显示值都四舍五入到 3 位小数 → 容差取**一个显示单位**
                                  // （第一版拿 0.111 去比 0.1/0.9=0.1111… 直接假报，见 D36）
      const close = (a, b, tol = DISP) => Math.abs(a - b) <= tol;
      for (const t of towerTypes()) {
        const def = BUILD[t];
        const base = payloadStats(def, []);
        if (base.单发 !== def.dmg) out.push(`0 槽单发 ${base.单发} ≠ 塔基础 ${def.dmg}（零变化被破坏）`);
        if (base.每发燃耗 !== 0) out.push(`0 槽竟然耗燃 ${base.每发燃耗}（应严格为 0，否则旧档塔会突然吃燃料）`);
        if (base.射程 !== def.range) out.push(`0 槽射程 ${base.射程} ≠ ${def.range}`);
        if (base.cd !== def.cd) out.push(`0 槽冷却 ${base.cd} ≠ ${def.cd}`);
        if (base.等级 !== 1) out.push(`空载默认等级 ${base.等级} ≠ 1`);
        // 第 6 步：数值门要按**全部等级**算（Lv3 三槽是最坏情形）——落到 base×[0.3, 12]
        for (let lv = 1; lv <= TOWER_LV_MAX; lv++) {
          const bl = payloadStats(def, [], lv);
          for (const mods of allLoads()) {
            const s = payloadStats(def, mods, lv);
            const tag = `Lv${lv} ${def.name}+[${mods.join(',')}]`;
            if (!(s.每秒 >= base.每秒 * 0.3 - 1e-9)) out.push(`${tag} 单靶每秒 ${s.每秒} < Lv1 基准 0.3×`);
            if (!(s.每秒 <= base.每秒 * 12 + 1e-9)) out.push(`${tag} 单靶每秒 ${s.每秒} > Lv1 基准 12×（等级×槽位的上限门）`);
            if (s.等级 !== lv) out.push(`${tag} 报出的等级 ${s.等级} ≠ ${lv}`);
            if (!close(s.单发, def.dmg * TOWER_LV[lv - 1].dmg * mods.reduce((m, x) => m * MODS[x].dmg, 1))) {
              out.push(`${tag} 单发与“基础×等级×载荷”不一致（两处各算一道）`);
            }
          }
        }
        for (const mods of allLoads()) {
          const s = payloadStats(def, mods);
          const tag = `${def.name}+[${mods.join(',')}]`;
          if (!(s.每秒 >= base.每秒 * 0.3 - 1e-9)) out.push(`${tag} 单靶每秒 ${s.每秒} < 基准 0.3×`);
          if (!(s.每秒 <= base.每秒 * 6 + 1e-9)) out.push(`${tag} 单靶每秒 ${s.每秒} > 基准 6×`);
          let mul = 1;
          for (const m of mods) mul *= MODS[m].dmg;
          if (!close(s.单发, def.dmg * mul)) out.push(`${tag} 单发 ${s.单发} ≠ ${def.dmg}×${mul.toFixed(3)}`);
          if (!close(s.每发燃耗, mods.length * FUEL_PER_MOD)) out.push(`${tag} 每发燃耗 ${s.每发燃耗} ≠ ${mods.length}×${FUEL_PER_MOD}`);
          if (!close(s.燃耗每秒, s.每发燃耗 / s.cd)) out.push(`${tag} 燃耗每秒与每发燃耗/冷却 不一致`);
          if (s.多靶每秒 < s.每秒 - 1e-9) out.push(`${tag} 多靶每秒 < 单靶每秒`);
        }
      }
      const r = dmgMulRange();
      if (r.per[0] < 0.6 || r.per[1] > 1.6) out.push(`每槽乘子区间 [${r.per}] 越出声明的 [0.6, 1.6]`);
      if (r.total[1] > 6) out.push(`3 槽总乘子上限 ${r.total[1]} > 6（上限门会挂）`);
      const lr = lvMulRange();
      if (lr.dmg[0] !== 1 || lr.range[0] !== 1) out.push('等级乘子下界不是 1（Lv1 必须 = 今天）');
      if (lr.dmg[1] * r.total[1] > 12) out.push(`满级×满槽单靶乘子 ${(lr.dmg[1] * r.total[1]).toFixed(2)} > 12（与上面的上限门对不上）`);
      return out.length ? bad('payload.bounds', '组合数值越界', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A26 载荷账本与纯性：口径只有一处、观测不许改到游戏
  // 【容器扣料那一半】要等塔真的开始耗燃（2c）才有实物可对；这里先守"纯计算 + 不改入参"
  {
    id: 'payload.ledger',
    run() {
      const out = [];
      // 合法性边界
      if (loadError([], MAX_SLOTS) !== null) out.push('空载竟被判非法');
      if (!loadError(['nope'])) out.push('未知修饰器未被拒');
      if (!loadError(['focus', 'focus'])) out.push('重复装未被拒');
      if (!loadError(['scatter', 'pierce'])) out.push('两个形状类同时装未被拒');
      if (!loadError(['focus', 'chill', 'purify', 'scatter'])) out.push('超槽位未被拒');
      if (loadError(['focus', 'chill', 'purify']) !== null) out.push('3 槽合法载荷被误判非法');
      if (!loadError(null)) out.push('非数组载荷未被拒');
      // 纯性：payloadStats 不得改动传入的塔定义与载荷数组（观测台把游戏改坏了就是最糟的 bug）
      const def = BUILD[towerTypes()[0]];
      const defBefore = JSON.stringify(def);
      const mods = ['focus', 'chill'];
      const modsBefore = JSON.stringify(mods);
      const s = payloadStats(def, mods);
      if (JSON.stringify(def) !== defBefore) out.push('payloadStats 改动了塔定义');
      if (JSON.stringify(mods) !== modsBefore) out.push('payloadStats 改动了载荷数组');
      if (s.mods === mods) out.push('payloadStats 直接引用了传入数组（外部改一下就跟着变）');
      // 名字来自表：空载 = 塔名；装了就有那个修饰器的名字
      if (payloadStats(def, []).name !== def.name) out.push('空载的名字不是塔名');
      if (!payloadStats(def, ['focus']).name.includes(MODS.focus.name)) out.push('载荷名里没有修饰器名');
      return out.length ? bad('payload.ledger', '载荷账本/纯性有问题', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A27 塔的载荷合法性（W14-A 第 2 步）
  // 【守什么】调试口与读档都能改载荷：一旦出现"表里没有的 id / 超过槽位 / 形状类重复"，
  //   塔会静默变成另一种武器（或根本算不出数值）。这里是运行时唯一的口径。
  {
    id: 'build.load',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const b of state.buildings || []) {
        const d = BUILD[b.type];
        if (!d) continue;
        if (d.dmg) {
          if (!Array.isArray(b.mods)) out.push(`${d.name}@${b.x},${b.y} 的载荷不是数组（应为空数组）`);
          else {
            // 结构上限用 MAX_SLOTS（研究门槛在安装点守：见 payload.slots 与 __load 的默认路径）
            const e = loadError(b.mods, MAX_SLOTS);
            if (e) out.push(`${d.name}@${b.x},${b.y} 载荷非法：${e}`);
          }
        } else if (b.mods != null) out.push(`${d.name}@${b.x},${b.y}（非塔）不该带载荷`);
      }
      return out.length ? bad('build.load', '塔的载荷不合法', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A28 天然竖井（B37 的回归守卫）
  // 【为什么必须有】建竖井要「深潜学」，而它属于深潜分区、分区开启条件又是"已经下过一次深渊"：
  //   没有天然入口就是死循环 → 深渊全部内容（母脉/遗迹碑/熔渊/补给站/盲蚀兽/深层研究）不可达。
  //   位置也要守：不居中（不能摆在家门口）、不贴边（不能落在边界带）、站得上去。
  {
    id: 'world.shaft',
    run() {
      if (!state.started) return null;
      const surf = (state.chunkStore && state.chunkStore['0,0']) || (state.layers && state.layers.surface) || null;
      if (!surf) return null;
      const out = [];
      const m = surf.map;
      const list = (surf.buildings || []).filter((b) => b.type === 'shaft' && b.natural);
      if (list.length !== 1) out.push(`地表天然竖井 ${list.length} 口（应恰好 1 口：少了玩家下不去，多了是重复生成）`);
      for (const b of list) {
        if (b.x < 9 || b.y < 9 || b.x >= m.w - 9 || b.y >= m.h - 9) out.push(`天然竖井 @${b.x},${b.y} 贴边了（应离边界 ≥9 格）`);
        if (Math.hypot(b.x - m.w / 2, b.y - m.h / 2) < 14) out.push(`天然竖井 @${b.x},${b.y} 离营地中心太近（应 ≥14 格）`);
        if (!m.isWalk(b.x, b.y)) out.push(`天然竖井 @${b.x},${b.y} 站不上去（走不上去就用不了）`);
        if (b.entry) out.push(`天然竖井 @${b.x},${b.y} 被当成了"上升井"（entry 应为 false 才能下潜）`);
      }
      return out.length ? bad('world.shaft', '天然竖井缺失或不合法（首潜会被锁死）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A30 岩壁开采门槛（本次修复的回归守卫）
  // 【为什么必须有】岩壁是石头**唯一**来源，而制造台/石镐/自动熔炉/解析台都要石头。
  //   曾经 canMineRock 要求“石工 + 手持镐”→ 只要手里没镐（开局的镐被工人拿走、丢在别层），
  //   就是“没石头→造不出镐→挖不动岩壁→没石头”的真死循环。镐子按设计只是**提速件**。
  {
    id: 'rock.gate',
    run() {
      const out = [];
      const savedRes = state.research ? JSON.parse(JSON.stringify(state.research)) : null;
      const savedHeld = state.equip ? state.equip.held : null;
      state.equip = { held: null };                                   // 模拟徒手
      state.research = Object.assign(state.research || {}, { unlocked: Object.assign({}, savedRes && savedRes.unlocked) });
      state.research.unlocked.stonework = true;
      if (!canMineRock(state)) out.push('研究了「石工」但空手时挖不动岩壁（石镐变成了硬门槛 → 石头/工具死循环）');
      state.research.unlocked.stonework = false;
      if (canMineRock(state)) out.push('没研究「石工」却能凿岩壁（岩壁不该在石工之前可挖）');
      if (!(mineTimeMul(state, 'stone') > 1)) out.push(`徒手凿岩壁没有变慢（倍率 ${mineTimeMul(state, 'stone')}，应 >1）`);
      state.equip = { held: 'pick' };                                 // 手持石镐：应该更快
      if (!(mineTimeMul(state, 'stone') < 1)) out.push(`手持石镐凿岩壁没有变快（倍率 ${mineTimeMul(state, 'stone')}，应 <1）`);
      if (savedRes) state.research = savedRes; else delete state.research.unlocked;
      state.equip = { held: savedHeld };
      return out.length ? bad('rock.gate', '岩壁开采门槛不对（可能又变回死循环）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A31 背包是容器（本次修复的回归守卫）
  // 【为什么必须有】采集产出以前只进【本层容器】：玩家背着一只空背包，在余烬层（本层 0 个容器）
  //   采一颗辉髓就直接提示“存储已满”并丢掉。这里用一个一次性假状态真跑一遍 deposit（不碰真 state）。
  {
    id: 'store.pack',
    run() {
      const out = [];
      const fake = {
        layers: { surface: { beacons: [], buildings: [] } }, layerId: 'surface',
        player: { x: 0, y: 0 }, pack: { stock: {}, cap: 2 }, res: {}, floaties: [],
      };
      const got = deposit(fake, 'ore', 5);
      if (got !== 2) out.push(`本层无容器时 deposit 只收了 ${got} 个（背包 cap=2，应全进背包）`);
      if ((fake.pack.stock.ore || 0) !== 2) out.push(`背包里只有 ${fake.pack.stock.ore || 0} 个辉髓（应 2）`);
      if (fake.res.ore !== 2) out.push(`总账 ${fake.res.ore} ≠ 2（背包没被算进派生账本）`);
      if (!String(fake.storeWarnTxt || '').includes('本层没有容器')) out.push(`放不下时的提示没说清“本层没有容器”（实际：${fake.storeWarnTxt}）`);
      // 自动消耗只短暂腾出一格时，满仓事件不能马上解锁，否则采集会每轮重复报警。
      if (withdrawOne(fake, 'ore', 1) !== null) out.push('满仓回归探针无法从背包出库');
      if (!fake._warnSfx) out.push('自动出库一格后立即清掉满仓报警锁（会形成循环音效）');
      return out.length ? bad('store.pack', '背包没有被当成容器（采集会白丢）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A29 载荷槽位（W14-A 第 2c 步）：研究门槛必须真的生效
  // 【重要分工】`build.load` 只守**结构合法性**（用 MAX_SLOTS），因为调试口 `__load(...,force)`
  //   有意绕过研究；而“装了几个槽”是**安装点**的规则（2d 的面板 + `__load` 默认路径）。
  //   这里守的是：新局 0 槽、每个节点 +1、上限不超、且三个节点真的在面板里看得到。
  {
    id: 'payload.slots',
    run() {
      const out = [];
      if (SLOT_TECHS.length !== MAX_SLOTS) out.push(`SLOT_TECHS ${SLOT_TECHS.length} 项 ≠ MAX_SLOTS ${MAX_SLOTS}`);
      for (const id of SLOT_TECHS) {
        if (!RESEARCH[id]) out.push(`槽位研究节点 ${id} 不在 RESEARCH 表里`);
        if (!RESEARCH_ORDER.includes(id)) out.push(`槽位研究节点 ${id} 没进 RESEARCH_ORDER（面板里看不到）`);
      }
      const saved = state.research ? JSON.parse(JSON.stringify(state.research)) : null;
      const hadStarted = state.started;
      state.research = { unlocked: {}, done: {} };   // 临时模拟新局（不碰地图/实体）
      if (slotsOf(state) !== 0) out.push(`新局槽位 ${slotsOf(state)}（应为 0：载荷必须靠研究解锁）`);
      let want = 0;
      for (const id of SLOT_TECHS) {
        state.research.unlocked[id] = true;
        want++;
        if (slotsOf(state) !== want) out.push(`解锁 ${id} 后槽位 ${slotsOf(state)}（应为 ${want}）`);
      }
      if (slotsOf(state) > MAX_SLOTS) out.push(`槽位 ${slotsOf(state)} 超过上限 ${MAX_SLOTS}`);
      if (saved) state.research = saved;
      if (!hadStarted) state.research = saved;
      return out.length ? bad('payload.slots', '载荷槽位规则不对', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A14b 死容器必须是空的（B30/B31 家族的不变量）
  // 【为什么需要】res 的定义是「allContainers 求和」，而 allContainers 会**跳过** hp≤0 的信标
  //   （"营地灯被打掉 → 仓库也没了"）与已拆除的建筑。于是只要有一条路径让它带着库存"消失"，
  //   总账就会虚高（实测：营地灯被 Boss 打掉 → 辉髓 总账 115 / 实际 19），
  //   玩家会看到"资源够"却取不出料，甚至能用幽灵资源白造东西。
  //   正确做法见 systems/building.js spillStock()：先把库存交出去，再让它退出容器名单。
  //   这条断言把"必须先洒库存"变成机器可查：谁再写出带库存的死容器，当帧就会被点名。
  {
    id: 'container.dead',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const id in (state.layers || {})) {
        const L = state.layers[id];
        for (const b of L.beacons || []) {
          if (b.hp != null && b.hp <= 0) {
            const n = Object.values(b.stock || {}).reduce((a, v) => a + (v || 0), 0);
            if (n > 0) out.push(`${id} 营地灯@${b.x},${b.y} 已熄灭但仍装着 ${n} 单位（应已 spillStock）`);
          }
        }
        for (const b of L.buildings || []) {
          const def = BUILD[b.type];
          if (!def || !def.store || b.site) continue;
          if (b.hp != null && b.hp <= 0) {
            const n = Object.values(b.stock || {}).reduce((a, v) => a + (v || 0), 0);
            if (n > 0) out.push(`${id} ${b.type}@${b.x},${b.y} 已损毁但仍装着 ${n} 单位（应已 spillStock）`);
          }
        }
      }
      return out.length ? bad('container.dead', '死容器里还留着库存（总账会虚高）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A14 实体重叠（分离后应当≈0）
  // 阈值说明：弹性碰撞的设计稳态就是"贴着但不进去" —— 两个实体半径之和附近（实测 0.71~0.74），
  // 所以判据必须高于这个稳态，否则每次夜战都会刷一堆假报（第一版取 0.7，正好卡在稳态上）。
  // 超过 0.8 才是"分离失败"；pairs 只作为现场数据附带。
  {
    id: 'overlap.bodies',
    run() {
      if (!state.started) return null;
      const st = overlapStats(state);
      if (st.worst != null && st.worst > 0.8) return bad('overlap.bodies', `最严重重叠 ${st.worst.toFixed(2)} 格（稳态约 0.74）`, [st.who || '', `pairs=${st.pairs}`]);
      return null;
    },
  },
  // A15 掉落物：寿命/坐标/数量
  {
    id: 'pickup.sane',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const p of state.pickups || []) {
        if (!RES_NAME[p.kind]) out.push(`掉落物类型未知：${p.kind}`);
        if (p.t != null && p.life != null && p.t > p.life + 0.5) out.push(`掉落物已过期仍在场 (t=${p.t} life=${p.life})`);
      }
      if ((state.pickups || []).length > 400) out.push(`掉落物 ${state.pickups.length} 个（疑似没清理）`);
      return out.length ? bad('pickup.sane', '掉落物异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A16 工人引用：任务里指向的目标必须还在
  {
    id: 'workers.ref',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const w of state.workers || []) {
        if (w.smelter && !(state.buildings || []).includes(w.smelter)) out.push(`${w.name}.smelter 已不在 buildings`);
        if (w.furnace && !(state.buildings || []).includes(w.furnace)) out.push(`${w.name}.furnace 已不在 buildings`);
        if (w.site && !(state.buildings || []).includes(w.site)) out.push(`${w.name}.site 已不在 buildings`);
        if (w.crop && !(state.buildings || []).includes(w.crop)) out.push(`${w.name}.crop 已不在 buildings`);
        // B29："要去炼油"却**没有**炉子目标 = 下一帧 approachTile(null) 直接抛异常卡死游戏。
        // 注意只查 refine：stoke 分支会先把目标置 null、同帧重算 job，属于合法瞬态。
        if (w.job === 'refine' && !w.furnace) out.push(`${w.name} job=refine 但 furnace 为空（B29 崩溃前兆）`);
      }
      return out.length ? bad('workers.ref', `${out.length} 处工人目标悬空`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // N0：身份卡、任务投影与区块驻守引用必须同时存在且唯一。
  {
    id: 'crew.bounds',
    run() {
      if (!state.started) return null;
      const out = [], list = [], seen = new Set(), ids = new Set();
      const add = (w) => { if (!w || seen.has(w)) return; seen.add(w); list.push(w); };
      if (state.layerId === 'surface') {
        const here = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
        if (here && state.workers !== here.workers) out.push('当前地表区块与 state.workers 未共享同一成员引用');
      }
      for (const w of state.workers || []) add(w);
      for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) add(w);
      list.forEach((w, i) => {
        const card = crewCardOf(w, i, state.day || 1);
        if (!w.crew) out.push(`${w.name} 缺身份卡`);
        if (!w.crew || w.crew.id !== card.id) out.push(`${w.name} 身份 ID 不稳定（运行时 ${w.crew && w.crew.id} / 投影 ${card.id}）`);
        if (ids.has(card.id)) out.push(`身份 ID 重复：${card.id}`); else ids.add(card.id);
        const rels = Object.keys(w.bonds || {});
        if (rels.length > COLONISTS.MAX_RELATIONS) out.push(`${w.name} 关系边 ${rels.length} > 上限 ${COLONISTS.MAX_RELATIONS}`);
        const events = Array.isArray(w.crew && w.crew.events) ? w.crew.events : [];
        if (events.length > COLONISTS.MAX_EVENTS) out.push(`${w.name} 经历 ${events.length} > 上限 ${COLONISTS.MAX_EVENTS}`);
        for (const e of events) if (!e || !Number.isInteger(e.day) || e.day < 1 || !['join', 'role', 'down', 'rescue', 'death', 'revive'].includes(e.kind) || !e.text || String(e.text).length > 48) out.push(`${w.name} 经历记录字段异常`);
        if (!(w.job || 'idle')) out.push(`${w.name} 没有任务字段`);
        const d = directiveFromSave(w.directive);
        if (!['auto', 'rest', 'guard', 'forage', 'patrol'].includes(d.mode)) out.push(`${w.name} 调度模式未知：${d.mode}`);
        if (!['normal', 'high'].includes(d.rescue)) out.push(`${w.name} 救援优先级未知：${d.rescue}`);
        if (!['neutral', 'medical', 'rescue', 'guard'].includes(d.care)) out.push(`${w.name} 照护意图未知：${d.care}`);
        if (d.outpostMode != null && !Object.prototype.hasOwnProperty.call(DIRECTIVES.OUTPOST, d.outpostMode)) out.push(`${w.name} 前哨意图未知：${d.outpostMode}`);
        if (d.outpostMode != null && !d.outpost) out.push(`${w.name} 有前哨意图但没有目标区块`);
        for (const [label, p] of [['工作区', d.area], ['前哨', d.outpost]]) if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) out.push(`${w.name} ${label}坐标异常`);
        if (w.outpostTravel) {
          const tr = w.outpostTravel;
          if (!tr.from || !tr.to || !Number.isFinite(tr.from.x) || !Number.isFinite(tr.from.y) || !Number.isFinite(tr.to.x) || !Number.isFinite(tr.to.y)) out.push(`${w.name} 前哨迁移坐标异常`);
          if (!d.outpost || tr.to.x !== d.outpost.x || tr.to.y !== d.outpost.y) out.push(`${w.name} 前哨迁移目标与指令不一致`);
          if (!Number.isFinite(tr.t) || tr.t < 0 || tr.t > ECOLOGY.OUTPOST_TRAVEL_SEC + 0.05) out.push(`${w.name} 前哨迁移计时异常：${tr.t}`);
          if ((w.chunkX | 0) === (tr.to.x | 0) && (w.chunkY | 0) === (tr.to.y | 0)) out.push(`${w.name} 已抵达却仍标记迁移中`);
        }
        const task = taskFromSave(w.task);
        const influence = roleInfluence(w, task ? task.job : (w.job || 'idle'), { night: false, dark: false, lit: true, boss: false });
        if (influence.role !== (w.crew && w.crew.role) || influence.personality !== (w.crew && w.crew.personality) || !Number.isFinite(influence.taskMul) || influence.taskMul < 0.5 || influence.taskMul > 2.5) out.push(`${w.name} 职业/性格影响投影异常`);
      });
      const memorial = Array.isArray(state.memorial) ? state.memorial : [];
      if (memorial.length > COLONISTS.MAX_MEMORIAL_EVENTS) out.push(`死亡履历 ${memorial.length} > 上限 ${COLONISTS.MAX_MEMORIAL_EVENTS}`);
      if (!Number.isFinite(state.reviveCount) || state.reviveCount < 0 || state.reviveCount > SURVIVAL.REVIVE.MAX_USES) out.push(`复苏次数异常：${state.reviveCount}`);
      for (const m of memorial) {
        if (m.type !== 'death' || !m.name || !Number.isFinite(m.day) || !Number.isFinite(m.x) || !Number.isFinite(m.y)) out.push('死亡履历字段异常');
        if (Array.isArray(m.affected) && m.affected.length > COLONISTS.MAX_RELATIONS) out.push(`${m.name} 受影响羁绊超过上限`);
        if (m.revived && !Number.isFinite(m.reviveDay)) out.push(`${m.name} 复苏履历缺少日期`);
      }
      return out.length ? bad('crew.bounds', '拓荒者身份/关系/任务边界异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'crew.save',
    run() {
      if (!state.started) return null;
      const snap = snapshot(state);
      const saved = new Map((snap.workers || []).map((w) => [w.crew && w.crew.id, w]));
      const out = [];
      const members = [], seenWorkers = new Set();
      const addWorker = (w) => { if (w && !seenWorkers.has(w)) { seenWorkers.add(w); members.push(w); } };
      for (const w of state.workers || []) addWorker(w);
      for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) addWorker(w);
      if ((snap.workers || []).length !== members.length) out.push(`snapshot 拓荒者数量 ${(snap.workers || []).length} ≠ 当前成员 ${members.length}`);
      for (const w of members) {
        const id = w.crew && w.crew.id;
        if (!id || !saved.has(id)) out.push(`${w.name} 的身份卡没有进入 snapshot.workers`);
        else if (saved.get(id).crew.role !== w.crew.role || saved.get(id).crew.personality !== w.crew.personality || JSON.stringify(saved.get(id).crew.events || []) !== JSON.stringify(w.crew.events || [])) out.push(`${w.name} 读写投影丢失身份/经历`);
        else {
          const a = directiveFromSave(w.directive), b = directiveFromSave(saved.get(id).directive);
          if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${w.name} 调度指令未随存档保存`);
          const s = saved.get(id);
          if (!!s.downed !== !!w.downed || Math.round(s.downT || 0) !== Math.round(w.downT || 0) || (s.rescueWound | 0) !== (w.rescueWound | 0) || (s.rescueState || 'none') !== (w.rescueState || 'none') || Math.round(s.rescueRestT || 0) !== Math.round(w.rescueRestT || 0) || (s.medicalState || 'none') !== (w.medicalState || 'none') || Math.round(s.medicalT || 0) !== Math.round(w.medicalT || 0)) out.push(`${w.name} 倒地/伤势/医疗状态未随存档保存`);
          if (!!s.deathRecord !== !!w.deathRecord || (s.deathRecord && (s.deathRecord.day | 0) !== (w.deathRecord.day | 0))) out.push(`${w.name} 死亡履历未随存档保存`);
        }
      }
      return out.length ? bad('crew.save', '拓荒者身份卡未随存档保存', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'outpost.ecology',
    run() {
      if (!state.started) return null;
      const out = [];
      for (const c of Object.values(state.chunkStore || {})) {
        const o = c && c.outpost;
        if (!o) continue;
        if (!Number.isFinite(o.lightPressure) || o.lightPressure < 0) out.push(`${c.id || 'chunk'} 光压异常：${o.lightPressure}`);
        if (!Number.isFinite(o.frontDebt) || o.frontDebt < 0 || o.frontDebt > ECOLOGY.OUTPOST_FRONT_DEBT_MAX || (o.frontDebt | 0) !== o.frontDebt) out.push(`${c.id || 'chunk'} 蚀潮债务异常：${o.frontDebt}`);
        const e = o.lastEcology || {};
        if (e.pressure != null && (!Number.isFinite(e.pressure) || e.pressure < 0)) out.push(`${c.id || 'chunk'} 生态光压异常：${e.pressure}`);
        if (e.debt != null && (!Number.isFinite(e.debt) || e.debt < 0 || e.debt > ECOLOGY.OUTPOST_FRONT_DEBT_MAX)) out.push(`${c.id || 'chunk'} 生态债务异常：${e.debt}`);
        if (!Array.isArray(o.alerts) || o.alerts.length > ECOLOGY.OUTPOST_MAX_ALERTS) out.push(`${c.id || 'chunk'} 远端告警数量异常：${o.alerts && o.alerts.length}`);
        for (const a of (o.alerts || [])) {
          if (!a || !a.id || !a.kind || !a.message || !['open', 'resolved'].includes(a.status)) out.push(`${c.id || 'chunk'} 远端告警字段异常`);
          if (a && typeof a.rescuePending !== 'boolean') out.push(`${c.id || 'chunk'} 远端告警救援标记异常`);
        }
      }
      return out.length ? bad('outpost.ecology', '远端前哨生态结算状态异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'task.bounds',
    run() {
      if (!state.started) return null;
      const out = [], reservations = new Map(), members = [], seenWorkers = new Set();
      const addWorker = (w) => { if (w && !seenWorkers.has(w)) { seenWorkers.add(w); members.push(w); } };
      for (const w of state.workers || []) addWorker(w);
      for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) addWorker(w);
      for (const w of members) {
        const t = taskFromSave(w.task);
        if (!t) { out.push(`${w.name} 缺任务板投影`); continue; }
        if (!TASKS.JOBS[t.job]) out.push(`${w.name} 任务类型未知：${t.job}`);
        if (!TASKS.STATUSES.includes(t.status)) out.push(`${w.name} 任务状态未知：${t.status}`);
        if (!Number.isFinite(t.priority) || t.priority < 0 || t.priority > 100) out.push(`${w.name} 任务优先级越界：${t.priority}`);
        if (t.target && (!Number.isFinite(t.target.x) || !Number.isFinite(t.target.y))) out.push(`${w.name} 任务目标坐标异常`);
        if (t.reservation) {
          const owners = reservations.get(t.reservation) || [];
          owners.push(w.name);
          reservations.set(t.reservation, owners);
        }
      }
      for (const [key, owners] of reservations) if (owners.length > 1 && !key.startsWith('gather:')) out.push(`任务重复占用：${key} ← ${owners.join('、')}`);
      const board = taskBoardStats(state);
      if (board.conflicts.length) out.push(`任务板报告 ${board.conflicts.length} 个重复占用`);
      return out.length ? bad('task.bounds', '任务板状态/预约边界异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'task.save',
    run() {
      if (!state.started) return null;
      const snap = snapshot(state);
      const saved = new Map((snap.workers || []).map((w) => [w.name, w.task && taskFromSave(w.task)]));
      const out = [], members = [], seenWorkers = new Set();
      const addWorker = (w) => { if (w && !seenWorkers.has(w)) { seenWorkers.add(w); members.push(w); } };
      for (const w of state.workers || []) addWorker(w);
      for (const c of Object.values(state.chunkStore || {})) for (const w of c.workers || []) addWorker(w);
      for (const w of members) {
        const a = taskFromSave(w.task), b = saved.get(w.name);
        if (!a || !b) { out.push(`${w.name} 任务没有进入 snapshot.workers`); continue; }
        if (a.id !== b.id || a.job !== b.job || a.status !== b.status || a.reservation !== b.reservation) out.push(`${w.name} 任务存档投影不一致`);
      }
      return out.length ? bad('task.save', '任务板投影未随存档保存', out.slice(0, MAX_DETAIL)) : null;
    },
  },
];

// =====================================================================
// B. 数据表交叉校验（不需要开局：随时可跑）
// =====================================================================
const DATA_CHECKS = [
  {
    id: 'visual.spec',
    run() {
      const out = [];
      if (VISUAL.pixel.human !== 24 || VISUAL.pixel.tile !== 16) out.push('像素规格不一致');
      for (const k of ['amber', 'moss', 'blue', 'copper', 'violet', 'rose', 'fallback']) if (!VISUAL.colonist || typeof VISUAL.colonist[k] !== 'string') out.push(`拓荒者色板缺失：${k}`);
      const s = visualSpec();
      if (s.colors.some((c) => !c.pass)) out.push('关键 UI 颜色对比度低于 4.5:1');
      return out.length ? bad('visual.spec', '视觉规格异常', out) : null;
    },
  },
  {
    id: 'ecology.consts',
    run() {
      const out = [];
      if (!(ECOLOGY.BIOME_VERSION >= 1 && ECOLOGY.RING_STEP >= 1)) out.push('群系版本/环带步长不合法');
      if (!(ECOLOGY.MAX_ACTIVE_OUTPOSTS >= 1 && ECOLOGY.MAX_ACTIVE_OUTPOSTS <= 3)) out.push(`有人区块上限=${ECOLOGY.MAX_ACTIVE_OUTPOSTS}`);
      if (!(ECOLOGY.OUTPOST_TRAVEL_SEC >= 1 && ECOLOGY.OUTPOST_TRAVEL_SEC <= 60)) out.push(`前哨迁移耗时=${ECOLOGY.OUTPOST_TRAVEL_SEC} 不在 1–60s 范围`);
      if (!(ECOLOGY.OUTPOST_SETTLE_SEC >= 5 && ECOLOGY.OUTPOST_SETTLE_SEC <= 60)) out.push(`前哨结算间隔=${ECOLOGY.OUTPOST_SETTLE_SEC} 不在 5–60s 范围`);
      if (!(ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK >= 1 && ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK <= 3)) out.push(`前哨单轮成员上限=${ECOLOGY.OUTPOST_MAX_WORKERS_PER_TICK}`);
      if (!(ECOLOGY.OUTPOST_GUARD_FUEL_PER_TICK >= 1 && ECOLOGY.OUTPOST_GUARD_FUEL_PER_TICK <= 3)) out.push(`前哨守灯燃料=${ECOLOGY.OUTPOST_GUARD_FUEL_PER_TICK}`);
      if (!(ECOLOGY.OUTPOST_FRONT_DEBT_MAX >= 1 && ECOLOGY.OUTPOST_FRONT_DEBT_MAX <= 6 && ECOLOGY.OUTPOST_FRONT_DEBT_DECAY >= 1 && ECOLOGY.OUTPOST_FRONT_DEBT_DECAY <= ECOLOGY.OUTPOST_FRONT_DEBT_MAX)) out.push(`远端蚀潮债务阈值/衰减异常：${ECOLOGY.OUTPOST_FRONT_DEBT_MAX}/${ECOLOGY.OUTPOST_FRONT_DEBT_DECAY}`);
      if (!(ECOLOGY.OUTPOST_MAX_ALERTS >= 1 && ECOLOGY.OUTPOST_MAX_ALERTS <= 6)) out.push(`远端告警上限=${ECOLOGY.OUTPOST_MAX_ALERTS}`);
      if (Object.keys(DIRECTIVES.OUTPOST || {}).length !== 3) out.push('前哨意图必须固定为守灯/采掘/静默三种');
      if (!(ECOLOGY.MAX_FRONTS_PER_CHUNK > 0 && ECOLOGY.MAX_FRONT_CELLS >= ECOLOGY.FRONT_NEST_CELLS && ECOLOGY.FRONT_NEST_CELLS > 0 && ECOLOGY.FRONT_GROW_SEC > 0 && ECOLOGY.FRONT_SPAWN_RADIUS > 0)) out.push('蚀痕前线容量/节奏不合法');
      if (!(ECOLOGY.MAX_PATCHES_PER_CHUNK > 0 && ECOLOGY.MAX_NEUTRAL_CREATURES > 0 && ECOLOGY.PATCH_UPDATE_SEC >= 1 && ECOLOGY.CREATURE_UPDATE_SEC >= 1)) out.push('生态斑块/生物上限或节拍不合法');
      if (!(ECOLOGY.LIGHT_PRESSURE_PER_STEP > 0 && ECOLOGY.LIGHT_PRESSURE_CAP >= 1 && ECOLOGY.LIGHT_PRESSURE_CAP <= 3)) out.push('光压反馈范围不合法');
      for (const id of ['tundra', 'vineMist', 'shaleRise']) {
        const b = BIOMES[id];
        if (!b || b.id !== id || !b.name || !b.color) out.push(`群系 ${id} 定义不完整`);
        if (!b || !(b.sightMul > 0 && b.sightMul <= 1) || !(b.resourceBias.ore > 0 && b.resourceBias.vine > 0)) out.push(`群系 ${id} 参数不合法`);
      }
      if (biomeIdAt(0, 0) !== 'tundra' || biomeIdAt(1, 0) !== biomeIdAt(0, 1) || biomeIdAt(3, 0) !== 'shaleRise') out.push('渐进环带群系判定不稳定');
      if (frontStageOf(0) !== 'none' || frontStageOf(1) !== 'trace' || frontStageOf(2) !== 'nest' || frontStageOf(3) !== 'rift') out.push('蚀痕前线阶段映射不完整');
      return out.length ? bad('ecology.consts', '生态常量/群系定义异常', out) : null;
    },
  },
  {
    id: 'survival.consts',
    run() {
      const out = [];
      const P = SURVIVAL.PLAYER, W = SURVIVAL.WORKER, D = SURVIVAL.DEATH, Q = SURVIVAL.RESCUE;
      const R = SURVIVAL.REST, G = SURVIVAL.REGEN;
      const C = SURVIVAL.CHUNK;
      if (!(P.BASE_MAX_HP >= 50 && P.BASE_MAX_HP <= 300)) out.push(`PLAYER.BASE_MAX_HP=${P.BASE_MAX_HP}`);
      if (!(P.HUNGER_MAX === 100 && P.START_HUNGER > 0 && P.START_HUNGER <= P.HUNGER_MAX && P.LOW_HUNGER > 0 && P.LOW_HUNGER < P.HUNGER_MAX)) out.push('玩家饱食初值/阈值不合法');
      if (!(P.RATION.FOOD > 0 && P.RATION.HUNGER > 0 && P.RATION.HEAL > 0)) out.push('口粮代价/效果不合法');
      if (!(P.HOT_MEAL.FOOD > 0 && P.HOT_MEAL.FUEL > 0 && P.HOT_MEAL.HUNGER >= P.RATION.HUNGER && P.HOT_MEAL.HEAL > P.RATION.HEAL && P.HOT_MEAL.CURE > 0 && P.HOT_MEAL.RANGE > 0)) out.push('热食代价/效果不合法');
      if (!(P.INJURY.LIGHT_AT > P.INJURY.HEAVY_AT && P.INJURY.HEAVY_AT > 0 && P.INJURY.MAX === 2)) out.push('伤势阈值不合法');
      if (!(W.BASE_HP > 0 && W.FRAIL_HP > 0 && W.FRAIL_HP < W.BASE_HP)) out.push(`工人 HP 基线不合法：${W.FRAIL_HP}/${W.BASE_HP}`);
      if (!(W.HUNGER_MAX === 100 && W.START_HUNGER > 0 && W.START_HUNGER <= W.HUNGER_MAX && W.RECRUIT_HUNGER > 0 && W.RECRUIT_HUNGER <= W.HUNGER_MAX)) out.push('工人饱食初值/上限不合法');
      if (!(W.HUNGER_PER_SEC > 0 && W.EAT_AT > W.LOW_HUNGER && W.EAT_GAIN > 0 && W.NATURAL_HEAL_PER_SEC > 0)) out.push('饥饿/进食/自然恢复常量不合法');
      if (!(D.FUEL_LOSS > 0 && D.FUEL_LOSS < 1)) out.push(`DEATH.FUEL_LOSS=${D.FUEL_LOSS}`);
      if (!(R.BED_SLOTS > 0 && R.RANGE > 0 && R.HEAL_PER_SEC > 0 && R.DURATION > 0 && R.OVERWORK_MAX >= 1 && R.OVERWORK_PENALTY > 0 && R.OVERWORK_PENALTY < 1)) out.push('休整/透支常量不合法');
      if (!(G.MAX_BEDS > 0 && G.GROW_SEC > 0 && G.LIGHT_MIN >= 0 && G.LIGHT_MAX > G.LIGHT_MIN && G.YIELD > 0)) out.push('再生常量不合法');
      if (!(Q.DOWNED_SECS >= 10 && Q.ACTION_SECS > 0 && Q.PLAYER_RANGE > 0 && Q.NPC_RANGE > 0 && Q.DANGER_RANGE > Q.PLAYER_RANGE && Q.LIGHT_MIN > 0 && Q.FOOD > 0 && Q.HOT_FUEL > 0 && Q.COLD_HP_FRAC > 0 && Q.HOT_HP_FRAC > Q.COLD_HP_FRAC && Q.INJURY_SECS > 0 && Q.ESCORT_MAX_GAP > Q.ESCORT_FOLLOW_GAP && Q.ESCORT_BED_RANGE > 0 && Q.ESCORT_SPEED > 0 && Q.ESCORT_TTL > 0 && Q.ESCORT_PATH_T > 0 && Q.RECOVERY_SECS > 0 && Q.MEDICAL_QUEUE_MAX > 0 && Q.MEDICAL_RANGE > 0 && Q.MEDICAL_LIGHT_MIN > 0 && Q.MEDICAL_FUEL > 0 && Q.MEDICAL_SECS > 0 && Q.MEDICAL_HEAL_PER_SEC > 0 && Q.MEDICAL_WOUND_PER_SEC > 0)) out.push('救援/医疗常量不合法');
      if (!(C.WIDTH > 0 && C.HEIGHT > 0 && C.EXIT_HALF > 0 && C.EXIT_TRIGGER > 1 && C.EXIT_TRIGGER < 2 && C.EXIT_SPAWN_INSET > C.EXIT_TRIGGER + 1 && C.EXIT_CORRIDOR >= 3 && C.MAX_ACTIVE === 1 && C.SPAWN_LIGHT_MIN > 0)) out.push('区块活跃/出口/刷怪常量不合法');
      return out.length ? bad('survival.consts', '生存常量越界', out) : null;
    },
  },
  {
    id: 'crew.consts',
    run() {
      const out = [];
      if (COLONISTS.VERSION !== 1) out.push(`COLONISTS.VERSION=${COLONISTS.VERSION}（N0 契约应为 1）`);
      if (!(COLONISTS.MAX_RELATIONS >= 1 && COLONISTS.MAX_RELATIONS <= 8)) out.push(`MAX_RELATIONS=${COLONISTS.MAX_RELATIONS}`);
      if (!(COLONISTS.MAX_MEMORIAL_EVENTS >= 1 && COLONISTS.MAX_MEMORIAL_EVENTS <= 64)) out.push(`MAX_MEMORIAL_EVENTS=${COLONISTS.MAX_MEMORIAL_EVENTS}`);
      if (!(COLONISTS.MAX_EVENTS >= 4 && COLONISTS.MAX_EVENTS <= 24)) out.push(`MAX_EVENTS=${COLONISTS.MAX_EVENTS}`);
      if (COLONISTS.MAX_ACTIVE_TASKS !== 1) out.push(`MAX_ACTIVE_TASKS=${COLONISTS.MAX_ACTIVE_TASKS}（每人只能有一个当前任务）`);
      if (Object.keys(COLONISTS.ROLES).length !== 6) out.push(`ROLES 有 ${Object.keys(COLONISTS.ROLES).length} 项（N4d 预期 6 项）`);
      if (Object.keys(COLONISTS.PERSONALITIES).length !== 5) out.push(`PERSONALITIES 有 ${Object.keys(COLONISTS.PERSONALITIES).length} 项（N0 预期 5 项）`);
      for (const [id, r] of Object.entries(COLONISTS.ROLES)) {
        if (r.id !== id || r.trait !== id || !r.name || !r.note || !r.portrait || !r.palette || !r.effects) out.push(`角色 ${id} 字段不完整`);
      }
      for (const [id, p] of Object.entries(COLONISTS.PERSONALITIES)) {
        if (p.id !== id || p.trait !== id || !p.name || !p.taboo || !p.note || !p.effects) out.push(`性格 ${id} 字段不完整`);
      }
      if (roleTaskMul({ crew: { role: 'miner' }, traits: { good: 'miner' } }, 'gather') !== 1.4) out.push('采掘职业倍率未锁定为 1.4');
      if (roleTaskMul({ crew: { role: 'tinker' }, traits: { good: 'tinker' } }, 'build') !== 2) out.push('机工施工倍率未锁定为 2');
      if (roleTaskMul({ crew: { role: 'medic' }, traits: { good: 'miner' } }, 'medical') !== 1.35) out.push('行医治疗倍率未锁定为 1.35');
      const probe = { name: '职业探针', traits: { good: 'miner', bad: 'slowhand' }, crew: { role: 'miner', personality: 'slowhand' } };
      if (!assignRole(probe, 'medic') || probe.crew.role !== 'medic' || probe.crew.palette !== COLONISTS.ROLES.medic.palette) out.push('职业分配写入口未锁定');
      return out.length ? bad('crew.consts', '拓荒者身份契约异常', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'task.consts',
    run() {
      const out = [];
      if (TASKS.VERSION !== 1) out.push(`TASKS.VERSION=${TASKS.VERSION}`);
      if (TASKS.MAX_ACTIVE_PER_WORKER !== 1 || TASKS.MAX_RESERVATIONS_PER_WORKER !== 1) out.push('每名拓荒者任务/预约上限不是 1');
      if (!TASKS.STATUSES.includes('idle') || !TASKS.STATUSES.includes('blocked')) out.push('任务状态表缺少 idle/blocked');
      for (const id of ['neutral', 'medical', 'rescue', 'guard']) if (!DIRECTIVES.CARE_PRIORITY || !Number.isFinite(DIRECTIVES.CARE_PRIORITY[id])) out.push(`照护意图优先级缺失：${id}`);
      for (const id of ['idle', 'gather', 'eat', 'flee', 'build', 'refine', 'stoke', 'rest', 'rescue', 'medical']) {
        const row = TASKS.JOBS[id];
        if (!row || row.id !== id || !row.label || !Number.isFinite(row.priority)) out.push(`任务定义不完整：${id}`);
        if (row && (row.priority < 0 || row.priority > 100)) out.push(`任务优先级越界：${id}=${row.priority}`);
      }
      return out.length ? bad('task.consts', '任务板常量/定义异常', out) : null;
    },
  },
  {
    id: 'data.build',
    run() {
      const out = [];
      for (const k in BUILD) {
        const d = BUILD[k];
        for (const r in (d.cost || {})) if (!RES_NAME[r]) out.push(`BUILD.${k}.cost 引用未知资源 "${r}"`);
        if (!d.name) out.push(`BUILD.${k} 缺 name`);
        if (d.locked && !RESEARCH[d.locked]) out.push(`BUILD.${k}.locked="${d.locked}" 不是研究节点`);
        if (!CATEGORY_OF[k]) out.push(`BUILD.${k} 没有出现在任何 CATEGORIES 分类里（建造面板看不见它）`);
        if (d.store != null && !(d.store > 0)) out.push(`BUILD.${k}.store=${d.store} 容量不合法`);
        if (d.maxFuel != null && !(d.maxFuel > 0)) out.push(`BUILD.${k}.maxFuel=${d.maxFuel}`);
        if (d.fireMat && !FUELS[d.fireMat]) out.push(`BUILD.${k}.fireMat="${d.fireMat}" 不是火种`);
        if (d.station && !['furnace', 'smelter', 'bench', 'analyze', 'clinic'].includes(d.station)) out.push(`BUILD.${k}.station="${d.station}" 不是已知站点类型`);
        if (d.station && d.recipe && !RECIPES.some((r) => r.id === d.recipe)) out.push(`BUILD.${k}.recipe="${d.recipe}" 不在 RECIPES 里`);
        if (d.gate && (!Number.isFinite(d.hp) || d.solid !== false)) out.push(`BUILD.${k} 栅门必须是可切换的非实体结构`);
        if (d.slow != null && !(d.slow > 0 && d.slow < 1)) out.push(`BUILD.${k}.slow=${d.slow} 不在 (0,1)`);
      }
      // 反向：分类表里引用了不存在的建筑
      for (const c of CATEGORIES) for (const t of c.types) if (!BUILD[t]) out.push(`CATEGORIES.${c.id} 引用了不存在的建筑 "${t}"`);
      return out.length ? bad('data.build', `${out.length} 处建筑表问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.research',
    run() {
      const out = [];
      for (const id of RESEARCH_ORDER) if (!RESEARCH[id]) out.push(`RESEARCH_ORDER 里的 "${id}" 不在 RESEARCH 表里`);
      const ids = Object.keys(RESEARCH);
      if (ids.length !== RESEARCH_ORDER.length) out.push(`RESEARCH 有 ${ids.length} 个节点，RESEARCH_ORDER 有 ${RESEARCH_ORDER.length} 个（顺序表有遗漏）`);
      for (const id of ids) if (!RESEARCH_ORDER.includes(id)) out.push(`研究节点 "${id}" 没进 RESEARCH_ORDER（面板里看不到）`);
      const sects = SECTS.map((s) => s.id);
      for (const id in RESEARCH) {
        const r = RESEARCH[id];
        if (!r.name) out.push(`RESEARCH.${id} 缺 name`);
        if (!sects.includes(r.sect)) out.push(`RESEARCH.${id}.sect="${r.sect}" 不是已知分区`);
        for (const q of (r.req || [])) {
          if (!RESEARCH[q]) out.push(`RESEARCH.${id}.req 指向不存在的 "${q}"`);
          else if (q === id) out.push(`RESEARCH.${id} 以自己为前置（永远解不开）`);
          else if ((RESEARCH[q].req || []).includes(id)) out.push(`RESEARCH.${id} 与 ${q} 互为前置（死锁）`);
        }
        if (r.req2 && !String(r.req2).length) out.push(`RESEARCH.${id}.req2 是空的`);
        if (r.branchOf && !RESEARCH[r.branchOf]) out.push(`RESEARCH.${id}.branchOf="${r.branchOf}" 不存在`);
      }
      // 可达性：从无前置的节点出发，所有节点都应当能被解锁（否则是孤儿）
      const done = new Set();
      let grew = true;
      while (grew) {
        grew = false;
        for (const id in RESEARCH) {
          if (done.has(id)) continue;
          const req = RESEARCH[id].req || [];
          if (req.every((q) => done.has(q) || !RESEARCH[q])) { done.add(id); grew = true; }
        }
      }
      const orphan = Object.keys(RESEARCH).filter((id) => !done.has(id));
      if (orphan.length) out.push(`这些研究节点永远解不开（前置成了环或引用缺失）：${orphan.join(',')}`);
      return out.length ? bad('data.research', `${out.length} 处研究表问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.recipe',
    run() {
      const out = [];
      const seen = new Set();
      for (const r of RECIPES) {
        if (!r.id) { out.push('有配方缺 id'); continue; }
        if (seen.has(r.id)) out.push(`配方 id 重复：${r.id}`);
        seen.add(r.id);
        for (const k in (r.cost || {})) if (!RES_NAME[k]) out.push(`配方 ${r.id}.cost 引用未知资源 "${k}"`);
        if (!RES_NAME[r.out] && !TOOLS[r.out]) out.push(`配方 ${r.id}.out="${r.out}" 既不是资源也不是工具`);
        for (const s of (r.station || [])) if (!['furnace', 'smelter', 'bench'].includes(s)) out.push(`配方 ${r.id}.station 含未知站点 "${s}"`);
        if (!(r.hand > 0) && !(r.sec > 0)) out.push(`配方 ${r.id} 既没有 hand 也没有 sec（永远做不出）`);
        // 产出必须是"能进容器"的东西
        if (TOOLS[r.out] && r.n > 1) out.push(`配方 ${r.id} 产出工具 ×${r.n}（工具是唯一物品，给数量容易出怪事）`);
      }
      // 站点默认配方必须存在于该站点的配方表里
      for (const type of ['furnace', 'smelter']) {
        const def = BUILD[type];
        if (def && def.recipe && !RECIPES.some((r) => r.id === def.recipe && (r.station || []).includes(type))) {
          out.push(`BUILD.${type}.recipe="${def.recipe}" 不在该站点的配方表里（面板会显示空配方）`);
        }
      }
      // 每个站点至少得有一个配方（B42：把烧炭从熔炉移走时，熔炉得还剩炼油）
      // 熔炉只做炼油是**有意**的（用户拍板：两个炉子分工要一眼看清），所以这里只守“不为空”
      for (const s of ['furnace', 'smelter', 'bench']) {
        if (!recipesOf(s).length) out.push(`站点 ${s} 一个配方都没有（面板会空）`);
      }
      if (recipesOf('furnace').some((r) => r.id === 'coal')) out.push('熔炉又出现了「烧炭」—— 熔炉只做炼油（烧炭在自动熔炉上）');
      return out.length ? bad('data.recipe', `${out.length} 处配方问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23 蚀兽定义完整性：渲染要用的字段一个都不能少
  // 【为什么需要这条】第 1 步给 blind 加 armor 时，我的编辑事故把 color/glow 两行并进了注释，
  //   于是 render.js 每帧 `rgba(undefined,0.20)` 抛异常 → **渲染循环整个崩掉（画面冻住）**。
  //   浏览器撞上了，但「每种蚀兽都能被画出来」这件事本身应该由检测器守着（新的敌人定义同样受益）。
  {
    id: 'data.enemy',
    run() {
      const out = [];
      const HEX = /^#[0-9a-fA-F]{6}$/;
      const RGB = /^\d{1,3},\d{1,3},\d{1,3}$/;
      for (const k in ENEMIES) {
        const d = ENEMIES[k];
        if (!d.name) out.push(`${k} 缺 name`);
        for (const f of ['hp', 'speed', 'dmg', 'atkCd', 'hitR', 'weight']) {
          if (!(typeof d[f] === 'number' && isFinite(d[f]) && d[f] >= 0)) out.push(`${k}.${f}=${d[f]}（应为非负有限数）`);
        }
        if (!(d.hp > 0)) out.push(`${k}.hp 必须 > 0`);
        if (!(d.speed > 0)) out.push(`${k}.speed 必须 > 0`);
        if (!HEX.test(d.color || '')) out.push(`${k}.color="${d.color}"（渲染用，必须是 #rrggbb）`);
        if (!RGB.test(d.glow || '')) out.push(`${k}.glow="${d.glow}"（会被拼进 rgba()，必须是 "r,g,b"）`);
        else if (d.glow.split(',').some((v) => Number(v) > 255)) out.push(`${k}.glow 分量超过 255`);
        if (d.dawnFade != null && !(d.dawnFade > 0 && d.dawnFade <= 1)) out.push(`${k}.dawnFade=${d.dawnFade}（应在 0~1）`);
      }
      return out.length ? bad('data.enemy', '蚀兽定义不完整（会崩渲染）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23b 敌人行为表与实现不分家（W14-A 第 3 步）
  // 【守着什么】① 敌人 def 上写的 ability 名字必须在 ABILITY（data/combat.js）里
  //             ② ABILITY 里的每条调参都必须至少有一个敌人用它（不得留没入口的死数据）
  //             ③ 数值必须在玩法区间内（远程射程 > 贴身距离、蓄力/引信不得为 0、光环倍率 > 1 …）
  //             ④ kindFor 的构成表每一档都只能给出 ENEMIES 里真实存在的兵种（写错名字会当场崩在 new Enemy）
  //             ⑤ 运行时：活着的蚀兽的行为计时器必须在声明上限内（负计时器/忘清状态 = 这里报）
  {
    id: 'enemy.ability',
    run() {
      const out = [];
      const names = Object.keys(ABILITY);
      const used = new Set();
      for (const k in ENEMIES) {
        const ab = ENEMIES[k].ability;
        if (!ab) continue;
        if (!ABILITY[ab]) { out.push(`${k}.ability="${ab}" 在 ABILITY 里不存在`); continue; }
        used.add(ab);
      }
      for (const n of names) if (!used.has(n)) out.push(`ABILITY.${n} 没有任何敌人使用（死数据）`);
      const R = (o, f, lo, hi) => { if (!(typeof o[f] === 'number' && o[f] >= lo && o[f] <= hi)) out.push(`${f}=${o[f]}（应在 ${lo}~${hi}）`); };
      const s = ABILITY.spit, c = ABILITY.charge, b = ABILITY.bomb, a = ABILITY.aura;
      R(s, 'RANGE', 2, 12); R(s, 'MIN_RANGE', 0.5, s.RANGE); R(s, 'WINDUP', 0.2, 2); R(s, 'DMG', 1, 40); R(s, 'CD', 0.5, 8);
      R(c, 'RANGE', 1, 8); R(c, 'WINDUP', 0.2, 2); R(c, 'DASH', 0.1, 1.5); R(c, 'MUL', 1.5, 8); R(c, 'CD', 0.5, 8);
      R(b, 'HP_FRAC', 0.02, 0.6); R(b, 'FUSE', 0.3, 4); R(b, 'RADIUS', 0.5, 5); R(b, 'DMG_PLAYER', 1, 60); R(b, 'DMG_BEAST', 1, 200);
      R(a, 'RANGE', 1, 10); R(a, 'SPEED_MUL', 1.05, 2); R(a, 'REFRESH', 0.05, 1);
      if (!(a.SPEED_MUL > 1)) out.push('光环倍率必须 > 1（否则光环没意义）');
      // KINDS 必须是从表里派生的非 Boss 兵种
      const want = Object.keys(ENEMIES).filter((k) => !ENEMIES[k].boss).sort().join(',');
      if (KINDS.slice().sort().join(',') !== want) out.push(`KINDS=[${KINDS}] 与 ENEMIES 的非 Boss 兵种不一致（KINDS 必须派生，不得手写）`);
      // kindFor：每档潮位采 400 次，都必须给出已知兵种 + 至少要能采出 2 种（第 1 档除外）
      //   顺带守住一个"第 4 步夜间加权依赖"的不变量：每档 BANDS 的权重和 = 1
      //   （主题是"在旧份额上加权"，靠的就是这个；哪天有人往表里塞一个 0.3 而不改其他项，这条会报）
      for (let tide = 1; tide <= WAVES.TIDE_MAX; tide++) {
        const seen = new Set();
        // 检测器绝不能消费玩法随机流：__replay 会暂时接管 Math.random，
        // 若这里直接传 Math.random，开 __watch 本身就会改变波次与难度曲线。
        const sampleRng = makeRng(0x51f15e + tide);
        let sum = 0;
        for (const [, w] of bandOf(tide)) sum += w;
        if (Math.abs(sum - 1) > 1e-9) out.push(`潮位 ${tide} 的 BANDS 权重和 ${sum} ≠ 1（主题加权会因此偏掉）`);
        for (let i = 0; i < 400; i++) {
          const k = kindFor(tide, sampleRng);
          if (!ENEMIES[k]) { out.push(`kindFor(${tide}) 给出了未知兵种 "${k}"`); break; }
          seen.add(k);
        }
        if (tide > 1 && seen.size < 2) out.push(`潮位 ${tide} 的构成表只能出 ${seen.size} 种兵种（表写漏了）`);
      }
      // 运行时状态量：不得越界
      for (const e of state.enemies || []) {
        if (!e.alive) continue;
        const ab = e.def && e.def.ability;
        if (!ab) continue;
        if (e.windT < 0) out.push(`${e.ekind} windT=${e.windT}（负数）`);
        if (e.dashT < 0) out.push(`${e.ekind} dashT=${e.dashT}（负数）`);
        if (e.fuseT < 0) out.push(`${e.ekind} fuseT=${e.fuseT}（负数）`);
        if (e.windT > ABILITY[ab].WINDUP + 1e-6) out.push(`${e.ekind} windT=${+e.windT.toFixed(2)} > 声明上限 ${ABILITY[ab].WINDUP}`);
        if (ab === 'charge' && e.dashT > c.DASH + 1e-6) out.push(`${e.ekind} dashT=${+e.dashT.toFixed(2)} > DASH`);
        if (ab === 'bomb' && e.fuseT > b.FUSE + 1e-6) out.push(`${e.ekind} fuseT=${+e.fuseT.toFixed(2)} > FUSE`);
        if (e.auraT > a.REFRESH + 1e-6) out.push(`${e.ekind} auraT=${+e.auraT.toFixed(2)} > REFRESH（光环没被正确续期/衰减）`);
        if (out.length >= MAX_DETAIL) break;
      }
      return out.length ? bad('enemy.ability', '敌人行为表与实现分家 / 状态量越界', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23c 一夜三段 + 主题夜（W14-A 第 4 步）
  // 【守着什么】这一步的风险全在"表与实现分家"，所以断言分四层：
  //   ① 三段必须**结构上连续覆盖**整夜（用累计上界 upTo，不许出现空档/重叠），乘子在合法区间
  //   ② 主题表：weights 的键必须是真实兵种（且不含 Boss）；非混合主题必须有权重 >1 的签名兵种；
  //      文案里的"主力"只能来签名兵种（signatureOf 就是 weights 的键，不许第二份清单）
  //   ③ 归一化：planNight 的 shares 和 = 1、每项 > 0；band 里没有未知兵种；
  //      **时段浓度真的生效**（试探段的主题兵种份额必须低于加压段 —— 否则"三段"只是嘴上说说）
  //   ④ 运行时：蚀潮里 state.nightTheme 必须等于 themeIdOf(state)（防两处各算一套）
  {
    id: 'night.plan',
    run() {
      const out = [];
      // ① 三段
      let prev = 0;
      for (const s of SEGMENTS) {
        if (!(s.upTo > prev)) out.push(`时段 ${s.id} 的 upTo=${s.upTo} 没有严格大于上一段（${prev}）`);
        if (!(s.intervalMul >= 0.5 && s.intervalMul <= 2)) out.push(`时段 ${s.id} 间隔乘子 ${s.intervalMul} 越界`);
        if (!(s.batchAdd >= 0 && s.batchAdd <= 2)) out.push(`时段 ${s.id} 批量加成 ${s.batchAdd} 越界`);
        if (!(s.themeBias >= 0 && s.themeBias <= 2)) out.push(`时段 ${s.id} 主题浓度 ${s.themeBias} 越界`);
        if (!s.name) out.push(`时段 ${s.id} 缺名字（HUD 要用）`);
        prev = s.upTo;
      }
      if (prev !== TIDE_SECS) out.push(`三段累计上界 ${prev} ≠ 蚀潮时长 ${TIDE_SECS}（会有空档或多算）`);
      // ② 主题表
      for (const id in THEMES) {
        const th = THEMES[id];
        if (th.id !== id) out.push(`THEMES.${id}.id=${th.id} 与键名不一致`);
        if (!th.name || !th.note) out.push(`主题 ${id} 缺 name/note（HUD 要用）`);
        const keys = Object.keys(th.weights);
        for (const k of keys) {
          if (!ENEMIES[k]) out.push(`主题 ${id} 加权了不存在的兵种 "${k}"`);
          else if (ENEMIES[k].boss) out.push(`主题 ${id} 不该给 Boss 加权`);
          else if (!(th.weights[k] > 1)) out.push(`主题 ${id} 给 ${k} 的权重 ${th.weights[k]} ≤1（那就不叫主题了）`);
        }
        if (id !== 'mix' && !keys.length) out.push(`主题 ${id} 没有任何签名兵种`);
        const sig = signatureOf(th);
        if (sig.length !== keys.length) out.push(`主题 ${id} 的 signatureOf 与 weights 键不一致（文案会与加权分家）`);
        for (const k of sig) if (!keys.includes(k)) out.push(`主题 ${id} 的签名兵种 ${k} 不在 weights 里`);
      }
      // 轮转：每个主题都要能在若干天内轮到；大潮夜固定混合
      const seen = new Set();
      for (let d = 1; d <= NIGHT.ROTATION.length * 2 + BOSS.EVERY; d++) {
        const id = themeIdOf({ day: d });
        if (!THEMES[id]) out.push(`第 ${d} 天算出的主题 "${id}" 不存在`);
        seen.add(id);
        if (d % BOSS.EVERY === 0 && id !== 'mix') out.push(`第 ${d} 天是大潮夜，主题必须是混合（现在是 ${id}）`);
        if (themeIdOf({ day: d }) !== id) out.push(`第 ${d} 天主题不确定（两次算出不同结果）`);
      }
      for (const id in THEMES) if (!seen.has(id)) out.push(`主题 ${id} 永远不会被轮到（轮转表里没有）`);
      // ③ 归一化 + 时段浓度生效
      for (let d = 1; d <= 12; d++) {
        for (const seg of SEGMENTS) {
          const t = TIDE_START + Math.min(TIDE_SECS - 0.01, seg.upTo - 0.01);
          const plan = planNight({ day: d, t });
          let sum = 0;
          for (const k in plan.shares) {
            const v = plan.shares[k];
            if (!(v > 0 && v <= 1)) out.push(`第 ${d} 天 ${seg.id} 段份额 ${k}=${v} 不合法`);
            if (!ENEMIES[k]) out.push(`第 ${d} 天 ${seg.id} 段份额包含未知兵种 ${k}`);
            sum += v;
          }
          if (Math.abs(sum - 1) > 1e-6) out.push(`第 ${d} 天 ${seg.id} 段份额和 ${sum} ≠ 1`);
          if (plan.seg.id !== seg.id) out.push(`第 ${d} 天 t 落在 ${seg.id} 段却算成 ${plan.seg.id}`);
          for (const [k, w] of plan.band) if (!(w > 0)) out.push(`第 ${d} 天 ${seg.id} 段 ${k} 权重 ${w} ≤ 0`);
        }
      }
      // 时段浓度：拿第 2 天（蛾潮夜）比试探段与加压段的签名份额
      //   注意比的是**份额**（归一后）—— 所以基础份额自己算，不能拿 BANDS 里的原始权重直接比
      const d2 = 2;
      const sigK = signatureOf(themeOf({ day: d2 }))[0];
      if (sigK) {
        const raw = bandOf(tideOf({ day: d2 }));
        let total = 0; for (const [, w] of raw) total += w;
        const hit = raw.find(([k]) => k === sigK);
        const baseShare = hit && total > 0 ? hit[1] / total : 0;
        const probe = planNight({ day: d2, t: TIDE_START + 5 }).shares[sigK] || 0;
        const press = planNight({ day: d2, t: TIDE_START + 30 }).shares[sigK] || 0;
        if (!(press > probe)) out.push(`主题浓度没生效：${sigK} 加压段 ${press.toFixed(3)} 未高于试探段 ${probe.toFixed(3)}`);
        if (!(probe >= baseShare - 1e-9)) out.push(`试探段把主题兵种压到基础份额以下（${probe.toFixed(3)} < ${baseShare.toFixed(3)}）`);
        if (!(press > baseShare + 1e-9)) out.push(`加压段的主题兵种没有高于基础份额（${press.toFixed(3)} ≤ ${baseShare.toFixed(3)}）`);
      }
      // ④ 运行时一致性（只在蚀潮中查：nightTheme 是 updateWaves 里写的）
      if (state.started && isTide(state) && state.nightTheme && state.nightTheme !== themeIdOf(state)) {
        out.push(`state.nightTheme=${state.nightTheme} 与 themeIdOf()=${themeIdOf(state)} 不一致`);
      }
      // HUD 数据完整性
      if (state.started) {
        const hud = nightHud(state);
        for (const f of ['theme', 'seg', 'main', 'group', 'tag', 'color']) {
          if (!hud[f]) out.push(`nightHud().${f} 为空（HUD 会缺信息）`);
        }
        if (!(hud.secs >= 0)) out.push(`nightHud().secs=${hud.secs} 不合法`);
        // 混合夜按设计没有签名兵种（“什么都有”）—— 只有带主题的夜才要求非空
        if (hud.themeId !== 'mix' && !hud.signatures.length) out.push(`主题 ${hud.themeId} 的 signatures 为空（悬停提示会空）`);
        // 主力必须真的取自当前加权表（不是另一处算的“最近似”）
        const plan = nightPlan(state);
        const main = mainKindOf(plan);
        if (!ENEMIES[main]) out.push(`下波主力 "${main}" 不是已知兵种`);
        if (!(plan.shares[main] > 0)) out.push(`下波主力 ${main} 的份额为 0（加权表里没有它）`);
      }
      return out.length ? bad('night.plan', '一夜三段 / 主题夜的表与实现分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23d 工具是生产件（W14-A 第 5 步撤回了“工具能攻击”）
  // 【守着什么】用户否决过“工具两用”（原话：工具能攻击简直是个废物设计，太割裂了，根本没必要 → D47）。
  //   这条断言就是**防着它自己爬回来**：工具表一旦又长出 atk/vsHard/kb 这类字段，当场报；
  //   顺带守住工具表自身的两张名单（TOOLS 与 storage 的 TOOL_ORDER/RES_NAME 不许分家）。
  {
    id: 'tool.pure',
    run() {
      const out = [];
      const COMBAT_KEYS = ['atk', 'vsHard', 'kb', 'dmg', 'dmgType', 'crit'];
      for (const k in TOOLS) {
        for (const f of COMBAT_KEYS) {
          if (TOOLS[k][f] != null) out.push(`工具 ${k} 又长出了战斗字段 ${f}=${TOOLS[k][f]}（工具是生产件，见 D47）`);
        }
        if (!TOOLS[k].name || !TOOLS[k].desc) out.push(`工具 ${k} 缺 name/desc`);
      }
      // 工具表与 data/storage.js 的名字/顺序表必须一致（装备位与容器面板读那一份）
      for (const k of TOOL_ORDER) {
        if (!TOOLS[k]) { out.push(`TOOL_ORDER 里的 "${k}" 不在 TOOLS 表里`); continue; }
        if (!STORE_ORDER.includes(k)) out.push(`工具 ${k} 不在 STORE_ORDER（容器面板里看不到、也搬不动）`);
        if (!RES_NAME[k]) out.push(`工具 ${k} 没有 RES_NAME（侧栏装备位会露 key）`);
      }
      for (const k of STORE_ORDER) if (TOOLS[k] && !TOOL_ORDER.includes(k)) out.push(`STORE_ORDER 里的工具 ${k} 不在 TOOL_ORDER（两张工具表分家了）`);
      // 发射器能力只能由 fire 标记声明（数值全在 data/combat.js 的 HAND_FIRE）
      for (const k in TOOLS) {
        const want = !!TOOLS[k].fire;
        if (canFire(k) !== want) out.push(`canFire(${k})=${canFire(k)} 与 TOOLS.${k}.fire=${want} 不一致`);
        if (want && !TOOL_ORDER.includes(k)) out.push(`发射器 ${k} 不在 TOOL_ORDER 里（造出来也没地方显示）`);
      }
      if (!Object.keys(TOOLS).some((k) => TOOLS[k].fire)) out.push('一把发射器都没有：F 键永远没反应');
      return out.length ? bad('tool.pure', '工具沾上了战斗数值（用户否决过的设计）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'hand.fire',
    run() {
      const out = [];
      // ① 数值区间：手持开火是玩家**唯一**的“随身远程”（近战已撤，见 D47）——射程要明显超出贴身，其余旋钮在可玩区间
      if (!(HAND_FIRE.RANGE >= 4)) out.push(`HAND_FIRE.RANGE=${HAND_FIRE.RANGE} 太近（贴脸才打得到，那是近战不是远程）`);
      if (!(HAND_FIRE.RANGE <= 12)) out.push(`HAND_FIRE.RANGE=${HAND_FIRE.RANGE} 太远（超出屏幕可指范围）`);
      if (!(HAND_FIRE.DMG > 0)) out.push(`HAND_FIRE.DMG=${HAND_FIRE.DMG} 不合法`);
      if (!(HAND_FIRE.CD >= 0.2 && HAND_FIRE.CD <= 2)) out.push(`HAND_FIRE.CD=${HAND_FIRE.CD} 越界（0.2~2s）`);
      if (!(HAND_FIRE.BEAM_R > 0 && HAND_FIRE.BEAM_R <= 1.5)) out.push(`HAND_FIRE.BEAM_R=${HAND_FIRE.BEAM_R} 越界`);
      if (!(HAND_FIRE.FUEL_PER_SHOT > 0 && HAND_FIRE.FUEL_PER_SHOT < 1)) out.push(`HAND_FIRE.FUEL_PER_SHOT=${HAND_FIRE.FUEL_PER_SHOT} 越界（必须 <1，否则小数债务白写）`);
      // 小数债务的承诺：约 3 发 1 燃料 —— 至少得是 2 发以上，否则每发真扣 1 更省事
      if (!(1 / HAND_FIRE.FUEL_PER_SHOT >= 2)) out.push(`每发耗 ${HAND_FIRE.FUEL_PER_SHOT}：一发就扣 1，小数债务没意义`);
      // ② 伤害类型必须是真类型（打错字会让 armorMul 静默按常规算）
      if (!TYPES[HAND_FIRE.TYPE] && !Object.values(TYPES).includes(HAND_FIRE.TYPE)) out.push(`HAND_FIRE.TYPE="${HAND_FIRE.TYPE}" 不是已知伤害类型`);
      if (!TYPE_NAME[HAND_FIRE.TYPE]) out.push(`HAND_FIRE.TYPE="${HAND_FIRE.TYPE}" 没有 TYPE_NAME（界面/i18n 会露 key）`);
      // ③ 键位：恰有一个 fire 动作，且它的键不能与别的动作撞车
      const fires = KEY_ACTIONS.filter((a) => a.id === 'fire');
      if (fires.length !== 1) out.push(`KEY_ACTIONS 里 fire 动作有 ${fires.length} 条（必须恰好 1 条）`);
      if (fires.length === 1) {
        const code = fires[0].code;
        if (!code) out.push('fire 动作没有默认键位');
        const dup = KEY_ACTIONS.filter((a) => a.code === code && a.id !== 'fire');
        if (dup.length) out.push(`fire 的默认键 ${code} 与 ${dup.map((a) => a.id).join('/')} 撞车`);
        if (!fires[0].label) out.push('fire 动作缺 label（键位表里会空一格）');
      }
      // ④ 配方：发射器必须能造出来，且材料是真实资源
      for (const k in TOOLS) {
        if (!TOOLS[k].fire) continue;
        const rs = RECIPES.filter((r) => r.out === k);
        if (!rs.length) out.push(`发射器 ${k} 没有任何配方（做不出来）`);
        for (const r of rs) {
          if (!(r.sec > 0)) out.push(`配方 ${r.id} 的 sec=${r.sec} 不合法`);
          for (const res in r.cost) {
            if (!(r.cost[res] > 0)) out.push(`配方 ${r.id} 的材料 ${res}=${r.cost[res]} 不合法`);
            if (!RES_NAME[res]) out.push(`配方 ${r.id} 用了不存在的资源 "${res}"`);
          }
        }
      }
      return out.length ? bad('hand.fire', '手持开火与键位/配方分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23e 结构装载体（W14-A 第 5 步 5b）：把一座塔背到背上
  // 【守着什么】这一步最容易出的不是“算错”，而是**漏掉某条代价**（那就成了免费移动堡垒）：
  //   ① 三条代价必须在表里、且方向正确（移动更慢 / 更费油 / 占背包）
  //   ② 研究节点、G 键、两条首次提示都必须真的存在（少一个 = 玩家永远发现不了这个功能）
  //   ③ 运行时不变量：背上的塔**不在任何一层“地上”**（不占格/不挡光）、只背一座、背包格是派生值
  {
    id: 'carry.config',
    run() {
      const out = [];
      // ① 代价
      if (!(CARRY.MOUNT_SECS >= 1)) out.push(`CARRY.MOUNT_SECS=${CARRY.MOUNT_SECS}：装卸太容易了（必须"停下来按住"）`);
      if (!(CARRY.RATE_MUL_MOVING > 0 && CARRY.RATE_MUL_MOVING < 1)) out.push(`CARRY.RATE_MUL_MOVING=${CARRY.RATE_MUL_MOVING} 应 <1（移动必须变差）`);
      if (!(CARRY.FUEL_MUL >= 1)) out.push(`CARRY.FUEL_MUL=${CARRY.FUEL_MUL} 应 ≥1`);
      if (!(CARRY.BASE_FUEL > 0)) out.push(`CARRY.BASE_FUEL=${CARRY.BASE_FUEL}：0 槽塔背起来就白射了`);
      if (!(CARRY.PACK_SLOTS >= 1)) out.push(`CARRY.PACK_SLOTS=${CARRY.PACK_SLOTS} 应 ≥1（背包代价不能免）`);
      // ② 解锁与研究：节点存在、在展示顺序里、属于已存在的分区、有面板文案
      if (!RESEARCH.carrier) out.push('没有 RESEARCH.carrier 节点（背负功能永远解锁不了）');
      else {
        if (RESEARCH.carrier.desc == null || !String(RESEARCH.carrier.desc).length) out.push('RESEARCH.carrier 缺 desc（研究面板会空一行）');
        if (!SECTS.some((s) => s.id === RESEARCH.carrier.sect)) out.push(`RESEARCH.carrier.sect="${RESEARCH.carrier.sect}" 不是已知分区`);
      }
      if (!RESEARCH_ORDER.includes('carrier')) out.push('carrier 不在 RESEARCH_ORDER（研究面板里看不见）');
      // ③ 键位与提示
      const fire = KEY_ACTIONS.filter((a) => a.id === 'carry');
      if (fire.length !== 1) out.push(`KEY_ACTIONS 里 carry 动作有 ${fire.length} 条（必须恰好 1 条）`);
      else {
        const dup = KEY_ACTIONS.filter((a) => a.code === fire[0].code && a.id !== 'carry');
        if (dup.length) out.push(`carry 的默认键 ${fire[0].code} 与 ${dup.map((a) => a.id).join('/')} 撞车`);
        if (!fire[0].label || !fire[0].hint) out.push('carry 动作缺 label/hint（键位表里学不会）');
      }
      for (const k of ['firstCarry', 'firstDrop']) if (!HINTS[k]) out.push(`缺首次提示 HINTS.${k}（玩家不会知道它有代价）`);
      // ④ 代价必须"值那么多"：背上塔的每发底价不能比手持辉光棒还便宜（否则谁还用手持）
      if (!(CARRY.BASE_FUEL * CARRY.FUEL_MUL >= HAND_FIRE.FUEL_PER_SHOT)) {
        out.push(`背着塔每发 ${(CARRY.BASE_FUEL * CARRY.FUEL_MUL).toFixed(3)} < 手持辉光棒 ${HAND_FIRE.FUEL_PER_SHOT}：移动炮台比手持更省，反了`);
      }
      return out.length ? bad('carry.config', '结构装载体的代价/解锁/键位分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'carry.state',
    run() {
      const out = [];
      if (state.carried) {
        const b = state.carried;
        const def = BUILD[b.type] || {};
        if (!state.buildings.includes(b)) out.push(`背上的 ${b.type} 不在 state.buildings 里（开火/存档都会漏掉它）`);
        if (!b.mounted) out.push(`背上的 ${b.type} 没有 mounted 标记`);
        if (!def.dmg) out.push(`背着的东西 ${b.type} 不是塔`);
        // 占格/挡光：它自己**没占过**。只有同格有别的建筑时才允许非 0
        const m = state.map;
        const i = b.y * m.w + b.x;
        const other = state.buildings.find((x) => x !== b && x.x === b.x && x.y === b.y);
        if (!other) {
          if (m.occWalk[i] !== 0) out.push(`背上的 ${b.type} 占住了行走格（会“背着塔卡在墙里”）`);
          if (m.occBuild && m.occBuild[i] !== 0) out.push(`背上的 ${b.type} 占住了建筑格（建不了东西）`);
          if (m.blockLight[i] !== 0) out.push(`背上的 ${b.type} 挡住了光`);
        }
        // 跟着人走：站着不动时它就应该在玩家脚下（容差 1 格：装卸/读档的那一帧可能还没跟着跑）
        const still = !state.moveInput && !(state.player.path && state.player.path.length);
        const lag = Math.max(Math.abs(b.x - Math.floor(state.player.x)), Math.abs(b.y - Math.floor(state.player.y)));
        if (still && lag > 1) {
          out.push(`背上的 ${b.type} 在 (${b.x},${b.y})，玩家在 (${Math.floor(state.player.x)},${Math.floor(state.player.y)})：没跟上`);
        }
        // 占背包格：派生值，必须真少了
        const cap = packContainer(state).cap;
        if (cap !== PACK_CAP - CARRY.PACK_SLOTS) out.push(`背着重物时背包容量 ${cap} ≠ ${PACK_CAP - CARRY.PACK_SLOTS}`);
      } else {
        const cap = packContainer(state).cap;
        if (cap !== PACK_CAP) out.push(`没背东西时背包容量 ${cap} ≠ ${PACK_CAP}`);
      }
      // 全局：最多只有一座 mounted，且它就是 state.carried
      for (const b of state.buildings) {
        if (b.mounted && b !== state.carried) out.push(`${b.type} 有 mounted 标记但不是 state.carried（数据不一致）`);
      }
      return out.length ? bad('carry.state', '背上的结构体不在“地上”（占格/挡光/背包）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A23f 塔的成长与光路炮（W14-A 第 6 步）
  // 【守着什么】这两块都靠“复用现成机制”实现，所以风险都是**同一件事被算两遍**：
  //   ① 升级改单发/射程/血上限 —— 若不经过 payloadStats，面板显示旧值、开火用另一个值（B13 的老毛病）
  //   ② 光路炮的开火条件是“旁边有一面被点亮的棱镜” —— 判定必须复用 light.js 的 relayHop（那才是“通没通”的结论）
  {
    id: 'tower.level',
    run() {
      const out = [];
      // ① Lv1 必须就是今天（零变化基线）——升级不许顺手改平衡
      const L1 = TOWER_LV[0];
      if (L1.dmg !== 1 || L1.range !== 1 || L1.hp !== 1) out.push(`Lv1 乘子 ${JSON.stringify(L1)} 不是 1/1/1（旧档/旧行为会变）`);
      if (TOWER_LV.length !== TOWER_LV_MAX) out.push(`TOWER_LV 长度 ${TOWER_LV.length} ≠ TOWER_LV_MAX ${TOWER_LV_MAX}`);
      // ② 逐级递增 + 在声明区间内
      for (let i = 1; i < TOWER_LV.length; i++) {
        for (const k of ['dmg', 'range', 'hp']) {
          if (!(TOWER_LV[i][k] > TOWER_LV[i - 1][k])) out.push(`等级 ${i + 1} 的 ${k}=${TOWER_LV[i][k]} 没比上一级大`);
        }
      }
      for (const L of TOWER_LV) {
        if (!(L.dmg >= 1 && L.dmg <= 2.2)) out.push(`等级表 dmg 乘子 ${L.dmg} 越界（1~2.2）`);
        if (!(L.range >= 1 && L.range <= 1.3)) out.push(`等级表 range 乘子 ${L.range} 越界（1~1.3）`);
        if (!(L.hp >= 1 && L.hp <= 2)) out.push(`等级表 hp 乘子 ${L.hp} 越界（1~2）`);
      }
      const lr = lvMulRange();
      if (lr.dmg[1] !== TOWER_LV[TOWER_LV_MAX - 1].dmg || lr.range[1] !== TOWER_LV[TOWER_LV_MAX - 1].range) {
        out.push('lvMulRange() 与 TOWER_LV 对不上（数值门会按错的区间放行）');
      }
      // ③ 升级价：每级都升得上去、逐级变贵、料都是真资源；满级 / 非塔 → 算不出价
      for (const t of towerTypes()) {
        const def = BUILD[t];
        let prev = 0;
        for (let lv = 1; lv < TOWER_LV_MAX; lv++) {
          const cost = upgradeCostFor(t, lv);
          if (!cost) { out.push(`${def.name} 从 Lv${lv} 升不上去（没有价目）`); continue; }
          let value = 0;
          for (const k in cost) {
            const n = cost[k];
            if (!Number.isInteger(n) || n <= 0) out.push(`${def.name} 升 Lv${lv + 1} 的材料 ${k}=${n} 不合法`);
            if (!RES_NAME[k]) out.push(`${def.name} 升级用了不存在的资源 "${k}"`);
            value += n;
          }
          if (!(value > prev)) out.push(`${def.name} 升 Lv${lv + 1} 的总量 ${value} 没比上一级贵（${prev}）`);
          prev = value;
        }
        if (upgradeCostFor(t, TOWER_LV_MAX)) out.push(`${def.name} 满级还能算出升级价`);
        if (def.hp && !(towerHp(def, TOWER_LV_MAX) > towerHp(def, 1))) out.push(`${def.name} 满级血上限没涨`);
      }
      if (upgradeCostFor('lamp', 1)) out.push('不是塔的建筑（lamp）竟然能算出升级价');
      // ③b 【反向断言】没有 hp 字段的建筑必须得到 null，不能是 0 ——
      //   盖上 0 会被仓库/小地图/添火那几处 `b.hp <= 0` 当成“已毁”（W14-A 第 6 步真踩过）
      if (towerHp(BUILD.lamp, 1) !== null) out.push(`没写 hp 的建筑（lamp）的塔血上限算成了 ${towerHp(BUILD.lamp, 1)}，应为 null`);
      if (towerHp(BUILD.towerGlow, 1) !== BUILD.towerGlow.hp) out.push(`塔 Lv1 血上限 ${towerHp(BUILD.towerGlow, 1)} ≠ def.hp ${BUILD.towerGlow.hp}（Lv1 必须一字不差）`);
      // ④ 升级后的数值只有一套：payloadStats(def,[],lv) == 基础 × 乘子（显示与开火同源）
      for (const t of towerTypes()) {
        const def = BUILD[t];
        for (let lv = 1; lv <= TOWER_LV_MAX; lv++) {
          const s = payloadStats(def, [], lv);
          const mul = TOWER_LV[lv - 1];
          if (Math.abs(s.单发 - def.dmg * mul.dmg) > 1e-9) out.push(`${def.name} Lv${lv} 单发 ${s.单发} ≠ ${def.dmg}×${mul.dmg}`);
          if (Math.abs(s.射程 - def.range * mul.range) > 1e-9) out.push(`${def.name} Lv${lv} 射程 ${s.射程} ≠ ${def.range}×${mul.range}`);
        }
      }
      // ⑤ 运行时：等级/血上限自洽（读档或升级后都不该出现“血超过上限”或越界等级）
      for (const b of state.buildings || []) {
        const def = BUILD[b.type];
        if (!def || !def.dmg) continue;
        const lv = b.level || 1;
        if (!(lv >= 1 && lv <= TOWER_LV_MAX)) out.push(`${b.type}@${b.x},${b.y} 等级 ${lv} 越界`);
        else if (!b.site && b.hp > towerHp(def, lv) + 1e-9) out.push(`${b.type}@${b.x},${b.y} 血 ${Math.round(b.hp)} > Lv${lv} 上限 ${towerHp(def, lv)}`);
      }
      // ⑤b 【反向断言】现场每一座建筑：本来没有结构概念的（def 里没写 hp）就不该被盖上 0 血 ——
      //     写 0 会被仓库/小地图/添火那几处 `hp <= 0` 当成已毁（同类回归的现场雷达）
      for (const b of state.buildings || []) {
        const def = BUILD[b.type];
        if (!def || typeof def.hp === 'number') continue;
        if (b.hp === 0) out.push(`${b.type}@${b.x},${b.y} 本来没有结构，却被写上 hp=0`);
      }
      return out.length ? bad('tower.level', '塔的成长与“单一数值来源”分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'prism.gun',
    run() {
      const out = [];
      const gun = BUILD.prismGun;
      if (!gun) return bad('prism.gun', '光路炮不存在（第 6 步的核心之一）', ['BUILD.prismGun 缺失']);
      // ① 数据自洽：它是一座塔、靠接光开火、射得远打得重、只打地面
      if (!gun.dmg) out.push('光路炮没有 dmg（updateTowers 根本不会处理它）');
      if (!gun.needsBeam) out.push('光路炮没有 needsBeam 标记 —— 会退回“自己脚下要有光”，身份没了');
      if (gun.air) out.push('光路炮标了对空 —— 夜枭那份活应该留给辉光塔');
      if (!(gun.range > BUILD.towerGlow.range)) out.push(`光路炮射程 ${gun.range} 不比辉光塔 ${BUILD.towerGlow.range} 远（“把火力投进黑暗”的价值就没了）`);
      const dps = gun.dmg / gun.cd, base = BUILD.towerGlow.dmg / BUILD.towerGlow.cd;
      if (!(dps >= base * 0.7 && dps <= base * 1.4)) out.push(`光路炮单靶每秒 ${dps.toFixed(2)} 不在辉光塔 ${base.toFixed(2)} 的 [0.7, 1.4] 倍内（要么是下级、要么是严格上位）`);
      if (CATEGORY_OF.prismGun !== 'def') out.push('光路炮不在「防御」分类里');
      if (gun.locked !== 'lamp') out.push('光路炮的解锁研究与棱镜不一致（应该一次解锁整条光路体系）');
      if (!(RESEARCH[gun.locked] && RESEARCH[gun.locked].desc)) out.push(`光路炮的解锁研究 "${gun.locked}" 不存在`);
      if (!towerTypes().includes('prismGun')) out.push('光路炮没被认成塔（载荷/升级/背塔都走不到它）');
      if (!(PRISM_LIT > 0)) out.push('PRISM_LIT 不合法（棱镜永远点不亮）');
      // ② 接光判定：只认 relayHop（上游断掉时它就是 null —— 判据“断一环失效”由此天然成立）
      for (const b of state.buildings || []) {
        if (b.type !== 'prism') continue;
        if (b.relayHop != null && !(b.relayHop >= 1 && b.relayHop <= PRISM_MAX_HOPS)) out.push(`棱镜@${b.x},${b.y} 的 relayHop=${b.relayHop} 越界`);
      }
      for (const b of state.buildings || []) {
        if (b.type !== 'prismGun') continue;
        const nb = beamNeighbor(state, b);
        if (nb && nb.relayHop == null) out.push('beamNeighbor 返回了没点亮的棱镜（判定漏了 relayHop）');
      }
      return out.length ? bad('prism.gun', '光路炮 / 棱镜接力的规则分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.codex',
    run() {
      const out = [];
      const spriteKeys = new Set(SPRITES.map((s) => s.key));
      for (const k in CODEX) {
        const d = CODEX[k];
        if (!d.name) out.push(`CODEX.${k} 缺 name`);
        if (!(d.need > 0)) out.push(`CODEX.${k}.need=${d.need}（击杀目标不合法）`);
        if (!ENEMIES[k]) out.push(`CODEX.${k} 没有对应的敌人定义`);
        // 抗性那半句必须由抗性表生成（W14-A 第 1 步）：写死的 weak 字段一律不允许复活
        if (d.weak !== undefined) out.push(`CODEX.${k}.weak 又写死了：抗性文案必须走 weakTextOf()`);
        if (!weakTextOf(k)) out.push(`weakTextOf(${k}) 拿不到文案`);
        const art = CODEX_ART[k];
        if (!art) out.push(`CODEX.${k} 没有配图（CODEX_ART 缺项）`);
        else if (!spriteKeys.has(art)) out.push(`CODEX_ART.${k}="${art}" 不在 SPRITES 登记表里`);
      }
      for (const k in ENEMIES) if (!CODEX[k]) out.push(`敌人 "${k}" 没有图鉴条目（打死了图鉴里看不到）`);
      return out.length ? bad('data.codex', `${out.length} 处图鉴问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.sprite',
    run() {
      const out = [];
      const keys = new Set(), srcs = new Set();
      for (const s of SPRITES) {
        if (!s.key) out.push('有素材项缺 key');
        if (keys.has(s.key)) out.push(`素材 key 重复：${s.key}`);
        keys.add(s.key);
        if (srcs.has(s.src)) out.push(`素材路径重复：${s.src}`);
        srcs.add(s.src);
        if (!s.src || !s.src.startsWith('assets/')) out.push(`素材 ${s.key}.src="${s.src}" 不在 assets/ 下`);
        if (s.pxW && s.pxH && (s.pxW % 2 || s.pxH % 2)) out.push(`素材 ${s.key} 尺寸 ${s.pxW}×${s.pxH} 是奇数（像素画会被拉糊）`);
      }
      return out.length ? bad('data.sprite', `${out.length} 处素材表问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.keymap',
    run() {
      const out = [];
      const byCode = {};                 // code → 绑了哪些动作
      const ids = new Set();
      for (const a of KEY_ACTIONS) {
        if (!a.id) { out.push('有按键动作缺 id'); continue; }
        if (ids.has(a.id)) out.push(`按键动作 id 重复：${a.id}`);
        ids.add(a.id);
        if (!a.label) out.push(`按键动作 ${a.id} 缺 label（键位表会空着）`);
        if (!a.code) continue;           // 允许无默认键（固定鼠标键等）
        (byCode[a.code] = byCode[a.code] || []).push(a.id);
      }
      for (const c in byCode) if (byCode[c].length > 1) out.push(`一个键绑了多个动作：${c} → ${byCode[c].join(' + ')}`);
      return out.length ? bad('data.keymap', `${out.length} 处键位问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // 节点量表 vs 生成器（B13 后两者同源于 data/nodes.js；这里守它别再被拆开）
  {
    id: 'data.nodeamt',
    run() {
      const out = [];
      for (const t of NODE_TILES) {
        if (!(nodeMax(t) > 0)) out.push(`地形 ${t} 的 nodeMax 为 0（上限判定会永远报警）`);
        // 深层量必须 ≥ 地表量（「下去更富」是这个层级设计的卖点）
        if (NODE_DEEP[t] != null && NODE_DEEP[t] < (NODE_AMT[t] || 0)) out.push(`地形${t}：深层 ${NODE_DEEP[t]} 比地表 ${NODE_AMT[t]} 还少（深层更富是有意的设计）`);
        if (nodeStart(t, false) !== (NODE_AMT[t] || 0)) out.push(`nodeStart(${t},false)=${nodeStart(t, false)} ≠ 地表量 ${NODE_AMT[t] || 0}`);
        if (nodeFallback(t) <= 0) out.push(`nodeFallback(${t})=${nodeFallback(t)}（懒初始化会填 0 → 采不完）`);
      }
      // 锁住一个容易顺手改坏的行为：岩壁**生成期不做初值**
      // （一旦写上限值，工人就会把地表岩壁当成可采目标 —— 见 tasks 注释）
      if (nodeStart(T.ROCK, false) !== 0) out.push(`岩壁生成期被给了初值 ${nodeStart(T.ROCK, false)}：工人会开始挖岩壁（行为改变）`);
      if (nodeStart(T.ROCK, true) !== 0) out.push('深层岩壁生成期被给了初值');
      if (nodeFallback(T.ROCK) !== ROCK_START) out.push(`岩壁懒初始化值 ${nodeFallback(T.ROCK)} ≠ ROCK_START ${ROCK_START}`);
      for (const t in NODE_DEEP) if (!(nodeStart(+t, true) > 0)) out.push(`NODE_DEEP 里的地形 ${t} 取不到深层初值`);
      return out.length ? bad('data.nodeamt', '节点量表自身不自洽', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // 建筑热键：B14 的**回归守卫** —— 数字键走「快捷栏槽位」，BUILD 里不该再有 key
  // （曾经有一份 key: Digit1/灯柱… 但没有任何代码读，属于会误导人的死数据；
  //   若将来真的要恢复「全局数字键」，请同时改 main.js 的 selectHot 与 keymap 的 hotbar）
  {
    id: 'data.hotkey',
    run() {
      const out = [];
      for (const k in BUILD) {
        const b = BUILD[k] || {};
        if (b.key) out.push(`建筑 ${k} 又有 key="${b.key}" 了（没人读；数字键请走 keymap 的 hotbar）`);
      }
      return out.length ? bad('data.hotkey', `${out.length} 座建筑带了没用的快捷键字段`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // 层表自洽：ORDER ↔ NAMES ↔ META；深层必须有法则文本
  {
    id: 'data.layer',
    run() {
      const out = [];
      for (const k of LAYER_ORDER) {
        if (!LAYER_NAMES[k]) out.push(`LAYER_ORDER 里的 "${k}" 没有层名`);
        if (k !== 'surface' && !LAYER_META[k]) out.push(`深层 "${k}" 缺 LAYER_META（法则不生效）`);
      }
      for (const k in LAYER_NAMES) if (!LAYER_ORDER.includes(k)) out.push(`层名 "${k}" 不在 LAYER_ORDER（切层时找不到）`);
      for (const k in LAYER_META) {
        if (!LAYER_ORDER.includes(k)) out.push(`LAYER_META."${k}" 不在 LAYER_ORDER`);
        const m = LAYER_META[k] || {};
        if (!(m.w > 0) || !(m.h > 0)) out.push(`层 ${k} 尺寸非法 ${m.w}x${m.h}`);
        if (m.ruleText == null) out.push(`层 ${k} 缺 ruleText（进层提示会空着）`);
      }
      return out.length ? bad('data.layer', `${out.length} 处层表问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // 学派 ↔ 研究：每个研究归属的学派必须存在，且学派下不能空
  // 注：SECTS 是**数组**（id/name/hint），不是字典 —— 第一版写错成字典，28 条全是误报
  {
    id: 'data.sect',
    run() {
      const out = [];
      const ids = SECTS.map((s) => s.id);
      const used = {};
      for (const id in RESEARCH) {
        const r = RESEARCH[id] || {};
        if (!r.sect) { out.push(`研究 ${id} 没归学派`); continue; }
        if (!ids.includes(r.sect)) out.push(`研究 ${id} 的学派 "${r.sect}" 不在 SECTS`);
        used[r.sect] = (used[r.sect] || 0) + 1;
      }
      for (const s of SECTS) {
        if (!s.id) { out.push('有学派缺 id'); continue; }
        if (!s.name) out.push(`学派 "${s.id}" 缺 name`);
        if (s.hint == null) out.push(`学派 "${s.id}" 缺 hint（面板说明会空着）`);
        if (!used[s.id]) out.push(`学派 "${s.id}" 下一个研究都没有（面板里是空标签）`);
      }
      if (new Set(ids).size !== ids.length) out.push('学派 id 有重复');
      return out.length ? bad('data.sect', `${out.length} 处学派问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'data.misc',
    run() {
      const out = [];
      // 火种表
      const fuelKeys = Object.keys(FUELS);
      for (const k of FUEL_ORDER) if (!FUELS[k]) out.push(`FUEL_ORDER 里的 "${k}" 不在 FUELS`);
      for (const k of fuelKeys) if (!FUEL_ORDER.includes(k)) out.push(`火种 "${k}" 没进 FUEL_ORDER（选火种的 UI 里看不到）`);
      for (const k of fuelKeys) {
        if (!(FUELS[k].burnSec > 0)) out.push(`FUELS.${k}.burnSec=${FUELS[k].burnSec}`);
        if (!(FUELS[k].heat > 0)) out.push(`FUELS.${k}.heat=${FUELS[k].heat}`);
      }
      // 音效表基本字段
      for (const k in SFX_DEFS) {
        const d = SFX_DEFS[k] || {};
        if (!(d.vol > 0)) out.push(`SFX_DEFS.${k}.vol=${d.vol}`);
        if (d.dedupe == null) out.push(`SFX_DEFS.${k} 缺 dedupe（会连喷）`);
      }
      // 容量常量
      if (!(CAMP_CAP > 0) || !(PACK_CAP > 0) || !(STORE_CAP > 0)) out.push('容器容量常量不合法');
      // 工具：产出/名称对齐
      for (const k of TOOL_ORDER) if (!TOOLS[k]) out.push(`TOOL_ORDER 里的 "${k}" 不在 TOOLS`);
      for (const k in TOOLS) if (!TOOL_ORDER.includes(k)) out.push(`工具 "${k}" 没进 TOOL_ORDER（容器面板里排不出来）`);
      // 难度表：开局物资 key 合法
      for (const k of DIFF_ORDER) {
        const d = DIFFICULTY[k];
        if (!d) { out.push(`DIFFICULTY.${k} 不存在`); continue; }
        for (const r in (d.start || {})) if (!RES_NAME[r]) out.push(`难度 ${k}.start 引用未知资源 "${r}"`);
        if (!(d.startWorkers >= 0)) out.push(`难度 ${k}.startWorkers=${d.startWorkers}`);
      }
      // 敌人表：必备字段
      for (const k in ENEMIES) {
        const e = ENEMIES[k];
        if (!(e.hp > 0)) out.push(`ENEMIES.${k}.hp=${e.hp}`);
        if (!(e.speed > 0)) out.push(`ENEMIES.${k}.speed=${e.speed}`);
        if (!(e.hitR > 0)) out.push(`ENEMIES.${k}.hitR=${e.hitR}`);
        if (e.dawnFade != null && !(e.dawnFade > 0 && e.dawnFade <= 1)) out.push(`ENEMIES.${k}.dawnFade=${e.dawnFade}`);
      }
      return out.length ? bad('data.misc', `${out.length} 处数据表问题`, out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'hud.forecast',
    // W14-A 第 7 步：HUD 的“威胁预告”（还剩多久 / 还剩几波）必须与刷怪器同一个式子。
    // 【为什么值得守】预告是玩家做决定（顶住 or 封灯）的依据 —— 数字错了他就是按假情报做选择。
    //   而“两处各算一套”正是这个项目最常出的 bug 家族（见 BUG_HUNT §0 的四类高发家族）。
    run() {
      const out = [];
      const dm = { waveMul: 1 };
      // ① 间隔公式：随潮位单调不增、上下界合法、随时段乘子缩放
      for (const seg of SEGMENTS) {
        let prev = Infinity;
        for (let day = 1; day <= WAVES.TIDE_MAX + 3; day++) {
          const iv = spawnInterval({ day, diff: dm }, seg, dm);
          if (!(iv > 0) || !Number.isFinite(iv)) out.push(`spawnInterval(${seg.id}, 第${day}天) = ${iv} 不合法`);
          if (iv > prev + 1e-9) out.push(`spawnInterval 随潮位变长了（${seg.id}）：第${day}天 ${iv} > 上一档 ${prev}`);
          prev = iv;
        }
        const want = Math.max(WAVES.INTERVAL_MIN, WAVES.INTERVAL_MAX - WAVES.TIDE_MAX * WAVES.INTERVAL_PER_TIDE) * seg.intervalMul;
        if (Math.abs(spawnInterval({ day: WAVES.TIDE_MAX, diff: dm }, seg, dm) - want) > 1e-9) out.push(`spawnInterval(${seg.id}) 在潮位上限处与公式对不上`);
        // 难度乘子必须真的进门（把 waveMul 拉大 → 间隔变长）
        if (!(spawnInterval({ day: 5, diff: { waveMul: 2 } }, seg, { waveMul: 2 }) > spawnInterval({ day: 5, diff: dm }, seg, dm))) {
          out.push(`spawnInterval(${seg.id}) 没有跟上难度乘子 waveMul`);
        }
      }
      // ② 时段界定连续覆盖一夜（第 4 步就守，但“还剩几波”的循环依赖它）
      if (segAtRel(-1).id !== SEGMENTS[0].id) out.push('segAtRel(负) 没回到首段');
      if (segAtRel(TIDE_SECS - 0.01).id !== SEGMENTS[SEGMENTS.length - 1].id) out.push('segAtRel(夜末) 不是最后一段');
      // ③ 参考实现（独立写一遍同一趟循环）逐点对账
      const refLeft = (s) => {
        const quiet = Math.max(0, s.noSpawnT || 0);
        let t = s.t + quiet + Math.max(0, s.spawnT || 0), n = 0;
        while (t < TIDE_END && n < 400) { n += 1; t += spawnInterval(s, segAtRel(t - TIDE_START), s.diff || dm); }
        return n;
      };
      for (const rel of [0, 0.5, 19.9, 20, 44.9, 45, TIDE_SECS - 0.5]) {
        for (const extra of [{}, { spawnT: 2.5 }, { noSpawnT: 14 }, { noSpawnT: 14, spawnT: 3 }]) {
          const s = Object.assign({ day: 5, t: TIDE_START + rel, spawnT: 0, noSpawnT: 0, diff: dm }, extra);
          const got = wavesLeft(s), want = refLeft(s);
          if (got !== want) out.push(`wavesLeft(rel=${rel}${JSON.stringify(extra)}) = ${got}，参考实现 ${want}`);
        }
      }
      // ③b 【独立语义】壶潮里、且离天亮还剩不止一个间隔 → 至少还会有 1 波。
      //     （这一条不依赖任何参考实现 —— 就是为了防"宁静期一大就报 0 波"那类错误）
      for (const extra of [{}, { noSpawnT: 14 }, { noSpawnT: 14, spawnT: 3.5 }, { spawnT: 4 }]) {
        const s = Object.assign({ day: 5, t: TIDE_START + 1, spawnT: 0, noSpawnT: 0, diff: dm }, extra);
        const span = TIDE_END - s.t - Math.max(0, s.noSpawnT || 0) - Math.max(0, s.spawnT || 0);
        const got = wavesLeft(s);
        if (span > spawnInterval(state.started ? state : s, segAtRel(0), dm) * 1.05 && !(got >= 1)) {
          out.push(`离天亮还有 ${span.toFixed(1)}s 却报 ${got} 波（${JSON.stringify(extra)}）`);
        }
      }
      // ④ 单调：时间往后走，剩余波数不得变多
      let prevN = Infinity;
      for (let rel = 0; rel <= TIDE_SECS; rel += 1) {
        const n = wavesLeft({ day: 5, t: TIDE_START + rel, spawnT: 0, noSpawnT: 0, diff: dm });
        if (n > prevN) out.push(`剩余波数随时间变多了（rel=${rel}：${n} > ${prevN}）`);
        prevN = n;
      }
      // ⑤ 窗口外必须为 null（HUD 靠它决定显示不显示）+ 整夜估值 >= 1
      for (const t of [0, DAY_END, TIDE_END, DAY_SECS - 0.1]) {
        if (wavesLeft({ day: 5, t, spawnT: 0, noSpawnT: 0, diff: dm }) !== null) out.push(`t=${t} 不在壶潮窗口，wavesLeft 应为 null`);
      }
      if (!(wavesInWindow({ day: 5, diff: dm }) >= 1)) out.push('整夜估值 < 1 波');
      // ⑥ 运行时：nightHud 必须与两个函数同源（HUD 报的数字 = 真实数字）
      if (state.started) {
        const h = nightHud(state);
        const wantLeft = isTide(state) ? wavesLeft(state) : wavesInWindow(state);
        if (h.left !== wantLeft) out.push(`nightHud().left = ${h.left}，与 wavesLeft/wavesInWindow = ${wantLeft} 不一致`);
        const wantTideLeft = Math.max(0, TIDE_END - state.t);
        if (Math.abs(h.tideLeft - wantTideLeft) > 0.11) out.push(`nightHud().tideLeft = ${h.tideLeft}，实际剩 ${wantTideLeft.toFixed(1)}`);
        if (!(h.tideLeft >= 0)) out.push(`nightHud().tideLeft = ${h.tideLeft} 不合法`);
      }
      return out.length ? bad('hud.forecast', '威胁预告与刷怪数据分家', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'retreat.rules',
    // W14-A 第 7 步：封灯撤退。
    // 【守什么】① 代价参数在合法区间 ② 每一种“不能封”都给得出一句人话（不能静默无反应）
    //   ③ 真封一次：灯油必须真的清零、时间必须真的跳到黎明、冷却必须真的记下来
    run() {
      const out = [];
      if (!(RETREAT.HOLD > 0 && RETREAT.HOLD <= 3)) out.push(`RETREAT.HOLD=${RETREAT.HOLD}（应在 (0,3]）`);
      if (!(RETREAT.MIN_SECS > 0 && RETREAT.MIN_SECS < TIDE_SECS)) out.push(`RETREAT.MIN_SECS=${RETREAT.MIN_SECS} 不在一夜之内`);
      if (!(RETREAT.COOLDOWN_DAYS >= 1)) out.push(`RETREAT.COOLDOWN_DAYS=${RETREAT.COOLDOWN_DAYS} < 1（那就没有冷却）`);
      if (!(RETREAT.MORALE > 0 && RETREAT.SANITY > 0)) out.push('封灯的士气/心志代价必须 > 0（否则它不是代价）');
      // 拒绝路径：九种理由都要有（每种都是一句可读的话，而不是 false）
      const mk = (o) => Object.assign({ started: true, layerId: 'surface', day: 5, t: TIDE_START + RETREAT.MIN_SECS + 1, lastSealDay: 0, buildings: [], workers: [], player: { x: 1, y: 1 }, floaties: [], res: {}, diff: { waveMul: 1 } }, o);
      const lampB = { type: 'lamp', x: 8, y: 8, fuel: 12, site: false };
      const cases = [
        [mk({ started: false }), '没开局'],
        [mk({ t: TIDE_START - 5 }), '不在壶潮'],
        [mk({ layerId: 'depth1' }), '不在表层'],
        [mk({ t: TIDE_START + 1 }), '还没顶过 MIN_SECS'],
        [mk({ buildings: [] }), '一盏灯都没点着'],
        [mk({ buildings: [{ type: 'lamp', x: 8, y: 8, fuel: 0, site: false }] }), '灯没油（不算点着）'],
        [mk({ buildings: [{ type: 'lamp', x: 8, y: 8, fuel: 9, site: true }] }), '灯还在工地'],
        [mk({ buildings: [{ type: 'decoy', x: 8, y: 8, fuel: 9, site: false }] }), '诱饵灯不算光源'],
        [mk({ lastSealDay: 5, day: 5, buildings: [lampB] }), '冷却中'],
      ];
      for (const [s, why] of cases) {
        const e = sealError(s);
        if (!e || typeof e !== 'string') out.push(`“${why}”没被拒绝（sealError 返回 ${JSON.stringify(e)}）`);
      }
      // 正面情形：真封一次
      const okState = mk({
        buildings: [lampB, { type: 'purifier', x: 9, y: 8, fuel: 8, site: false }],
        workers: [{ morale: 60, sanity: 80 }, { morale: 10, sanity: 5, hollow: true }], toast: null,
      });
      if (sealError(okState) !== null) out.push(`正面情形竟被拒绝：${sealError(okState)}`);
      const st0 = litLampStats(okState);
      if (st0.lamps !== 2 || st0.oil !== 20) out.push(`litLampStats 算错（${st0.lamps} 盏 / ${st0.oil} 油）`);
      if (sealNow(okState) !== true) out.push('sealNow 在正面情形下没成功');
      if (lampB.fuel !== 0 || okState.buildings[1].fuel !== 0) out.push('封灯后还有灯留着油（代价没落地）');
      if (okState.t !== DAWN_T) out.push(`封灯后 t=${okState.t}，应为黎明 ${DAWN_T}`);
      if ((okState.lastSealDay | 0) !== (okState.day | 0)) out.push('封灯没记冷却起点（lastSealDay）');
      if (okState.workers[0].morale >= 60 || okState.workers[0].sanity >= 80) out.push('封灯没有让全队士气/心志下降');
      if (okState.workers[1].morale !== 10) out.push('蚀化的人不该再被扣士气（她已经不在这套情绪里）');
      if (sealError(okState) == null) out.push('刚封完还允许再封（冷却没生效）');
      // 【反向断言】没油的 / 非光源的 / 工地 都不算“可封的灯”，否则封灯会变成零代价
      if (litLampStats({ buildings: [{ type: 'lamp', fuel: 0 }, { type: 'cache', fuel: 9 }, { type: 'lamp', fuel: 3, site: true }] }).lamps !== 0) {
        out.push('litLampStats 把没油的/非光源的/工地算成了可封的灯');
      }
      // 运行时：字段合法
      if (state.started) {
        if ((state.lastSealDay | 0) < 0 || (state.lastSealDay | 0) > (state.day | 0) + 1) out.push(`state.lastSealDay = ${state.lastSealDay} 不合法`);
        if (!(state.sealT >= 0 && state.sealT <= RETREAT.HOLD + 1e-9)) out.push(`state.sealT = ${state.sealT} 越界`);
      }
      return out.length ? bad('retreat.rules', '封灯撤退的规则与代价不一致', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'boss.phases',
    // W14-A 第 7 步：Boss 二阶段。
    // 【守什么】① 数值合法 ② 二阶段真的更快更多（不能只加个名字）
    //   ③ 运行时阶段与血量一致，且切换就发生在阈值 ±5% 内（这就是本步的判据）
    run() {
      const out = [];
      if (!(BOSS.PHASE2_AT > 0.1 && BOSS.PHASE2_AT < 0.9)) out.push(`BOSS.PHASE2_AT=${BOSS.PHASE2_AT}（应 ∈ (0.1,0.9)）`);
      if (!(BOSS.PHASE2_CD_MUL > 0 && BOSS.PHASE2_CD_MUL < 1)) out.push(`BOSS.PHASE2_CD_MUL=${BOSS.PHASE2_CD_MUL}（应 ∈ (0,1)：二阶段必须更快）`);
      if (!(BOSS.PHASE2_BATCH_ADD >= 1)) out.push(`BOSS.PHASE2_BATCH_ADD=${BOSS.PHASE2_BATCH_ADD}（应 >= 1：二阶段必须更多）`);
      for (let tier = 0; tier <= 10; tier++) {
        const cd1 = Math.max(BOSS.SUMMON_CD_MIN, BOSS.SUMMON_CD - tier * BOSS.SUMMON_TIER_STEP);
        const cd2 = cd1 * BOSS.PHASE2_CD_MUL;
        if (!(cd2 < cd1)) out.push(`第 ${tier} 轮二阶段召唔竟没变快（${cd2} >= ${cd1}）`);
        if (!(cd2 > 0.5)) out.push(`第 ${tier} 轮二阶段召唔间隔 ${cd2.toFixed(2)}s 太短（像刷屏）`);
      }
      if (!(BOSS.SUMMON_BATCH + BOSS.PHASE2_BATCH_ADD > BOSS.SUMMON_BATCH)) out.push('二阶段每批没变多');
      // 运行时：阶段与血量必须对得上（阈值 ±5%）
      const bs = state.bossRef;
      if (bs && bs.alive && bs.maxHp > 0) {
        const frac = bs.hp / bs.maxHp;
        const ph = bs.bossPhase || 1;
        if (ph !== 1 && ph !== 2) out.push(`bossPhase=${ph} 越界（只能是 1/2）`);
        else if (ph === 2 && frac > BOSS.PHASE2_AT + 0.05) out.push(`已进二阶段但血量 ${(frac * 100).toFixed(1)}% > 阈值+5%`);
        else if (ph === 1 && frac < BOSS.PHASE2_AT - 0.05) out.push(`血量 ${(frac * 100).toFixed(1)}% 已低于阈值-5%，阶段却没切`);
      }
      // 任何非 Boss 都不该被标上阶段（防“字段洒到全家”）
      for (const e of state.enemies || []) {
        if (!(e.def && e.def.boss) && e.bossPhase) out.push(`${e.ekind} 不是 Boss 却带着 bossPhase`);
      }
      return out.length ? bad('boss.phases', 'Boss 阶段化与血量对不上', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'blight.budget',
    // W14-A 第 8 步：蚀痕定档（B33）。
    // 【回放台量到的事实】定档前 7 天后 **3 级蚀痕 5907/6912 格（85%）**：你守住的那盏灯周围全烂了，
    //   而烂地又降低夜间可见/农田/建造 —— 一个不可逆的死螺旋。
    // 这一条守的就是"压力仍在、但不再是一夜全沦"这两件事同时成立。
    run() {
      const out = [];
      const B = BLIGHT;
      // ① 领地半径：不能大到“整个可视范围都算你的”（那是 85% 沦陷的直接原因），
      //    也不能小到“蚀痕根本不出现”（那就白写了一套机制）
      if (!(B.DOMAIN >= 6 && B.DOMAIN <= 18)) out.push(`BLIGHT.DOMAIN=${B.DOMAIN} 应在 [6,18]`);
      // ② 一级的时长：一整段蚀潮（60s）里最多长一级
      const tideSecs = TIDE_END - TIDE_START;
      if (!(B.BASE_SECS >= tideSecs * 0.75)) out.push(`BLIGHT.BASE_SECS=${B.BASE_SECS} 太短（一夜能长好几级）`);
      if (B.BASE_SECS > tideSecs * 3) out.push(`BLIGHT.BASE_SECS=${B.BASE_SECS} 太长（蚀痕形同不存在）`);
      // ③ 被光照回来时必须比侵蚀快（否则“抢救”永远追不上）
      if (!(B.LIT_DECAY_SECS > 0 && B.LIT_DECAY_SECS <= 240)) out.push(`BLIGHT.LIT_DECAY_SECS=${B.LIT_DECAY_SECS} 不合理`);
      if (!(B.LIGHT_SAFE > 0 && B.LIGHT_SAFE < 3)) out.push(`BLIGHT.LIGHT_SAFE=${B.LIGHT_SAFE} 不合理`);
      // ④ 运行时：蚀痕数据合法（不可能有 > BLIGHT_MAX 的格）
      //    ⚠️ 这里必须**主动确保数组存在**（ensureBlight）—— 否则新局里 map.blight 还没建，
      //    整条断言就空跑过去了（D48 那条教训：场上没那种数据 = 断言没牙齿，我自己又踩了一次）
      const m = state.map;
      if (m) {
        ensureBlight(m);
        let over = 0;
        for (let i = 0; i < m.blight.length; i++) if (m.blight[i] > BLIGHT_MAX) over += 1;
        if (over) out.push(`有 ${over} 格蚀痕等级 > ${BLIGHT_MAX}`);
        const st = blightStats(state);
        if (!(st.tiles >= 0 && st.tiles <= m.blight.length)) out.push(`blightStats().tiles=${st.tiles} 越界`);
      }
      return out.length ? bad('blight.budget', '蚀痕定档越界', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'starve.buffer',
    // W14-A 第 8 步：B18（挂机饿死）。
    // 【回放台量到的事实】“什么都不做”的一天里工人会成批死掉，而玩家看不到“什么时候开始的”。
    // 这一条守三件事：① 有缓冲（不是立即处死）② 缓冲期有提示 ③ 仍然有代价（不会白活）
    run() {
      const out = [];
      if (!(STARVE.graceSecs >= 15)) out.push(`STARVE.graceSecs=${STARVE.graceSecs} 太短（玩家来不及反应）`);
      if (!(STARVE.graceSecs <= 90)) out.push(`STARVE.graceSecs=${STARVE.graceSecs} 太长（饿了也没事 = 去掉机制）`);
      if (!(STARVE.hpPerSec > 0 && STARVE.hpPerSec < 3)) out.push(`STARVE.hpPerSec=${STARVE.hpPerSec}（应在 (0,3)：比原来温和，但仍会死）`);
      if (!(STARVE.moralePerSec > 0)) out.push('挨饿必须同时掉士气（否则它只是慢一点的掉血）');
      if (!HINTS[STARVE.hintId]) out.push(`挨饿提示键 "${STARVE.hintId}" 不在 HINTS 里（提示永远不会出现）`);
      // 运行时：不饿的时候缓冲计时必须归零（否则“攒够一次就永久扣血”）
      for (const w of state.workers || []) {
        if (w.hunger > 0 && w.starveT) out.push(`${w.name} 不饿却带着 starveT=${(w.starveT || 0).toFixed(1)}`);
        if (w.starveT > STARVE.graceSecs + 1) out.push(`${w.name} starveT=${w.starveT} 异常`);
      }
      return out.length ? bad('starve.buffer', '饥饿缓冲配置/状态不一致', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  {
    id: 'replay.sane',
    // W14-A 第 8 步：回放台自身的可信度。
    // 【为什么值得守】所有难度结论都从它出 —— 它错了，后面全错。
    //   而它最容易错的地方是“随机源”：一旦 Math.random 没被还原，整个页面会进入“魔法随机”状态。
    run() {
      const out = [];
      // ① 确定性随机源：同种子同序列、值域 [0,1)、不同种子不同序列
      const a1 = makeRng(12345), a2 = makeRng(12345), b1 = makeRng(54321);
      const s1 = [a1(), a1(), a1()], s2 = [a2(), a2(), a2()], s3 = [b1(), b1(), b1()];
      for (let i = 0; i < 3; i++) {
        if (s1[i] !== s2[i]) out.push('makeRng 同种子两次序列不一致（回放不可复现）');
        if (!(s1[i] >= 0 && s1[i] < 1)) out.push(`makeRng 值域越界：${s1[i]}`);
        if (s1[i] === s3[i]) out.push('makeRng 不同种子给出了同一个序列');
      }
      // ② 打法表：至少要有"守家"与"挂机"两条（难度曲线靠它俩对质）
      for (const k of ['home', 'idle', 'rest', 'expedition', 'panic']) if (typeof POLICIES[k] !== 'function') out.push(`POLICIES.${k} 不是函数（难度曲线少了一条腿）`);
      if (POLICIES.home === POLICIES.idle) out.push('守家与挂机是同一个策略（那就没有对照）');
      // ③ 曲线字段：齐全且都是有限数（NaN 会静静地把整条曲线变成垃圾）
      //    ⚠️ 这里不能只在 state.started 时才跑 —— 否则新局/主菜单下这条又变成空跑（D48）
      {
        // 造一个**确定是空的**世界来验字段（不能拿真 state —— 它已经有灯/塔了，那条“空世界应当全 0”的检查会自相矛盾）
        const probe = {
          day: 3, playerHp: 80, playerMaxHp: 100, kills: 5,
          res: { ore: 1, vine: 2, fuel: 3, food: 4 },
          buildings: [], workers: [], graves: [], enemies: [], map: state.map, light: state.light,
        };
        const row = curveRow(probe);
        const need = ['day', 'hp', 'maxHp', 'kills', 'ore', 'vine', 'fuel', 'food', 'lamps', 'lit', 'towers', 'workers', 'blight', 'blightL3'];
        for (const k of need) if (!Number.isFinite(row[k])) out.push(`curveRow().${k} = ${row[k]}（不是有限数）`);
        if (row.blightL3 > row.blight) out.push(`3 级蚀痕 ${row.blightL3} > 总蚀痕 ${row.blight}`);
        if (row.lamps !== 0 || row.towers !== 0 || row.lit !== 0) out.push('curveRow 把空建筑列表数成了有灯/有塔');
        if (row.hp !== 80 || row.ore !== 1 || row.kills !== 5) out.push('curveRow 没如实搬字段（血/资源/击杀）');
      }
      return out.length ? bad('replay.sane', '回放台/随机源不可信', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A32 读档往返（2026-09-13 补）——**只有** `__check({roundtrip:true})` 才会跑
  // 【为什么必须单独跑】loadFromData/restoreBuildings 的调用时机是"读档那一刻"，
  //   而 `__check()` 平时只巡检不变量，永远碰不到这些函数。2026-09-13 就因为
  //   `restoreBuildings` 里缺一句 `const m = state.map` 而读档必崩（ReferenceError），
  //   检测器 45 项全绿、实际"点继续游戏就死"。
  // 【为什么默认不跑】它会真的重建世界（rebind 层、重建地图），代价不小且有副作用，
  //   不能每帧（__watch）跑；要求显式带上 roundtrip 标志。
  {
    id: 'save.roundtrip',
    run(o) {
      if (!o || !o.roundtrip) return null;
      if (typeof window === 'undefined' || typeof window.__reload !== 'function') return null;
      const out = [];
      const snap = JSON.parse(JSON.stringify(snapshot(state)));
      const before = {
        n: (state.buildings || []).length, layer: state.layerId, w: state.map.w, h: state.map.h,
        hp: state.playerHp, hunger: state.playerHunger, injury: state.playerInjury,
        overwork: (state.workers || []).map((w) => w.overwork || 0),
        deathPack: JSON.stringify(state.deathPack || null),
      };
      try { window.__reload(snap); } catch (err) { out.push(`读档路径抛异常：${err && err.message}`); }
      const after = {
        n: (state.buildings || []).length, layer: state.layerId, w: state.map.w, h: state.map.h,
        hp: state.playerHp, hunger: state.playerHunger, injury: state.playerInjury,
        overwork: (state.workers || []).map((w) => w.overwork || 0),
        deathPack: JSON.stringify(state.deathPack || null),
      };
      if (after.n !== before.n) out.push(`读档往返后建筑数 ${after.n} ≠ ${before.n}`);
      if (after.layer !== before.layer) out.push(`读档往返后层 ${after.layer} ≠ ${before.layer}`);
      if (after.w !== before.w || after.h !== before.h) out.push(`读档往返后地图 ${after.w}×${after.h} ≠ ${before.w}×${before.h}`);
      if (after.hp !== before.hp || after.hunger !== before.hunger || after.injury !== before.injury) {
        out.push(`读档往返后玩家状态 血/饱食/伤势=${after.hp}/${after.hunger}/${after.injury} ≠ ${before.hp}/${before.hunger}/${before.injury}`);
      }
      if (after.overwork.join(',') !== before.overwork.join(',')) out.push(`读档往返后透支=${after.overwork} ≠ ${before.overwork}`);
      if (after.deathPack !== before.deathPack) out.push('读档往返后遗落包内容不一致');
      return out.length ? bad('save.roundtrip', '读档往返路径有问题（loadFromData/restoreBuildings）', out.slice(0, MAX_DETAIL)) : null;
    },
  },
  // A33 连锁光塔（2e）：链规则必须可断言，而且塔必须真能建
  // 【为什么守】链是"发射器自带"的第二个多目标机制（第一个是散射/穿透载荷）：
  //   ① 每跳必须更弱（mul<1），否则 3 跳 = ×3 白送；② 跳距不能超过射程（不然是跨屏闪电）；
  //   ③ 它**不能**走载荷的"形状"开关（那是散射/穿透专用的），否则同一发会双重命中；
  //   ④ 必须真的出现在建造面板分类里，且 locked 指向一个真实存在的研究节点（否则永远建不出来）。
  {
    id: 'chain.rules',
    run() {
      const out = [];
      const chs = towerTypes().filter((t) => BUILD[t].chain);
      if (!chs.length) out.push('没有任何塔带 chain（2e 的连锁光塔丢了？）');
      for (const t of chs) {
        const def = BUILD[t];
        const c = def.chain;
        if (!(c.jump > 0 && c.jump <= def.range)) out.push(`${t}.chain.jump=${c.jump} 不合法（应 ∈ (0, 射程 ${def.range}]）`);
        if (!(c.max >= 1 && c.max <= 4)) out.push(`${t}.chain.max=${c.max}（应 ∈ [1,4]）`);
        if (!(c.mul > 0 && c.mul < 1)) out.push(`${t}.chain.mul=${c.mul}（应 ∈ (0,1)：跳一次必须更弱）`);
        if (def.air) out.push(`${t} 既连锁又对空（连锁是对地群伤，先把设计定下来再加对空）`);
        if (!CATEGORY_OF[t]) out.push(`${t} 没出现在建造面板分类里（建不出来）`);
        if (def.locked && !RESEARCH[def.locked]) out.push(`${t}.locked=${def.locked} 不是研究节点（永远解不开）`);
        const ps = payloadStats(def, []);
        if (!ps.链) out.push(`payloadStats 没给出 ${t} 的链信息（面板/悬停都看不到）`);
        else {
          if (ps.链.最多 !== c.max) out.push(`${t} 链最多 ${ps.链.最多} ≠ ${c.max}`);
          const want = 1 + c.mul + c.mul * c.mul + c.mul * c.mul * c.mul;
          if (!(Math.abs(ps.链.倍率 - want) < 1e-6)) out.push(`${t} 链倍率 ${ps.链.倍率} 与公式 ${want.toFixed(3)} 不符`);
        }
        if (ps.形状) out.push(`${t} 空载就有形状（${ps.形状}）：连锁不该走载荷的形状开关（会双重命中）`);
        if (!(ps.多靶每秒 > ps.每秒)) out.push(`${t} 带链后多靶每秒并不高于单靶`);
        if (ps.单发 !== def.dmg) out.push(`${t} 0 槽单发被链改了（${ps.单发} ≠ ${def.dmg}）`);
      }
      // 反向：没有 chain 的塔，payloadStats 不许凭空给出链（否则面板会写错）
      for (const t of towerTypes()) if (!BUILD[t].chain && payloadStats(BUILD[t], []).链) out.push(`${t} 没有 chain 却报出了链`);
      // 「形状」开关只跟着 scatter/pierce 走（2e 改过开火逻辑，这条守回归）
      for (const id of MOD_ORDER) {
        if (!MODS[id].shape) continue;
        if (!payloadStats(BUILD[towerTypes()[0]], [id]).形状) out.push(`装了 ${id} 却没报形状（开火逻辑不会再找多目标）`);
      }
      if (payloadStats(BUILD[towerTypes()[0]], []).形状) out.push('空载竟然报了形状');
      return out.length ? bad('chain.rules', '连锁/形状规则不对', out.slice(0, MAX_DETAIL)) : null;
    },
  },
];

// =====================================================================
// 运行器
// =====================================================================
const ALL_CHECKS = DATA_CHECKS.concat(RUNTIME_CHECKS);
let baseline = new Set();          // 已知问题（id#msg 前缀）
let watchOn = false, watchEvery = 30, watchTick = 0;
const log = new Map();             // id → { n, first:{msg,data}, last }
let only = null;

function keyOf(f) { return f.id + '|' + f.msg; }

export function runChecks(opts) {
  const o = opts || {};
  const t0 = performance.now();
  const fails = [];
  let ran = 0;
  for (const c of ALL_CHECKS) {
    if (only && !only.includes(c.id)) continue;
    ran++;
    let r = null;
    try { r = c.run(o); } catch (err) {
      r = bad('check.error', `检查项 ${c.id} 自己抛异常：${err && err.message}`, [String(err && err.stack || '').split('\n')[1] || '']);
    }
    if (r) fails.push(r);
  }
  const known = fails.filter((f) => baseline.has(keyOf(f)));
  const fresh = fails.filter((f) => !baseline.has(keyOf(f)));
  return {
    ok: (o.includeKnown ? fails : fresh).length === 0,
    ran, ms: Math.round((performance.now() - t0) * 100) / 100,
    fails: o.includeKnown ? fails : fresh,
    knownCount: known.length,
    baselineSize: baseline.size,
  };
}

// 每帧钩子（由 main.js 在 simStep 里调用）：关闭时只有一次 if
export function selfTestTick() {
  if (!watchOn) return;
  watchTick += 1;
  if (watchTick < watchEvery) return;
  watchTick = 0;
  const r = runChecks();
  for (const f of r.fails) {
    const k = keyOf(f);
    const rec = log.get(k);
    if (rec) { rec.n += 1; rec.last = { day: state.day, t: Math.round(state.t), data: f.data }; }
    else log.set(k, { n: 1, id: f.id, msg: f.msg, first: { day: state.day, t: Math.round(state.t), data: f.data } });
  }
}

// =====================================================================
// C. 源码级静态审计（异步：fetch 源文件文本 → 正则扫描）
//    为什么值得做：有一整类 bug 只会以「运行时才炸 / 静默失效」的形式出现，
//    眼睛看代码看不出来，但源码文本里能扫出来：
//      · 用了别的模块的导出却忘了 import  → ReferenceError（本会话真炸过一次）
//      · sfx('拼错的键')                  → 静默无声（B04 那类）
//      · sprite('拼错的键')               → 永远没图，且不报错
//      · maybeHint 的键不在 HINTS 里      → 提示永远不出现
//    不进 __watch（要联网 + 文本解析，不适合每帧跑），用 __srcCheck() 触发。
// =====================================================================
function push(map, k, v) { (map[k] = map[k] || []).push(v); }

// 逐行剥掉 import/export-from 语句（支持多行），返回 { code, imp }：
//   code = 去掉导入后的源码；imp = 导入语句原文（用来解析导入了哪些名字）
// 早先版本用「按行过滤」被证明会误伤正文（正文里恰好长得像单独标识符的行会被删掉），
// 所以这里改成状态机：只有真的 import 语句段才丢。
function splitImports(src) {
  const lines = src.split('\n');
  const keep = [], imp = [];
  let inImp = false;
  for (const L of lines) {
    if (!inImp && /^\s*import\b/.test(L)) {
      imp.push(L);
      const oneLine = /\bfrom\s*['"]/.test(L) || /^\s*import\s*['"][^'"]*['"];?\s*$/.test(L);
      inImp = !oneLine;
      continue;
    }
    if (!inImp && /^\s*export\s*(?:\*|\{[^}]*\})\s*from\b/.test(L)) { imp.push(L); continue; }
    if (inImp) { imp.push(L); if (/\bfrom\s*['"]/.test(L)) inImp = false; continue; }
    keep.push(L);
  }
  return { code: keep.join('\n'), imp: imp.join('\n') };
}

// 去掉注释：只删「整行注释」与「空格 // 空格」式尾注释。
// 为什么这么保守：第一版用 /\/\*[\s\S]*?\*\// 全删，结果因为字符串/正则里出现了 /* ，
// 把 keymap.js 吃掉了 47% 的正文（连 export function boundCode 都没了）→ 一堆假「未使用」。
// 教训：检测器自己的正则也要先验证过再信。
function stripNoise(code) {
  return code
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\r?$/gm, ' ')     // 整行块注释
    .replace(/^[ \t]*\/\/[^\n]*/gm, ' ')                        // 整行行注释
    .replace(/(?<!:)\s\/\/ [^\n]*/g, ' ');                      // 「代码 // 说明」尾注释
}

// 这个名字在文件里「被绑定过」吗？（参数/局部变量/属性名都算，避免把同名参数误判成跨模块引用）
function isBound(code, n) {
  const pats = [
    new RegExp('(?<![.\\w$])(?:const|let|var|function|class)\\s+' + n + '\\b'),
    new RegExp('[(,]\\s*' + n + '\\s*[,)=]'),                 // 普通参数
    new RegExp('[(,]\\s*' + n + '\\s*=>'),                    // 箭头参数
    new RegExp('\\{\\s*' + n + '\\b'),                        // 解构
    new RegExp('(?<![.\\w$])' + n + '\\s*:'),                 // 对象键 / 类型字段
    new RegExp('for\\s*\\(\\s*(?:const|let|var)?\\s*' + n + '\\b'),
    new RegExp('catch\\s*\\(\\s*' + n + '\\b'),
    new RegExp('\\.\\s*' + n + '\\b'),                        // 属性访问
  ];
  return pats.some((re) => re.test(code));
}

export async function srcCheck(opts) {
  const o = opts || {};
  const files = o.files || SRC_FILES;
  const texts = {};
  await Promise.all(files.map(async (f) => {
    try {
      const r = await fetch('/' + f, { cache: 'no-store' });
      texts[f] = r.ok ? await r.text() : null;
    } catch (e) { texts[f] = null; }
  }));

  // —— ① 汇总所有「导出名 → 哪些文件导出」——
  const exportedBy = {};
  for (const f in texts) {
    const src = texts[f];
    if (!src) continue;
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) push(exportedBy, m[1], f);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) push(exportedBy, name, f);
      }
    }
  }

  const fails = [];
  globalThis.__srcHintUsed = new Set();
  for (const f in texts) {
    const raw = texts[f];
    if (!raw) { fails.push(bad('src.fetch', `${f} 抓不到源码（filelist 过期？）`, null)); continue; }
    const { code: codeRaw, imp } = splitImports(raw);
    const code = stripNoise(codeRaw);          // 去注释后的正文：用于「有没有用到」与扫字面量键

    // 本文件绑定的名字（含 import 进来的）
    const local = new Set();
    for (const m of code.matchAll(/(?<![.\w$])(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    const imported = new Set();
    for (const m of imp.matchAll(/\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (n && /^[A-Za-z_$][\w$]*$/.test(n)) imported.add(n);
      }
    }

    // ② 调用/访问了别的模块的导出，却没 import（会 ReferenceError）
    //    只认「N(」或「N.」这种自由标识符用法，并且排除参数/属性/对象键
    //    另：本文件自己导出的名字不参与判定（自己导出自己用是正常的）
    const missing = [];
    for (const name in exportedBy) {
      if (local.has(name) || imported.has(name)) continue;
      if (exportedBy[name].includes(f)) continue;
      if (/^[A-Z]$/.test(name)) continue;
      const re = new RegExp('(?<![.\\w$])' + name + '\\s*[.(]');
      if (!re.test(code)) continue;
      if (isBound(code, name)) continue;
      missing.push(`${name}（${exportedBy[name][0]} 导出）`);
    }
    if (missing.length) fails.push(bad('src.missingImport', `${f}：用了别人导出的东西却没 import`, missing.slice(0, 8)));

    // ③ import 了却没用到（死引用：改代码时漏删，也会掩盖真问题）
    const unused = [];
    for (const n of imported) {
      if (local.has(n)) continue;
      if (new RegExp('(?<![.\\w$])' + n + '\\b').test(code)) continue;
      unused.push(n);
    }
    if (unused.length) fails.push(bad('src.unusedImport', `${f}：import 了但没用到`, unused));

    // ④⑤⑥ 扫「字面量键」：注释已剔除；dev/ 下的工具自己不参与（扫描器自己的正则不该被当资产）
    const isDevTool = /^js\/dev\//.test(f);
    const plain = stripNoise(raw);
    const badSfx = new Set();
    if (!isDevTool) for (const m of plain.matchAll(/\bsfx\(\s*['"]([A-Za-z0-9_]+)['"]/g)) if (!SFX_DEFS[m[1]]) badSfx.add(m[1]);
    if (badSfx.size) fails.push(bad('src.sfxKey', `${f}：sfx 键不在 SFX_DEFS（静默无声）`, Array.from(badSfx)));

    // ⑤ sprite 字面量必须在精灵表里（否则永远没图，且不报错）
    const spriteKeys = new Set(SPRITES.map((s) => s.key));
    const badSpr = new Set();
    if (!isDevTool) for (const m of plain.matchAll(/\bsprite\(\s*['"]([A-Za-z0-9_]+)['"]/g)) if (!spriteKeys.has(m[1])) badSpr.add(m[1]);
    if (badSpr.size) fails.push(bad('src.spriteKey', `${f}：sprite 键不在 SPRITES`, Array.from(badSpr)));

    // ⑥ 首次提示的键必须在 HINTS 里（否则提示永不出现）
    const badHint = new Set();
    for (const m of code.matchAll(/\b(?:maybeHint|firstTime)\(\s*[\w.]+\s*,\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      globalThis.__srcHintUsed.add(m[1]);
      if (!HINTS[m[1]]) badHint.add(m[1]);
    }
    for (const m of code.matchAll(/\bHINTS\.([A-Za-z0-9_]+)/g)) {
      globalThis.__srcHintUsed.add(m[1]);
      if (!HINTS[m[1]]) badHint.add(m[1]);
    }
    if (badHint.size) fails.push(bad('src.hintKey', `${f}：提示键不在 HINTS`, Array.from(badHint)));

    // ⑦ 调试句柄清单（不是错误，是给文档用：window 上挂了哪些口子）
    const handles = new Set();
    for (const m of raw.matchAll(/\bwindow\.(__[a-zA-Z]\w*)/g)) handles.add(m[1]);
    if (handles.size) (globalThis.__srcHandles = globalThis.__srcHandles || new Map()).set(f, Array.from(handles).sort());
  }

  // ⑧ HINTS 里没人调用的键 = 死提示（写了但永远不会出现）
  const dead = Object.keys(HINTS).filter((k) => !globalThis.__srcHintUsed.has(k));
  if (dead.length) fails.push(bad('src.deadHint', 'HINTS 里有提示没人调用（永远不出现）', dead));

  const hm = globalThis.__srcHandles || new Map();
  return {
    ok: fails.length === 0,
    files: files.length,
    fails,
    handles: Array.from(hm.entries()).map(([f, h]) => `${f}: ${h.join(' ')}`),
    handleFiles: hm.size,
  };
}

export function installSelfTest() {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w) return;
  w.__check = (o) => runChecks(o || {});
  w.__listCheck = () => ALL_CHECKS.map((c) => c.id);
  w.__only = (...ids) => { only = ids.length ? ids : null; return only; };
  w.__baseline = () => {
    const r = runChecks({ includeKnown: true });
    baseline = new Set(r.fails.map(keyOf));
    return { recorded: baseline.size, fails: r.fails.length };
  };
  w.__baselineClear = () => { baseline = new Set(); return 0; };
  w.__watch = (on, every) => {
    watchOn = on === undefined ? true : !!on;
    if (every) watchEvery = Math.max(1, every | 0);
    watchTick = 0;
    return { watchOn, watchEvery };
  };
  w.__testLog = () => Array.from(log.values()).map((r) => `${r.id}: ${r.msg} ×${r.n}（首次 第${r.first.day}天 ${r.first.t}s）`).concat([`共 ${log.size} 类`]);
  w.__testLogRaw = () => Array.from(log.values());
  w.__testReset = () => { log.clear(); watchTick = 0; return 0; };
  w.__srcCheck = (o) => srcCheck(o || {});          // 源码级静态审计（异步，第 1 步用）
  return true;
}
