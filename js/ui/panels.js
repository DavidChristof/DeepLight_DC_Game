// ui/panels.js —— 按键面板注册表（集成式 UI）
// 新增一个面板只需在 PANELS 里加一项：{ id, key, label, render(state) }
// 打开状态由本模块统一管理，互斥显示；面板点击由 panelClick 统一分发。
import { BUILD, canAfford, CATEGORIES, workOf, TOWER_LV, TOWER_LV_MAX, towerHp, upgradeCostFor } from '../data/buildings.js';
import { RESEARCH, RESEARCH_ORDER, SECTS } from '../data/research.js';
import { CODEX, weakTextOf } from '../data/codex.js';
import { hasTech, researchError, unlockTech, costOf, sectOpen, knowSeenId, nearAnalyzer, branchMulOf, slotsOf } from '../systems/research.js';
import { relicRows } from '../systems/relics.js';
import { RELIC_SERIES } from '../data/relics.js';
import { lockedByResearch, upgradeError, upgradeBuilding, costTextOf } from '../systems/building.js';
import { ORDERS, PATROL } from '../data/nightops.js';
import { RECRUIT_COST, RECRUIT_MAX } from '../data/traits.js';
import { RES_ORDER, RES_NAME, RES_COLOR, STORE_ORDER, TOOL_ORDER } from '../data/storage.js';
import { icon, resIcon, buildIcon } from './icons.js';
import { hasAsset, specOf } from '../core/assets.js';
import { CODEX_ART } from '../data/sprites.js';
import { RECIPE_OF, TOOLS, recipesOf, recipeName } from '../data/tools.js';
import { MODS, MOD_ORDER, MAX_SLOTS, SLOT_TECHS, FUEL_PER_MOD, payloadStats, loadError } from '../data/payload.js';
import { restBeds, restCount } from '../systems/survival.js';
import { SURVIVAL } from '../data/survival.js';
import { beamNeighbor } from '../systems/towers.js';   // “接上光路没”——与开火用的是同一个判定（第 6 步）
import { TYPE_NAME } from '../data/combat.js';
import { allContainers, packContainer, usedOf, transfer, dropPack } from '../systems/storage.js';
import { craftError, startCraft, setRecipe, workOnce, addFire, setFireMat, fireOn, recipeForStation } from '../systems/craft.js';
import { FUELS, FUEL_ORDER, fuelDef, fireMatOf, heatOf } from '../data/fire.js';
import { smeltSecs } from '../systems/smelt.js';
import { equipTool, unequipTool, heldTool } from '../systems/tools.js';
import { isTide, isDawn, phaseIndexOf } from '../core/time.js';
import { sfx } from '../core/audio.js';
import { keyLabel, boundCode } from '../data/keymap.js';
import { COLONISTS, crewCardOf, assignRole, recordCrewEvent } from '../data/colonists.js';
import { allCrewWorkers, findCrewWorker, setDirective } from '../systems/taskBoard.js';

let selectBuild = () => { };
let toggleHotbar = () => { };
let toggleDemolish = () => { };
let doRecruit = () => { };
export function setupPanelUI(handlers) {
  if (!handlers) return;
  if (handlers.onSelectBuild) selectBuild = handlers.onSelectBuild;
  if (handlers.onToggleHotbar) toggleHotbar = handlers.onToggleHotbar;
  if (handlers.onToggleDemolish) toggleDemolish = handlers.onToggleDemolish;
  if (handlers.onRecruit) doRecruit = handlers.onRecruit;
}

let activeId = null;
export function activePanelId() { return activeId; }

// —— 面板内搜索/筛选（W13-L）——
// 【为什么不是“筛选后重新渲染”】面板重建会 innerHTML 整段抹掉：输入框会失焦、
//   正在拖的滚动条会被取消、滚动位置要手动恢复 —— 而筛选是“每敲一个字就跑一次”的动作。
//   所以这里只做**可见性切换**（.fil-off → display:none），一个 DOM 节点都不新建。
//   重建只发生在结构变化（切面板/解锁/分类），重建后由 renderPanelHost 重新跑一次本套规则。
const PANEL_FILTER = {
  build: '搜索建筑…（名称 / 作用）',
  research: '搜索研究…（名称 / 作用）',
  codex: '搜索图鉴…（名称 / 弱点）',
  store: '搜索物品…（名称）',
  pack: '搜索背包物品…（名称）',
};
const panelQuery = { build: '', research: '', codex: '', store: '' };
export function setPanelQuery(id, q) { if (id in panelQuery) panelQuery[id] = String(q == null ? '' : q); }
const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hayOf = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();
function filterBar(id) {
  const q = panelQuery[id] || '';
  return `<div class="pfilter">
    <input class="pfin" data-filter="${id}" type="text" spellcheck="false" autocomplete="off"
      placeholder="${escAttr(PANEL_FILTER[id])}" value="${escAttr(q)}">
    <span class="pfx${q ? '' : ' hidden'}" data-act="fil-clear" data-filter="${id}" title="清空筛选">✕</span>
  </div>
  <div class="pfil-none hidden" data-fil-none>没有匹配的条目 · 换个词试试</div>`;
}
export function hasPanelFilter() { return !!PANEL_FILTER[activeId]; }

// 研究面板是分区的：当前分区里搜不到时，把其它分区里的命中列出来（点一下就切过去）
function researchOtherHits(state, q, cur) {
  const out = [];
  for (const id of RESEARCH_ORDER) {
    const r = RESEARCH[id];
    if (!r || r.sect === cur) continue;
    if (!sectOpen(state, r.sect)) continue;                              // 没揭开的分区不剧透
    const known = r.sect === 'know' ? (hasTech(state, id) || knowSeenId(state, id)) : true;
    if (!known) continue;
    if (hayOf(r.name, r.desc).indexOf(q) < 0) continue;
    const s = SECTS.find((x) => x.id === r.sect);
    out.push(`<span class="rchip sm" data-sect="${r.sect}">${r.name}<em>${s ? s.name : ''}${hasTech(state, id) ? ' · 已完成' : ''}</em></span>`);
  }
  if (!out.length) return '';
  return `<div class="pfil-hits">其它分区命中 ${out.length} 条：<span class="pfil-hitrow">${out.join('')}</span></div>`;
}

// 把当前查询应用到面板：只切 class，不碰结构
export function applyPanelFilter(hostEl, state) {
  if (!hostEl || !PANEL_FILTER[activeId]) return;
  const q = (panelQuery[activeId] || '').trim().toLowerCase();
  let shown = 0;
  for (const r of hostEl.querySelectorAll('[data-hay]')) {
    const hit = !q || r.getAttribute('data-hay').indexOf(q) >= 0;
    r.classList.toggle('fil-off', !hit);
    if (hit) shown += 1;
  }
  // 分组标题：整组都被筛掉就一起藏
  for (const g of hostEl.querySelectorAll('[data-filg]')) {
    let any = false;
    for (const r of g.querySelectorAll('[data-hay]')) if (!r.classList.contains('fil-off')) { any = true; break; }
    g.classList.toggle('fil-off', !any);
  }
  const none = hostEl.querySelector('[data-fil-none]');
  if (none) none.classList.toggle('hidden', !q || shown > 0);
  const x = hostEl.querySelector('.pfx');
  if (x) x.classList.toggle('hidden', !q);
  const hits = hostEl.querySelector('[data-fil-hits]');
  if (hits) hits.innerHTML = (activeId === 'research' && q) ? researchOtherHits(state, q, state.resSect || 'founder') : '';
  if (hits) hits.classList.toggle('hidden', !hits.innerHTML);
}
export function clearPanelQuery(id, hostEl) {
  setPanelQuery(id, '');
  if (hostEl) {
    const inp = hostEl.querySelector(`.pfin[data-filter="${id}"]`);
    if (inp) inp.value = '';
  }
}

// 新开一局/读档时清至干净：查询词是会话级的，但**不能跨局残留**
// （B25：上一局搜过“光”，开新局打开建造面板时列表还是被筛过的 → 看起来“建筑没了”）
export function resetPanelQueries() {
  for (const k in panelQuery) panelQuery[k] = '';
}
// 给开发期检测器看的快照（断言“刚开局不该带着旧搜索词”）
export function panelQuerySnapshot() { return Object.assign({}, panelQuery); }

const COST_CLASS = { ore: 'r-ore', vine: 'r-vine', fuel: 'r-fuel', data: 'r-data', core: 'r-core', food: 'r-food', night: 'r-night', stone: 'r-stone', coal: 'r-coal' };
const COST_NAME = { ore: '辉髓', vine: '藤木', fuel: '燃料', data: '档案', core: '母髓', food: '食物', night: '夜髓', stone: '石头', coal: '木炭' };
const BUILD_DESC = {
  lamp: '照亮周围，是夜间的第一道防线（蚀兽优先啃灯）。R 键可调亮度档',
  wall: '阻挡地面蚀兽（夜枭可越墙）',
  stoneWall: '厚重石墙 · 更高耐久 · 阻挡地面蚀兽并挡光',
  gate: '栅门 · 默认开启，旁边按 E 切换开关 · 关闭时阻挡蚀兽',
  barricade: '路障 · 可通行但让地面蚀兽减速 45% · 夜枭不受影响',
  furnace: '炼油：辉髓 → 燃料（按住 E 手做最快；燃料低了拓荒队会自己来炼）',
  towerGlow: '单体高伤 · 可对空 · 需光照',
  towerShock: '范围伤害 + 减速 · 仅对地 · 需光照',
  towerChain: '光弧连锁：命中后跳 2 格内下一个目标 · 最多 3 跳、每跳 ×0.6 · 仅对地 · 需光照',
  farm: '作物地（可走）· 需光照 ≥2.5 生长 · 成熟得食物',
  mycobed: '菌床（可走）· 半暗光照 0.8–2.4 生长 · 成熟得藤木 · 每图最多 4 床',
  bunk: '简易铺位 · 夜里休整恢复生命与心志 · 1 个休整位',
  clinic: '医疗站 · 治疗恢复期伤势 · 1 个治疗位 · 需研究「蚀抗体质」',
  shaft: '井口（可站上去）· 通往更深一层',
  purifier: '净化周围蚀痕（每 8 秒 −1 级）· 燃耗约为灯柱的 2.5 倍',
  cache: '只能建在深渊 · 存 60 燃料，每 4 秒给 6 格内最缺油的灯加 1（噬光虫会来啃）',
  prism: '光路中继（不耗燃料）· 两块镜子最多隔 5 格（余烬层 3 格）· 极脆，碎了下游全灭',
  decoy: '只吸仇恨 · 不发光、不照亮、不压蚀痕（拿时间和燃料换命）',
  store: '容器 · 采到的材料自动进最近的（本层装满会丢）· 旁边按 E 存取',
  bench: '制造台 · 石头 + 藤木 → 工具（需研究「石工」）',
};

function costText(cost, full) {
  let s = '';
  // 用资源图标 + 数字（比“辉2藤2”好认：不用先背下缩写）；full=长名留给 title 属性
  for (const k in cost) s += `<em class="${COST_CLASS[k] || ''}">${full ? COST_NAME[k] : resIcon(k, 11)}${cost[k]}</em>`;
  return s;
}

// —— 面板内容渲染 ——
function catChips(state) {
  const cur = state.buildCat || CATEGORIES[0].id;
  return `<div class="bcats">${CATEGORIES.map((c) => `<span class="bcat ${c.id === cur ? 'on' : ''}" data-cat="${c.id}">${c.name}</span>`).join('')}</div>`;
}
function renderBuild(state) {
  const cats = CATEGORIES;
  const cur = cats.find((c) => c.id === (state.buildCat || cats[0].id)) || cats[0];
  const sites = (state.buildings || []).filter((b) => b.site).length;
  let html = '<div class="psec">建造 · 放下是【工地】，需施工完成</div>';
  html += catChips(state);
  html += `<div class="bnote">${cur.note} · 数字键 1~9 = 本类第 N 项</div>`;
  const list = cur.types;
  for (const type of list) {
    const d = BUILD[type];
    if (!d) continue;
    const locked = lockedByResearch(state, type);
    const ok = !locked && canAfford(state.res, type);
    const cls = ['brow', ok ? 'ready' : 'poor', state.building === type ? 'active' : ''].join(' ');
    const idx = list.indexOf(type);
    const keyTxt = idx < 9 ? String(idx + 1) : idx === 9 ? '0' : '−';
    const st = locked ? { ico: 'lock', txt: '未解锁' } : ok ? { ico: 'ok', txt: '可建造' } : { ico: 'no', txt: '资源不足' };
    html += `<div class="${cls}" data-type="${type}" data-hay="${escAttr(hayOf(d.name, BUILD_DESC[type], cur.name))}"
        title="${d.name} · 花费 ${costText(d.cost, true).replace(/<[^>]+>/g, ' ')} · 工期 ${workOf(type)} 工">
      <span class="bkey">${keyTxt}</span>
      <span class="bicon">${buildIcon(type)}</span>
      <span class="bname">${d.name}</span>
      <span class="bcost">${costText(d.cost)}</span>
      <span class="bstate" data-live="state">${icon(st.ico, 12)} ${st.txt}</span>
      <span class="bdesc">${BUILD_DESC[type] || ''}<em class="bwork">工期 ${workOf(type)} 工</em></span>
    </div>`;
  }
  if (sites) html += `<div class="bnote warn" data-live="sites">工地上还有 ${sites} 处待建：站过去按 E 自己盖，或等拓荒队白天来盖</div>`;
  else html += '<div class="bnote warn hidden" data-live="sites"></div>';
  html += `<div class="psec">工具</div>`;
  const dcls = ['brow', state.demolish ? 'active' : 'ready'].join(' ');
  html += `<div class="${dcls}" data-tool="demolish" data-hay="${escAttr(hayOf('拆除模式 拆除 拆掉 返还材料 工具'))}" title="点选后左键点掉建筑，返还一半材料（燃料不返还）">
    <span class="bkey">X</span><span class="bicon">${icon('hammer')}</span><span class="bname">拆除模式</span><span class="bstate">${icon(state.demolish ? 'ok' : 'lockOpen', 12)} ${state.demolish ? '已开启' : '可开启'}</span>
    <span class="bdesc">左键点掉自己盖的建筑，返还一半材料（自建可拆，拆不了营地灯）</span>
  </div>`;
  const rc = RECRUIT_COST;
  const ws = (state.workers || []).length;
  const full = ws >= RECRUIT_MAX;
  const afford = !full && Object.keys(rc).every((k) => (state.res[k] || 0) >= rc[k]);
  const rcls = ['brow', afford ? 'ready' : 'poor'].join(' ');
  html += `<div class="${rcls}" data-tool="recruit" data-hay="${escAttr(hayOf('引路篝火 招募 招人 新拓荒者 工具'))}" title="点燃引路篝火：消耗 ${costText(rc, true).replace(/<[^>]+>/g, ' ')} 换一位新拓荒者（随机专长，上限 ${RECRUIT_MAX} 人）">
    <span class="bkey">＋</span><span class="bicon">${icon('fire')}</span><span class="bname">引路篝火</span><span class="bcost">${costText(rc)}</span>
    <span class="bstate" data-live="recruit">${icon(full ? 'lock' : 'ok', 12)} ${full ? `已满 ${RECRUIT_MAX} 人` : afford ? `招募（现 ${ws} 人）` : '资源不足'}</span>
    <span class="bdesc">用食物与燃料点一堆火，深渊会送回一位迷路的拓荒者（随机专长/短处）</span>
  </div>`;
  html += `<div class="ptip">面板开着时：1~9 选当前分类第 N 项</div>`;
  html += '<div class="ptip">放下即扣料（拆蓝图全退）· 按住 E 或等拓荒队施工 · 蚀痕格不能建</div>';
  return html;
}

// —— 夜行面板：团队夜间指令 + 巡逻方向 ——
const DIRS = [
  { id: 'N', name: '北', dx: 0, dy: -1 },
  { id: 'S', name: '南', dx: 0, dy: 1 },
  { id: 'W', name: '西', dx: -1, dy: 0 },
  { id: 'E', name: '东', dx: 1, dy: 0 },
];
function renderNight(state) {
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  const blooms = ops ? ops.blooms.filter((b) => b.alive && b.charges > 0).length : 0;
  const tide = isTide(state);
  const dawn = isDawn(state);
  const cur = state.order || 'auto';
  let next = null;
  if (ops && ops.vents.length) next = Math.max(0, Math.round(Math.min(...ops.vents.map((v) => v.t))));
  let html = `<div class="psec">夜间指令 · ${tide ? '蚀潮中' : dawn ? '黎明（残留蚀兽正在消解）' : '非蚀潮'}</div>`;
  for (const o of ORDERS) {
    html += `<div class="nrow ${o.id === cur ? 'on' : ''}" data-order="${o.id}">
      <span class="nname">${o.name}</span><span class="ndesc">${o.desc}</span></div>`;
  }
  html += `<div class="psec">巡逻方向（仅「巡逻」生效）</div><div class="nrow dirs">`;
  for (const d of DIRS) html += `<span class="ndir ${state.patrol && state.patrol.dx === d.dx && state.patrol.dy === d.dy ? 'on' : ''}" data-dir="${d.id}">${d.name}</span>`;
  html += '</div>';
  html += `<div class="psec">今晚资源</div>
    <div class="ninfo">休整位 <span data-live="rest">${restCount(state)}</span> / ${restBeds(state)} · 透支会降低次日效率</div>
    <div class="ninfo">夜辉草 <span data-live="blooms">${blooms}</span> 株 · 夜髓 +1</div>
    <div class="ninfo">潮穴 <span data-live="vents">${ops ? ops.vents.length : 0}</span> 处<span data-live="next">${next != null ? ` · ${next}s 后喷发（出怪，掉母髓）` : ''}</span></div>
    <div class="ninfo">巡逻 · 出怪 -${Math.round(PATROL.spawnCut * 100)}% · 士气 ×${PATROL.moraleMul}</div>`;
  html += '<div class="ptip">夜辉草 E 采撷 · 掉落物走过自动拾取</div>';
  return html;
}

// —— 容器面板：容器 ↔ 背包 手动搬运（无搬运 AI；跨层携带靠背包）——
// 【拖拽】拖一行到对面那一栏 = **整摞搬过去**（跟 MC 一致：拖 = 一整摞；想要一个就用行上的「取1 / 存1」）。
// 为什么不做“Shift+拖 = 全”：精确的那个动作已经有按钮了，再给拖拽挂修饰键只是让玩家多背一条规则。
let dragItem = null;
function clearDragMarks() {
  dragItem = null;
  const host = document.getElementById('panel');
  if (!host) return;
  for (const el of host.querySelectorAll('.dragging, .drop')) el.classList.remove('dragging', 'drop');
}
export function setupStoreDrag(hostEl, getState) {
  if (!hostEl) return;
  const colOf = (t) => (t && t.closest ? t.closest('.scol[data-side]') : null);
  hostEl.addEventListener('dragstart', (ev) => {
    if (activeId !== 'store') return;
    const row = ev.target && ev.target.closest ? ev.target.closest('.srow[data-row]') : null;
    if (!row) return;
    const [side, k] = row.dataset.row.split('-');
    dragItem = { side, k };
    row.classList.add('dragging');
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', k || '');      // Firefox 不带数据就不会真的开始拖
    }
  });
  hostEl.addEventListener('dragend', clearDragMarks);
  hostEl.addEventListener('dragover', (ev) => {
    if (!dragItem) return;
    const col = colOf(ev.target);
    if (!col || col.dataset.side === dragItem.side) return;   // 同一栏不给放：光标会显示为禁止
    ev.preventDefault();                                      // 不阻止默认行为就收不到 drop
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    for (const c of hostEl.querySelectorAll('.scol.drop')) c.classList.remove('drop');
    col.classList.add('drop');
  });
  hostEl.addEventListener('drop', (ev) => {
    const col = colOf(ev.target);
    const item = dragItem;
    clearDragMarks();
    if (!item || !col || col.dataset.side === item.side) return;
    ev.preventDefault();
    const state = getState && getState();          // panels.js 自身不持有 state（其它函数都是参数传入），这里由 main 提供
    if (!state) return;
    const c = state.storeRef ? allContainers(state, false).find((x) => x.ref === state.storeRef) : null;
    if (!c) return;
    const pack = packContainer(state);
    const from = item.side === 'c' ? c : pack;
    const to = item.side === 'c' ? pack : c;
    const moved = transfer(state, from, to, item.k, 9999);     // 上限交给 transfer 自己按空间夹
    const name = RES_NAME[item.k] || item.k;
    if (moved > 0) {
      sfx('click');
      state.toast = { txt: `${item.side === 'c' ? '取出' : '存入'} ${name} ×${moved}`, at: performance.now() };
    } else {
      sfx('deny');
      state.toast = { txt: `${item.side === 'c' ? '背包' : '容器'}满了，搬不过去`, at: performance.now() };
    }
    state._panelSig = null;                                    // 数量变了 → 重建一次（行序仍是固定 ID 次序）
    renderPanelHost(state);
  });
}
// 只列「这里真有的东西」—— 不再把全部材料罗列出来（空行是噪音，不是信息）
function storeCol(state, holder, side) {
  const act = side === 'c' ? 'pull' : 'push';
  const verb = side === 'c' ? '取' : '存';
  const stock = holder.ref.stock || {};
  const used = usedOf(holder);
  const free = Math.max(0, holder.cap - used);
  // 【排序只用物品 ID 的固定次序，绝不按数量】
  //   连点「取1 / 全」时数量一直在变，按数量排会让整列每点一下重排一次 —— 玩家下一击就打偏了。
  //   同理：本次打开面板期间出现过的行，数量归 0 后**留在原地变灰**，而不是消失让下面的行往上顶。
  const seen = seenSet(state, side);
  const keysOf = (order) => order.filter((k) => (stock[k] || 0) > 0 || seen.has(k));
  const mats = keysOf(RES_ORDER);
  const tools = keysOf(TOOL_ORDER);
  for (const k of mats) seen.add(k);
  for (const k of tools) seen.add(k);
  const rowOf = (k) => {
    const v = stock[k] || 0;
    const off = v > 0 ? '' : ' off';
    // 可拖：拖到对面那一栏 = 整摞搬过去（v<=0 的行不给拖）
    const drag = v > 0 ? ` draggable="true" title="拖到对面那一栏 = 整摞搬过去"` : '';
    return `<div class="srow${v > 0 ? '' : ' dim'}" data-row="${side}-${k}" data-hay="${escAttr(hayOf(RES_NAME[k] || k, TOOLS[k] ? '工具' : '材料'))}"${drag}>
      <i style="color:${RES_COLOR[k]}">${resIcon(k, 12)}<span>${RES_NAME[k]}</span></i>
      <b data-live="${side === 'c' ? 'cv' : 'pv'}-${k}">${v}</b>
      <span class="sbtns">
        <span class="sbtnx${off}" data-act="${act}" data-k="${k}" data-n="1">${verb}1</span>
        <span class="sbtnx${off}" data-act="${act}" data-k="${k}" data-n="999">全</span>
      </span>
    </div>`;
  };
  const bar = `<div class="scbar" title="容量 ${used} / ${holder.cap}">
      <div class="scbar-fill${free <= 0 ? ' full' : ''}" style="width:${Math.min(100, (used / holder.cap) * 100).toFixed(1)}%"></div>
    </div>`;
  let body = '';
  if (!mats.length && !tools.length) body = '<div class="sempty">空</div>';
  else {
    body = mats.map(rowOf).join('');
    if (tools.length) body += `<div class="ssub">工具</div>${tools.map(rowOf).join('')}`;
  }
  return `<div class="scol" data-side="${side}">
    <div class="shd"><span>${side === 'c' ? holderName(state, holder) : '玩家背包'}</span>
      <span data-live="cap-${side}">${used} / ${holder.cap}${free > 0 ? ` · 剩 ${free}` : ' · 满'}</span></div>
    ${bar}
    ${body}
  </div>`;
}
function holderName(state, holder) {
  if (holder.kind === 'camp') return '营地篝火仓';
  if (holder.kind === 'store') return '储物箱';
  return '容器';
}
// 本次打开容器面板期间「露过面」的物品（两栏各一份）—— 归零后仍占位，保证行号不跳
function seenSet(state, side) {
  if (!state._storeSeen || !state._storeSeen[side]) {
    state._storeSeen = state._storeSeen || {};
    state._storeSeen[side] = new Set();
  }
  return state._storeSeen[side];
}

// —— 制造台面板：配方 + 装备位（工具是真物品：拿在手上就不在仓库里）——
function renderBench(state) {
  const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
  if (!b || b.site) return '<div class="psec">制造台不在了（可能被拆/被打掉）。重新建一个吧</div>';
  const held = heldTool(state);
  let html = stationSummary('制造台', '石头 + 藤木  →  工具', held ? `手上：${RES_NAME[held] || held}` : '空手 · 可装备工具', held ? 'on' : '');
  html += '<div class="psec">装备位 · 工具是物品（拿在手上就不在仓库里）</div>';
  html += `<div class="trow ready">
    <span class="tname">手上：${held ? (RES_NAME[held] || held) : '空手'}</span>
    <span class="tdesc">${held ? TOOLS[held].desc : '下面选一件握住'}</span>
    ${held ? '<span class="tbtn" data-act="unequip">收好</span>' : ''}</div>`;
  html += '<div class="psec">仓库里的工具（点「装备」拿到手上）</div>';
  const have = TOOL_ORDER.filter((k) => (state.res[k] || 0) > 0);
  if (!have.length) html += '<div class="bnote">还没有工具。先做一把石镐，端掉一片岩壁就有石头了</div>';
  for (const k of have) {
    html += `<div class="trow ready">
      <span class="tname">${RES_NAME[k]} ×${state.res[k] || 0}</span>
      <span class="tdesc">${TOOLS[k].desc}</span>
      <span class="tbtn" data-act="equip" data-k="${k}">装备</span></div>`;
  }
  html += `<div class="psec">配方（扣料立即 · 做完的成品进【最近的容器】）</div>`;
  const recipes = recipesOf('bench');
  const busyId = b.craft ? b.craft.id : null;
  for (const r of recipes) {
    const err = craftError(state, b, r.id);
    const busy = busyId === r.id;
    html += `<div class="trow ${busy || !err ? 'ready' : 'poor'}${busy ? ' cur' : ''}" data-recipe="${r.id}">
      <span class="tname">${RES_NAME[r.out] || r.out}</span>
      <span class="tcost">${costText(r.cost)}<em class="bwork">${r.sec}s</em></span>
      <span class="tstate" data-live="rc-${r.id}">${busy ? '制作中…' : (err || '可制作')}</span>
      <span class="tbtn" data-act="craft" data-id="${r.id}">制作</span>
      <span class="tdesc">${r.desc || (TOOLS[r.out] ? TOOLS[r.out].desc : '')}</span></div>`;
  }
  html += '<div class="pnote" data-live="prog"></div>';
  html += '<div class="ptip">岩壁只要研究「石工」就能徒手凿（慢 2.2×）· 拿镐快 40% · 拓荒者会自己领工具</div>';
  return html;
}
function renderStore(state) {
  const c = state.storeRef ? allContainers(state, false).find((x) => x.ref === state.storeRef) : null;
  if (!c) return '<div class="psec">容器已不存在（可能被打掉了）</div>';
  const pack = packContainer(state);
  return `<div class="psec">搬运（手动）· 本层容器装满时多出来的会丢</div>
    <div class="storecols">${storeCol(state, c, 'c')}${storeCol(state, pack, 'p')}</div>
    <div class="ptip">「取1 / 存1」一次一个 · 「全」整摞 · 拖一行到对面那一栏 = 整摞搬过去 · 跨层先装背包（${pack.cap} 格）再下竖井</div>`;
}

function renderPack(state) {
  const pack = packContainer(state), stock = pack.ref.stock || {};
  const keys = RES_ORDER.filter((k) => (stock[k] || 0) > 0).concat(TOOL_ORDER.filter((k) => (stock[k] || 0) > 0));
  let html = `<div class="psec">随身背包 · ${usedOf(pack)} / ${pack.cap} 格</div>`;
  html += '<div class="bnote">物品会随你跨区块、跨楼层移动；丢下后可在脚边重新拾回</div>';
  if (!keys.length) return html + '<div class="sempty">背包是空的</div>';
  for (const k of keys) {
    const n = stock[k] || 0, name = RES_NAME[k] || k;
    html += `<div class="srow packrow" data-hay="${escAttr(hayOf(name, TOOLS[k] ? '工具' : '材料'))}">
      <i style="color:${RES_COLOR[k] || '#dfe9ff'}">${resIcon(k, 12)}<span>${name}</span></i>
      <b data-live="pack-${k}">${n}</b>
      <span class="sbtns"><span class="sbtnx" data-act="drop1" data-k="${k}">丢 1</span><span class="sbtnx" data-act="dropall" data-k="${k}">全丢</span></span>
    </div>`;
  }
  return html + '<div class="ptip">丢下不会销毁物品；掉落物放在当前位置，30 秒后消失。</div>';
}

// —— 拓荒队调度面板（N2/N6b）：登记意图，跨区移动由区块调度器按时间完成 ——
function crewLocation(w) {
  const cx = w.chunkX == null ? 0 : w.chunkX | 0;
  const cy = w.chunkY == null ? 0 : w.chunkY | 0;
  return `区块 ${cx},${cy}`;
}
function crewHpPct(w) { return Math.max(0, Math.min(100, (w.hp || 0) / Math.max(1, w.maxHp || 1) * 100)); }
function crewBar(value, color) { return `<span class="crewbar"><i style="width:${Math.max(0, Math.min(100, value)).toFixed(1)}%;background:${color}"></i></span>`; }
function crewModeLabel(mode) {
  return ({ auto: '自动', rest: '休整', guard: '守卫', forage: '夜采', patrol: '巡逻' })[mode] || '自动';
}
function crewCareLabel(care) {
  return ({ neutral: '常规照护', medical: '治疗优先', rescue: '救援优先', guard: '仅守灯' })[care] || '常规照护';
}
function crewOutpostLabel(mode) {
  return ({ guard: '守灯', gather: '采掘', silent: '静默撤离' })[mode] || '未设定';
}
function crewOutpostStatus(state, w) {
  if (!w) return '';
  if (w.outpostTravel) return w.outpostTravel.blocked ? ' · 等待区块名额' : ` · 前往中 ${Math.ceil(Math.max(0, w.outpostTravel.t || 0))}s`;
  const d = w.directive || {};
  if (!d.outpost || (w.chunkX | 0) !== (d.outpost.x | 0) || (w.chunkY | 0) !== (d.outpost.y | 0)) return '';
  const c = state.chunkStore && state.chunkStore[`${d.outpost.x | 0},${d.outpost.y | 0}`];
  const o = c && c.outpost;
  if (!o) return d.outpostMode === 'silent' ? ' · 静默撤离' : ' · 守灯中 · 等待首次结算';
  const eco = o.lastEcology || {};
  const ecoText = Number.isFinite(eco.pressure) ? ` · 光压 ${eco.pressure} · ${eco.tide ? `潮压 ${eco.debt || 0}` : '白天'}` : '';
  const alert = (o.alerts || []).find((a) => a && a.status === 'open');
  const alertText = alert ? ` · 告警：${alert.message || '远端生态异常'}` : '';
  if (d.outpostMode !== 'gather') return `${d.outpostMode === 'silent' ? ' · 静默撤离' : ' · 守灯中'}${ecoText}${alertText}`;
  const n = o.lastNeeds || {};
  const supply = n.fed || n.fuel ? ` · 补给 食物${n.fed || 0} 燃料${n.fuel || 0}` : '';
  return ` · 下轮结算 ${Math.ceil(Math.max(0, o.nextT || 0))}s${supply}${ecoText}${alertText} · ${o.lastReason || '等待结算'}`;
}
function renderCrew(state) {
  const members = allCrewWorkers(state);
  const memorial = (state.memorial || []).slice(-COLONISTS.MAX_MEMORIAL_EVENTS).reverse();
  let html = `<div class="psec">拓荒队调度 · ${members.filter((w) => w.alive !== false).length} 名在册 · 复苏 ${state.reviveCount | 0}/${SURVIVAL.REVIVE.MAX_USES}</div>`;
  html += '<div class="bnote">选中的区块会成为前哨目标；拓荒者按时间迁移，不会瞬移。采掘前哨每 12 秒结算一次，产出只能进入当地容器；潮夜会按当地光压留下有限蚀痕前线，并发出有上限的远端告警，不会在远端额外刷怪。最多同时维持 3 个有人区块。</div>';
  if (memorial.length) {
    html += '<div class="psec memorial-head">离去记录</div>';
    html += memorial.map((m) => {
      const affected = (m.affected || []).map((a) => a.name).join('、');
      const status = m.revived ? ` · 第 ${Math.max(1, m.reviveDay | 0)} 天复苏` : ' · 墓碑已留下';
      return `<div class="memorial-row"><b>第 ${Math.max(1, m.day | 0)} 天 · ${escAttr(m.name || '拓荒者')}</b><span>${escAttr(m.cause || '伤势过重')}${status}${affected ? ` · ${escAttr(affected)} 正在哀悼` : ''}</span></div>`;
    }).join('');
  }
  if (!members.length) return html + '<div class="sempty">还没有在世拓荒者</div>';
  for (const w of members) {
    const card = crewCardOf(w, 0, state.day || 1);
    const d = w.directive || { mode: 'auto', noNight: false, rescue: 'normal', care: 'neutral', area: null, outpost: null, outpostMode: null };
    const id = card.id || w.name;
    const task = w.task || { label: w.job || '待命', reason: '等待下一次工作决策' };
    const dead = w.alive === false;
    const death = dead && w.deathRecord ? `<div class="crewdeath">第 ${Math.max(1, w.deathRecord.day | 0)} 天离去 · ${escAttr(w.deathRecord.cause || '伤势过重')} · 墓碑已留下</div>` : '';
    const events = (card.events || []).slice(-3).reverse();
    const eventHtml = events.length ? `<div class="crewevents"><span>经历</span>${events.map((e) => `<em>第 ${Math.max(1, e.day | 0)} 天 · ${escAttr(e.text)}</em>`).join('')}</div>` : '';
    const outpost = d.outpost ? `前哨 ${d.outpost.x},${d.outpost.y} · ${crewOutpostLabel(d.outpostMode)}${crewOutpostStatus(state, w)}` : '未驻守';
    const area = d.area ? `工作区 ${d.area.x},${d.area.y}` : '全区';
    const inHere = (w.chunkX | 0) === (state.chunkX | 0) && (w.chunkY | 0) === (state.chunkY | 0);
    html += `<section class="crewcard${dead ? ' dead' : ''}" data-worker="${escAttr(id)}">
      <div class="crewhead"><span class="crewportrait ${escAttr(card.palette)}">${escAttr((w.name || '拓').slice(-1))}</span>
        <span class="crewname">${escAttr(w.name || '拓荒者')}<small>${escAttr(COLONISTS.ROLES[card.role] ? COLONISTS.ROLES[card.role].name : '拓荒者')} · ${escAttr(COLONISTS.PERSONALITIES[card.personality] ? COLONISTS.PERSONALITIES[card.personality].name : '普通')}</small></span>
        <span class="crewloc">${escAttr(crewLocation(w))}</span></div>
      <div class="crewstats"><span>生命 ${crewBar(crewHpPct(w), '#ff7d8a')}<b>${Math.ceil(w.hp || 0)}/${Math.ceil(w.maxHp || 0)}</b></span>
        <span>饱食 ${crewBar(w.hunger || 0, '#ffd76e')}<b>${Math.ceil(w.hunger || 0)}</b></span>
        <span>士气 ${crewBar(w.morale || 0, '#9ef7a8')}<b>${Math.ceil(w.morale || 0)}</b></span></div>
      ${death}
      ${eventHtml}
      <div class="crewtask"><b>${escAttr(task.label || '待命')}</b><span>${escAttr(task.reason || '—')}</span></div>
      <div class="crewmeta"><span>${escAttr(area)}</span><span>${escAttr(outpost)}</span><span>${d.noNight ? '夜班已禁' : '允许夜班'}</span><span>${escAttr(crewCareLabel(d.care || 'neutral'))}</span></div>
      <div class="crewcontrols" role="group" aria-label="${escAttr(w.name || '拓荒者')} 调度">
        <span class="crewgroup-label">职业</span>
        ${Object.values(COLONISTS.ROLES).map((r) => `<button type="button" class="crewctl rolectl${card.role === r.id ? ' on' : ''}" data-crew-role="${r.id}" data-worker="${escAttr(id)}" title="${escAttr(r.note)}">${escAttr(r.name)}</button>`).join('')}
        <span class="crewgroup-label">照护</span>
        ${['medical', 'rescue', 'guard'].map((c) => `<button type="button" class="crewctl carectl${(d.care || 'neutral') === c ? ' on' : ''}" data-crew-care="${c}" data-worker="${escAttr(id)}">${crewCareLabel(c)}</button>`).join('')}
        ${['auto', 'rest', 'guard', 'forage', 'patrol'].map((m) => `<button type="button" class="crewctl${d.mode === m ? ' on' : ''}" data-crew-mode="${m}" data-worker="${escAttr(id)}">${crewModeLabel(m)}</button>`).join('')}
        <button type="button" class="crewctl" data-crew-area="set" data-worker="${escAttr(id)}">设为当前工作区</button>
        <button type="button" class="crewctl" data-crew-area="clear" data-worker="${escAttr(id)}">清除工作区</button>
        <button type="button" class="crewctl${d.outpost && d.outpost.x === (state.chunkX | 0) && d.outpost.y === (state.chunkY | 0) ? ' on' : ''}" data-crew-outpost="assign" data-worker="${escAttr(id)}">${inHere ? '驻守本区块' : '派往此区块'}</button>
        <button type="button" class="crewctl" data-crew-outpost="withdraw" data-worker="${escAttr(id)}">撤回营地</button>
        ${['guard', 'gather', 'silent'].map((m) => `<button type="button" class="crewctl${d.outpost && d.outpostMode === m ? ' on' : ''}" data-crew-outpost-mode="${m}" data-worker="${escAttr(id)}">${crewOutpostLabel(m)}</button>`).join('')}
        <button type="button" class="crewctl${d.noNight ? ' on' : ''}" data-crew-night="toggle" data-worker="${escAttr(id)}">${d.noNight ? '允许夜班' : '禁止夜班'}</button>
        <button type="button" class="crewctl${d.rescue === 'high' ? ' on' : ''}" data-crew-rescue="toggle" data-worker="${escAttr(id)}">${d.rescue === 'high' ? '改为常规救援' : '设为优先救援'}</button>
      </div>
    </section>`;
  }
  return html + '<div class="ptip">职业只改工作适配，不重掷性格；照护意图决定伤员处理顺序。夜班禁令只影响普通工作，进食、避险和救援仍会打断命令。</div>';
}

// —— 配方选择器（熔炉 / 自动熔炉共用）：产出取决于选中哪个 ——
function recipePicker(state, station, cur) {
  let html = '<div class="psec">配方</div>';
  for (const r of recipesOf(station)) {
    const on = r.id === cur;
    const cost = costText(r.cost, true);
    // 【只显示本站台真的有的节奏】以前无条件拼「手做 Xs · 自动 Ys」→ 熔炉面板上出现了只有
    //   自动熔炉才成立的「自动 4s」，玩家会以为“把自动熔炉的页面放到熔炉上了”。
    const pace = (station === 'furnace' && r.hand) ? `手做 ${r.hand}s` : '';
    const auto = (station === 'smelter' && r.sec) ? `自动 ${r.sec}s` : '';
    html += `<div class="trow ${on ? 'cur ready' : ''}" data-recipe-pick="${r.id}">
      <span class="tname">${on ? '● ' : '○ '}${recipeName(r)}</span>
      <span class="tcost">${cost} → ${costText({ [r.out]: r.n || 1 }, true)}<em class="bwork">${pace}${auto}</em></span>
      <span class="tdesc">${r.desc || ''}</span></div>`;
  }
  return html;
}

// —— 火种高频刷新（熔炉 / 自动熔炉共用）：槽位与“炉火”行就地改字 ——
function liveFire(hostEl, b, def, prefix) {
  const put = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };   // refreshLive 里的 set 是本地的，这里自带一个
  const fd = fuelDef(fireMatOf(b, def));
  const have = b.fuel | 0;
  const hot = !b.off && have > 0;
  put(hostEl.querySelector(`[data-live="${prefix}-fuel"]`), `${have} / ${def.maxFuel || 6}`);
  put(hostEl.querySelector(`[data-live="${prefix}-fire"]`), hot
    ? `烧 ${fd.name} · 剩 ${have} 个（≈${Math.round(have * fd.burnSec)}s）`
    : '没火 · 加火种');
}

// —— 火种槽（熔炉 / 自动熔炉共用）：烧什么由你定，质量不同（耐烧度 + 火力）——
function fireSlot(state, b, def, prefix) {
  const mat = fireMatOf(b, def);
  const fd = fuelDef(mat);
  const max = def.maxFuel || 6;
  const have = b.fuel | 0;
  const hot = !b.off && have > 0;
  let html = `<div class="psec">火种 · 1 个烧 ${fd.burnSec}s · 火力 ×${fd.heat}</div>`;
  for (const k of FUEL_ORDER) {
    const f = FUELS[k];
    const on = k === mat;
    html += `<div class="trow ${on ? 'cur ready' : ''}" data-fire-pick="${k}">
      <span class="tname">${on ? '● ' : '○ '}${f.name}<em class="bwork">库存 ${state.res[k] || 0}</em></span>
      <span class="tcost">烧 ${f.burnSec}s / 个<em class="bwork">火力 ×${f.heat}</em></span>
      <span class="tdesc">${f.desc}</span></div>`;
  }
  html += `<div class="trow ${hot ? 'ready' : 'poor'}">
    <span class="tname">${fd.name}</span>
    <span class="tstate" data-live="${prefix}-fuel">${have} / ${max}</span>
    <span class="tbtn" data-act="fuel1">加 1</span>
    <span class="tbtn" data-act="fuelmax">加满</span></div>`;
  html += `<div class="trow ${hot ? 'ready' : 'poor'}"><span class="tname">炉火</span>
    <span class="tdesc" data-live="${prefix}-fire">${hot
        ? `烧 ${fd.name} · 剩 ${have} 个（≈${Math.round(have * fd.burnSec)}s）`
        : '没火 · 加火种'}</span></div>`;
  return html;
}

// —— 熔炉：配方站（按住 E 就按选中配方手做）——
function stationSummary(title, flow, status, tone = '') {
  return `<div class="station-summary ${tone}"><div class="station-title">${title}</div><div class="station-flow">${flow}</div><div class="station-status">${status}</div></div>`;
}
function renderFurnace(state) {
  const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
  if (!b || b.site) return '<div class="psec">熔炉不在了（被拆/被打掉）。重新建一个吧</div>';
  const def = BUILD.furnace;
  const cur = recipeForStation(b, def);        // 旧档里可能存着已下线的配方（例：熔炉做木炭）→ 自愈回炼油
  const hot = fireOn(b);
  let html = stationSummary('手动熔炉', `${Object.keys((RECIPE_OF[cur] || {}).cost || {}).map((k) => RES_NAME[k]).join(' + ') || '原料'}  →  ${RES_NAME[(RECIPE_OF[cur] || {}).out] || '燃料'}`, hot ? '可开工' : '需要火种', hot ? 'on' : 'warn');
  html += '<div class="ptip">手动站台：火种自己添、按住 E 手做（要无人值守 → 研究「自动熔炉」）</div>';
  html += recipePicker(state, 'furnace', cur);
  html += fireSlot(state, b, def, 'f');
  const r = RECIPE_OF[cur] || {};
  const lack = Object.keys(r.cost || {}).map((k) => `${RES_NAME[k]} ${state.res[k] || 0}`).join(' · ');
  html += '<div class="psec">开工</div>';
  html += `<div class="trow ${hot ? 'ready' : 'poor'}"><span class="tname">手做</span>
    <span class="tdesc">${hot
        ? `按住 E 连做 · ${((r.hand || 0.4) / (heatOf(b, def) || 1)).toFixed(2)}s / 批`
        : '没火 · 按 E 点火'}</span>
    <span class="tbtn" data-act="once">做一次</span></div>`;
  html += `<div class="trow"><span class="tname">库存</span><span class="tdesc" data-live="stock">${lack || '—'}</span></div>`;
  html += '<div class="ptip">研究「自动熔炉」→ 无人值守版（需火种）</div>';
  return html;
}

// —— 自动熔炉面板：配方 + 火种槽 + 开关 ——
// 「为什么不出货」只能有一种说法：没火种 / 缺料 / 容器满（面板与增量刷新共用这一份）
function smelterStatus(b, state) {
  if (b.off) return '停工';
  if (!(b.fuel > 0)) return '没火种 · 按「加 1 / 加满」';
  if (b.dry === 'no-room') return '容器满 · 成品没处放（先腾地方）';
  if (b.dry === 'no-mat') return `缺料 · ${RES_NAME[b.dryMat] || '原料'}`;
  const pct = Math.round(Math.min(1, (b.prog || 0) / smeltSecs(b, state)) * 100);
  return pct > 0 ? `${pct}%` : '待命';
}
function renderSmelter(state) {
  const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
  if (!b || b.site) return '<div class="psec">自动熔炉不在了（被拆/被打掉）。重新建一个吧</div>';
  const def = BUILD.smelter;
  const mat = fireMatOf(b, def);
  const fd = fuelDef(mat);
  const cur = b.recipe || def.recipe || 'fuel';
  const r = RECIPE_OF[cur] || {};
  const pct = Math.round(Math.min(1, (b.prog || 0) / smeltSecs(b, state)) * 100);
  const burning = !b.off && b.fuel > 0;
  const status = smelterStatus(b, state);
  let html = stationSummary('自动熔炉', `${Object.keys(r.cost || {}).map((k) => RES_NAME[k]).join(' + ') || '原料'}  →  ${RES_NAME[r.out] || r.out}`, status, burning && !b.dry ? 'on' : 'warn');
  html += '<div class="ptip">自动站台：火种自动从最近容器补、选好配方自己产（不用人守）</div>';
  html += recipePicker(state, 'smelter', cur);
  html += fireSlot(state, b, def, 's');
  html += `<div class="trow ${b.off ? 'poor' : 'ready'}">
    <span class="tname">开关</span>
    <span class="tdesc">${b.off ? '已熄火' : `运行中 · ${smeltSecs(b, state).toFixed(1)}s / 批`}</span>
    <span class="tbtn" data-act="toggle">${b.off ? '点火' : '熄火'}</span></div>`;
  html += `<div class="trow ${burning && !b.dry ? 'ready' : 'poor'}">
    <span class="tname">状态</span>
    <span class="tdesc" data-live="sm-status">${status}</span></div>`;
  // 烧制进度条（用户点名要）：一条能看的量，比一个百分比数字直观
  html += `<div class="trow ${burning && !b.dry ? 'ready' : 'poor'}">
    <span class="tname">进度</span>
    <div class="scbar tbar" title="这一批的烧制进度（每 ${smeltSecs(b, state).toFixed(1)}s 出一批）">
      <div class="scbar-fill" data-live="sm-bar" style="width:${pct}%"></div></div>
    <span class="tstate" data-live="sm-pct">${pct}%</span></div>`;
  html += '<div class="psec">自动流程</div>';
  html += `<div class="trow"><span class="tname">投料</span><span class="tdesc">每 ${smeltSecs(b, state).toFixed(1)}s 取 1 批：${Object.keys(r.cost || {}).map((k) => RES_NAME[k]).join('/') || '—'}</span></div>`;
  html += `<div class="trow"><span class="tname">产出</span><span class="tdesc">${RES_NAME[r.out] || r.out} ×${r.n || 1} → 最近容器</span></div>`;
  html += `<div class="trow"><span class="tname">添火</span><span class="tdesc">自动补：槽不满就从最近容器拿（优先${fd.name}；藤木也行）</span></div>`;
  html += '<div class="pnote" data-live="s-stat"></div>';
  html += '<div class="ptip">藤木 便宜但慢 · 木炭 均衡 · 燃料 最快</div>';
  return html;
}

function renderClinic(state) {
  const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
  if (!b || b.site) return '<div class="psec">医疗站不在了（被拆/被打掉）。重新建一个吧</div>';
  const active = b.medicalWorker;
  const q = (state.medicalQueue || []).filter((w) => w && w.medicalClinic === b && w.medicalState === 'queued');
  const lit = state.light && state.light[b.y * state.map.w + b.x] >= SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN;
  const status = active ? `治疗中 · ${active.name}` : q.length ? `候诊中 · ${q.length} 人` : '待命';
  let html = stationSummary('医疗站', '恢复期伤势 → 清除', status, active && lit ? 'on' : 'warn');
  html += '<div class="ptip">只治疗已救回的伤员 · 每人耗 1 燃料 · 失去光照会暂停</div>';
  html += `<div class="trow ${lit ? 'ready' : 'poor'}"><span class="tname">光照</span><span class="tdesc">${lit ? '可治疗' : `需要人工光 ≥${SURVIVAL.RESCUE.MEDICAL_LIGHT_MIN}`}</span></div>`;
  html += `<div class="trow"><span class="tname">治疗位</span><span class="tdesc">${active ? `${active.name} · ${Math.round((active.medicalT || 0) / SURVIVAL.RESCUE.MEDICAL_SECS * 100)}%` : '空闲'} · 1 位</span></div>`;
  html += `<div class="trow"><span class="tname">队列</span><span class="tdesc">${q.length} / ${SURVIVAL.RESCUE.MEDICAL_QUEUE_MAX} · 只收当前活跃区块的恢复期伤员</span></div>`;
  html += '<div class="ptip">没有医疗位时，伤员仍会在简易铺位恢复，不会倒退成倒地状态。</div>';
  return html;
}

// —— 研究面板（W12-D 重排）：分区 chip + 未解之谜 + 人话原因 + 柔性分支 ——
function researchNodeHTML(state, id, showReq = true) {
  const r = RESEARCH[id];
  const done = hasTech(state, id);
  const err = researchError(state, id);
  const cls = done ? 'done' : err ? 'lock' : 'ready';
  const mul = branchMulOf(state, id);
  const branchTag = r.branchOf
    ? `<em class="rbranch">${mul > 1 ? '软分支 · 第二条贵 ×3' : '与本线另一条二选一（另一条会贵 ×3）'}</em>`
    : '';
  const reqTxt = showReq && (!done && r.req && r.req.length) ? '（前置：' + r.req.map((q) => RESEARCH[q].name).join('、') + '）' : '';
  const st = done ? { ico: 'done', col: '#7fe8d8', txt: '已完成' } : err ? { ico: 'lock', col: '#8b93a6', txt: '' } : { ico: 'know', col: '#a88cff', txt: '' };
  return `<div class="rs ${cls}" data-id="${id}" data-hay="${escAttr(hayOf(r.name, r.desc, (r.req || []).map((q) => (RESEARCH[q] || {}).name).join(' ')))}">
    <div class="rs-h"><span><i class="rsi" style="color:${st.col}">${icon(st.ico, 13)}</i>${r.name}${branchTag}</span><span data-live="cost">${done ? st.txt : costTxtOf(state, id)}</span></div>
    <div class="rs-d">${r.desc}${reqTxt}<i class="rs-err">${!done ? errSuffixOf(state, id, err) : ''}</i></div>
  </div>`;
}

function renderResearch(state) {
  const cur = state.resSect || 'founder';
  let html = `<div class="psec" data-live="res">档案 ${state.res.data || 0} · 母髓 ${state.res.core || 0} · 夜髓 ${state.res.night || 0}</div>`;
  html += '<div class="rsects">';
  for (const s of SECTS) {
    const on = s.id === cur;
    const op = sectOpen(state, s.id);
    const ids = RESEARCH_ORDER.filter((id) => RESEARCH[id].sect === s.id);
    const done = ids.filter((id) => hasTech(state, id)).length;
    html += `<span class="rchip${on ? ' on' : ''}${op ? '' : ' off'}" data-sect="${s.id}">${op ? s.name : '？？？'}<em>${done}/${ids.length}</em></span>`;
  }
  html += '</div>';
  const sd = SECTS.find((x) => x.id === cur) || SECTS[0];
  html += `<div class="pfil-hits hidden" data-fil-hits></div>`;
  html += `<div data-filg><div class="psec">${sd.name} · ${sd.hint}</div>`;

  if (!sectOpen(state, cur)) {
    const why = cur === 'deep' ? '等你第一次下到深渊（先研究「深潜学」再放竖井）'
      : cur === 'night' ? '等你第一次在蚀潮里采到夜髓'
        : '先去遗迹碑 / 挨过的伤 / 安抚过的同伴里翻点线索';
    html += `<div class="bnote">这一页还是一片空白 —— ${why}</div>`;
  } else if (cur === 'know') {
    // 知识分区：残页进度 + 解析台状态 + 知识节点（没线索的显示 ？？？）
    for (const row of relicRows(state)) {
      const got = row.have.map((i) => RELIC_SERIES[row.id].parts[i]).join('、');
      html += `<div class="rrow ${row.full ? 'ready' : ''}" data-hay="${escAttr(hayOf('残页', row.name, row.full ? '已集齐' : '还差'))}">
        <span class="rname"><i class="rsi" style="color:${row.full ? '#7fe8d8' : '#c9a0ff'}">${icon(row.full ? 'done' : 'data', 13)}</i>残页 · ${row.name}</span>
        <span class="rstate">${row.have.length}/${row.need}${got ? '（' + got + '）' : ''}</span>
        <span class="rdesc">${row.full ? '已集齐 —— 知识可解析' : `还差：${row.missing.join('、')} · ${row.from}`}</span>
      </div>`;
    }
    html += `<div class="bnote">${nearAnalyzer(state) ? '✓ 你正站在解析台旁，可以解析知识' : '⚠ 知识只能在「解析台」旁解锁 —— 把线索带回去'}</div>`;
    for (const id of RESEARCH_ORDER.filter((x) => RESEARCH[x].sect === 'know')) {
      if (hasTech(state, id) || knowSeenId(state, id)) html += researchNodeHTML(state, id);
      else {
        const r = RESEARCH[id];
        html += `<div class="rs mystery" data-hay="${escAttr(hayOf(r.hint || ''))}">
          <div class="rs-h"><span>？？？</span><span>未解之谜</span></div>
          <div class="rs-d dim">${r.hint || ''}</div></div>`;
      }
    }
  } else {
    const ids = RESEARCH_ORDER.filter((x) => RESEARCH[x].sect === cur);
    const depth = (id, seen = new Set()) => {
      if (seen.has(id)) return 0;
      seen.add(id);
      const req = (RESEARCH[id].req || []).filter((q) => RESEARCH[q]);
      return req.length ? 1 + Math.max(...req.map((q) => depth(q, new Set(seen)))) : 0;
    };
    const cols = [];
    for (const id of ids) { const d = depth(id); (cols[d] ||= []).push(id); }
    html += '<div class="rgraph" aria-label="研究树">';
    for (let d = 0; d < cols.length; d++) {
      const col = cols[d] || [];
      html += `<div class="rcol"><div class="rcolhead">${d === 0 ? '起点' : `第 ${d} 层`}</div>`;
      for (const id of col) {
        const r = RESEARCH[id];
        const req = (r.req || []).map((q) => RESEARCH[q] && RESEARCH[q].name).filter(Boolean);
        html += `<div class="rnode">${researchNodeHTML(state, id, false)}${req.length ? `<div class="rreq">← ${req.join('、')}</div>` : '<div class="rreq root">从这里开始</div>'}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="ptip">档案来自遗迹碑与大潮 · 软分支：两条都能拿，第二条贵 ×3 · 知识不能买，只能发现</div>';
  return html;
}

// —— 解析台面板：残页收藏 + 知识清单（真正解锁仍走研究面板，这里给"带回来"的感觉）——
function renderAnalyze(state) {
  const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
  if (!b || b.site) return '<div class="psec">解析台不在了（被拆/被打掉）。重新建一个吧</div>';
  let html = '<div class="psec">残页收藏 · 集齐一个系列就读懂一件事</div>';
  for (const row of relicRows(state)) {
    const got = row.have.map((i) => RELIC_SERIES[row.id].parts[i]).join('、');
    html += `<div class="rrow ${row.full ? 'ready' : ''}">
      <span class="rname"><i class="rsi" style="color:${row.full ? '#7fe8d8' : '#c9a0ff'}">${icon(row.full ? 'done' : 'data', 13)}</i>${row.name}</span>
      <span class="rstate">${row.have.length}/${row.need}</span>
      <span class="rdesc">${got ? '已有：' + got : '还没有'}${row.full ? ' · 集齐' : ' · 还差 ' + row.missing.join('、')}</span></div>`;
    html += `<div class="rtip">${row.desc}</div>`;
  }
  const knowIds = RESEARCH_ORDER.filter((x) => RESEARCH[x].sect === 'know');
  html += '<div class="psec">知识清单（在「研究」→ 知识 分区里解析）</div>';
  for (const id of knowIds) {
    const r = RESEARCH[id];
    const done = hasTech(state, id);
    const seen = done || knowSeenId(state, id);
    html += `<div class="rrow ${done ? 'ready' : seen ? '' : 'dim'}">
      <span class="rname"><i class="rsi" style="color:${done ? '#7fe8d8' : seen ? '#a88cff' : '#8b93a6'}">${icon(done ? 'done' : seen ? 'know' : 'lock', 13)}</i>${seen ? r.name : '？？？'}</span>
      <span class="rstate">${done ? '已解析' : seen ? '可解析' : '无线索'}</span>
      <span class="rdesc">${seen ? r.desc : (r.hint || '')}</span></div>`;
  }
  html += '<div class="ptip">图鉴击杀数、伤过的身体、被安抚回来的同伴，都算线索</div>';
  return html;
}

function renderCodex(state) {
  let html = '<div class="psec">击杀达标 → 解锁档案 · 对其伤害 +15%</div>';
  for (const k in CODEX) {
    const d = CODEX[k];
    const e = state.codex[k] || { kills: 0, unlocked: false };
    // 抗性那半句由抗性表生成（data/codex.js weakTextOf）—— 改表就改文案，不可能分家
    const wt = weakTextOf(k);
    // 没解锁的条目不进 desc/弱点（不然搜“畏光”会提前把夜枭的档案挖出来）
    const hay = hayOf(d.name, e.unlocked ? d.desc : '', e.unlocked ? wt : '', e.unlocked ? d.tactic : '');
    html += `<div class="cx ${e.unlocked ? 'on' : ''}" data-kind="${k}" data-hay="${escAttr(hay)}">
      <div class="cx-h"><span>${d.name}</span><span data-live="kills">${e.kills}/${d.need}${e.unlocked ? ' · 已解锁' : ''}</span></div>
      ${e.unlocked
        ? `<div class="cx-body">${codexArt(k)}<div class="cx-d">${d.desc}<br><b>弱点：</b>${wt}<br><b>打法：</b>${d.tactic || '—'}<br><b>加成：</b>对其伤害 +15%</div></div>`
        : '<div class="cx-d dim">击杀达标后解锁档案</div>'}
    </div>`;
  }
  return html;
}

// 图鉴立绘（W13-F）：有素材就 96×96 最近邻摆左边；没有就纯文字（不占位）
function codexArt(kind) {
  const key = CODEX_ART[kind];
  const sp = specOf(key);
  if (!hasAsset(key) || !sp) return '';
  return `<img class="cx-art" src="${sp.src}" alt="" width="96" height="96">`;
}

// 面板注册表：快捷键不给代号，只给 **keymap 里的动作 id**（改键后标签与响应一起变）
// tab:false = **不占底部标签位**（靠走近方块按 E 打开）—— 不然功能方块一多，那一行根本放不下
// 载荷：错误/成功提示飘在塔头上（比在玩家头上更容易找到是哪座塔出的问题）
function loadFx(state, b, txt) {
  state.floaties.push({
    x: b ? b.x + 0.5 : state.player.x, y: b ? b.y + 0.25 : state.player.y - 0.9,
    txt, color: '#ff9d5c', t: 0, life: 1.1,
  });
}

// —— 载荷面板（W14-A 第 2 步）：站在塔旁按 E ——
// 【为什么复用 .brow】面板里所有行样式（焦点环 .foc、置灰 .poor、悬停高亮）都挂在 .brow 上，
//   另立一套 class 就得再写一份 CSS，而且焦点/回车机制（FOCUS_SEL）会跟着分家。
// 【数值只来自 payloadStats】面板不许自己乘一遍 —— 否则面板和塔算出来的 DPS 会对不上（B13 的教训）。
function renderPayload(state) {
  const b = state.payloadRef && (state.buildings || []).find((x) => x === state.payloadRef);
  const def = b ? BUILD[b.type] : null;
  if (!b || !def || !def.dmg) return '<div class="psec">载荷</div><div class="ptip warn">这座塔不在了 —— 关掉面板再选一座</div>';
  const slots = slotsOf(state);
  const mods = (b.mods || []).filter((m) => MODS[m]);
  const lv = b.level || 1;
  const ps = payloadStats(def, mods, lv);
  let html = `<div class="psec">载荷 · ${ps.name}（Lv${lv}）</div>`;
  html += `<div class="ptip">${def.name}（${TYPE_NAME[ps.类型] || ps.类型}） · 单发 ${ps.单发} · 每秒 ${ps.每秒} · 射程 ${ps.射程} · 命中上限 ${ps.命中上限}${ps.线 ? `（沿线 ${ps.线}）` : ''}</div>`;
  if (ps.链) html += `<div class="ptip">连锁：命中后跳 ${ps.链.跳} 格内下一个目标 · 最多 ${ps.链.最多} 跳 · 每跳 ×${ps.链.每跳}（潜在 ×${ps.链.倍率}，多靶每秒 ${ps.多靶每秒}）</div>`;
  html += `<div class="ptip">每发燃耗 ${ps.每发燃耗} · 每秒烧 ${ps.燃耗每秒} 燃料${ps.减速 ? ` · 减速 ${Math.round((1 - ps.减速.mul) * 100)}%（${ps.减速.secs} 秒）` : ''}${ps.净化半径 ? ` · 净化半径 ${ps.净化半径}` : ''}</div>`;
  if (def.needsBeam) {
    const lit = beamNeighbor(state, b);
    html += `<div class="ptip${lit ? '' : ' warn'}">${lit ? '✓ 已接上光路（旁边那面棱镜亮着）' : '⚠ 未接光：旁边要有一面被点亮的棱镜 —— 光路断一环就熄火'}</div>`;
  }
  // —— 等级与升级（第 6 步）：预览数字与实战数字同源（payloadStats）——
  html += `<div class="psec">等级</div>`;
  {
    const err = upgradeError(state, b);
    const cost = upgradeCostFor(b.type, lv);
    const maxed = lv >= TOWER_LV_MAX;
    if (maxed) {
      html += `<div class="brow active"><span class="bkey">Lv${lv}</span><span class="bicon">${icon('ok')}</span>
        <span class="bname">已满级</span><span class="bstate">${icon('ok', 12)} 满</span>
        <span class="bdesc">单发 ×${TOWER_LV[lv - 1].dmg} · 射程 ×${TOWER_LV[lv - 1].range} · 结构 ×${TOWER_LV[lv - 1].hp}</span></div>`;
    } else {
      const up = payloadStats(def, mods, lv + 1);
      const hpNow = towerHp(def, lv), hpUp = towerHp(def, lv + 1);
      html += `<div class="brow ${err ? 'poor' : 'ready'}" data-act="upgrade" data-hay="${escAttr(hayOf('升级 Lv' + (lv + 1), costTextOf(cost), '塔的成长'))}"
          title="${err ? err : `升级：单发 ${ps.单发} → ${up.单发} · 射程 ${ps.射程} → ${up.射程} · 结构 ${hpNow} → ${hpUp}（升完满血）`}">
        <span class="bkey">Lv${lv}→${lv + 1}</span><span class="bicon">${icon(err ? 'lock' : 'lockOpen')}</span>
        <span class="bname">升级到 Lv${lv + 1}</span>
        <span class="bstate">${icon(err ? 'no' : 'ok', 12)} ${err ? '条件不足' : costTextOf(cost)}</span>
        <span class="bdesc">单发 ${ps.单发} → ${up.单发} · 射程 ${ps.射程} → ${up.射程} · 结构 ${hpNow} → ${hpUp}${err ? ` · <em class="bwork">${err}</em>` : ''}</span></div>`;
    }
  }
  html += `<div class="psec">槽位</div>`;
  for (let i = 0; i < Math.max(slots, 1); i++) {
    const id = mods[i];
    if (id) {
      html += `<div class="brow active" data-slot="${i}" data-hay="${escAttr(hayOf('拆下 卸下', MODS[id].name, MODS[id].desc))}"
          title="点一下把「${MODS[id].name}」拆下来（数值当场回到未装状态）">
        <span class="bkey">${i + 1}</span><span class="bicon">${icon('ok')}</span>
        <span class="bname">${MODS[id].name}</span>
        <span class="bstate">${icon('lockOpen', 12)} 拆下</span>
        <span class="bdesc">${MODS[id].desc}</span>
      </div>`;
    } else {
      html += `<div class="brow poor">
        <span class="bkey">${i + 1}</span><span class="bicon">${icon('lock')}</span>
        <span class="bname">空槽</span><span class="bstate">待装配</span>
        <span class="bdesc">从下面挑一个修饰器装上</span>
      </div>`;
    }
  }
  if (slots <= 0) html += `<div class="bnote warn">还没有载荷槽 —— 去「研究」里解锁「${RESEARCH[SLOT_TECHS[0]].name}」（${costTxtOf(state, SLOT_TECHS[0])}）</div>`;
  else if (slots < MAX_SLOTS) html += `<div class="bnote">研究「${RESEARCH[SLOT_TECHS[slots]].name}」可以再加一个槽（现在 ${slots}/${MAX_SLOTS}）</div>`;
  else html += `<div class="bnote">三个槽全开：装上不同的东西，同一座塔能变出不同武器</div>`;
  html += `<div class="psec">修饰器（装一个 = 每发多烧 ${FUEL_PER_MOD} 燃料）</div>`;
  for (const id of MOD_ORDER) {
    const m = MODS[id];
    const on = mods.includes(id);
    const shapeClash = !on && m.shape && mods.some((x) => MODS[x] && MODS[x].shape);
    const full = !on && !shapeClash && mods.length >= slots;
    const cls = on ? 'active' : (shapeClash || full) ? 'poor' : 'ready';
    const note = on ? '已装载' : shapeClash ? '与已装形状类冲突' : full ? (slots <= 0 ? '需要载荷槽' : '槽位已满') : '装上';
    const ico = on ? 'ok' : (shapeClash || full) ? 'no' : 'lockOpen';
    html += `<div class="brow ${cls}" data-mod="${id}" data-hay="${escAttr(hayOf(m.name, m.desc, '修饰器 载荷'))}" title="${m.desc}">
      <span class="bkey">＋</span><span class="bicon">${icon(ico)}</span>
      <span class="bname">${m.name}</span>
      <span class="bstate">${icon(ico, 12)} ${note}</span>
      <span class="bdesc">${m.desc}<em class="bwork">每发 +${FUEL_PER_MOD} 燃料</em></span>
    </div>`;
  }
  html += `<div class="ptip">装/拆当场生效 · 拆掉这座塔，装上的修饰器也一起没了 · 燃料扣不出来时塔会熄火</div>`;
  // —— 结构装载体（W14-A 第 5 步 5b）：这里只**说明**，真正的装卸要按住 V ——
  // 【为什么不放一个可点的按钮】装配载荷是"点一下生效"，而背负是"停下来按住 2.2 秒" ——
  //   放个能点的按钮等于绕过那条代价，阵地战的意义就没了。
  {
    const car = state.carried;
    const line = car === b
      ? '已背在背上：跟着你走、用你身上的光开火 —— 移动中射速减半、每发燃耗 ×1.5 · 按住 V 就地放下'
      : car
        ? `背上已经背着 ${BUILD[car.type].name} —— 先按住 V 放下它，才能再背别的`
        : !hasTech(state, 'carrier')
          ? '「背负支架」（研究 · 深渊）解锁后，可以背起一座塔跟着你走'
          : '按住 V 背起它：占 1 背包格 · 移动中射速减半 · 每发燃耗 ×1.5（0 槽也有底价）· 被啃掉就真丢';
    html += `<div class="psec">结构体（背在身上）</div><div class="ptip">${line}</div>`;
  }
  return html;
}

const NO_TAB = { tab: false };
export const PANELS = [
  { id: 'build', action: 'panelBuild', label: '建造', render: renderBuild },
  { id: 'night', action: 'panelNight', label: '夜行', render: renderNight },
  { id: 'research', action: 'panelResearch', label: '研究', render: renderResearch },
  { id: 'codex', action: 'panelCodex', label: '图鉴', render: renderCodex },
  { id: 'pack', action: 'panelPack', label: '背包', render: renderPack },
  { id: 'crew', action: 'panelCrew', label: '拓荒队', render: renderCrew },
  { id: 'store', action: null, label: '容器', render: renderStore, ...NO_TAB },     // 站在容器旁按 E 打开
  { id: 'bench', action: null, label: '制造台', render: renderBench, ...NO_TAB },    // 站在制造台旁按 E 打开
  { id: 'furnace', action: null, label: '熔炉', render: renderFurnace, ...NO_TAB },  // 配方站：产出取决于选中配方
  { id: 'smelter', action: null, label: '自动熔炉', render: renderSmelter, ...NO_TAB },   // 自动熔炉面板（以前叫「操作台」，与建筑本名不一致）
  { id: 'clinic', action: null, label: '医疗站', render: renderClinic, ...NO_TAB },
  { id: 'analyze', action: null, label: '解析台', render: renderAnalyze, ...NO_TAB },   // 知识锁的物理载体：站在解析台旁按 E
  { id: 'payload', action: null, label: '载荷', render: renderPayload, ...NO_TAB },   // 站在塔旁按 E：装/拆修饰器
];
// 底部标签条上真正会出现的那些（Tab 轮换也读它）
export const TAB_PANEL_IDS = PANELS.filter((p) => p.tab !== false).map((p) => p.id);

// tab 条上显示当前绑定（与设置页/键位表同源）
export function panelKeyLabel(p) { return p.action ? keyLabel(boundCode(p.action)) : ''; }

function syncFlags(state) {
  state.activePanel = activeId;
  state.researchOpen = activeId === 'research';   // 兼容既有状态字段
  state.codexOpen = activeId === 'codex';
  focusKey = null;                                 // 换面板：焦点不跟着跑
  state._panelSig = null;                          // 强制重绘
}

export function togglePanel(state, id) {
  const willOpen = activeId !== id;
  activeId = willOpen ? id : null;
  if (willOpen && id === 'store') state._storeSeen = null;   // 开一趟容器就重算一遍（不留上一趟的空行）
  syncFlags(state);
  renderPanelHost(state);
}

export function closePanel(state) {
  // 注意：这里**不能**因为 activeId 已经是 null 就直接 return ——
  // state.activePanel 只是 activeId 的镜像，万一外部（调试口子/旧存档）把它写成非 null，
  // 面板会永远显示“开着”。镜像要能自愈。
  activeId = null;
  syncFlags(state);
  renderPanelHost(state);
}

// 站在容器旁按 E：打开容器面板（无快捷键的面板，由 interact 申请）
export function openStorePanel(state, container) {
  state.storeRef = container && container.ref ? container.ref : null;
  state._storeSeen = null;                 // 每次打开重新算「这一趟有哪些东西」——上一趟的余行不留
  activeId = 'store';
  syncFlags(state);
  renderPanelHost(state);
}

// 站在配方站/解析台旁按 E：按站点类型打开对应面板
export function openStationPanel(state, b) {
  state.stationRef = b || null;
  const def = b ? BUILD[b.type] : null;
  const sid = def && def.station ? def.station : 'bench';
  activeId = sid === 'furnace' ? 'furnace'
    : sid === 'smelter' ? 'smelter'
      : sid === 'clinic' ? 'clinic'
      : sid === 'analyze' ? 'analyze' : 'bench';
  syncFlags(state);
  renderPanelHost(state);
}

// 站在塔旁按 E：打开载荷面板（与容器/操作台同一条路：interact 只申请，UI 自己开）
export function openPayloadPanel(state, b) {
  state.payloadRef = b || null;
  activeId = 'payload';
  syncFlags(state);
  renderPanelHost(state);
}

// —— 面板内键盘：Enter 确认“鼠标指着的那一行” ——
// 为什么焦点来源是**悬停**而不是方向键：全作都是鼠标优先的界面，而且方向键还要当移动保底，
// 一旦被面板抢走，用方向键走路就会在面板里乱跳。所以规则很短：指着哪一行 → 回车就是点它。
const FOCUS_SEL = {
  build: '.brow[data-type]', research: '.rs[data-id]',
  night: '.nrow[data-order]', furnace: '[data-recipe-pick]', smelter: '[data-recipe-pick]',
  bench: '[data-act="craft"]', codex: '.cx[data-kind]',
  payload: '.brow[data-mod], .brow[data-slot]',
  pack: '.packrow',
  crew: '[data-crew-role], [data-crew-care], [data-crew-mode], [data-crew-area], [data-crew-outpost], [data-crew-outpost-mode], [data-crew-night], [data-crew-rescue]',
};
let focusKey = null;                 // 形如 "type:lamp"，跨重建有效（重建后按 key 重新找回来）
function focusableRows() {
  const host = document.getElementById('panel');
  const sel = FOCUS_SEL[activeId];
  if (!host || !sel) return [];
  // 被筛选藏起来的行不算焦点：否则回车会点到一个你看不见的行上
  return Array.from(host.querySelectorAll(sel)).filter((el) => el.offsetHeight > 0);
}
function rowKey(el) {
  const d = el.dataset;
  if (d.type) return `type:${d.type}`;
  if (d.id) return `id:${d.id}`;
  if (d.mod) return `mod:${d.mod}`;                  // 载荷：装上（否则回车会退回第一行 = 装错东西）
  if (d.slot != null) return `slot:${d.slot}`;       // 载荷：拆下
  if (d.order) return `order:${d.order}`;
  if (d.kind) return `kind:${d.kind}`;
  if (d.recipePick) return `recipePick:${d.recipePick}`;
  if (d.act) return `act:${d.act}`;
  return null;
}
function elByKey(key) {
  if (!key) return null;
  const i = key.indexOf(':');
  const k = key.slice(0, i), v = key.slice(i + 1);
  const host = document.getElementById('panel');
  return host ? host.querySelector(`[data-${k}="${v}"]`) : null;
}
function applyFocusRing() {
  const host = document.getElementById('panel');
  if (!host) return;
  for (const r of host.querySelectorAll('.foc')) r.classList.remove('foc');
  const el = focusKey ? elByKey(focusKey) : null;
  if (el) el.classList.add('foc');
}
// 鼠标移到某一行上：它就是回车要点的目标
export function panelHoverAt(target) {
  if (!target) return;
  const rows = focusableRows();
  for (const r of rows) {
    if (r === target || r.contains(target)) {
      focusKey = rowKey(r);
      applyFocusRing();
      return;
    }
  }
}
// 回车：有焦点就点它，没焦点就点本面板的第一行
export function panelConfirm() {
  const rows = focusableRows();
  if (!rows.length) return false;
  const el = (focusKey ? elByKey(focusKey) : null) || rows[0];
  focusKey = rowKey(el);
  applyFocusRing();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
export function panelFocusInfo() { return { panel: activeId, key: focusKey, rows: focusableRows().length }; }

// 面板宿主 + 标签条渲染（每帧调用）
//
// 【为什么不能一有变化就重建 DOM】
//   innerHTML 重建会销毁 .pbody 与滚动条本身 —— 你正在拖的那个滚动条会被浏览器取消，
//   布局也要重算一次。而 ore/vine/fuel 这类字段工人每采一次矿就变（≈6 次/秒），
//   于是“滑动卡顿 + 被弹回顶部”。所以这里拆成两层：
//     ① 结构签名（解锁数、选中项、分类、昼夜相位…）变了才重建，并保留滚动位置
//     ② 其余（资源数、工地数、击杀数、夜辉草数）走 refreshLive() 原位改文字/class
function codexUnlocked(state) {
  let n = 0;
  for (const k in (state.codex || {})) if (state.codex[k] && state.codex[k].unlocked) n += 1;
  return n;
}
function codexKills(state) {
  let n = 0;
  for (const k in (state.codex || {})) n += (state.codex[k] && state.codex[k].kills) || 0;
  return n;
}
function costTxtOf(state, id) {
  const c = costOf(state, id);
  const txt = [c.data ? `${c.data} 档案` : '', c.core ? `${c.core} 母髓` : '', c.night ? `${c.night} 夜髓` : ''].filter(Boolean).join(' · ');
  return txt || '免费（只需线索）';
}
function errSuffixOf(state, id, err) {
  return (err && err !== '已解锁') ? ' · ' + err : '';
}

let liveSig = null;
let scrollMemo = { key: null, top: 0 };      // 每个面板各自的滚动位置（重建时恢复）
export function renderPanelHost(state) {
  const barEl = document.getElementById('panelbar');
  const hostEl = document.getElementById('panel');
  if (!barEl || !hostEl) return;
  const p = PANELS.find((x) => x.id === activeId) || null;
  const struct = `${activeId || ''}|${state.building || ''}|${state.buildCat || ''}|${state.layerId || ''}`
    + `|${state.researchVersion || 0}|${Object.keys((state.research && state.research.unlocked) || {}).length}`
    + `|${codexUnlocked(state)}|${state.order || 'auto'}`
    + `|${state.patrol ? state.patrol.dx + ',' + state.patrol.dy : ''}`
    + `|${phaseIndexOf(state)}|${p ? 'open' : 'shut'}`
    + `|${activeId === 'crew' ? allCrewWorkers(state).map((w) => {
      const d = w.directive || {};
      return `${w.crew && w.crew.id || w.name}:${w.crew && w.crew.role || ''}:${w.job || 'idle'}:${w.hp | 0}:${w.hunger | 0}:${w.morale | 0}:${d.mode || 'auto'}:${d.noNight ? 1 : 0}:${d.outpost ? `${d.outpost.x},${d.outpost.y}` : ''}:${d.outpostMode || ''}:${d.area ? `${d.area.x},${d.area.y}` : ''}:${d.rescue || 'normal'}:${d.care || 'neutral'}`;
    }).join(';') : ''}|M${activeId === 'crew' ? (state.memorial || []).length : 0}`;
  // 注意：外部把 state._panelSig 置 null（切面板/选中方块/解锁研究…）同样会被判为“结构变了”
  if (state._panelSig !== struct) {
    const prevBody = hostEl.querySelector('.pbody');
    const prevTop = (prevBody && scrollMemo.key === (activeId || null)) ? prevBody.scrollTop : 0;
    state._panelSig = struct;
    liveSig = null;                                   // 重建后强制走一次增量刷新
    let tabs = '';
    // 「快捷建造」不是面板：它只开关下面那一条（点它不会开右侧页面 —— 那页和 B 建造完全重复）
    {
      const kb = keyLabel(boundCode('hotbarToggle'));
      tabs += `<button type="button" class="ptab sw ${state.hotbarOpen ? 'on' : ''}" data-hotbar="1" aria-expanded="${state.hotbarOpen ? 'true' : 'false'}">${kb ? `<b>${kb}</b> ` : ''}快捷建造 ${state.hotbarOpen ? '▲' : '▼'}</button>`;
    }
    for (const item of PANELS) {
      if (item.tab === false) continue;                    // 站台面板不占标签位（走近按 E 开）
      const on = item.id === activeId;
      const extra = item.id === 'build' && state.building && BUILD[state.building] ? ` · ${BUILD[state.building].name}` : '';
      const kb = panelKeyLabel(item);
      tabs += `<button type="button" class="ptab ${on ? 'on' : ''}" data-panel="${item.id}" aria-pressed="${on ? 'true' : 'false'}">${kb ? `<b>${kb}</b> ` : ''}${item.label}${extra}</button>`;
    }
    barEl.innerHTML = tabs;
    if (!p) {
      hostEl.classList.add('hidden');
      hostEl.innerHTML = '';
      scrollMemo = { key: null, top: 0 };
      return;
    }
    hostEl.classList.remove('hidden');
    hostEl.classList.toggle('research-wide', activeId === 'research');
  hostEl.classList.toggle('station-wide', activeId === 'bench' || activeId === 'furnace' || activeId === 'smelter' || activeId === 'clinic');
    hostEl.classList.toggle('crew-wide', activeId === 'crew');
    // 筛选条放在 phead 与 pbody 之间：pbody 才滚，所以筛选框不会跟着列表滑走
    const filBar = PANEL_FILTER[activeId] ? filterBar(activeId) : '';
    hostEl.innerHTML = `<div class="phead"><span>${p.label}</span><span class="pclose" title="关闭（Esc）">✕</span></div>
    ${filBar}
    <div class="pbody">${p.render(state)}</div>`;
    const body = hostEl.querySelector('.pbody');
    if (body) body.scrollTop = prevTop;               // 恢复滚动位置
    scrollMemo = { key: activeId || null, top: prevTop };
  }
  if (p) refreshLive(state, hostEl);
  if (p && PANEL_FILTER[activeId]) applyPanelFilter(hostEl, state);   // 重建后把当前查询重新盖上去（筛选本身不重建）
  if (p) applyFocusRing();          // DOM 重建后把“回车要点的那一行”重新圈上
}

// —— 原位增量刷新：只改文字与 class，绝不动 DOM 结构，所以永远不会打断滚动 ——
function refreshLive(state, hostEl) {
  const sites = (state.buildings || []).filter((b) => b.site).length;
  const ops = state.layers && state.layers.surface ? state.layers.surface.nightops : null;
  const blooms = ops ? ops.blooms.filter((b) => b.alive && b.charges > 0).length : 0;
  const vents = ops ? ops.vents.length : 0;
  const next = ops && ops.vents.length ? Math.max(0, Math.round(Math.min(...ops.vents.map((v) => v.t)))) : -1;
  // 站台自己的状态也得进签名：炉火/进度/缺料变了就要重刷那一行（否则它会停在重建那一刻）
  const stB = state.stationRef;
  const stSig = stB ? `${stB.fuel | 0}|${stB.dry || ''}|${(stB.prog || 0).toFixed(1)}` : '';
  const clinicSig = activeId === 'clinic' && stB ? `${stB.medicalWorker && stB.medicalWorker.name || ''}|${(state.medicalQueue || []).filter((w) => w && w.medicalClinic === stB && w.medicalState === 'queued').length}` : '';
  // 容器面板：行里的数字看的是**容器自己的库存**，而容器↔容器搬运（取1/存1/拖拽/补给站送油）
  // 并不改总账（state.res 是聚合值）——只靠资源签名的话，面板开着时这些数字会停住不动。
  const roll = (o) => { let n = 0; for (const k in o) n += o[k] || 0; return n; };
  let stgSig = '';
  if (activeId === 'store' && state.storeRef) {
    const c = allContainers(state, false).find((x) => x.ref === state.storeRef);
    stgSig = c ? `${roll(c.ref.stock)}|${roll(state.pack.stock)}` : 'x';
  }
  const sig = `${state.res.ore}|${state.res.vine}|${state.res.fuel}|${state.res.food}|${state.res.data || 0}|${state.res.core || 0}|${state.res.night || 0}|${sites}|${codexKills(state)}|${blooms}|${vents}|${next}|${stSig}|${clinicSig}|${stgSig}`;
  if (sig === liveSig) return;
  liveSig = sig;
  const set = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };
  // 带图标的原位刷新：不能用 textContent（那会把状态图标抹掉），用 _k 缓存避免每帧重拼 HTML
  const setRich = (el, ico, txt) => {
    if (!el) return;
    const k = ico + '|' + txt;
    if (el._k === k) return;
    el._k = k;
    el.innerHTML = `${icon(ico, 12)} ${txt}`;
  };

  if (activeId === 'build') {
    for (const row of hostEl.querySelectorAll('.brow[data-type]')) {
      const type = row.dataset.type;
      const locked = lockedByResearch(state, type);
      const ok = !locked && canAfford(state.res, type);
      row.classList.toggle('ready', ok);
      row.classList.toggle('poor', !ok);
      setRich(row.querySelector('.bstate'), locked ? 'lock' : ok ? 'ok' : 'no', locked ? '未解锁' : ok ? '可建造' : '资源不足');
    }
    const note = hostEl.querySelector('[data-live="sites"]');
    if (note) {
      note.textContent = sites ? `工地上还有 ${sites} 处待建：站过去按 E 自己盖，或等拓荒队白天来盖` : '';
      note.classList.toggle('hidden', !sites);
    }
    const rc = hostEl.querySelector('[data-live="recruit"]');
    if (rc) {
      const full = (state.workers || []).length >= RECRUIT_MAX;
      const afford = !full && Object.keys(RECRUIT_COST).every((k) => (state.res[k] || 0) >= RECRUIT_COST[k]);
      setRich(rc, full ? 'lock' : 'ok', full ? `已满 ${RECRUIT_MAX} 人` : afford ? `招募（现 ${(state.workers || []).length} 人）` : '资源不足');
      rc.parentElement.classList.toggle('ready', afford);
      rc.parentElement.classList.toggle('poor', !afford);
    }
  } else if (activeId === 'research') {
    set(hostEl.querySelector('[data-live="res"]'), `档案 ${state.res.data || 0} · 母髓 ${state.res.core || 0} · 夜髓 ${state.res.night || 0}`);
    for (const node of hostEl.querySelectorAll('.rs[data-id]')) {
      const id = node.dataset.id;
      const r = RESEARCH[id];
      const done = hasTech(state, id);
      const err = researchError(state, id);
      node.classList.toggle('done', done);
      node.classList.toggle('lock', !done && !!err);
      node.classList.toggle('ready', !done && !err);
      set(node.querySelector('[data-live="cost"]'), done ? '已完成' : costTxtOf(state, id));
      set(node.querySelector('.rs-err'), errSuffixOf(state, id, err));
    }
  } else if (activeId === 'codex') {
    for (const row of hostEl.querySelectorAll('.cx[data-kind]')) {
      const d = CODEX[row.dataset.kind];
      const e = state.codex[row.dataset.kind] || { kills: 0, unlocked: false };
      if (d) set(row.querySelector('[data-live="kills"]'), `${e.kills}/${d.need}${e.unlocked ? ' · 已解锁' : ''}`);
    }
  } else if (activeId === 'night') {
    set(hostEl.querySelector('[data-live="blooms"]'), String(blooms));
    set(hostEl.querySelector('[data-live="vents"]'), String(vents));
    set(hostEl.querySelector('[data-live="rest"]'), String(restCount(state)));
    const nx = hostEl.querySelector('[data-live="next"]');
    if (nx) set(nx, next >= 0 ? ` · 约 ${next}s 后喷发（喷发会刷怪并掉落母髓）` : '');
  } else if (activeId === 'pack') {
    const pk = packContainer(state), used = usedOf(pk);
    set(hostEl.querySelector('.psec'), `随身背包 · ${used} / ${pk.cap} 格`);
    for (const k of RES_ORDER.concat(TOOL_ORDER)) set(hostEl.querySelector(`[data-live="pack-${k}"]`), String(pk.ref.stock[k] || 0));
  } else if (activeId === 'store' && state.storeRef) {
    const c = allContainers(state, false).find((x) => x.ref === state.storeRef);
    const pk = packContainer(state);
    if (c) {
      const paintCap = (holder, side) => {
        const used = usedOf(holder);
        const free = Math.max(0, holder.cap - used);
        set(hostEl.querySelector(`[data-live="cap-${side}"]`), `${used} / ${holder.cap}${free > 0 ? ` · 剩 ${free}` : ' · 满'}`);
        const fill = hostEl.querySelector(`.scol[data-side="${side}"] .scbar-fill`);
        if (fill) {
          fill.style.width = `${Math.min(100, (used / holder.cap) * 100).toFixed(1)}%`;
          fill.classList.toggle('full', free <= 0);
        }
      };
      paintCap(c, 'c'); paintCap(pk, 'p');
      // 数量就地更新：变成 0 的行藏起来；出现了面板里没有的新物品 → 重建一次（不每帧重建）
      let needRebuild = false;
      const sync = (holder, side) => {
        const stock = holder.ref.stock || {};
        for (const k of STORE_ORDER) {
          const v = stock[k] || 0;
          const row = hostEl.querySelector(`[data-row="${side}-${k}"]`);
          if (!row) { if (v > 0) needRebuild = true; continue; }
          set(row.querySelector('b'), String(v));
          // 归零就变灰留在原地：**不隐藏**（隐藏等于让下面的行往上顶，连点时会打偏）
          row.classList.toggle('dim', v <= 0);
          for (const btn of row.querySelectorAll('.sbtnx')) btn.classList.toggle('off', v <= 0);
        }
      };
      sync(c, 'c'); sync(pk, 'p');
      if (needRebuild) { state._panelSig = null; renderPanelHost(state); return; }
    }
  } else if (activeId === 'furnace') {
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    const r = b ? RECIPE_OF[recipeForStation(b, BUILD.furnace)] : null;
    const row = hostEl.querySelector('[data-live="stock"]');
    if (row && r) row.textContent = Object.keys(r.cost).map((k) => `${RES_NAME[k]} ${state.res[k] || 0}`).join(' · ');
    if (b) liveFire(hostEl, b, BUILD.furnace, 'f');
  } else if (activeId === 'bench') {
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    if (b) {
      for (const r of recipesOf('bench')) {
        const err = craftError(state, b, r.id);
        const busy = !!(b.craft && b.craft.id === r.id);
        const row = hostEl.querySelector(`.trow[data-recipe="${r.id}"]`);
        if (!row) continue;
        row.classList.toggle('ready', busy || !err);
        row.classList.toggle('poor', !busy && !!err);
        row.classList.toggle('cur', busy);
        set(row.querySelector('[data-live^="rc-"]'), busy ? '制作中…' : (err || '可制作'));
      }
      const prog = hostEl.querySelector('[data-live="prog"]');
      if (prog) {
        const txt = b.craft
          ? `制作中：${RES_NAME[b.craft.id] || RES_NAME[(RECIPE_OF[b.craft.id] || {}).out] || b.craft.id} ${Math.min(99, Math.round(b.craft.t / b.craft.sec * 100))}%`
          : '空闲（一台同时只做一件：想吃并行就多建几台）';
        set(prog, txt);
      }
    }
  } else if (activeId === 'smelter') {
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    if (b) {
      const r0 = RECIPE_OF[b.recipe || 'fuel'];
      liveFire(hostEl, b, BUILD.smelter, 's');
      set(hostEl.querySelector('[data-live="sm-status"]'), smelterStatus(b, state));   // 状态行也要跟着变（不然一直停在重建那一刻）
      // 进度条实时跑（0.15s 过渡由 CSS 做，看着是连的，不是一跳一跳的）
      const pctNow = Math.round(Math.min(1, (b.prog || 0) / smeltSecs(b, state)) * 100);
      const bar = hostEl.querySelector('[data-live="sm-bar"]');
      if (bar) bar.style.width = `${b.off || !(b.fuel > 0) ? 0 : pctNow}%`;
      set(hostEl.querySelector('[data-live="sm-pct"]'), `${b.off || !(b.fuel > 0) ? 0 : pctNow}%`);
      const st = hostEl.querySelector('[data-live="s-stat"]');
      if (st) {
        set(st, `累计已出 ${b.made | 0} 批 · 当前配方：${recipeName(r0 || {})} · 现在：${smelterStatus(b, state)}`);
      }
    }
  }
}


// 面板内点击统一入口
export function panelClick(state, ev) {
  const t = ev.target;
  if (!t || !t.closest) return;
  sfx('click');                     // 面板内任何点击都给一个“嗒”（UI 音量最低档）
  // 误触保护：「一次花一大笔」的按钮（研究解锁 / 招募），260ms 内只算一次。
  // 因为这些点击会让面板重建，双击的第二次会落到重建后的另一个节点上 —— 那就会白花一份档案。
  if (t.closest('.rs, [data-tool="recruit"]')) {
    const now = performance.now();
    if (state._spendAt && now - state._spendAt < 260) return;
    state._spendAt = now;
  }
  const tab = t.closest('.ptab');
  if (tab) {
    if (tab.dataset.hotbar) toggleHotbar();          // 快捷建造：只开关下面那一条
    else togglePanel(state, tab.dataset.panel);
    return;
  }
  const close = t.closest('.pclose');
  if (close) { closePanel(state); return; }
  if (activeId === 'crew') {
    const workerId = (t.closest('[data-worker]') || {}).dataset && (t.closest('[data-worker]') || {}).dataset.worker;
    const w = findCrewWorker(state, workerId);
    if (w) {
      const mode = t.closest('[data-crew-mode]');
      const role = t.closest('[data-crew-role]');
      const care = t.closest('[data-crew-care]');
      const area = t.closest('[data-crew-area]');
      const outpost = t.closest('[data-crew-outpost]');
      const outpostMode = t.closest('[data-crew-outpost-mode]');
      const night = t.closest('[data-crew-night]');
      const rescue = t.closest('[data-crew-rescue]');
      let note = '';
      if (role) {
        const card = assignRole(w, role.dataset.crewRole);
        if (card) {
          recordCrewEvent(w, 'role', `改为${COLONISTS.ROLES[card.role].name}`, state.day || 1);
          note = `${w.name} 职业改为${COLONISTS.ROLES[card.role].name}`;
        }
      } else if (care) {
        const next = care.dataset.crewCare;
        const patch = { care: next };
        if (next === 'guard') patch.mode = 'guard';
        else if (w.directive && w.directive.mode === 'guard') patch.mode = 'auto';
        if (next === 'rescue') patch.rescue = 'high';
        else if (next === 'medical') patch.rescue = 'normal';
        setDirective(w, patch);
        note = `${w.name}：${crewCareLabel(next)}`;
      } else if (mode) { setDirective(w, { mode: mode.dataset.crewMode }); note = `已将 ${w.name} 调为${mode.dataset.crewMode === 'auto' ? '自动' : crewModeLabel(mode.dataset.crewMode)}`; }
      else if (area) {
        setDirective(w, { area: area.dataset.crewArea === 'clear' ? null : { x: state.chunkX | 0, y: state.chunkY | 0 } });
        note = area.dataset.crewArea === 'clear' ? `已清除 ${w.name} 的工作区` : `${w.name} 工作区设为当前区块`;
      } else if (outpost) {
        const withdrawing = outpost.dataset.crewOutpost === 'withdraw';
        setDirective(w, { outpost: withdrawing ? null : { x: state.chunkX | 0, y: state.chunkY | 0 }, outpostMode: withdrawing ? null : (w.directive && w.directive.outpostMode) || 'guard' });
        note = withdrawing ? `已登记撤回 ${w.name}` : `${w.name} 已接到前往当前区块的命令`;
      } else if (outpostMode) {
        const mode = outpostMode.dataset.crewOutpostMode;
        setDirective(w, { outpost: w.directive && w.directive.outpost ? w.directive.outpost : { x: state.chunkX | 0, y: state.chunkY | 0 }, outpostMode: mode });
        note = `${w.name} 前哨意图：${crewOutpostLabel(mode)}`;
      } else if (night) { setDirective(w, { noNight: !w.directive || !w.directive.noNight }); note = w.directive.noNight ? `${w.name} 今晚不排夜班` : `${w.name} 恢复夜班许可`; }
      else if (rescue) { setDirective(w, { rescue: (!w.directive || w.directive.rescue !== 'high') ? 'high' : 'normal' }); note = `${w.name}：${w.directive.rescue === 'high' ? '优先救援' : '常规救援'}`; }
      if (note) {
        state.toast = { txt: note, at: performance.now() };
        state._panelSig = null; state._sidebarSig = null;
        renderPanelHost(state);
      }
    }
    return;
  }
  const fil = t.closest('[data-act="fil-clear"]');
  if (fil) {                                        // 清空筛选：只改 DOM，不重建（重建会把输入框的焦点丢掉）
    const hostEl = document.getElementById('panel');
    clearPanelQuery(fil.dataset.filter, hostEl);
    applyPanelFilter(hostEl, state);
    return;
  }
  const tool = t.closest('[data-tool]');
  if (tool && activeId === 'build') {
    if (tool.dataset.tool === 'demolish') { toggleDemolish(); closePanel(state); }
    else if (tool.dataset.tool === 'recruit') { doRecruit(); renderPanelHost(state); }
    return;
  }
  const cat = t.closest('[data-cat]');
  if (cat && activeId === 'build') {                       // 分类 chip：只切分类，不动选择
    state.buildCat = cat.dataset.cat;
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  const sect = t.closest('[data-sect]');
  if (sect && activeId === 'research') {                    // 研究分区 chip
    state.resSect = sect.dataset.sect;
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  // 载荷：装（[data-mod]）/ 拆（[data-slot]）—— 校验一律走 loadError（塔、检测器、读档同一套规则）
  const modEl = t.closest('[data-mod]');
  const slotEl = t.closest('[data-slot]');
  // 载荷面板的「升级」（第 6 步）：塔的就地成长 —— 一条轴管一件事（槽位仍归研究）
  const upEl = t.closest('[data-act="upgrade"]');
  if (upEl && activeId === 'payload') {
    const b = state.payloadRef && (state.buildings || []).find((x) => x === state.payloadRef);
    const err = b ? upgradeBuilding(state, b) : '这座塔不在了';
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if ((modEl || slotEl) && activeId === 'payload') {
    const b = state.payloadRef && (state.buildings || []).find((x) => x === state.payloadRef);
    if (!b || !BUILD[b.type] || !BUILD[b.type].dmg) {
      loadFx(state, b, '这座塔不在了');
    } else {
      const slots = slotsOf(state);
      const cur = (b.mods || []).filter((m) => MODS[m]);
      const next = modEl ? cur.concat(modEl.dataset.mod) : cur.filter((_, i) => i !== Number(slotEl.dataset.slot));
      const err = (modEl && slots <= 0) ? '还没有载荷槽 —— 先研究「载荷学」' : loadError(next, slots);
      if (err) loadFx(state, b, err);
      else {
        b.mods = next;
        b._ps = null;                 // 数值缓存失效：statsOf 下一帧按新载荷重算（塔随即变强/变弱）
        sfx('craft', { x: b.x + 0.5, y: b.y + 0.5 });
      }
    }
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  const mv = t.closest('[data-act]');
  // 选配方（熔炉 / 自动熔炉）
  const pick = t.closest('[data-recipe-pick]');
  if (pick && (activeId === 'furnace' || activeId === 'smelter')) {
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    const err = b ? setRecipe(state, b, pick.dataset.recipePick) : '站点不在了';
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if (t.closest('[data-act="once"]') && activeId === 'furnace') {   // 熔炉：做一次
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    const err = b ? workOnce(state, b) : '站点不在了';
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    renderPanelHost(state);
    return;
  }
  // 选火种（熔炉 / 自动熔炉共用）：换档会把槽里剩的退回容器，避免“木炭被当成藤木烧”
  const fire = t.closest('[data-fire-pick]');
  if (fire && (activeId === 'furnace' || activeId === 'smelter')) {
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    const err = b ? setFireMat(state, b, fire.dataset.firePick) : '站点不在了';
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if (mv && (activeId === 'smelter' || activeId === 'furnace')) {   // 加火种 / 熄火开关
    const act = mv.dataset.act;
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    let err = null;
    if (!b) err = '站点不在了';
    else if (act === 'fuel1' || act === 'fuelmax') {
      const def = BUILD[b.type] || {};
      const mat = fireMatOf(b, def);
      const cap = def.maxFuel || 6;
      const want = act === 'fuel1' ? 1 : cap;
      let got = addFire(state, b, want);
      if (!got && (b.fuel || 0) < cap) {
        if (mat === 'vine') err = '藤木不足（点火至少要 1 个）';
        else {                                       // 设定的火种不够 → 自动用藤木引火（并告知）
          b.fireMat = 'vine';
          got = addFire(state, b, want);
          err = got ? `没有${fuelName(mat)} → 自动切到藤木引火` : `${fuelName(mat)}和藤木都不够`;
        }
      }
    } else if (act === 'toggle' && activeId === 'smelter') {
      b.off = !b.off;
      sfx(b.off ? 'extinguish' : 'ignite', { x: b.x + 0.5, y: b.y + 0.5 });
    }
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if (mv && activeId === 'bench') {                        // 制造台：制造 / 装备 / 收好
    const act = mv.dataset.act;
    const b = state.stationRef && (state.buildings || []).find((x) => x === state.stationRef);
    let err = null;
    if (act === 'craft' && b) err = startCraft(state, b, mv.dataset.id);
    else if (act === 'equip') err = equipTool(state, mv.dataset.k);
    else if (act === 'unequip') err = unequipTool(state);
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if (mv && activeId === 'pack') {
    const k = mv.dataset.k;
    const n = mv.dataset.act === 'dropall' ? ((state.pack && state.pack.stock && state.pack.stock[k]) || 0) : 1;
    const got = dropPack(state, k, n);
    if (got) state.toast = { txt: `已丢下 ${RES_NAME[k] || k} ×${got}`, at: performance.now() };
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  if (mv && activeId === 'store') {                        // 容器 ↔ 背包 搬运
    if (mv.classList.contains('off')) return;              // 该行已空（变灰占位），点了不做事
    const c = state.storeRef ? allContainers(state, false).find((x) => x.ref === state.storeRef) : null;
    if (c) {
      const pack = packContainer(state);
      const n = Number(mv.dataset.n) || 1;
      if (mv.dataset.act === 'pull') transfer(state, c, pack, mv.dataset.k, n);
      else transfer(state, pack, c, mv.dataset.k, n);
      state._panelSig = null;
      renderPanelHost(state);
    }
    return;
  }
  const brow = t.closest('.brow');
  if (brow && brow.dataset.type) {
    selectBuild(brow.dataset.type);
    closePanel(state);
    return;
  }
  const node = t.closest('.rs');
  if (node && activeId === 'research') {
    const err = unlockTech(state, node.dataset.id);
    if (err) state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 0.9 });
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  const ord = t.closest('[data-order]');
  if (ord && activeId === 'night') {
    state.order = ord.dataset.order;
    // 选「巡逻」但还没定方向：默认补一个（北），否则指令会空转
    if (state.order === 'patrol' && !state.patrol) state.patrol = { dx: 0, dy: -1, day: state.day };
    state._panelSig = null;
    renderPanelHost(state);
    return;
  }
  const dir = t.closest('[data-dir]');
  if (dir && activeId === 'night') {
    const d = DIRS.find((x) => x.id === dir.dataset.dir);
    if (d) {
      state.patrol = { dx: d.dx, dy: d.dy, day: state.day };
      if ((state.order || 'auto') !== 'patrol') state.order = 'patrol';
    }
    state._panelSig = null;
    renderPanelHost(state);
  }
}
