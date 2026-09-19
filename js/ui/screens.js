// ui/screens.js —— 全屏界面：主菜单 / 新游戏 / 存档 / 设置 / 游戏信息 / 暂停菜单
// 通过 setupScreens({...}) 注入游戏生命周期回调，界面自己只负责显示与导航。
import { state } from '../core/state.js';
import { settings, saveSettings, resetSettings } from '../core/settings.js';
import { DIFFICULTY, DIFF_ORDER } from '../data/difficulty.js';
import { listSaves, deleteSave, prettyTime, slotLabel, latestSlot } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { KEY_ACTIONS, KEY_GROUPS, actionsOf, boundCode, keyLabel, isChanged, isModifierOnly, setKey, resetKey, resetAllKeys, changedCount } from '../data/keymap.js';
import { HINTS } from '../systems/hints.js';
import { hasAsset, specOf } from '../core/assets.js';

const VERSION = 'v0.7-w7';

let hooks = {
  onStart: () => { }, onLoad: () => { }, onSave: () => { },
  onResume: () => { }, onMainMenu: () => { }, onScreenChange: () => { }, onSettingsChanged: () => { },
  onKeysChanged: () => { },
};
export function setupScreens(h) {
  Object.assign(hooks, h || {});
  // 改键捕获：捕获阶段拦下一切（游戏里那些键一个都不会被触发）
  window.addEventListener('keydown', onCaptureKey, true);
  // 主菜单键盘导航（W13-M）：↑↓ / W S 选择，Enter / 空格 确定
  // 纯附加：只在主菜单生效，不影响其它界面与游戏内按键
  window.addEventListener('keydown', (e) => {
    if (screenTop() !== 'main' || capturing) return;
    const items = menuItems();
    if (!items.length) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      menuSel = (menuSel + 1) % items.length; sfx('click'); render(); e.preventDefault(); return;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      menuSel = (menuSel - 1 + items.length) % items.length; sfx('click'); render(); e.preventDefault(); return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      const it = items[menuSel];
      if (!it) return;
      e.preventDefault();
      // 合成一次点击：走的还是鼠标那条路（screenClick → doAction），不另开分支
      const btn = document.querySelector(`#screen .mbtn[data-act="${it.act}"]`);
      if (btn) btn.click();
    }
  });
}

const stack = [];
let newSeed = '';
let newDiff = 'normal';
let infoTab = 'play';
let setTab = 'video';        // 设置分页：video / control / audio / save
let capturing = null;        // 正在改键的动作 id（null = 没在改）
let note = '';

export function screenTop() { return stack.length ? stack[stack.length - 1] : null; }
export function screenOpen() { return stack.length > 0; }

export function openScreen(id) { stack.push(id); note = ''; if (id === 'main') menuSel = 0; render(); }
export function replaceScreen(id) { stack.length = 0; stack.push(id); note = ''; if (id === 'main') menuSel = 0; render(); }
export function backScreen() {
  const top = screenTop();
  if (!top || top === 'main') return;   // 主菜单不能被 Esc 弹出，其余可逐层返回
  stack.pop();
  note = '';
  render();
}
export function closeScreens() { stack.length = 0; note = ''; render(); }
// 素材晚到（W13-F）：主菜单插画是唯一“晚到也要补上”的界面。
// 只改 class/变量，**不重建 DOM** —— 重建会把玩家正在点的那一下换成另一个节点。
export function applyArt() {
  const el = document.getElementById('screen');
  const card = el && el.querySelector('.card');
  if (!card) return;
  const art = (screenTop() === 'main' && hasAsset('title_art')) ? specOf('title_art') : null;
  card.classList.toggle('has-art', !!art);
  if (art) card.style.setProperty('--art', `url('${artUrl(art)}')`);
}

// 自定义属性里的相对 url() 会按**使用它的样式表**（css/screens.css）解析，
// 于是 url('assets/sprites/x.png') 会变成 /css/assets/sprites/x.png → 404（图就白交了）。
// 所以这里一律换成绝对 URL。
function artUrl(art) {
  try { return new URL(art.src, document.baseURI).href; } catch (e) { return art.src; }
}

function setNote(t) { note = t; render(); }

function render() {
  const el = document.getElementById('screen');
  if (!el) return;
  const top = screenTop();
  hooks.onScreenChange(top);
  if (!top) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const wide = (top === 'settings' || top === 'info') ? ' wide' : '';
  // 主菜单占满整屏（封面式）——其它界面仍是居中卡片
  const full = top === 'main' ? ' maincard' : '';
  // 主菜单插画（W13-F）：有 assets/sprites/title_art.png 就当成背景铺上（暗化后不抢文字）
  const art = (top === 'main' && hasAsset('title_art')) ? specOf('title_art') : null;
  const artStyle = art ? ` style="--art:url('${artUrl(art)}')"` : '';
  el.innerHTML = `<div class="scrim"></div><div class="card${wide}${full}${art ? ' has-art' : ''}"${artStyle}>${VIEWS[top]()}</div>`;
}

// —— 各界面内容 ——
// 主菜单（W13-M）：左侧标题块 · 右侧菜单列 · 底部版本与键位
// 选中项用键盘（↑↓）与鼠标（悬停）共同驱动 —— 同一个 menuSel，两条路都只改它
let menuSel = 0;
function menuItems() {
  const latest = latestSlot();
  const items = [];
  if (latest) {
    items.push({
      act: 'continue', label: '继续游戏', primary: true,
      sub: `第 ${latest.data.day} 天 · ${DIFFICULTY[latest.data.diff] ? DIFFICULTY[latest.data.diff].name : '标准'} · ${prettyTime(latest.data.at)}`,
    });
  }
  items.push({ act: 'new', label: '新游戏', sub: '选择种子与难度 · 从头拓荒' });
  items.push({ act: 'load', label: '载入存档', sub: `${listSaves().filter((s) => s.data).length} / 4 个存档` });
  items.push({ act: 'settings', label: '设置', sub: '画面 · 操作 · 声音 · 存档' });
  items.push({ act: 'info', label: '游戏信息', sub: '玩法要点 · 操作 · 键位与关于' });
  return items;
}
function menuButtons() {
  const items = menuItems();
  if (menuSel >= items.length) menuSel = items.length - 1;      // 存档数量会变（刚开局/删了档）
  if (!(menuSel >= 0)) menuSel = 0;
  return items.map((it, i) => `<button class="mbtn${i === menuSel ? ' sel' : ''}${it.primary ? ' primary' : ''}"
      data-act="${it.act}" data-mi="${i}">
      <span class="mbname">${it.label}</span><span class="mbsub">${it.sub}</span></button>`).join('');
}

const VIEWS = {
  main: () => `
    <div class="menu">
      <div class="mtitle">
        <h1 class="title">蚀渊拓荒者</h1>
        <p class="tsub">D E E P &nbsp; L I G H T</p>
        <div class="trule"></div>
        <p class="ttag">光即生命 · 夜即危险 —— 在蚀潮里守住最后一盏灯</p>
        ${note ? `<div class="note">${note}</div>` : ''}
      </div>
      <div class="mside">
        <div class="mbtns">${menuButtons()}</div>
      </div>
      <div class="mfoot">
        <span class="ver">${VERSION} · 原型开发中</span>
        <span class="khint"><b>↑↓</b> 选择 · <b>Enter</b> 确定 · 鼠标也能点</span>
      </div>
    </div>`,

  new: () => `
    <h2>新游戏</h2>
    <div class="psec">世界种子（相同种子 = 相同地图）</div>
    <div class="row">
      <input id="seed-input" class="field" type="text" value="${newSeed || ''}" placeholder="留空 = 随机" maxlength="12">
      <button class="sbtn" data-act="seed-random">随机</button>
    </div>
    <div class="psec">难度</div>
    <div class="diffs">
      ${DIFF_ORDER.map((k) => {
        const d = DIFFICULTY[k];
        return `<div class="diff ${k === newDiff ? 'on' : ''}" data-diff="${k}">
          <div class="dh"><span>${d.name}</span><span class="dtag">${d.tag}</span></div>
          <div class="dd">${d.desc}</div>
          <div class="ds">初始物资 ${Object.entries(d.start).map(([r, v]) => `${COST_NAME[r] || r}${v}`).join(' ')} · 拓荒者 ${d.startWorkers} 人</div>
        </div>`;
      }).join('')}
    </div>
    ${note ? `<div class="note">${note}</div>` : ''}
    <div class="row end">
      <button class="sbtn" data-act="back">返回</button>
      <button class="sbtn primary" data-act="start">开始拓荒</button>
    </div>`,

  load: () => {
    const slots = listSaves();
    const playing = state.started;
    return `<h2>存档</h2>
      <div class="psec">自动存档在每天结束时更新；手动槽位可随时覆盖</div>
      <div class="slots">
        ${slots.map((s) => {
          const d = s.data;
          const diff = d && DIFFICULTY[d.diff] ? DIFFICULTY[d.diff].name : '—';
          return `<div class="slot ${d ? '' : 'empty'}">
            <div class="sinfo">
              <div class="sname">${slotLabel(s.id)}${s.id === 'auto' ? '' : ''}</div>
              ${d ? `<div class="smeta">第 ${d.day} 天 · ${diff} · 击杀 ${d.kills || 0} · ${prettyTime(d.at)}</div>`
            : '<div class="smeta dim">空存档位</div>'}
            </div>
            <div class="sacts">
              <button class="sbtn ${d ? 'primary' : ''}" data-act="load-slot" data-slot="${s.id}" ${d ? '' : 'disabled'}>载入</button>
              ${s.id === 'auto' ? '' : `<button class="sbtn" data-act="save-slot" data-slot="${s.id}" ${playing ? '' : 'disabled'}>保存到此</button>`}
              ${d ? `<button class="sbtn danger" data-act="del-slot" data-slot="${s.id}">删除</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${note ? `<div class="note">${note}</div>` : ''}
      <div class="row end"><button class="sbtn" data-act="back">返回</button></div>`;
  },

  settings: () => {
    const tab = (id, name) => `<span class="itab ${setTab === id ? 'on' : ''}" data-settab="${id}">${name}</span>`;
    let body = '';
    if (setTab === 'video') body = setVideo();
    else if (setTab === 'control') body = setControl();
    else if (setTab === 'audio') body = setAudio();
    else body = setSave();
    return `<h2>设置</h2>
      <div class="tabs">${tab('video', '画面')}${tab('control', '控制')}${tab('audio', '音频')}${tab('save', '存档')}</div>
      ${body}
      ${note ? `<div class="note">${note}</div>` : ''}
      <div class="row end">
        <button class="sbtn" data-act="settings-reset">全部恢复默认</button>
        <button class="sbtn primary" data-act="back">返回</button>
      </div>`;
  },

  info: () => {
    const tabs = [['play', '玩法要点'], ['keys', '操作'], ['about', '关于']];
    let body = '';
    if (infoTab === 'play') {
      body = `<ul class="ul">
        <li><b>光即生命</b>：灯柱与提灯是你的视野，也是蚀兽的目标；白天全图被太阳照亮，黄昏渐暗，<b>蚀潮（夜里）全黑</b>。</li>
        <li><b>白天经营</b>：E 采集辉髓/藤木 → 熔炉炼燃料 → 给灯加油；<b>幽菌田(7)</b> 在光照下长食物。</li>
        <li><b>光就是预算</b>：光源分低/中/高三档（R 键调）—— 视野、防守塔、农田、拓荒者士气抢同一池燃料；<b>越亮越贵</b>。</li>
        <li><b>蚀痕</b>：长期无光的土地会被黑暗腐蚀（紫黑结晶）—— 不可建造、农田停产、蚀兽变强，3 级还会自己渗漏出蚀兽。被光照亮时蚀痕会<b>缓慢消退</b>（但慢于侵蚀，所以仍要主动净化）：光爆立即净化，净光柱(8) 持续净化。</li>
        <li><b>拓荒者</b>：拓荒队会自动采集与抢收；他们需要<b>食物</b>与<b>光照</b>，天黑或蚀潮会回营避难，断粮会掉血。</li>
        <li><b>食物</b>：按 Z 吃口粮；靠营地火或点燃的炉子按 Z 吃热食；<b>引路篝火</b>要食物×8 + 燃料×4，能接回一位拓荒者。</li>
        <li><b>人不是数值</b>：每人 1 专长 + 1 短处（悬停侧栏名册可见）；<b>心志</b>是长期值（失眠 → 疑惧 → 蚀化前兆 → 蚀化），靠光照/饱食/同伴/墓碑回复。心志归零会<b>蚀化</b>：她只朝着光走——按住 E 安抚她（8 燃料），或让净光柱照她 15 秒，是唯一的救人路径。同伴会因阵亡而心志重创并守在墓前，而<b>墓碑会成为营地最亮的光</b>。</li>
        <li><b>夜战</b>：蚀潮涌出蚀兽。防守塔<b>必须在光照中才能开火</b>，所以「点灯 = 铺输出」；空格光爆清场。</li>
        <li><b>夜行</b>（按 N 规划）：蚀潮里黑暗处会长出<b>夜辉草</b>（E 采撷得「夜髓」）；地面上的<b>潮穴</b>会喷发——刷出蚀兽但掉落母髓；全队可下<b>夜间指令</b>：自动 / 夜采 / 守卫（留守维修）/ 巡逻（该方向出怪 -34%，更伤士气）。</li>
        <li><b>大潮（每 7 天）</b>：蚀巢核心降临，会孵化小怪、腐蚀营地灯。击败它即 <b>「序章完成」</b>，之后每 7 天更强。</li>
        <li><b>深渊（y 轴）</b>：研究「深潜学」→ 建竖井下潜。地下永夜，有遗迹碑（档案点数）与母髓；<b>畏光盲蚀兽</b> 在光中会被灼伤——点亮即武器。</li>
        <li><b>每层换一套法则</b>（进层时会提示）：<b>余烬层</b> 光衰减 ×1.6、照明半径 −10% —— 燃料是咽喉，必须带补给；<b>母脉层</b> 照明半径 ×0.5，只有<b>走动时</b>才会以自身为圆心短暂显形（回声视觉）；<b>熔渊之心</b> 唯一光源是<b>岩浆</b>—— 免费但持续灼伤，你烧的不再是燃料，而是生命与空间。</li>
        <li><b>补给站（9 键，只能建在深渊）</b>：存 60 燃料，每 4 秒把 1 燃料分给 6 格内最缺油的灯 —— 深渊里光衰减更快，你不可能来回跑给每盏灯加油。但<b>噬光虫闻得到油味</b>，会转而来啃补给站。</li>
        <li><b>档案点数</b>来自遗迹碑与击杀，用于研究树解锁能力；蚀兽图鉴解锁后对其伤害 +15%。</li>
        <li><b>光路（0 棱镜 / − 诱饵灯）</b>：棱镜自己不产光、不烧燃料，只把落在身上的光<b>接力</b>出去 —— 一条光路能把一盏灯铺到 20 格外，但<b>打断任意一环下游全灭</b>（表层可隔 5 格，余烬层只剩 3 格）。诱饵灯则是一盏<b>不产生任何光</b>的假灯，只把蚀兽引过来（弃车保帅）。</li>
        <li><b>仓储</b>：材料真存在于容器里 —— 采到的料会<b>自动进本层最近的容器</b>（篝火仓 240 / 储物箱 60），<b>本层容器满了就会丢</b>。所以下深渊前先建一个储物箱；跨层搬运靠<b>背包</b>（站在容器旁按 E 开容器面板手动搬）。</li>
      </ul>`;
    } else if (infoTab === 'keys') {
      // 操作页与键位表同源（data/keymap.js）—— 改键后这里也一起变
      const rows = KEY_ACTIONS.map((a) => `<tr><td>${keyLabel(boundCode(a.id))}</td><td>${a.label}${a.hint ? `<span class="dim"> · ${a.hint}</span>` : ''}</td></tr>`).join('');
      body = `<div class="psec">全部键位（与设置 → 控制 同步）</div>
        <table class="kt">${rows}</table>
        <div class="psec">不怎么靠按键的东西</div>
        <table class="kt">
          <tr><td>鼠标悬停</td><td>查看格子 / 建筑 / 工地 / 蚀兽的信息（剩余量、燃料、能不能放、为什么不能）</td></tr>
          <tr><td>鼠标指着谁，${keyLabel(boundCode('interact'))} 就交给谁</td><td>身边挤着好几样可交互的东西时（炉子贴着矿脉、两口井挨着、机器边上还有一块石头）<b>鼠标指哪个就高亮哪个</b>，按 ${keyLabel(boundCode('interact'))} 作用于它；指着空地时自动退回“最近优先”。所以“看到框在矿脉上、按 E 却砍了旁边的树”不会再发生</td></tr>
          <tr><td>悬停侧栏名册</td><td>地图上高亮那位拓荒者，并弹出状态卡（血 / 饱食 / 士气 / 心志 / 专长）</td></tr>
          <tr><td>工地与工期</td><td>左键放下的是<b>工地</b>（立即扣料、不挡路也不发光）—— 站过去<b>按住 ${keyLabel(boundCode('interact'))} 施工</b>，或等拓荒队白天自己来盖；拆工地<b>全额退回</b>材料，已建成的只退一半</td></tr>
          <tr><td>左键按住拖</td><td>建造模式下<b>拖出一个矩形 = 矩形填充</b>（松手才放下，拖的时候看得到范围和格数）；点一下 = 只放一格</td></tr>
          <tr><td><b>Alt</b> + 左键</b></td><td>直接拆掉鼠标下那座（按住可以扫一片）；放错地方用 <b>${keyLabel(boundCode('undo'))}</b> 撤销</td></tr>
          <tr><td>鼠标悬停快捷栏</td><td><b>${keyLabel(boundCode('hotbarToggle'))}</b> 叫出快捷建造栏（底部 9 格 = 当前分类的第 1~9 项，数字键 / 滚轮 / 鼠标点都能选），再按一次收起</td></tr>
        </table>
        <div class="setnote">想改键：主菜单或暂停菜单 → 设置 → <b>控制</b>（点右边的按键就能改，与别的动作冲突时会自动交换）</div>`;
    } else {
      body = `<div class="about">
        <p><b>蚀渊拓荒者 Deep-Light</b> · ${VERSION}</p>
        <p>一台昼夜机：白天经营蓄力，夜里熄灭一切。核心张力来自「光 = 视野 = 输出 = 生命」三位一体。</p>
        <p>技术：纯原生 JavaScript ES Modules + Canvas 2D，零构建、零依赖；存档走 localStorage。</p>
        <p>美术：当前全部由 canvas 程序化绘制（像素风），后续可替换为 AI 生成的像素素材（见 assets/README.md）。</p>
        <p>已完成：引擎（光照/碰撞/寻路/存档）、经营（采集/建造/炼油）、防守（4+2 种蚀兽、2 种塔、图鉴）、
        研究树与多层深渊（母脉/遗迹/畏光兽）、拓荒者与农田食物、UI（侧栏 + 按键面板 + 全流程菜单）。</p>
      </div>`;
    }
    return `<h2>游戏信息</h2>
      <div class="tabs">${tabs.map(([id, label]) => `<span class="itab ${id === infoTab ? 'on' : ''}" data-info="${id}">${label}</span>`).join('')}</div>
      <div class="ibody">${body}</div>
      <div class="row end"><button class="sbtn primary" data-act="back">返回</button></div>`;
  },

  pause: () => `
    <h2>已暂停</h2>
    <div class="psec">第 ${state.day} 天 · ${state.res ? '辉髓 ' + state.res.ore + ' · 藤木 ' + state.res.vine : ''} · 想快速冻结用 P</div>
    <div class="mbtns">
      <button class="mbtn primary" data-act="resume">继续游戏</button>
      <button class="mbtn" data-act="save-auto">保存进度<span class="sub">写入自动存档位</span></button>
      <button class="mbtn" data-act="load">存档管理<span class="sub">载入 / 覆盖 / 删除</span></button>
      <button class="mbtn" data-act="settings">设置</button>
      <button class="mbtn" data-act="info">游戏信息</button>
      <button class="mbtn danger" data-act="main-menu">返回主菜单<span class="sub">当前进度已自动存档则不会丢失</span></button>
    </div>
    ${note ? `<div class="note">${note}</div>` : ''}`,
};

const COST_NAME = { ore: '辉髓', vine: '藤木', fuel: '燃料', food: '食物', data: '档案', core: '母髓' };

// —— 交互（统一从 #screen 委托） ——
// 鼠标悬停到主菜单某一行：与键盘共用同一个 menuSel（两条路都不会推翻对方）
export function screenHover(target) {
  if (screenTop() !== 'main' || capturing) return;
  const btn = target && target.closest ? target.closest('.mbtn[data-mi]') : null;
  if (!btn) return;
  const i = Number(btn.dataset.mi) | 0;
  if (i === menuSel) return;                    // 已经是它：不重建（否则鼠标横穿一行会重绘好几次）
  menuSel = i;
  render();
}

export function screenClick(ev) {
  sfx('click');                     // 菜单里的每一下点击都有“嗒”
  const t = ev.target;
  if (!t || !t.closest) return;
  const itab = t.closest('.itab');
  if (itab && itab.dataset.info) { infoTab = itab.dataset.info; render(); return; }
  const stab = t.closest('[data-settab]');
  if (stab) {                                   // 设置分页：画面 / 控制 / 音频 / 存档
    if (capturing) { capturing = null; sfx('deny'); }   // 改键中切页 = 取消
    setTab = stab.dataset.settab;
    render();
    return;
  }
  const rb = t.closest('[data-rebind]');
  if (rb) {                                     // 进入改键：下一个键就是新绑定
    capturing = capturing === rb.dataset.rebind ? null : rb.dataset.rebind;
    render();
    return;
  }
  const kr = t.closest('[data-keyreset]');
  if (kr) { resetKey(kr.dataset.keyreset); hooks.onKeysChanged(); setNote('已恢复这个键的默认值'); return; }
  const diff = t.closest('.diff');
  if (diff) { newDiff = diff.dataset.diff; render(); return; }
  const act = t.closest('[data-act]');
  if (!act) { if (capturing) { capturing = null; sfx('deny'); render(); } return; }   // 点空白 = 取消改键
  doAction(act.dataset.act, act.dataset);
}

function doAction(act, data) {
  switch (act) {
    case 'continue': {
      const latest = latestSlot();
      if (!latest) return setNote('没有可用存档');
      hooks.onLoad(latest.id);
      closeScreens();
      break;
    }
    case 'new': openScreen('new'); break;
    case 'load': openScreen('load'); break;
    case 'settings': openScreen('settings'); break;
    case 'info': openScreen('info'); break;
    case 'back': backScreen(); break;
    case 'resume': closeScreens(); hooks.onResume(); break;

    case 'seed-random':
      newSeed = String((Math.random() * 1e9) | 0).slice(0, 8);
      render();
      break;
    case 'start': {
      const el = document.getElementById('seed-input');
      const raw = el ? el.value.trim() : '';
      const seed = raw ? (Number.isNaN(Number(raw)) ? hash(raw) : (Number(raw) | 0)) : ((Math.random() * 1e9) | 0);
      hooks.onStart(seed, newDiff);
      closeScreens();
      break;
    }
    case 'save-slot':
      hooks.onSave(data.slot);
      setNote(`已保存到 ${slotLabel(data.slot)}`);
      break;
    case 'load-slot':
      hooks.onLoad(data.slot);
      closeScreens();
      break;
    case 'del-slot':
      deleteSave(data.slot);
      setNote(`已删除 ${slotLabel(data.slot)}`);
      break;
    case 'save-auto':
      hooks.onSave('auto');
      setNote('进度已写入自动存档位');
      break;
    case 'settings-reset':
      resetSettings();
      resetAllKeys();
      capturing = null;
      hooks.onSettingsChanged();
      hooks.onKeysChanged();
      setNote('已恢复默认设置与键位');
      break;
    case 'keys-reset':
      resetAllKeys();
      capturing = null;
      hooks.onKeysChanged();
      setNote('键位已全部恢复默认');
      break;
    case 'audio-test':
      sfx('place'); sfx('built'); setTimeout(() => sfx('tide'), 220);
      setNote('听得到就说明音频正常');
      break;
    case 'hintreset': {
      const n = state.seen ? Object.keys(state.seen).length : 0;
      state.seen = {};
      setNote(n ? `已重置新手提示（清了 ${n} 条记录，下次遇到会再说一遍）` : '本来就没有说过什么');
      break;
    }
    case 'main-menu':
      hooks.onMainMenu();
      replaceScreen('main');
      break;
    default: break;
  }
}

export function screenChange(ev) {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.set) return;
  const key = t.dataset.set;
  if (t.type === 'checkbox') settings[key] = t.checked;
  else if (key === 'scale') settings[key] = t.value === 'fit' ? 'fit' : Number(t.value);
  else if (key === 'glow') settings[key] = Number(t.value);
  else if (key === 'volMaster' || key === 'volSfx' || key === 'volAmbient' || key === 'volMusic') settings[key] = Number(t.value);
  saveSettings();
  hooks.onSettingsChanged();
  render();
}

export function screenInput(ev) {
  const t = ev.target;
  if (t && t.id === 'seed-input') newSeed = t.value;
}

// 音量显示（0~1 → 百分比）
function pct(v) { return `${Math.round((v == null ? 0 : v) * 100)}%`; }

// —— 设置：四个分页（像一般游戏那样：画面 / 控制 / 音频 / 存档）——
function setVideo() {
  return `
    <div class="psec">画面</div>
    <div class="setrow"><span>画布缩放</span>
      <select class="field" data-set="scale">
        ${['fit', '1', '2', '3'].map((v) => `<option value="${v}" ${String(settings.scale) === v ? 'selected' : ''}>${v === 'fit' ? '自适应窗口' : v + ' 倍'}</option>`).join('')}
      </select>
    </div>
    <div class="setrow"><span>辉光强度</span>
      <input class="field" type="range" min="0.4" max="1.6" step="0.1" value="${settings.glow}" data-set="glow">
      <b class="val">${settings.glow.toFixed(1)}×</b>
    </div>
    <div class="setrow"><span>屏幕暗角</span><input type="checkbox" data-set="vignette" ${settings.vignette ? 'checked' : ''}></div>
    <div class="setrow"><span>飘字提示</span><input type="checkbox" data-set="floaties" ${settings.floaties ? 'checked' : ''}></div>
    <div class="setrow"><span>减少动态</span><input type="checkbox" data-set="reduceMotion" ${settings.reduceMotion ? 'checked' : ''}></div>
    <div class="setrow"><span>色弱辅助</span><input type="checkbox" data-set="colorAssist" ${settings.colorAssist ? 'checked' : ''}></div>
    <div class="psec">界面</div>
    <div class="setrow"><span>左侧信息栏</span><input type="checkbox" data-set="sidebar" ${settings.sidebar ? 'checked' : ''}></div>
    <div class="setrow"><span>顶部帮助与提示</span><input type="checkbox" data-set="hints" ${settings.hints ? 'checked' : ''}></div>
    <div class="setrow"><span>新手提示</span>
      <span class="dim">只说一次，共 ${Object.keys(HINTS).length} 条</span>
      <button class="kreset" data-act="hintreset" title="清空“已经说过”的记录，下次遇到会再说一遍">重置</button>
    </div>
    <div class="setnote">游戏内按 ${keyLabel(boundCode('help'))} 可随时调出完整键位表；改键在「控制」页。</div>`;
}

function setAudio() {
  const row = (label, key, val) => `<div class="setrow"><span>${label}</span>
      <input class="field" type="range" min="0" max="1" step="0.05" value="${val}" data-set="${key}">
      <b class="val">${pct(val)}</b>
    </div>`;
  return `
    <div class="psec">音量</div>
    ${row('主音量', 'volMaster', settings.volMaster)}
    ${row('音效', 'volSfx', settings.volSfx)}
    ${row('音乐', 'volMusic', settings.volMusic)}
    ${row('环境音', 'volAmbient', settings.volAmbient)}
    <div class="setrow"><span>静音（游戏中 ${keyLabel(boundCode('mute'))}）</span><input type="checkbox" data-set="mute" ${settings.mute ? 'checked' : ''}></div>
    <div class="psec">音乐来源</div>
    <div class="setrow"><span>没音乐文件时用合成垫音</span><input type="checkbox" data-set="synthMusic" ${settings.synthMusic ? 'checked' : ''}></div>
    <div class="setnote">音效全部是现场合成（零素材）；音乐可以放你自己的 mp3 —— 丢进 <code>assets/music/</code> 即生效，规格见该目录的 README。</div>
    <div class="row"><button class="sbtn" data-act="audio-test">试听音效</button></div>`;
}

function setSave() {
  return `
    <div class="psec">存档</div>
    <div class="setrow"><span>跨天自动存档</span><input type="checkbox" data-set="autosave" ${settings.autosave ? 'checked' : ''}></div>
    <div class="setnote">自动存档写在每天结束时；存档管理（载入 / 覆盖 / 删除）在主菜单与暂停菜单里。</div>`;
}

function setControl() {
  const n = changedCount();
  const groups = KEY_GROUPS.map((g) => {
    const rows = actionsOf(g.id).map((a) => {
      const now = boundCode(a.id);
      const capping = capturing === a.id;
      const btn = a.fixed
        ? `<span class="kkey fixed">${keyLabel(now)}</span>`
        : `<button class="kkey ${capping ? 'capture' : ''} ${isChanged(a.id) ? 'changed' : ''}" data-rebind="${a.id}">${capping ? '按任意键…' : keyLabel(now)}</button>`
          + (isChanged(a.id) ? `<button class="kreset" data-keyreset="${a.id}" title="恢复默认（${keyLabel(a.code)}）">↺</button>` : '');
      return `<div class="krow ${capping ? 'on' : ''}">
        <span class="kname">${a.label}</span>
        <span class="kkeys">${btn}</span>
        <span class="khint">${a.hint || ''}</span>
      </div>`;
    }).join('');
    return `<div class="psec">${g.name}${g.id === 'mouse' ? '（不可改）' : ''}</div>${rows}`;
  }).join('');
  return `
    <div class="setnote">${capturing ? '按任意键完成绑定 · Esc 取消 · 点空白处也能取消' : `点右边的按键就能改（已改 ${n} 项）`}</div>
    ${groups}
    <div class="row end"><button class="sbtn" data-act="keys-reset">全部恢复默认键位</button></div>`;
}

// 改键捕获：在捕获阶段拦住，游戏里那些键一个都不会被触发
function onCaptureKey(ev) {
  if (!capturing) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  if (ev.code === 'Escape') { capturing = null; sfx('deny'); render(); return; }
  if (isModifierOnly(ev.code)) return;                       // 纯修饰键：继续等真正的键
  const id = capturing;
  capturing = null;
  const r = setKey(id, ev.code);
  sfx(r.ok ? 'ok' : 'deny');
  setNote(r.ok
    ? (r.swapped ? `已绑定 ${keyLabel(ev.code)}（与「${r.swapped}」交换了键位）` : `已绑定 ${keyLabel(ev.code)}`)
    : `改不了：${r.why}`);
}

// 字符串种子 → 数字（保证同字符串同地图）
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
