// main.js —— 启动 / 游戏循环 / 摄像机 / 调度
import { TILE, VIEW_W, VIEW_H, state } from './core/state.js';
import { genMap, mulberry } from './world/gen.js';
import { compute, lightDirty } from './world/light.js';
import { findPath } from './world/pathfinding.js';
import { Colonist } from './entities/colonist.js';
import { bindInput, axis, held, pointer, takeWheel, takeDrag, takePress } from './systems/input.js';
import { updateTime, phaseInfo, ambientOf, TIDE_START, TIDE_END, DUSK_START, isDawn, isTide } from './core/time.js';
import { saveGame, loadGame, clearSave, migrateLegacy } from './core/save.js';
import { settings, loadSettings } from './core/settings.js';
import { DIFFICULTY } from './data/difficulty.js';
import { setupScreens, openScreen, closeScreens, backScreen, screenOpen, screenTop, screenClick, screenChange, screenInput, screenHover, applyArt } from './ui/screens.js';
import { draw } from './systems/render.js';
import { BUILD, LIGHT_LEVELS, workOf, CATEGORIES, canAfford, TOWER_LV, towerHp } from './data/buildings.js';
import { loadError, normalizeMods, MAX_SLOTS } from './data/payload.js';   // W14-A 第 2 步：塔的载荷
import { burnSecOf } from './data/fire.js';
import { placeError, reservedTileError, tryPlace, demolish, buildingAt, advanceBuild, undoPlace, lockedByResearch, UNDO_SECS, upgradeBuilding } from './systems/building.js';
import { ensureStorage, syncRes, migrateResToBeacon, storageStats, deposit, withdrawOne, allContainers, usedOf, withdraw } from './systems/storage.js';
import { PACK_CAP, RES_NAME, RES_COLOR } from './data/storage.js';
import { minimapHit } from './systems/minimap.js';
import { PANELS, TAB_PANEL_IDS, togglePanel, closePanel, renderPanelHost, panelClick, setupPanelUI, setupStoreDrag, setPanelQuery, clearPanelQuery, applyPanelFilter, openStorePanel, openStationPanel, openPayloadPanel, panelHoverAt, panelConfirm, panelFocusInfo, resetPanelQueries } from './ui/panels.js';
import { resolveInteract, resolveInteractAt, tick, actionCooldown } from './systems/interact.js';
import { inspectTile, inspectEnemy, inspectEnemyNear, inspectMapPoint, actLabel, workerTip, moraleTier, JOB_COLOR } from './ui/inspect.js';
import { icon, resIcon, buildIcon, CAT_ICON } from './ui/icons.js';
import { updateWaves } from './systems/waves.js';
import { updatePlayerSkill, handleDeath, applyDamage } from './systems/combat.js';
import { updateEnemies } from './entities/enemy.js';
import { Enemy } from './entities/enemy.js';
import { Worker, updateWorkers, recruitWorker, needRefine, startPlayerRescue, reviveAtGrave } from './entities/worker.js';
import { updateFarm } from './systems/farm.js';
import { updateBlight, updatePurifiers, blightStats, blightDebug } from './systems/blight.js';
import { updateEcology } from './systems/ecology.js';
import { updateNightOps, ensureNightOps, inPatrolSector, patrolActive } from './systems/nightops.js';
import { updateMind, ensureMind, graveStats, soothe, bondLevel } from './systems/mind.js';
import { updateHazard } from './systems/hazard.js';
import { updateLogistics, cacheStats } from './systems/logistics.js';
import { updateCraft, addFire, setRecipe, workOnce, craftError } from './systems/craft.js';
import { updateSmelt } from './systems/smelt.js';
import { equipTool, unequipTool, heldTool } from './systems/tools.js';
import { canFire } from './data/tools.js';
import { HAND_FIRE, tideOf, CARRY, RETREAT } from './data/combat.js';   // 手持开火数值 + 潮位唯一式子 + 装载体/封灯代价（HUD 用）
import { SURVIVAL } from './data/survival.js';
import { updatePlayerSurvival, eatBestMeal, eatHotMeal, injuryName } from './systems/survival.js';
import { rollTraits, sanityTier, SANITY_MAX, SOOTHE as SOOTHE_CFG } from './data/traits.js';
import { ORDER_NAME } from './data/nightops.js';
import { updateTowers } from './systems/towers.js';
import { separateEntities, overlapStats } from './systems/collide.js';
import { unlockTech, lampBurnMul, smeltBurnMul, costOf, sectOpen, knowSeenId, slotsOf } from './systems/research.js';
import { checkHints, maybeHint, seenStats, HINTS } from './systems/hints.js';
import { grantRelic, relicTotal, seriesGot } from './systems/relics.js';
import { useShaft, bindLayer, ensureLayer, layerName } from './systems/layer.js';
import { combatTable, waveReport, dpsReport, labReport, abilityReport, survivalReport, expeditionReport, ecologyReport, visualReport, crewReport } from './dev/observe.js';   // W14-A/W15-B/C/D/E：观测台
import { runReplay } from './dev/replay.js';                                                     // W14-A 第 8 步：标准局回放台
import { nightHud, spawnInterval, segAtRel } from './data/night.js';                                                     // W14-A 第 4/7 步：一夜三段 + 主题夜 + 刷怪节奏
import { updateCarry, mount, unmount, mountError, unmountError, carryable } from './systems/carry.js';       // W14-A 第 5 步 5b：结构装载体
import { updateSeal, sealError, sealNow, sealHint, litLampStats } from './systems/seal.js';                    // W14-A 第 7 步：封灯撤退
import { packContainer } from './systems/storage.js';
import { unlockAudio, sfx, toggleMute, onSettingsChanged, audioStats } from './core/audio.js';
import { updateAmbient, ambientStats } from './core/ambient.js';
import { sfxBankStats } from './core/sfxbank.js';
import { unlockMusic, updateMusic, musicStatus, musicDir, playStinger } from './core/music.js';
import { KEY_ACTIONS, KEY_GROUPS, keyHit, keyLabel, boundCode, isChanged } from './data/keymap.js';
import { pnow, pmark, pframe, perfReset, perfReport } from './core/perf.js';
import { loadAssets, assetStats, onAssetsChanged } from './core/assets.js';
import { registerSprites } from './data/sprites.js';
import { COLONISTS, ensureCrewCard, recordCrewEvent } from './data/colonists.js';
import { restoreTask, restoreDirective, taskBoardStats } from './systems/taskBoard.js';
import { installSelfTest, selfTestTick } from './dev/selftest.js';   // 开发期不变量检测器（W13-N）
import { ensureSurfaceChunk, bindSurfaceChunk, tryCrossSurfaceExit, outpostReport, updateOutpostTravel, updateOutpostSettlement } from './world/chunks.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

// 画布 CSS 尺寸（跟随设置：自适应窗口 / 固定倍率）
function fitCanvas() {
  const sc = settings.scale === 'fit'
    ? Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H) * 0.94
    : Number(settings.scale);
  const w = Math.max(200, Math.round(VIEW_W * sc));
  const h = Math.round(w / (VIEW_W / VIEW_H));
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
}
window.addEventListener('resize', fitCanvas);

// 顶部帮助行：也从键位表生成（改键后立刻同步）
// 移动键按 W-A-S-D 的顺序拼（up / left / down / right），默认正好是 "WASD"
const MOVE_IDS = ['up', 'left', 'down', 'right'];
const moveKeyLabel = () => MOVE_IDS.map((id) => keyLabel(boundCode(id))).join('');
function renderHelpLine() {
  const el = document.getElementById('help');
  if (!el) return;
  const b = (s) => `<b>${s}</b>`;
  el.innerHTML = `${b(moveKeyLabel())} 移动 · ${b('左键')} 前往/放置 · ${b('右键')} 用 · ${b(keyLabel(boundCode('interact')))} 交互 · ${b(keyLabel(boundCode('pulse')))} 光爆 · ${b(keyLabel(boundCode('pause')))} 暂停 · ${b(keyLabel(boundCode('help')))} 键位表`;
}

// 应用设置（画面缩放 / 侧栏 / 提示行）
function applySettings() {
  fitCanvas();
  if (wrap) {
    wrap.classList.toggle('reduce-motion', !!settings.reduceMotion);
    wrap.classList.toggle('color-assist', !!settings.colorAssist);
  }
  if (sidebarEl) sidebarEl.style.display = settings.sidebar ? '' : 'none';
  const helpEl = document.getElementById('help');
  if (helpEl) helpEl.style.display = settings.hints ? '' : 'none';
  if (hintEl) hintEl.style.display = settings.hints ? '' : 'none';
  renderHelpLine();
  onSettingsChanged();          // 音量滑杆/静音：把值推到音频总线
}

const elDay = document.getElementById('day');
const elPhase = document.getElementById('phase');
const elTide = document.getElementById('tide');
const elNightTheme = document.getElementById('nighttheme');
const elWaveLeft = document.getElementById('waveleft');        // W14-A 第 7 步：还剩几波（威胁预告）
const bar = document.getElementById('bar');
const sidebarEl = document.getElementById('sidebar');
const elLayer = document.getElementById('layer');
const elHp = document.getElementById('hp');
const elSat = document.getElementById('sat');
const elHpMeter = document.getElementById('hp-meter');
const elSatMeter = document.getElementById('sat-meter');
const elKills = document.getElementById('kills');
const bossWrap = document.getElementById('bossbar');
const bossFill = document.getElementById('bossbar-fill');
const bossName = document.getElementById('bossname');
const bannerEl = document.getElementById('banner');
const hintEl = document.getElementById('buildhint');
const tipEl = document.getElementById('tip');
const wtipEl = document.getElementById('wtip');
const hotbarEl = document.getElementById('hotbar');

// —— 键位表（H 开关）：内容**由 data/keymap.js 生成**，与设置页的控制项同源，永远不会脱节 ——
const keyHelpEl = document.getElementById('keyhelp');
export function keyHelpOpen() { return !!keyHelpEl && !keyHelpEl.classList.contains('hidden'); }
function buildKeyHelp() {
  if (!keyHelpEl) return;
  const cols = KEY_GROUPS.map((g) => {
    const rows = KEY_ACTIONS.filter((a) => a.group === g.id)
      .map((a) => `<div class="kh-r"><b>${keyLabel(boundCode(a.id))}</b><span>${a.label}${a.hint ? `（${a.hint}）` : ''}</span></div>`)
      .join('');
    return `<div class="kh-col"><div class="kh-t">${g.name}${g.note ? ` · ${g.note}` : ''}</div>${rows}</div>`;
  }).join('');
  keyHelpEl.innerHTML = `<div class="kh-h">键位表 <span>（H 或 Esc 关闭 · 设置 → 控制 里可以改键）</span></div><div class="kh-cols">${cols}</div>`;
}
export function toggleKeyHelp(force) {
  if (!keyHelpEl) return;
  const want = force == null ? keyHelpEl.classList.contains('hidden') : !!force;
  if (want) buildKeyHelp();
  keyHelpEl.classList.toggle('hidden', !want);
}
// 设置里改过键之后调用：重建覆盖层内容（没打开也无所谓）
export function refreshKeyHelp() { if (keyHelpOpen()) buildKeyHelp(); }

function newGame(seed, diffKey = 'normal') {
  const diff = DIFFICULTY[diffKey] || DIFFICULTY.normal;
  state.diffKey = DIFFICULTY[diffKey] ? diffKey : 'normal';
  state.diff = diff;
  state.started = true;
  // 新局的低频系统节拍必须从零开始。否则连续 __replay() 会继承上局的
  // 光照/蚀痕节拍，固定种子也会得到不同曲线。
  state._simT = 0;
  state._blightT = 0;
  state.leakT = 0;
  state._blightDay = -1;
  state.seed = seed;
  const surfMap = genMap(96, 72, seed, 'tundra');
  const cx0 = surfMap.w / 2, cy0 = surfMap.h / 2;
  // 分层世界：每层各持一份 map/建筑/光源/敌人，state 指向当前层
  state.layers = {
    surface: {
      id: '0,0', cx: 0, cy: 0, biome: 'tundra',
      map: surfMap,
      discovered: new Uint8Array(surfMap.w * surfMap.h),
      buildings: [],
      beacons: [
        { x: cx0 - 3, y: cy0, power: 9, radius: 7.5, hp: 300, maxHp: 300 },
        { x: cx0 + 3, y: cy0, power: 9, radius: 7.5, hp: 300, maxHp: 300 },
      ],
      enemies: [],
    },
  };
  state.chunkStore = { '0,0': state.layers.surface };
  state.chunkX = 0; state.chunkY = 0;
  state.lastShaft = null;
  bindLayer(state, 'surface');
  ensureNightOps(state.layers.surface, seed);            // 夜行节点（夜辉草点位 / 潮穴）
  placeNaturalShaft(state);                              // 天然竖井（B37）：地表唯一的下深渊入口
  state.res = Object.assign({ ore: 0, vine: 0, fuel: 0, data: 0, core: 0, food: 0 }, diff.start);
  state.res.night = 0;
  state.pack = { stock: {}, cap: PACK_CAP };
  state.equip = { held: null };               // 玩家手上那一件工具（装在手上时就不在仓库里）
  state.stationRef = null;
  state.storeRef = null;                      // 新开一局：容器/操作台引用一并清掉，不留悬空指针
  state.storeWarnTxt = null;                  // 新开一局：不继承上一局的仓储警告
  state.storeWarnT = 0;
  state._warnSfx = false;
  state._warnFreeAt = null;
  state.payloadRef = null;                    // 载荷面板指向的那座塔
  state.bossRef = null;
  closePanel(state);                          // 新开一局：把上一局的容器/操作台面板关掉（否则会显示「不在了」）
  const startRes = Object.assign({}, state.res);
  ensureStorage(state);                       // 补容器字段（此步会把 res 同步成聚合值 = 0）
  migrateResToBeacon(state, startRes);        // 开局物资就放在营地篝火仓库里
  deposit(state, 'pick', 1, cx0, cy0);        // 备一把放在营地（拓荒者会自己领用）
  state.equip = { held: 'pick' };             // 祖传石镐直接握在手上：新手不该在“装备在哪”上卡住（历史上这条路被当成死循环）
  state.pickups = [];
  state.deathPack = null;
  state.memorial = [];
  state.reviveCount = 0;
  state.rescue = null;
  state.medicalQueue = [];
  state.patrol = null;
  state.order = 'auto';
  state.graves = [];
  ensureMind(state);
  state.building = null;
  state.demolish = false;                     // 新开一局：上一局的拆除模式不能跟过来（否则左键一按就是在拆东西）
  state.quickPause = false;                   // 快速暂停（P）也别跟过来：新局一进来应该是“动着”的
  resetPanelQueries();                        // 面板搜索词也是会话状态：别让新局继承旧查询（B25）
  state.buildCat = CATEGORIES[0].id;          // 快捷栏当前分类
  state.hotSlot = -1;                         // 快捷栏当前格（-1 = 还没选）
  state.camPan = null;                        // 中键拖屏的临时偏移（一移动就收回）
  state.toast = null;                         // 一句话提示（覆盖在提示行）
  state.floaties = [];
  state.interactCd = 0;
  state.dest = null;
  state.playerHp = SURVIVAL.PLAYER.BASE_MAX_HP;
  state.playerHunger = SURVIVAL.PLAYER.START_HUNGER;
  state.playerInjury = 0;
  state.playerRestT = 0;
  state.playerInvuln = 0;
  state.playerDead = false;
  state.kills = 0;
  state.spawnT = 0;
  state.wasTide = false;
  state.wasDawn = false;
  state.nightLightPressure = 0;
  state.nightChallengeMul = 1;
  state.seen = {};                    // 新开一局：首次提示重新算（读档会在 loadFromData 里覆盖回存档里的）
  state._blightAny = false;
  state.skillCd = 0;
  state.skillQueued = 0;
  state.fireCd = 0;                   // 手持开火冷却（第 5 步）
  state.handDebt = 0;                 // 手持开火的燃料小数债务（与塔同一条纪律：满 1 才真扣容器）
  state.carried = null;               // 背上的结构体（第 5 步 5b；只是引用，读档后由 mounted 标记重建）
  state.carryT = 0;                   // 按住 V 的累计时长
  state.carryKey = null;              // 当前正在按住的目标（换了目标/松手就重来）
  state.pulse = null;
  state.beams = [];
  state.codex = {};
  state.codexOpen = false;
  state.codexVersion = 0;
  state.research = { unlocked: {} };
  state.researchVersion = 0;
  state.researchOpen = false;
  state.resSect = 'founder';                  // 研究面板当前分区
  state.relics = {};                          // 残页收藏 { seriesId: [idx] }
  state.relicTiles = {};                      // 已掉过残页的碑 { "x,y": 1 }
  state.relicTotal = 0;
  state.relicVersion = 0;
  state.observed = { seep: 0 };               // 观察类知识计数（图鉴击杀数另存 state.codex）
  state.body = { lava: 0 };                   // 身体换来的知识计数
  state.bossTier = 0;
  state.bossSpawnedThisNight = false;
  state.noSpawnT = 0;
  state.lastSealDay = 0;                      // 第 7 步：封灯冷却是"这一局"的信息，新局当然要清
  state.sealT = 0;
  state.sealPrompt = null;
  state.milestone = { bossDefeated: false, bossDay: 7, clearedDay: 0 };
  // 新局先锁定第 1 天，避免从上一局重开时身份/经历记录继承旧日数。
  state.day = 1;
  state.t = 0;
  state.playerMaxHp = SURVIVAL.PLAYER.BASE_MAX_HP;
  state.pulseMul = 1;
  state.banner = null;
  state.bossRef = null;
  const cx = cx0, cy = cy0;
  state.player = new Colonist(cx + 1, cy);
  state.player.chunkX = 0; state.player.chunkY = 0;
  const names = ['拓荒者 A', '拓荒者 B', '拓荒者 C', '拓荒者 D'];
  state.workers = [];
  for (let i = 0; i < (diff.startWorkers || 2); i++) {
    const ang = i * 1.6;
    const nw = new Worker(names[i] || `拓荒者 ${i + 1}`, cx - 1.5 + Math.cos(ang) * 2.6, cy + 1.5 + Math.sin(ang) * 2.6, rollTraits());
    ensureCrewCard(nw, i, state.day);
    recordCrewEvent(nw, 'join', '加入拓荒队', state.day || 1);
    nw.chunkX = 0; nw.chunkY = 0; state.workers.push(nw);
  }
  // N7 E2E：新局创建成员后立即把当前地表区块的成员桶接上同一引用。
  // 否则第一次前哨迁移会把未迁移成员视为“没有来源列表”，切回/回写时丢失原点居民。
  state.layers.surface.workers = state.workers;
  state.day = 1;
  state.t = 0;
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
}

// 恢复存档中的建筑（工地不占行走格 / 不挡光；重写占格与挡光标记）
// —— 天然竖井（B37 修复）：地表开局就有一口下深渊的井 ——
// 【为什么必须有】建竖井要「深潜学」，而它属于**深潜分区**，分区开启条件又是"已经下过一次深渊"
//   → 没有天然入口就是死循环：深渊全部内容（母脉/遗迹碑/熔渊/补给站/盲蚀兽/深层研究）永远不可达。
// 【位置规则】同种子同位；**不居中**（离营地中心 ≥ CENTER_GAP）、**不贴边**（离边界 ≥ MARGIN）、
//   且必须站得上去（isWalk）且不压任何已有建筑格（occBuild）。
const SHAFT_MARGIN = 9;        // 离地图边界至少这么多格
const SHAFT_CENTER_GAP = 14;   // 离营地中心至少这么多格（别把入口摆在自家门口）
function placeNaturalShaft(state) {
  const m = state.map;
  const rnd = mulberry((state.seed ^ 0x9e3779b9) >>> 0);   // 与地形用不同的派生种子（避免相关性）
  const cx = m.w / 2, cy = m.h / 2;
  const ok = (tx, ty) => tx >= SHAFT_MARGIN && ty >= SHAFT_MARGIN && tx < m.w - SHAFT_MARGIN && ty < m.h - SHAFT_MARGIN
    && Math.hypot(tx - cx, ty - cy) >= SHAFT_CENTER_GAP
    && m.isWalk(tx, ty) && !(m.occBuild && m.occBuild[ty * m.w + tx]);
  let spot = null;
  for (let i = 0; i < 4000 && !spot; i++) {
    const tx = SHAFT_MARGIN + Math.floor(rnd() * (m.w - SHAFT_MARGIN * 2));
    const ty = SHAFT_MARGIN + Math.floor(rnd() * (m.h - SHAFT_MARGIN * 2));
    if (ok(tx, ty)) spot = { x: tx, y: ty };
  }
  if (!spot) {                                   // 兜底：确定性环形搜索（宁可放得丑，也不能没有入口）
    for (let r = SHAFT_CENTER_GAP; r < Math.max(m.w, m.h) && !spot; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const tx = Math.round(cx + dx), ty = Math.round(cy + dy);
        if (ok(tx, ty)) { spot = { x: tx, y: ty }; break; }
      }
    }
  }
  if (!spot) return null;
  state.buildings.push({
    type: 'shaft', x: spot.x, y: spot.y, site: false, work: 0,
    hp: BUILD.shaft.hp, fuel: 0, level: 1, burnT: 0, cd: 0, growth: 0, purifyT: 0,
    recipe: null, fireMat: null, stock: null, mods: null,
    entry: false,        // 天然井 = 入口（E 下潜）；深层里 entry:true 的井才是"上升"
    natural: true,       // 不可拆、不可毁（B37）：井口属于地形，不是建筑
  });
  if (m.occBuild) m.occBuild[spot.y * m.w + spot.x] = 1;
  return spot;
}

// 读档前：把当前层"生成期预置的建筑"整层让位（存档就是这一层的真相）
// 同时退掉它们的占格标记 —— 否则会在世界里留下幽灵占用格（看着空却建不了）
function clearGeneratedBuildings(state) {
  const m = state.map;
  for (const b of state.buildings) {
    const d = BUILD[b.type];
    const i = b.y * m.w + b.x;
    if (m.occBuild) m.occBuild[i] = 0;
    if (d && d.solid && m.occWalk) m.occWalk[i] = 0;
    if (d && d.block && m.blockLight) m.blockLight[i] = 0;
  }
  state.buildings.length = 0;
}

function restoreSurfaceChunks(state, list, currentX, currentY) {
  if (!Array.isArray(list) || !state.chunkStore) return;
  const current = ensureSurfaceChunk(state, currentX, currentY);
  for (const d of list) {
    const c = ensureSurfaceChunk(state, d.x | 0, d.y | 0);
    if (d.biome) { c.biome = d.biome; c.map.biome = d.biome; }
    if (c === current) {
      if (d.outpost && typeof d.outpost === 'object') c.outpost = {
        nextT: Math.max(0, Number(d.outpost.nextT) || 0), ticks: Math.max(0, d.outpost.ticks | 0),
        lightPressure: Math.max(0, Number(d.outpost.lightPressure) || 0), frontDebt: Math.max(0, d.outpost.frontDebt | 0),
        lastEcology: d.outpost.lastEcology && typeof d.outpost.lastEcology === 'object' ? { ...d.outpost.lastEcology } : {},
        alerts: Array.isArray(d.outpost.alerts) ? d.outpost.alerts.map((a) => ({ ...a })) : [],
        lastYield: d.outpost.lastYield && typeof d.outpost.lastYield === 'object' ? { ...d.outpost.lastYield } : {},
        lastNeeds: d.outpost.lastNeeds && typeof d.outpost.lastNeeds === 'object' ? { ...d.outpost.lastNeeds } : {},
        lastReason: String(d.outpost.lastReason || ''),
      };
      continue;
    }
    c.buildings.length = 0;
    if (c.map.occBuild) c.map.occBuild.fill(0); if (c.map.occWalk) c.map.occWalk.fill(0); if (c.map.blockLight) c.map.blockLight.fill(0);
    const prev = state.layers.surface;
    state.layers.surface = c; state.map = c.map; state.buildings = c.buildings; state.beacons = c.beacons; state.enemies = c.enemies; state.discovered = c.discovered;
    restoreBuildings(d.buildings || []);
    c.beacons = (d.beacons || []).map((b) => ({ ...b }));
    if (d.nodes) for (let i = 0; i + 1 < d.nodes.length; i += 2) c.map.nodeAmt[d.nodes[i]] = d.nodes[i + 1];
    if (d.blight && d.blight.length) { const bl = c.map.blight || (c.map.blight = new Uint8Array(c.map.w * c.map.h)); for (let i = 0; i + 1 < d.blight.length; i += 2) bl[d.blight[i]] = d.blight[i + 1]; }
    if (d.fronts && d.fronts.length) { c.map.blightFronts = d.fronts.map((f) => ({ ...f, cells: Array.isArray(f.cells) ? f.cells.slice() : [] })); }
    if (Array.isArray(d.patches)) c.ecoPatches = d.patches.map((p) => ({ ...p }));
    if (Array.isArray(d.creatures)) c.ecoCreatures = d.creatures.map((e) => ({ ...e }));
    if (d.outpost && typeof d.outpost === 'object') c.outpost = {
      nextT: Math.max(0, Number(d.outpost.nextT) || 0), ticks: Math.max(0, d.outpost.ticks | 0),
      lightPressure: Math.max(0, Number(d.outpost.lightPressure) || 0), frontDebt: Math.max(0, d.outpost.frontDebt | 0),
      lastEcology: d.outpost.lastEcology && typeof d.outpost.lastEcology === 'object' ? { ...d.outpost.lastEcology } : {},
      alerts: Array.isArray(d.outpost.alerts) ? d.outpost.alerts.map((a) => ({ ...a })) : [],
      lastYield: d.outpost.lastYield && typeof d.outpost.lastYield === 'object' ? { ...d.outpost.lastYield } : {},
      lastNeeds: d.outpost.lastNeeds && typeof d.outpost.lastNeeds === 'object' ? { ...d.outpost.lastNeeds } : {},
      lastReason: String(d.outpost.lastReason || ''),
    };
    if (d.nightops && c.nightops) { c.nightops.day = d.nightops.day || 0; c.nightops.tideOn = !!d.nightops.tideOn; if (d.nightops.blooms) c.nightops.blooms = d.nightops.blooms.map((b) => ({ ...b })); if (d.nightops.vents) c.nightops.vents = d.nightops.vents.map((v) => ({ ...v })); }
    state.layers.surface = prev;
  }
  const target = ensureSurfaceChunk(state, currentX, currentY);
  bindSurfaceChunk(state, target);
}

// 读档时给一座建筑算 hp —— 单独抽出来是因为这里最容易踩两脚：
//   ① 老存档没有 hp 字段 → 按满血；② 塔的上限要按**等级**算（Lv3 的 216 不能被子基础 120 砍掉）；
//   ③ 灯柱/工作台/储物箱根本没有结构（towerHp 返回 null）→ 原样带过去（别写成 0，会被各处 hp<=0 判成已毁）。
function hpAfterLoad(d, b) {
  const mh = towerHp(d, b.level == null ? 1 : b.level);
  // 没有结构概念的建筑（灯柱/工作台/储物箱）：老档里它们被写成了 0（save 曾经把 null 兑成 0）
  //   → 认成“没结构”，别让它们被各处 `b.hp <= 0` 当成已毁
  if (mh == null) return b.hp > 0 ? b.hp : undefined;
  return b.hp != null ? Math.min(b.hp, mh) : mh;
}

function restoreBuildings(list) {
  const m = state.map;                              // ⚠️ 必须在这里取：下面整段都在用 m（漏了就“读档必崩” ReferenceError）
  let badMods = 0;                                  // 载荷被洗掉的件数（读完给玩家一次提示，不静默）
  for (const b of list) {
    const d = BUILD[b.type];
    if (!d || b.x < 1 || b.y < 1 || b.x >= m.w - 1 || b.y >= m.h - 1) continue;
    const i = b.y * m.w + b.x;
    const site = !!b.site;
    const mounted = !!b.mounted;
    // 背在身上的结构体**没占过格**（第 5 步 5b）：读档时绝对不能替它写占格
    //   —— 否则玩家一读档，脚下那格就被“幽灵塔”占住（人卡在原地、也建不了东西）
    if (m.occBuild && !mounted) m.occBuild[i] = 1;
    if (!site && !mounted) {                        // 工地还没盖起来 → 不占行走、不挡光
      if (d.solid || (d.gate && b.open === false)) m.occWalk[i] = 1;
      if (d.block) m.blockLight[i] = 1;
    }
    // 载荷（W14-A 第 2 步）：老存档没有 mods 字段 → 塔默认空载，其它建筑一律 null（行为与旧版一致）。
    // 【为什么用 MAX_SLOTS 而不是 slotsOf(state)】读档顺序里 state.research 在**建筑之后**才恢复，
    //   此处按当前研究判槽数会把合法载荷误判成非法。恢复期只查绝对上限，研究门槛留给运行时。
    const nm = d.dmg ? normalizeMods(b.mods, MAX_SLOTS) : { mods: null, dropped: 0 };
    badMods += nm.dropped;
    state.buildings.push({
      type: b.type, x: b.x, y: b.y, site,
      work: site ? (b.work || 0) : 0,
      hp: site ? 0 : hpAfterLoad(d, b),   // 旧存档没有 hp 字段 → 按满血；塔还要按**等级**算上限（第 6 步，Lv3 的 216 不能被子基础 120 砍掉）；没有结构概念的建筑（灯柱/工作台）保持原样
      fuel: b.fuel || 0, level: b.level == null ? 1 : b.level,
      burnT: 0, cd: 0, growth: b.growth || 0, purifyT: 0,
      prog: b.prog || 0, made: b.made || 0, off: !!b.off,
      recipe: b.recipe || d.recipe || null,                     // 配方站：存档旧实例时补默认配方
      fireMat: b.fireMat || d.fireMat || null,                   // 火种：烧什么由玩家定（旧档补默认）
      stock: d.store ? Object.assign({}, b.stock || {}) : null,                 // 储物箱里的东西
      mods: nm.mods,                                             // 塔的载荷（老档 = 空载）
      medicalWorker: null,                                       // 医疗位是运行时引用，不写入存档
      // 竖井的“地形属性”必须跟着走：丢了 natural，读档后会被当成自建井 ——
      //   ① B37 的补井迁移会以为“没有天然井”而**再补一口**（同层两口井）
      //   ② 原本那口井会变成可拆（拆了就下不去深渊，首潜又自锁）
      natural: !!b.natural, entry: !!b.entry,
      open: d.gate ? b.open !== false : undefined,
      mounted,                                             // 背在身上的结构体（第 5 步 5b）
    });
  }
  if (badMods > 0) state.floaties.push({ x: state.player.x, y: state.player.y - 1.2, txt: `载荷数据异常：已卸下 ${badMods} 件`, color: '#ff9d5c', t: 0, life: 2.6 });
}

function toggleBuild(type) {
  state.demolish = false;
  state.building = state.building === type ? null : type;
  if (state.building) { state.player.clearPath(); state.dest = null; }
  state._panelSig = null;
}

// 建造面板里的数字键：只作用于【当前分类】（面板没开就不响应）
const PANEL_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'];
function buildListOf(state) {
  const cat = CATEGORIES.find((c) => c.id === (state.buildCat || CATEGORIES[0].id)) || CATEGORIES[0];
  return cat.types;
}
function catIndexOf(state) {
  const i = CATEGORIES.findIndex((c) => c.id === (state.buildCat || CATEGORIES[0].id));
  return i < 0 ? 0 : i;
}
function catNameOf(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? (c.name || c.id) : id;
}

// —— 快捷栏（W13-A / W13-I）：9 格 = 当前建造分类的第 1~9 项 ——
// 不再常驻：按 Q 叫出来（或按数字键时顺手叫出来），关掉就收回去。
// 与建造面板共用同一套「分类 + 格位」状态，两边永远显示同一个东西。
function selectHot(state, idx) {
  const list = buildListOf(state);
  if (idx < 0 || idx >= list.length) { sfx('deny'); return false; }
  state.hotSlot = idx;
  const t = list[idx];
  state.demolish = false;
  if (state.building !== t) state.building = t;
  if (state.building) { state.player.clearPath(); state.dest = null; }
  state._panelSig = null;
  sfx('click');
  return true;
}
function cycleHot(state, dir) {
  const list = buildListOf(state);
  if (!list.length) return;
  // 优先从「当前选中的建筑」推导格位：从面板里点选过时也能接着滚
  const cur = state.building ? list.indexOf(state.building) : -1;
  let i = cur >= 0 ? cur : (state.hotSlot == null || state.hotSlot < 0 ? (dir > 0 ? -1 : 0) : state.hotSlot);
  i = (i + dir + list.length * 2) % list.length;
  selectHot(state, i);
}
function cycleCat(state, dir) {
  const i = (catIndexOf(state) + dir + CATEGORIES.length) % CATEGORIES.length;
  state.buildCat = CATEGORIES[i].id;
  state.hotSlot = -1;
  state.building = null;
  state.demolish = false;
  state._panelSig = null;
  sfx('click');
  toast(state, `建造分类：${catNameOf(state.buildCat)}`);
}
// 一句话提示：盖在底部提示行上，1.8 秒后自动消失（同一时间只留最新一条）
// 注意：这里**不出声** —— 提示只负责"说清楚"，声音由各自的动作成败决定（见 sfx('deny'/'ok')）
function toast(state, txt) {
  const now = performance.now();
  if (state.toast && state.toast.txt === txt && now - state.toast.at < 700) { state.toast.at = now; return; }
  state.toast = { txt, at: now };
}

// 防呆（W13-E 补）：移动键被改过就在开局提醒一次 ——
// 否则玩家会很困惑："W 键怎么没反应"（其实是他自己或上次误操作改了绑定）
function warnMovedKeys() {
  const ids = MOVE_IDS;
  if (!ids.some((id) => isChanged(id))) return;
  toast(state, `移动键已改为 ${moveKeyLabel()}（不是 WASD）· 设置 → 控制 可恢复默认`);
}

// 滚轮缩放：自适应 ↔ 1× ↔ 2× ↔ 3×
const SCALES = ['fit', 1, 2, 3];
function zoomBy(state, dir) {
  let i = SCALES.findIndex((s) => String(s) === String(settings.scale));
  if (i < 0) i = 0;
  const ni = Math.max(0, Math.min(SCALES.length - 1, i + dir));
  if (ni === i) return;
  settings.scale = SCALES[ni];
  applySettings();
  sfx('click');
  toast(state, SCALES[ni] === 'fit' ? '画面：自适应窗口' : `画面：${SCALES[ni]}×`);
}

// Ctrl+Z：撤销最近一次放置（全额退料）
function doUndo(state) {
  const err = undoPlace(state);
  sfx(err ? 'deny' : 'ok');
  toast(state, err || `已撤销（${UNDO_SECS} 秒内的放置可撤）`);
  state._panelSig = null;
}

// 右键够不着时：先走到目标旁边（找最近的能站格寻路）
function walkNear(state, tx, ty) {
  const m = state.map;
  const p = state.player;
  const cands = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue;
      if (!m.isWalk(x, y)) continue;
      cands.push({ x, y, d: Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const path = findPath(m, Math.floor(p.x), Math.floor(p.y), c.x, c.y);
    if (path && path.length) { p.setPath(path); state.dest = { x: c.x, y: c.y, ok: true, at: performance.now() }; return true; }
  }
  return false;
}

// 两个格之间的连线（已不用：Shift 现在是“快走”，拖放改成矩形；留着会被误改，所以删了）

// Tab 依次轮换常驻面板（Shift+Tab 反向）—— 可用面板列表由 panels.js 的 PANELS 提供（tab:false 的站台不算）
function cyclePanelTab(state, dir = 1) {
  const list = TAB_PANEL_IDS;
  const cur = list.indexOf(state.activePanel);
  const next = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
  togglePanel(state, list[next]);
}

// 快捷建造栏（Q）：只开关下面那一条 1~9（**不开右侧页面** —— 那页和 B 建造完全重复）。
// 关掉时顺手放下手里的蓝图 —— 规则简单：“栏关了就是没在建”
function toggleHotbar(state) {
  state.hotbarOpen = !state.hotbarOpen;
  if (!state.hotbarOpen && state.building) {
    state.building = null;
    state.hotSlot = -1;
    toast(state, '已退出建造');
  }
  state._panelSig = null;                    // 标签条上的「快捷建造」要跟着点亮/熄灭
  renderHotbar();
  renderPanelHost(state);
}

// —— 快捷栏 HUD：9 格 = 当前建造分类的第 1~9 项（按 Q 叫出来，不再常驻）——
function renderHotbar() {
  if (!hotbarEl) return;
  if (!state.started || !state.hotbarOpen) {
    if (hotbarEl._sig !== 'off') { hotbarEl.innerHTML = ''; hotbarEl._sig = 'off'; hotbarEl.classList.add('hidden'); }
    return;
  }
  hotbarEl.classList.remove('hidden');
  const list = buildListOf(state).slice(0, 9);
  const sig = `${state.buildCat}|${state.building || ''}|${list.join(',')}`;
  if (hotbarEl._sig !== sig) {
    hotbarEl._sig = sig;
    let html = `<div class="hcat"><b>${icon(CAT_ICON[state.buildCat] || 'catLight')} ${catNameOf(state.buildCat)}</b><s>Q 收起 · [ ] 换类</s></div>`;
    list.forEach((t, i) => {
      const d = BUILD[t] || {};
      html += `<div class="hslot" data-hs="${i}"><i>${i + 1}</i><span class="hico">${buildIcon(t)}</span><s>${d.name || t}</s><b>${costMiniIcons(d.cost)}</b></div>`;
    });
    hotbarEl.innerHTML = html;
  }
  // 选中/够不够料：只改 class，不重建 DOM（每帧只扫 9 个节点）
  const slots = hotbarEl.querySelectorAll('.hslot');
  for (let i = 0; i < slots.length; i++) {
    const t = list[i];
    if (!t) continue;
    const lock = lockedByResearch(state, t);
    const cls = `hslot${state.building === t ? ' on' : ''}${lock ? ' lock' : (canAfford(state.res, t) ? '' : ' poor')}`;
    if (slots[i].className !== cls) slots[i].className = cls;
  }
}
function costMini(cost) {
  let s = '';
  for (const k in (cost || {})) s += `${RES_NAME[k] ? RES_NAME[k][0] : k}${cost[k]}`;
  return s || '—';
}
// 快捷栏的花费：小图标 + 数字（拼“辉2藤2”要玩家先背下缩写）
function costMiniIcons(cost) {
  const ks = Object.keys(cost || {});
  if (!ks.length) return '—';
  let s = '';
  for (const k of ks) s += `<em class="r-${k}">${resIcon(k, 11)}${cost[k]}</em>`;
  return s;
}

// 拆除模式：左键点掉自己盖的建筑（返还一半材料）
function toggleDemolish(v) {
  state.demolish = v === undefined ? !state.demolish : !!v;
  if (state.demolish) { state.building = null; state.player.clearPath(); state.dest = null; }
  state._panelSig = null;
}

// 引路篝火：消耗食物 + 燃料，深渊送回一位迷路的拓荒者（面板按钮触发，按住 E 不会连刷）
function tryRecruit() {
  const err = recruitWorker(state);
  if (err) { sfx('deny'); state.floaties.push({ x: state.player.x, y: state.player.y - 0.9, txt: err, color: '#ff9d5c', t: 0, life: 1.2 }); }
  else sfx('built');
  state._panelSig = null;
}

function screenToTile(sx, sy) {
  const ox = Math.round(state.camera.x * TILE - VIEW_W / 2);
  const oy = Math.round(state.camera.y * TILE - VIEW_H / 2);
  return {
    tx: Math.floor((sx + ox) / TILE),
    ty: Math.floor((sy + oy) / TILE),
  };
}

// 从存档数据重建世界
function loadFromData(s) {
  newGame(s.seed, s.diff || 'normal');
  state.diffKey = s.diff || 'normal';
  state.diff = DIFFICULTY[state.diffKey];
  state.day = s.day || 1; state.t = s.t || 0;  state.player.x = s.px; state.player.y = s.py;
  if ((s.chunkX || 0) !== 0 || (s.chunkY || 0) !== 0) {
    const ch = ensureSurfaceChunk(state, s.chunkX | 0, s.chunkY | 0);
    bindSurfaceChunk(state, ch);
    state.player.chunkX = ch.cx; state.player.chunkY = ch.cy;
  }
  // 跨层存档（B26）：存档只存**当前层**的东西，所以必须先把“所在层”恢复，
  // 再把建筑/单位恢复进去。否则：在深渊存、读档却回地表（那一层白存，分区也会重新锁上）。
  if (s.layerId && s.layerId !== 'surface') {
    ensureLayer(state, s.layerId);          // 深潜层按种子重建（同存档地貌稳定）
    bindLayer(state, s.layerId);
  }
  // 存档就是这一层的真相（B27 的规则）：生成期预置的建筑（深潜层的入口井、地表的天然竖井）
  // 一律让位给存档里的同一座 —— 不清空就会同格两座竖井（build.occ 断言会抓）。
  clearGeneratedBuildings(state);
  state.res = Object.assign({ ore: 0, vine: 0, fuel: 0, data: 0, core: 0, food: 4, night: 0 }, s.res || {});
  state.seen = Object.assign({}, s.seen || {});      // 已经说过的首次提示，读档后不再弹
  restoreBuildings(s.buildings || []);
  restoreSurfaceChunks(state, s.chunks, state.chunkX || 0, state.chunkY || 0);
  // 第 5 步 5b：读档后重建“背上的结构体”（存档只存 mounted 标记，不存引用）
  //   只在**当前层**找：它总是跟着玩家的层走（bindLayer 会把它搬过来）。多座就当数据异常，只认第一座。
  state.carried = null;
  for (const b of state.buildings) {
    if (!b.mounted) continue;
    if (state.carried) { b.mounted = false; continue; }
    state.carried = b;
  }
  // 老存档迁移（B37）：W14-A 2b 之前的存档里没有天然竖井，读进来会永远下不去 → 按种子补一口。
  // 天然竖井只属于原点营地；远征区块没有井，读档时不能把营地入口复制过去。
  if (state.layerId === 'surface' && (state.chunkX | 0) === 0 && (state.chunkY | 0) === 0
      && !state.buildings.some((b) => b.type === 'shaft' && b.natural)) placeNaturalShaft(state);
  if (s.blight && s.blight.length) {                  // 恢复蚀痕（稀疏 [索引, 等级] 对）
    const bl = state.map.blight || (state.map.blight = new Uint8Array(state.map.w * state.map.h));
    for (let i = 0; i + 1 < s.blight.length; i += 2) bl[s.blight[i]] = s.blight[i + 1];
  }
  if (Array.isArray(s.workers)) {                      // 恢复拓荒者（工作状态重置为待命）；空数组也是真实的“无人存活”
    state.workers = s.workers.map((w, i) => {
      const nw = new Worker(w.name || `拓荒者 ${i + 1}`, w.x, w.y, w.traits || undefined);
      ensureCrewCard(nw, i, state.day, w.crew || null);
      nw.hp = w.hp != null ? w.hp : nw.hp;
      nw.alive = w.alive !== false;
      nw.downed = !!w.downed;
      nw.downT = nw.downed ? Math.max(0, Number(w.downT) || SURVIVAL.RESCUE.DOWNED_SECS) : 0;
      nw.rescueWound = w.rescueWound | 0;
      nw.rescueWoundT = Math.max(0, Number(w.rescueWoundT) || 0);
      nw.rescueState = w.rescueState === 'escort' ? 'escort' : 'none';
      nw.rescueBed = w.rescueBed && Number.isFinite(w.rescueBed.x) && Number.isFinite(w.rescueBed.y) ? { x: w.rescueBed.x | 0, y: w.rescueBed.y | 0 } : null;
      nw.rescueRestT = Math.max(0, Math.min(SURVIVAL.RESCUE.RECOVERY_SECS, Number(w.rescueRestT) || 0));
      nw.medicalState = ['queued', 'treating'].includes(w.medicalState) ? w.medicalState : 'none';
      nw.medicalClinic = w.medicalClinic && Number.isFinite(w.medicalClinic.x) && Number.isFinite(w.medicalClinic.y) ? { x: w.medicalClinic.x | 0, y: w.medicalClinic.y | 0 } : null;
      nw.medicalT = Math.max(0, Math.min(SURVIVAL.RESCUE.MEDICAL_SECS, Number(w.medicalT) || 0));
      nw.hunger = w.hunger != null ? w.hunger : nw.hunger;
      nw.morale = w.morale != null ? w.morale : nw.morale;
      nw.layerId = w.layerId || 'surface';
      nw.chunkX = w.chunkX || 0; nw.chunkY = w.chunkY || 0;
      nw.outpostTravel = w.outpostTravel && w.outpostTravel.to && w.outpostTravel.from ? {
        from: { x: w.outpostTravel.from.x | 0, y: w.outpostTravel.from.y | 0 },
        to: { x: w.outpostTravel.to.x | 0, y: w.outpostTravel.to.y | 0 },
        t: Math.max(0, Number(w.outpostTravel.t) || 0), blocked: !!w.outpostTravel.blocked,
      } : null;
      nw.sanity = w.sanity != null ? w.sanity : SANITY_MAX;
      nw.bonds = w.bonds || {};
      nw.grief = w.grief || 0;
      nw.overwork = w.overwork || 0;
      nw.shiftDay = w.shiftDay == null ? -1 : w.shiftDay;
      nw.hollow = !!w.hollow;
      nw.grave = w.grave || null;
      nw.deathRecord = w.deathRecord && typeof w.deathRecord === 'object' ? {
        day: w.deathRecord.day | 0, x: w.deathRecord.x | 0, y: w.deathRecord.y | 0,
        layerId: w.deathRecord.layerId || 'surface', cause: String(w.deathRecord.cause || '伤势过重'),
      } : null;
      nw.tool = w.tool || null;               // 工具跟着人走（存档）
      nw.lockedOrder = 'auto';
      // 蚀化者是“不能干活”的状态：读档后立刻写成一致值。
      // （AI 在 worker.js 里确实会 `if (w.hollow) w.job='hollow'` 自愈，但那要等一帧——
      //   中间这一帧名册会把她显示成“待命”，不变量检查也会报。存档恢复就该是自洽的。）
      nw.job = nw.downed ? 'rescue' : (w.hollow ? 'hollow' : 'idle');
      restoreTask(nw, w.task || null);
      restoreDirective(nw, w.directive || null);
      return nw;
    });
    if (state.chunkStore) {
      const here = state.workers.filter((w) => (w.chunkX || 0) === (state.chunkX || 0) && (w.chunkY || 0) === (state.chunkY || 0));
      // N6b：不能只回填原点区块。玩家在原点存档时，远端前哨成员也必须回到各自
      // 的 chunk.workers，否则读档后他们会从所有区块的活跃集合中消失。
      for (const c of Object.values(state.chunkStore)) {
        c.workers = state.workers.filter((w) => (w.chunkX || 0) === (c.cx || 0) && (w.chunkY || 0) === (c.cy || 0));
      }
      const currentChunk = state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
      // 当前视图必须指向当前区块的成员桶；不能保留一份等值但不同引用的过滤数组。
      state.workers = currentChunk ? currentChunk.workers : here;
    }
  }
  state.graves = (s.graves || []).map((g) => ({ x: g.x, y: g.y, name: g.name, day: g.day || 1, layerId: g.layerId || 'surface' }));
  state.memorial = Array.isArray(s.memorial) ? s.memorial.slice(-COLONISTS.MAX_MEMORIAL_EVENTS).map((m) => ({
    type: m.type === 'death' ? 'death' : 'death', crewId: m.crewId || null, name: String(m.name || '拓荒者'),
    day: m.day | 0, x: m.x | 0, y: m.y | 0, layerId: m.layerId || 'surface', cause: String(m.cause || '伤势过重'),
    affected: Array.isArray(m.affected) ? m.affected.slice(0, COLONISTS.MAX_RELATIONS).map((a) => ({ name: String(a.name || '拓荒者'), level: a.level | 0 })) : [],
    revived: !!m.revived, reviveDay: m.revived ? (m.reviveDay | 0) : 0,
    snapshot: m.snapshot && typeof m.snapshot === 'object' ? {
      traits: m.snapshot.traits && typeof m.snapshot.traits === 'object' ? { good: m.snapshot.traits.good, bad: m.snapshot.traits.bad } : null,
      crew: m.snapshot.crew && typeof m.snapshot.crew === 'object' ? { ...m.snapshot.crew } : null,
      maxHp: Math.max(1, Number(m.snapshot.maxHp) || 90), hunger: Math.max(0, Math.min(100, Number(m.snapshot.hunger) || 0)),
      morale: Math.max(0, Math.min(100, Number(m.snapshot.morale) || 0)), sanity: Math.max(0, Math.min(100, Number(m.snapshot.sanity) || 0)),
      bonds: m.snapshot.bonds && typeof m.snapshot.bonds === 'object' ? { ...m.snapshot.bonds } : {},
    } : null,
  })) : [];
  state.reviveCount = Math.max(0, Math.min(SURVIVAL.REVIVE.MAX_USES, s.reviveCount | 0));
  state.deathPack = s.deathPack ? { x: s.deathPack.x, y: s.deathPack.y, layerId: s.deathPack.layerId || state.layerId, stock: Object.assign({}, s.deathPack.stock || {}), held: s.deathPack.held || null, day: s.deathPack.day || state.day } : null;
  state.rescue = null;
  state.medicalQueue = [];
  if (s.rescue && s.rescue.worker) {
    const findWorker = (ref) => (state.workers || []).find((w) => (ref.id && w.crew && w.crew.id === ref.id) || (ref.name && w.name === ref.name));
    const rw = findWorker(s.rescue.worker);
    const rr = s.rescue.rescuer ? findWorker(s.rescue.rescuer) : null;
    if (rw && rw.alive && (s.rescue.actor !== 'npc' || rr)) {
      state.rescue = { worker: rw, actor: s.rescue.actor === 'npc' ? 'npc' : 'player', rescuer: rr, phase: s.rescue.phase === 'escort' ? 'escort' : 'stabilize', t: Math.max(0, Number(s.rescue.t) || 0), bed: s.rescue.bed || rw.rescueBed || null };
      rw.rescueState = state.rescue.phase === 'escort' ? 'escort' : 'none';
      rw.rescueBed = state.rescue.bed;
    }
  }
  for (const w of state.workers || []) if (w.rescueState === 'escort' && (!state.rescue || state.rescue.worker !== w)) { w.rescueState = 'none'; w.rescueBed = null; w.job = 'flee'; }
  // —— 存储：篝火仓 / 背包 / 储物箱 ——
  ensureStorage(state);
  if (s.stores) {
    const bs = (state.layers.surface && state.layers.surface.beacons) || [];
    (s.stores.beacons || []).forEach((sk, i) => { if (bs[i]) bs[i].stock = Object.assign({}, sk); });
    state.pack.stock = Object.assign({}, s.stores.pack || {});
    syncRes(state);
  } else {
    migrateResToBeacon(state, s.res || {});      // 旧存档：全局资源倒回营地仓
  }
  if (s.fronts && s.fronts.length) state.map.blightFronts = s.fronts.map((f) => ({ ...f, cells: Array.isArray(f.cells) ? f.cells.slice() : [] }));
  const currentChunk = state.chunkStore && state.chunkStore[`${state.chunkX || 0},${state.chunkY || 0}`];
  if (currentChunk && Array.isArray(s.patches)) currentChunk.ecoPatches = s.patches.map((p) => ({ ...p }));
  if (currentChunk && Array.isArray(s.creatures)) currentChunk.ecoCreatures = s.creatures.map((e) => ({ ...e }));
  // 区块存档：ensureStorage 只看当前区块，恢复完全部区块后以快照中的全局账本收口，避免远征读档把原点仓库存量算丢。
  if (s.chunks) state.res = Object.assign({ ore: 0, vine: 0, fuel: 0, data: 0, core: 0, food: 0, night: 0 }, s.res || {});
  if (s.mind) state.mind = s.mind;
  ensureMind(state);
  // —— W12-D 知识锁：残页 / 观察 / 身体 ——
  state.relics = Object.assign({}, s.relics || {});
  state.relicTiles = Object.assign({}, s.relicTiles || {});
  state.observed = Object.assign({ seep: 0 }, s.observed || {});
  state.body = Object.assign({ lava: 0 }, s.body || {});
  state.relicTotal = relicTotal(state);
  if (s.equip) state.equip = Object.assign({ held: null }, s.equip);   // 装备位
  for (const b of state.buildings) if (b.craft) b.craft = Object.assign({ t: 0, sec: 5 }, b.craft);   // 制造中的活接着做
  if (s.bossTier != null) state.bossTier = s.bossTier;
  // 夜战记账（B21）：不算来的话，读档会重放蚀潮边沿 + 当晚 Boss 再降临一次
  state.spawnT = s.spawnT || 0;
  state.noSpawnT = s.noSpawnT || 0;
  state.wasTide = !!s.wasTide;
  state.wasDawn = !!s.wasDawn;
  state.nightLightPressure = s.nightLightPressure || 0;
  state.nightChallengeMul = s.nightChallengeMul || 1;
  state.bossSpawnedThisNight = !!s.bossSpawnedThisNight;
  state.lastSealDay = s.lastSealDay | 0;      // 第 7 步：封灯冷却起点（读档不该刷新冷却）
  if (s.milestone) state.milestone = s.milestone;
  if (s.playerMaxHp) state.playerMaxHp = s.playerMaxHp;
  if (s.pulseMul) state.pulseMul = s.pulseMul;
  if (s.kills != null) state.kills = s.kills;
  if (s.research && s.research.unlocked) state.research = s.research;
  // 层尺寸不同（地表 96×72 vs 深潜层 88×64…）时，光照数组必须重建，否则会拿旧尺寸去索引
  if (!state.light || state.light.length !== state.map.w * state.map.h) compute(state);
  state.playerHp = s.playerHp == null ? state.playerMaxHp : Math.max(0, Math.min(state.playerMaxHp, s.playerHp));
  state.playerHunger = s.playerHunger == null ? SURVIVAL.PLAYER.START_HUNGER : Math.max(0, Math.min(SURVIVAL.PLAYER.HUNGER_MAX, s.playerHunger));
  state.playerInjury = s.playerInjury == null ? 0 : Math.max(0, Math.min(SURVIVAL.PLAYER.INJURY.MAX, s.playerInjury | 0));
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  state.started = true;
}

// 暂停状态统一出口：快速暂停（P）/ 菜单打开 / 未开局
function syncPause() {
  const qp = !!state.quickPause;
  state.paused = qp || screenOpen() || !state.started;
  if (state.paused) { state.dragRect = null; state._dragStart = null; }   // 冻结时不留着半截拖框
  wrap.classList.toggle('in-menu', !state.started);
  const el = document.getElementById('quickpause');
  if (el) el.classList.toggle('hidden', !(qp && state.started && !screenOpen()));
}

function boot() {
  loadSettings();
  migrateLegacy();               // 旧版单槽存档 → 自动存档位
  applySettings();
  bindInput(canvas);
  installSelfTest();             // 开发期不变量检测器：挂 __check/__watch/__baseline（不影响玩法）
  // 素材（W13-F）：登记清单 + 异步加载 —— **不阻塞开局**，没文件就继续程序化绘制
  registerSprites();
  onAssetsChanged(() => { state._panelSig = null; state._sidebarSig = null; applyArt(); });   // 图到了：面板/侧栏下次刷新自会带上，主菜单插画原地补上
  loadAssets();
  // 音频：浏览器要求用户手势后才能出声，一次就够（幂等）
  const kick = () => {
    unlockAudio();
    unlockMusic();                     // 音乐也用同一时机解锁（缺文件时自动转合成垫音）
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
  newGame((Math.random() * 1e9) | 0);   // 先建一个世界当菜单背景（不模拟）
  state.started = false;
  state.quickPause = false;
  syncPause();

  window.addEventListener('keydown', (e) => {
    // 菜单打开时：Esc 返回上一层 / P 继续
    if (screenOpen()) {
      if (keyHit('cancel', e)) { backScreen(); e.preventDefault(); }
      if (keyHit('pause', e) && screenTop() === 'pause') closeScreens();
      return;
    }
    if (!state.started) return;                 // 主菜单状态下不响应游戏按键
    // 面板里的筛选框正在输入：全局按键全部让路（否则打 b/q/空格 会开面板、换生建栏、放光爆）
    // 用 activeElement 而不是 ev.target：浏览器/输入法的 keydown 目标不一定是输入框
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (keyHit('pause', e)) {                   // 直接暂停 / 继续（快速冻结，不开菜单）
      state.quickPause = !state.quickPause;
      syncPause();
      e.preventDefault();
      return;
    }
    if (keyHit('cancel', e)) {
      // 优先级：关闭键位表 → 关闭面板 → 取消建造/拆除/移动 → 打开暂停菜单
      if (keyHelpOpen()) {
        toggleKeyHelp(false);
      } else if (state.activePanel) {
        closePanel(state);
      } else if (state.building || state.demolish || state.dest) {
        state.player.clearPath(); state.dest = null; state.building = null; state.demolish = false;
        state.dragRect = null; state._dragStart = null;
        state._panelSig = null;
      } else {
        openScreen('pause');
      }
      e.preventDefault();
      return;
    }
    if (state.quickPause) { if (keyHit('help', e)) { toggleKeyHelp(); e.preventDefault(); } return; }   // 冻结中：仍可查键位表
    if (keyHit('help', e)) { toggleKeyHelp(); e.preventDefault(); return; }   // 键位表
    if (keyHit('mute', e)) {                                                  // 一键静音
      const on = toggleMute();
      toast(state, on ? '已静音（再按一次恢复）' : '声音已开');
      sfx('click');
      e.preventDefault();
      return;
    }
    if (keyHit('undo', e)) { doUndo(state); e.preventDefault(); return; }                              // 撤销放置
    if (keyHit('panelTab', e)) { cyclePanelTab(state, e.shiftKey ? -1 : 1); e.preventDefault(); return; }   // 轮换面板
    if (keyHit('hotbarToggle', e)) { toggleHotbar(state); e.preventDefault(); return; }               // 快捷建造栏开关
    if (keyHit('catPrev', e)) { cycleCat(state, -1); e.preventDefault(); return; }                    // 换建造分类
    if (keyHit('catNext', e)) { cycleCat(state, 1); e.preventDefault(); return; }
    if (keyHit('lamp', e)) { cycleLampLevel(); e.preventDefault(); return; }
    if (keyHit('demolish', e)) { toggleDemolish(); e.preventDefault(); return; }
    if (keyHit('roster', e)) toggleRoster();
    // 面板内回车 = 点一下“鼠标指着的那一行”（指哪打哪，不用把鼠标挪到按钮上）
    if (state.activePanel && keyHit('confirm', e)) { panelConfirm(); e.preventDefault(); return; }
    if (keyHit('pulse', e)) {                   // 光爆（排队一帧，由 updatePlayerSkill 结算）
      state.skillQueued = Math.min((state.skillQueued || 0) + 1, 1);
      e.preventDefault();
    }
    if (keyHit('fire', e)) { fireHand(state); e.preventDefault(); }   // 手持开火（W14-A 第 5 步）
    if (keyHit('eat', e) && !state.activePanel) {
      const err = eatBestMeal(state);
      if (err) { toast(state, err); sfx('deny'); }
      e.preventDefault();
      return;
    }
    if (keyHit('rest', e) && !state.activePanel) {
      state.playerRestT = SURVIVAL.REST.DURATION;
      toast(state, '开始休整 · 受光且安全时恢复');
      e.preventDefault();
      return;
    }
    const panel = PANELS.find((p) => p.action && keyHit(p.action, e));   // 建造/夜行/研究/图鉴
    if (panel) { togglePanel(state, panel.id); e.preventDefault(); return; }
    // 数字键 = 快捷建造栏格位；没开任何面板时顺手把这一栏叫出来（按 1 就是“我要用第 1 格”）
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const idx = PANEL_DIGITS.indexOf(e.code);
      if (idx >= 0) {
        if (!state.hotbarOpen) { state.hotbarOpen = true; state._panelSig = null; renderPanelHost(state); }
        if (!selectHot(state, idx)) toast(state, `${catNameOf(state.buildCat)} 没有第 ${idx + 1} 项`);
        e.preventDefault();
      }
    }
  });
  canvas.addEventListener('click', onClick);
  initDragRect(canvas);                     // 建造拖矩形：松手落地
  // 右键 = 「在光标处做事」：够得着就直接用（采集/加油/施工/开面板），够不着就走过去；
  // 建造中 = 放下蓝图；什么地方都没东西 = 取消当前动作（可当 Esc 用）
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.started || screenOpen()) return;
    const ptr = pointer();
    if (ptr.sx < 0 || minimapHit(ptr.sx, ptr.sy, state)) return;
    const { tx, ty } = screenToTile(ptr.sx, ptr.sy);
    if (tx < 0 || ty < 0 || tx >= state.map.w || ty >= state.map.h) return;
    state.camPan = null;
    if (state.building) {                       // 建造中：右键 = 退出建造（左键才是放）
      const name = (BUILD[state.building] || {}).name || state.building;
      state.building = null;
      state.demolish = false;
      state.hotSlot = -1;
      state._dragStart = null;
      state.dragRect = null;
      state._panelSig = null;
      sfx('click');
      toast(state, `已退出建造（${name}）`);
      return;
    }
    if (state.interactCd > 0) return;           // 与 E 共用一个冷却，防连点
    const a = resolveInteractAt(state, tx, ty);
    if (a) {
      tick(state, a);
      state.interactCd = actionCooldown(state, a);
      state._actCdTotal = state.interactCd;                  // 供进度弧用
      state._actTile = a.b ? `${a.b.x},${a.b.y}` : a.x != null ? `${a.x},${a.y}` : null;
      state._panelSig = null;
      return;
    }
    // 东西在那里，只是离得远 → 先走过去（到了再右键一次，或按 E）
    if (resolveInteractAt(state, tx, ty, 99) && walkNear(state, tx, ty)) return;
    state.player.clearPath(); state.dest = null; state.building = null; state.demolish = false;
    state._panelSig = null;
  });
  const panelEl = document.getElementById('panel');
  if (panelEl) panelEl.addEventListener('click', (ev) => panelClick(state, ev));
  if (panelEl) panelEl.addEventListener('mouseover', (ev) => panelHoverAt(ev.target));   // 悬停 = 指明“回车要点哪一行”
  setupStoreDrag(panelEl, () => state);                          // 容器面板：拖一行到对面那一栏 = 整摞搬过去
  // 面板内筛选（W13-L）：输入即筛选（只切 class，不重建 → 不失焦、不跳滚动）
  if (panelEl) panelEl.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t || !t.dataset || !t.dataset.filter) return;
    setPanelQuery(t.dataset.filter, t.value);
    applyPanelFilter(panelEl, state);
  });
  // 输入框里的 Esc：有字先清字，没字才失焦（不让它直接把面板关掉）；Tab 也留下（否则焦点会跑出输入框）
  if (panelEl) panelEl.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!t || !t.dataset || !t.dataset.filter) return;
    if (ev.key === 'Tab') { ev.stopPropagation(); ev.preventDefault(); return; }
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    ev.preventDefault();
    if (t.value) { clearPanelQuery(t.dataset.filter, panelEl); applyPanelFilter(panelEl, state); }
    else t.blur();
  });
  const panelBarEl = document.getElementById('panelbar');
  if (panelBarEl) panelBarEl.addEventListener('click', (ev) => panelClick(state, ev));
  if (hotbarEl) hotbarEl.addEventListener('click', (ev) => {       // 鼠标点快捷栏也能选
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-hs]') : null;
    if (t) { selectHot(state, Number(t.getAttribute('data-hs')) | 0); sfx('click'); }
  });
  if (sidebarEl) sidebarEl.addEventListener('click', (ev) => {   // 点标题行折叠/展开（材料 / 营地 / 拓荒队）
    const head = ev.target && ev.target.closest ? ev.target.closest('[data-fold]') : null;
    if (head) toggleFold(head.getAttribute('data-fold'));
  });
  if (sidebarEl) {                                              // 名册悬停：地图高亮 + 自绘提示
    sidebarEl.addEventListener('mouseover', (ev) => {
      const t = ev.target;
      const row = t && t.closest ? t.closest('.wrow') : null;
      if (row) {
        const nameEl = row.querySelector('.wname');
        state._hoverW = nameEl ? nameEl.textContent : null;
        state._hoverTip = null;
        state.hilitWorker = state._hoverW;
        return;
      }
      const tipRow = t && t.closest ? t.closest('[data-tipkey]') : null;
      state._hoverW = null;
      state.hilitWorker = null;
      state._hoverTip = tipRow
        ? { key: tipRow.getAttribute('data-tipkey'), label: tipRow.getAttribute('data-tiplabel') || '', text: tipRow.getAttribute('data-tiptext') || '' }
        : null;
    });
    sidebarEl.addEventListener('mouseleave', () => {
      state._hoverW = null; state._hoverTip = null; state.hilitWorker = null;
    });
  }
  const screenEl = document.getElementById('screen');
  if (screenEl) {
    screenEl.addEventListener('click', (ev) => screenClick(ev));
    screenEl.addEventListener('mouseover', (ev) => screenHover(ev.target));   // 主菜单：鼠标悬停 = 键盘选中项
    screenEl.addEventListener('change', (ev) => screenChange(ev));
    screenEl.addEventListener('input', (ev) => screenInput(ev));
  }
  const qpResume = document.getElementById('qp-resume');
  const qpMenu = document.getElementById('qp-menu');
  if (qpResume) qpResume.addEventListener('click', () => { state.quickPause = false; syncPause(); });
  if (qpMenu) qpMenu.addEventListener('click', () => { state.quickPause = false; openScreen('pause'); });
  setupPanelUI({ onSelectBuild: toggleBuild, onToggleDemolish: toggleDemolish, onRecruit: () => tryRecruit(), onToggleHotbar: () => toggleHotbar(state) });     // 面板点击建造行 → 选中建筑；点「快捷建造」标签 → 开关下面那一条
  setupScreens({
    onStart: (seed, diff) => { newGame(seed, diff); warnMovedKeys(); maybeHint(state, 'firstGame', showFirstNote); },
    onLoad: (slot) => { const d = loadGame(slot); if (d) { loadFromData(d); warnMovedKeys(); } },
    onSave: (slot) => { if (state.started) saveGame(state, slot); },
    onResume: () => { state.quickPause = false; syncPause(); },
    onMainMenu: () => {
      if (state.started && settings.autosave) saveGame(state, 'auto');
      state.started = false;
      state.quickPause = false;
      syncPause();
    },
    onSettingsChanged: () => applySettings(),
    onKeysChanged: () => { refreshKeyHelp(); renderHelpLine(); state._panelSig = null; },   // 改键后：键位表 + 帮助行 + 面板标签一起更新
    onScreenChange: () => syncPause(),
  });
  renderSidebar();
  renderPanelHost(state);
  openScreen('main');
  requestAnimationFrame(frame);
}

function onClick(e) {
  const r = canvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (canvas.width / r.width);
  const sy = (e.clientY - r.top) * (canvas.height / r.height);
  if (minimapHit(sx, sy, state)) return;              // 点小地图不移动
  const { tx, ty } = screenToTile(sx, sy);
  if (tx < 0 || ty < 0 || tx >= state.map.w || ty >= state.map.h) return;
  state.camPan = null;                                // 给了个明确的指令 → 镜头回到身边

  if (e.altKey) {          // Alt + 左键：不管当前什么模式，直接拆它（按住扫一片见 mouseDuties）
    if (state._altSweep === `${tx},${ty}`) return;    // 按住时已经拆过了，松手这次不重复
    const b = buildingAt(state, tx, ty);
    if (!b) { sfx('deny'); toast(state, '这里没有建筑'); return; }
    const name = (BUILD[b.type] || {}).name || b.type;
    const err = demolish(state, b);
    if (err) sfx('deny');
    toast(state, err || `已拆除 ${name}（工地全退 · 建成退半）`);
    state.building = null; state.demolish = false;
    state._panelSig = null;
    return;
  }
  if (state.building) {          // 建造模式：放置交给“松手”那一下（见 initDragRect），这里不动手
    return;
  }
  if (state.demolish) {          // 拆除模式：点击拆掉自己盖的东西
    const b = buildingAt(state, tx, ty);
    if (!b) {
      sfx('deny');
      toast(state, '这里没有建筑');
      return;
    }
    const name = (BUILD[b.type] || {}).name || b.type;
    const err = demolish(state, b);
    toast(state, err || `已拆除 ${name}`);
    state._panelSig = null;
    return;
  }
  const path = findPath(state.map, Math.floor(state.player.x), Math.floor(state.player.y), tx, ty);
  if (!path) {
    state.dest = { x: tx, y: ty, ok: false, at: performance.now() };  // 受阻：红叉提示
    return;
  }
  state.player.setPath(path);
  state.dest = { x: tx, y: ty, ok: true, at: performance.now() };
}

function updateCursor() {
  const cur = state.cursor;
  const ptr = pointer();
  if (!ptr.l) state.dragRect = null;          // 松手了（或中途失焦）：拖框不再显示
  const { tx, ty } = screenToTile(ptr.sx, ptr.sy);
  cur.tx = tx; cur.ty = ty;                   // 总是记录悬停格（悬停描边/信息框都要用）
  if (state.demolish) {                       // 拆除模式：高亮鼠标下的建筑
    cur.show = true; cur.ok = false; cur.demolish = true;
    const b = buildingAt(state, tx, ty);
    cur.target = b ? { x: b.x, y: b.y } : null;
    return;
  }
  cur.demolish = false;
  if (!state.building) { cur.show = false; return; }
  cur.show = ptr.sx >= 0 && tx >= 1 && ty >= 1 && tx < state.map.w - 1 && ty < state.map.h - 1;
  cur.ok = cur.show && !placeError(state, state.building, tx, ty);
}

let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  const tFrame = pnow();
  if (dt > 0.05) dt = 0.05;
  update(dt);                            // 暂停时内部直接返回
  updateMusic(state, dt);                // 音乐不随暂停停（菜单里也该有主题曲），所以放在这
  updateHover();                         // 悬停信息 + E 目标高亮（暂停时也刷新）
  const tDraw = pnow();
  draw(ctx);                             // 无论是否暂停都渲染（画面不冻结）
  pmark('draw', tDraw);
  pmark('frame.total', tFrame);
  pframe(dt * 1000);
  requestAnimationFrame(frame);
}

// 悬停检验：把鼠标下的格子讲清楚，同时算出玩家身边可交互的目标（渲染层画高亮）
function updateHover() {
  const ptr = pointer();
  const inside = !!ptr.inside && ptr.sx >= 0 && !!state.started && !screenOpen();
  const { tx, ty } = screenToTile(ptr.sx, ptr.sy);
  // E 的目标：鼠标指着谁就算谁（指不到就回退“最近优先”）——高亮与 E 用的是**同一个**目标
  state.nearAct = state.started && inside ? resolveInteract(state, { tx, ty }) : (state.started ? resolveInteract(state) : null);
  if (!inside) {
    hideTip();
    if (canvas) canvas.style.cursor = 'default';
    return;
  }
  let info = null;
  if (tx >= 0 && ty >= 0 && tx < state.map.w && ty < state.map.h) {
    info = hoverInfoAt(state, tx, ty);
  }
  if (info) showTip(info, ptr.cx, ptr.cy); else hideTip();
  if (canvas) {
    if (state.building || state.demolish || (ptr.alt && buildingAt(state, tx, ty))) canvas.style.cursor = 'crosshair';
    else canvas.style.cursor = (info && info.kind && info.kind !== 'floor' && info.kind !== 'rock') ? 'pointer' : 'default';
  }
}

// 把鼠标格变成一条悬停信息：蚀兽 > 建筑/地块 > 地图上的点状实体（篝火/墓碑/夜辉草/潮穴/掉落物/拓荒者）
function hoverInfoAt(state, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= state.map.w || ty >= state.map.h) return null;
  const e = inspectEnemyNear(state, tx, ty);
  if (e) return inspectEnemy(state, e);
  const tile = inspectTile(state, tx, ty);
  if (tile && tile.kind === 'building') return tile;              // 建筑该优先于脚下的东西
  return inspectMapPoint(state, tx, ty) || tile;
}

function showTip(info, cx, cy) {
  if (!tipEl) return;
  tipEl.className = info.dim ? 'dim' : (info.danger ? 'danger' : info.kind || '');
  tipEl.innerHTML = tipHTML(info);
  tipEl.classList.remove('hidden');
  // 贴着鼠标，并避免超出窗口
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = cx + 16, y = cy + 14;
  if (x + w > window.innerWidth - 8) x = cx - w - 14;
  if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 10;
  tipEl.style.left = `${Math.max(6, x)}px`;
  tipEl.style.top = `${Math.max(6, y)}px`;
}

// 提示框内容（画布 #tip 与侧栏 #wtip 共用一套排版）
function tipHTML(info) {
  const rows = (info.rows || []).map(([k, v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`).join('');
  const tipCls = info.danger ? 'tt-tip warn' : (info.kind === 'building' && info.tip && info.tip.startsWith('E') ? 'tt-tip good' : 'tt-tip');
  // 立绘（W13-F）：有素材就摆左边，没有就完全不占位
  const head = info.portrait
    ? `<div class="tt-head">${info.portrait}<div class="tt-headtxt"><div class="tt-title">${info.title}</div>${info.sub ? `<div class="tt-sub">${info.sub}</div>` : ''}</div></div>`
    : `<div class="tt-title">${info.title}</div>${info.sub ? `<div class="tt-sub">${info.sub}</div>` : ''}`;
  return head
    + (rows ? `<div class="tt-rows">${rows}</div>` : '')
    + (info.notes ? info.notes : '')
    + (info.bars ? info.bars : '')
    + (info.tip ? `<div class="${tipCls}">${info.tip}</div>` : '');
}

function hideTip() {
  if (tipEl && !tipEl.classList.contains('hidden')) tipEl.classList.add('hidden');
}

// —— 侧栏提示（自绘，不用原生 title）——
// 原生 title 有两宗罪：① 样式跟游戏不搭、无法定制；② 侧栏一重建（工人状态每几秒就变）
// 悬挂元素就被销毁，系统 tooltip 会“关掉再弹出来”——看起来就是一闪一闪。
// 所以这里用常驻的 #wtip：元素不会被侧栏重建弄死，内容变化时用签名比对原位更新。
// 状态卡内容（workerTip / JOB_LABEL / JOB_COLOR / moraleTier）在 ui/inspect.js —— 地图悬停用同一份。

function hideWTip() {
  if (wtipEl && !wtipEl.classList.contains('hidden')) wtipEl.classList.add('hidden');
}

// 侧栏提示每帧刷新：仅在内容变化时改 innerHTML（元素本体不动 → 不会闪）
function refreshWTip() {
  if (!wtipEl) return;
  const hover = state._hoverW
    ? { w: (state.workers || []).find((x) => x.name === state._hoverW), row: findRosterRow(state._hoverW) }
    : null;
  const plain = hover && hover.w ? null : state._hoverTip;
  const row = hover && hover.row ? hover.row : (plain ? findTipRow(plain.key) : null);
  if (!row || screenOpen() || !state.started || !settings.sidebar) { hideWTip(); return; }
  const anchor = row.getBoundingClientRect();
  if (!anchor.width && !anchor.height) { hideWTip(); return; }            // 行被 display:none 掉
  const info = hover && hover.w ? workerTip(state, hover.w) : { title: plain.label, tip: plain.text };
  const html = tipHTML(info);
  if (wtipEl._html !== html) { wtipEl.innerHTML = html; wtipEl._html = html; }
  wtipEl.classList.toggle('danger', !!info.danger);
  wtipEl.style.borderLeftColor = info.color || 'rgba(150,190,255,0.55)';
  wtipEl.classList.remove('hidden');
  // 锚在行右侧（右侧放不下就翻到左侧），纵向跟随行
  const h = wtipEl.offsetHeight, w = wtipEl.offsetWidth;
  let x = anchor.right + 8;
  if (x + w > window.innerWidth - 8) x = Math.max(6, anchor.left - w - 8);
  const y = Math.max(6, Math.min(anchor.top + anchor.height / 2 - h / 2, window.innerHeight - h - 8));
  wtipEl.style.left = `${x}px`;
  wtipEl.style.top = `${y}px`;
}
// 按名字找名册行：不缓存元素引用，侧栏重建后下一帧也能找到
function findRosterRow(name) {
  if (!sidebarEl || !name) return null;
  for (const r of sidebarEl.querySelectorAll('.wrow')) {
    const n = r.querySelector('.wname');
    if (n && n.textContent === name) return r;
  }
  return null;
}
function findTipRow(key) {
  if (!sidebarEl || !key) return null;
  return sidebarEl.querySelector(`[data-tipkey="${key}"]`);
}

// 固定步长模拟：真实 dt → 固定 STEP 模拟步，解耦渲染帧率
const STEP = 1 / 60;
const MAX_ACC = 0.12;              // 上限 7 个子步（原来 0.25=15 步：卡顿后追帧会雪崩式越算越慢）
const RUN_MUL = 1.55;              // 按住 Shift 的移动倍率（5 → 7.75 格/秒）
let acc = 0;

// 系统列表：游戏逻辑按系统独立注册、顺序执行（W3 起的地基）
// updateMind 必须排在 updateWorkers 之后：它要用工人本帧算出的士气增减 w.dm 来折算心志
const SIM = [updateWaves, updateEnemies, updateCarry, updateTowers, updateFarm, updateHazard, updatePurifiers, updateNightOps, updateLogistics, updateWorkers, updateMind, updateCraft, updateSmelt, updatePlayerSurvival, updatePlayerSkill, updateEcology, updateHand];
const BLIGHT_HZ = 4;               // 蚀痕心跳：地貌腐蚀以秒/分钟演进，逐步扫 6912 格是纯浪费

function simStep(dt) {
  const tStep = pnow();
  state._simT = (state._simT || 0) + dt;              // 模拟时间（光照脏标记/确定性测试用）
  updateTime(state, dt, () => { if (settings.autosave) saveGame(state, 'auto'); });   // 跨天自动存档
  const p = state.player;
  const oldPX = p.x, oldPY = p.y;
  const inp = axis();
  const manual = inp.dx !== 0 || inp.dy !== 0;
  state.moveInput = manual;                           // 供塔/装载体判“这一帧在移动”（WASD 不写 path，不能只看 path）
  if (manual) {                                       // 键盘直控优先，取消寻路
    p.clearPath(); state.dest = null;
    state.camPan = null;                              // 自己动手走路 → 镜头收回身上
    state._follow = null;
    p.moveManual(dt, state, inp.dx, inp.dy);
  } else {
    // 按住左键 = 持续跟随光标（MC / 环世界习惯）：不用一下一下点，拖着鼠标走就行
    const ptr = pointer();
    if (ptr.l && ptr.inside && !state.building && !state.demolish
        && !minimapHit(ptr.sx, ptr.sy, state) && !screenOpen()) {
      const { tx, ty } = screenToTile(ptr.sx, ptr.sy);
      const onSelf = Math.floor(p.x) === tx && Math.floor(p.y) === ty;
      if (!onSelf && tx >= 0 && ty >= 0 && tx < state.map.w && ty < state.map.h) {
        const f = state._follow || (state._follow = { tx: -9, ty: -9, at: 0 });
        const now = performance.now();
        const moved = f.tx !== tx || f.ty !== ty;
        if ((moved && now - f.at > 140) || (!p.hasPath() && now - f.at > 240)) {
          f.tx = tx; f.ty = ty; f.at = now;
          const path = findPath(state.map, Math.floor(p.x), Math.floor(p.y), tx, ty);
          if (path) { p.setPath(path); state.dest = { x: tx, y: ty, ok: true, at: now }; }
          else state.dest = { x: tx, y: ty, ok: false, at: now };
        }
      } else if (state._follow) state._follow.at = performance.now();
    } else if (state._follow) state._follow = null;
    p.followPath(dt, state);
    if (state.dest && !state.dest.ok && performance.now() - state.dest.at > 800) {
      state.dest = null;                              // 受阻红叉显示 0.8s 后消失
    }
    if (state.dest && state.dest.ok && !p.hasPath()) state.dest = null;   // 到达后清除目标
  }
  // V1：记录最后移动方向，鼠标寻路与 WASD 都能切换四向像素姿态；静止时保留上次朝向。
  const faceDX = p.x - oldPX, faceDY = p.y - oldPY;
  if (Math.abs(faceDX) + Math.abs(faceDY) > 0.001) {
    p.face = Math.abs(faceDX) >= Math.abs(faceDY) ? (faceDX > 0 ? 'right' : 'left') : (faceDY > 0 ? 'down' : 'up');
  }
  // 地表边缘出口：仅在出口五格宽的通道切换区块，切换前先把当前区块引用写回缓存。
  tryCrossSurfaceExit(state);

  updateCursor();                                     // 建造幽灵光标
  // 容器面板：interact 只在 E 结算时置一个一次性请求，实际开面板由这里做（避免 interact 反向依赖 UI）
  if (state._openStore) { openStorePanel(state, state._openStore); state._openStore = null; }
  if (state._openStation) { openStationPanel(state, state._openStation); state._openStation = null; }
  if (state._openPayload) { openPayloadPanel(state, state._openPayload); state._openPayload = null; }
  if (state.activePanel === 'store' && state.storeRef) {   // 走远了自动关掉
    const cs = allContainers(state, true);
    const c = cs.find((x) => x.ref === state.storeRef);
    if (!c || Math.hypot(c.x + 0.5 - state.player.x, c.y + 0.5 - state.player.y) > 4.5) closePanel(state);
  }
  if ((state.activePanel === 'bench' || state.activePanel === 'smelter' || state.activePanel === 'furnace' || state.activePanel === 'analyze' || state.activePanel === 'clinic') && state.stationRef) {   // 走远了自动关掉
    const b = (state.buildings || []).find((x) => x === state.stationRef);
    if (!b || b.site || Math.hypot(b.x + 0.5 - state.player.x, b.y + 0.5 - state.player.y) > 4.5) closePanel(state);
  }
  if (state.activePanel === 'payload' && state.payloadRef) {   // 走远/换层/塔没了 → 自动关掉（与站台同规则）
    const b = (state.buildings || []).find((x) => x === state.payloadRef);
    if (!b || b.site || Math.hypot(b.x + 0.5 - state.player.x, b.y + 0.5 - state.player.y) > 4.5) closePanel(state);
  }
  // 回声视觉：走动时才有光（母脉层法则）
  {
    const px = state._lastPx == null ? p.x : state._lastPx;
    const py = state._lastPy == null ? p.y : state._lastPy;
    const moved = Math.hypot(p.x - px, p.y - py);
    state._lastPx = p.x; state._lastPy = p.y;
    state.echoT = moved > 0.012 ? 0.5 : Math.max(0, (state.echoT || 0) - dt);
  }
  // NaN 自愈：历史上（SPEED 缺键）会把 interactCd 写成 NaN，NaN <= 0 恒 false → E 键看起来“坏了”
  state.interactCd = Number.isFinite(state.interactCd) ? Math.max(0, state.interactCd - dt) : 0;
  // —— V：背负 / 放下结构体（第 5 步 5b）——
  // 【为什么是独立一键而不是复用 E】E 已经是“装配载荷/施工/采集”，再叠一个 2.2 秒的长按
  //   会和它们抢手势（按 E 站一下面板先开了）。所以另给一键（KeyV，见 data/keymap.js），键位表与提示行都会教。
  // 规则：**必须停下来按住**；松手、移动、换目标、条件变化 —— 一律重来（阵地战的意义就在这里）。
  {
    const still = !manual && !(p.path && p.path.length);
    const ptr = pointer();
    let kind = null, tower = null, ttx = 0, tty = 0, prompt = null;
    if (state.carried) {
      const c = state.carried;
      const def = BUILD[c.type] || { name: '结构体', hp: 0 };
      // 血量必须一直看得见：它替你挡伤害，掉光就真丢（这条代价不能被藏在悬停卡里）
      const hpTxt = `${Math.max(0, Math.round(c.hp))}/${def.hp || 0}`;
      const low = c.hp / Math.max(1, def.hp || 1) < 0.35 ? ' ⚠' : '';
      // 卸：光标指着哪就放哪（指到不合法处 → 退到自己脚下，和“建在自己脚下”同一套规则）
      const t = ptr.inside && ptr.sx >= 0 ? screenToTile(ptr.sx, ptr.sy) : { tx: Math.floor(p.x), ty: Math.floor(p.y) };
      ttx = t.tx; tty = t.ty;
      const e1 = unmountError(state, c, ttx, tty);
      if (e1) { ttx = Math.floor(p.x); tty = Math.floor(p.y); }
      const err = unmountError(state, c, ttx, tty);
      if (!still) prompt = `背上 ${def.name}（${hpTxt}${low}）· 停下并按住 V 放下`;
      else if (err) prompt = `背上 ${def.name}（${hpTxt}${low}）· 这里放不下（${err.replace('放不下：', '')}）`;
      else { kind = 'unmount'; prompt = `按住 V 放下 ${def.name}（${hpTxt}${low}）· 本格`; }
    } else if (still) {
      // 装：光标指着的塔优先（与 B48「鼠标指哪打哪」一致），没指到就取身边最近的塔
      const t = ptr.inside && ptr.sx >= 0 ? screenToTile(ptr.sx, ptr.sy) : null;
      const hit = t ? buildingAt(state, t.tx, t.ty) : null;
      let cand = (hit && carryable(hit)) ? hit : null;
      if (!cand) {
        let bd = 2.6;
        for (const b of state.buildings) {
          if (!carryable(b)) continue;
          const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
          if (d <= bd) { bd = d; cand = b; }
        }
      }
      if (cand) {
        const err = mountError(state, cand);
        const def = BUILD[cand.type];
        if (err) prompt = `邻近 ${def.name} · ${err}`;
        else { kind = 'mount'; tower = cand; prompt = `按住 V 背起 ${def.name}`; }
      }
    }
    const wantKey = kind === 'mount' ? `mount:${tower.x},${tower.y}` : kind === 'unmount' ? `unmount:${ttx},${tty}` : null;
    const holding = held(boundCode('carry'));
    if (!holding || !wantKey) { state.carryT = 0; state.carryKey = wantKey; }
    else if (state.carryKey !== wantKey) { state.carryKey = wantKey; state.carryT = dt; }
    else state.carryT = Math.min(CARRY.MOUNT_SECS, state.carryT + dt);
    if (state.carryT > 0 && state.carryT >= CARRY.MOUNT_SECS) {
      const err = kind === 'mount' ? mount(state, tower) : unmount(state, ttx, tty);
      if (err) { state.storeWarnTxt = err; state.storeWarnT = 3; sfx('deny'); }
      else if (kind === 'mount') maybeHint(state, 'firstCarry', showFirstNote);
      else maybeHint(state, 'firstDrop', showFirstNote);   // 两条都用字面量：检查器要能看到“有人调用”
      state.carryT = 0; state.carryKey = null; prompt = null;
    }
    state.carryPrompt = prompt;
    state.carryProgress = state.carryT > 0 ? state.carryT / CARRY.MOUNT_SECS : 0;
  }
  // —— Y：封灯撤退（第 7 步）——
  // 【为什么不进鼠标解析】背负是"对这个塔做"，而封灯是**全局示意**（把所有灯都封了）—— 它没有目标，
  //   所以不跟 B48 的"鼠标指哪交给谁"竞争。代价在按下之前就写在提示行里（sealHint），不靠玩家猜。
  {
    const done = updateSeal(state, dt, held(boundCode('seal')));
    if (done === 'done') {
      maybeHint(state, 'firstSeal', showFirstNote);
      state._sidebarSig = null;
    }
  }
  if (held(boundCode('interact')) && state.interactCd <= 0) {        // E：采集/精炼/加油/竖井/施工/开容器/制造台
    // 用**高亮显示的那一个**目标（updateHover 每帧算好），而不是再算一次“最近的”——
    //   否则“看到框在矿脉上、按 E 却砍了旁边的树”。
    const a = state.nearAct || resolveInteract(state, state.cursor);
    if (a) {
      tick(state, a);
      state.interactCd = actionCooldown(state, a);      // 研究 + 工具一起影响耗时
      state._actCdTotal = state.interactCd;           // 供进度弧用
      state._actTile = a.b ? `${a.b.x},${a.b.y}` : a.x != null ? `${a.x},${a.y}` : null;
    }
  }

  const L = BUILD.lamp;                               // 烧火的建筑：节奏看【火种】（档位越亮耗得越快）
  for (const b of state.buildings) {
    const def = BUILD[b.type];
    if (!def || !def.burnSec || !(b.fuel > 0)) continue;
    if (b.off) continue;                              // 熄火的自动熔炉：不发光也不烧火种
    const lv = LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1];
    const fireMul = def.fireMat ? smeltBurnMul(state) : 1;             // 知识「省料炉膛」只作用于炉火
    const burnSec = burnSecOf(b, def) * lampBurnMul(state) * fireMul / lv.burn;   // 火的节奏看烧的是什么
    b.burnT = (b.burnT || 0) + dt;
    while (b.burnT >= burnSec) { b.burnT -= burnSec; b.fuel--; }
    if (b.fuel <= 0) b.fuel = 0;
  }

  for (const f of state.floaties) f.t += dt;          // 飘字计时
  state.floaties = state.floaties.filter((f) => f.t < f.life);
  if (state.storeWarnT > 0) state.storeWarnT = Math.max(0, state.storeWarnT - dt);   // 「存储已满」提示计时
  if (state.banner) {                                 // 里程碑横幅计时
    state.banner.t += dt;
    if (state.banner.t >= state.banner.life) state.banner = null;
  }
  pmark('sim.pre', tStep);

  // N6b：前哨迁移是区块级事件，不放进普通 NPC 寻路循环；完成后再由本帧的
  // updateWorkers 处理抵达区块里的新任务。无人区块不会因此被唤醒做生产结算。
  updateOutpostTravel(state, dt);

  const tSys = pnow();
  for (const fn of SIM) {                             // 系统：波次/蚀兽/光爆（逐个计时，体检时能直接看出是哪一个）
    const t1 = pnow();
    fn(state, dt);
    pmark('sys.' + fn.name, t1);
  }
  // N6b-2a：远端前哨只在区块活跃时低频结算，当前区块仍由原有 NPC AI 处理。
  updateOutpostSettlement(state, dt);
  pmark('sim.systems', tSys);
  // 蚀痕：低频心跳（累加 dt 一次性结算，长跑结果与每步结算等价）
  state._blightT = (state._blightT || 0) + dt;
  if (state._blightT >= 1 / BLIGHT_HZ) {
    const t1 = pnow();
    updateBlight(state, state._blightT);
    state._blightT = 0;
    pmark('sys.updateBlight', t1);
  }
  const tCol = pnow();
  separateEntities(state, dt);                        // 实体间碰撞体积（弹性分离，放最后：先把 AI 走完再收拾重叠）
  pmark('sim.collide', tCol);
  handleDeath(state);
  // 就地剔除阵亡者：绝不可整体替换 state.enemies（那会与 layers.surface.enemies 脱钩）
  const eArr = state.enemies;
  for (let i = eArr.length - 1; i >= 0; i--) if (!eArr[i].alive) eArr.splice(i, 1);
  const tLight = pnow();
  if (lightDirty(state)) compute(state);              // 光照：脏标记驱动（原来每个模拟步都重算）
  pmark('sim.light', tLight);
  // 开发期自检放在完整模拟步之后：区块切换、生产和账本同步都已收口，避免监控读到半帧状态。
  selfTestTick();
}

function update(dt) {
  if (state.paused || !state.started) { drawHud(); return; }   // 暂停/菜单：不推进模拟，但 HUD 照常刷新
  acc = Math.min(acc + dt, MAX_ACC);
  while (acc >= STEP) { acc -= STEP; simStep(STEP); } // 固定步推进
  mouseDuties();
  stepFirstNote(dt);
  checkHints(state, dt, showFirstNote);               // 首次提示（说一次就不再说）
  updateAmbient(state, dt);                           // 环境音床（缺文件就静音，不影响其它声音）
  const cam = state.camera;                           // 摄像机按帧平滑跟随（+ 中键拖屏的临时偏移）
  const p = state.player;
  const pan = state.camPan || { x: 0, y: 0 };
  cam.x += (p.x + pan.x - cam.x) * Math.min(1, dt * 6);
  cam.y += (p.y + pan.y - cam.y) * Math.min(1, dt * 6);
  drawHud();
}

// 按住不放才成立的鼠标职责：拖拽连放 / Alt 扫拆 / 中键拖屏 / 滚轮
// —— 首次提示横幅（systems/hints.js 驱动）——
// 比提示行更显眼一点，5.5 秒后自己淡出；每条只说一次（state.seen 随存档走）
const firstNoteEl = document.getElementById('firstnote');
let firstNoteT = 0;
function showFirstNote(txt) {
  if (!firstNoteEl || !settings.hints) return;          // 设置 → 画面 → 「新手提示」关掉就不弹
  firstNoteEl.textContent = txt;
  firstNoteEl.classList.remove('hidden', 'out');
  firstNoteT = 5.5;
}
function stepFirstNote(dt) {
  if (!firstNoteEl || firstNoteT <= 0) return;
  firstNoteT -= dt;
  if (firstNoteT <= 0.6) firstNoteEl.classList.add('out');
  if (firstNoteT <= 0) { firstNoteEl.classList.add('hidden'); firstNoteEl.classList.remove('out'); }
}

function mouseDuties() {
  const ptr = pointer();
  // Shift 快走：按住加速（左右 Shift 都算）—— 它只是“倍率”，不消耗任何资源，也不改光照/恐惧节奏
  if (state.player) state.player.speedMul = ptr.shift ? RUN_MUL : 1;
  const { tx, ty } = ptr.inside && ptr.sx >= 0 ? screenToTile(ptr.sx, ptr.sy) : { tx: -1, ty: -1 };
  const inMap = tx >= 1 && ty >= 1 && tx < state.map.w - 1 && ty < state.map.h - 1 && !minimapHit(ptr.sx, ptr.sy, state);
  const pressed = takePress();
  if (pressed === 1) { state._dragStart = { x: tx, y: ty }; state._lastPut = { x: tx, y: ty }; }

  if (ptr.l && inMap && !screenOpen()) {
    if (state.building && !ptr.alt) {
      // 建造：按住左键拖 = **矩形填充**（拖的时候只画范围，松手才落地）
      // 点一下不拖 = 1×1 的矩形，所以单击/拖拽是同一套逻辑，不会出现两种放法打架
      const s0 = state._dragStart || { x: tx, y: ty };
      state.dragRect = rectOf(s0.x, s0.y, tx, ty);
    } else if (ptr.alt) {
      // Alt + 按住左键扫过去 = 连续拆（清一片林子/旧墙）
      if (state._altSweep !== key) {
        state._altSweep = key;
        const b = buildingAt(state, tx, ty);
        if (b) {
          const err = demolish(state, b);
          toast(state, err || `已拆除 ${BUILD[b.type].name}`);
          state._panelSig = null;
        }
      }
    }
  }
  if (!ptr.l) { state._dragPlace = null; state._altSweep = null; }

  // 滚轮：建造中/建造面板开着 → 切格位；否则 → 缩放画面
  const wheel = takeWheel();
  if (wheel) {
    if (state.building || state.activePanel === 'build' || state.hotbarOpen) cycleHot(state, wheel > 0 ? 1 : -1);
    else zoomBy(state, wheel > 0 ? 1 : -1);
  }

  // 中键拖屏：把镜头从玩家身上暂时挪开（一旦走动/下令就自动收回）
  const d = takeDrag();
  if (d.x || d.y) {
    const pan = state.camPan || (state.camPan = { x: 0, y: 0 });
    pan.x = Math.max(-18, Math.min(18, pan.x - d.x / TILE));
    pan.y = Math.max(-18, Math.min(18, pan.y - d.y / TILE));
  }
}

// —— 建造拖矩形（W13-I）——
// 规则：按住左键拖出一块 → 松手一次性放下；只点一下 = 1×1。
// 上限 RECT_MAX：一次几千格会让单帧卡一下，而且那种规模本来就是“整片推平”，不如分开拖。
const RECT_MAX = 1600;             // 40×40
function rectOf(ax, ay, bx, by) {
  const m = state.map;
  const x0 = Math.max(1, Math.min(ax, bx)), x1 = Math.min(m.w - 2, Math.max(ax, bx));
  const y0 = Math.max(1, Math.min(ay, by)), y1 = Math.min(m.h - 2, Math.max(ay, by));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return { x0, y0, x1, y1, w, h, n: w * h };
}
function placeRect(state, r) {
  if (r.n > RECT_MAX) { sfx('deny'); toast(state, `矩形太大：${r.n} 格（上限 ${RECT_MAX}）`); return; }
  let ok = 0, fail = 0, firstErr = null;
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const err = tryPlace(state, state.building, x, y);
      if (err) { fail += 1; if (!firstErr) firstErr = err; }
      else { ok += 1; state._lastPut = { x, y }; }
    }
  }
  state._panelSig = null;
  if (ok && !fail) toast(state, `放下 ${ok} 格`);
  else if (ok && fail) toast(state, `放下 ${ok} 格 · ${fail} 格没放下（${firstErr}）`);
  else if (fail) toast(state, `没放下（${firstErr}）`);
}
function initDragRect(canvas) {
  // 松手在 window 上监听：拖到画布外松手也算数
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const r = state.dragRect;
    const start = state._dragStart;
    state.dragRect = null;
    state._dragStart = null;
    if (!state.building || e.altKey) return;              // Alt = “直接拆”，不归这里管
    if (state.paused || screenOpen()) return;             // 冻结/菜单里松手：不算数
    if (r) placeRect(state, r);
    else if (start) placeRect(state, rectOf(start.x, start.y, start.x, start.y));   // 快到来不及画框的一下
  });
}

function drawHud() {
  const p = phaseInfo(state);
  elDay.textContent = `第 ${state.day} 天`;
  // 壶潮里把"还剩多少秒天亮"直接写在相位旁边（第 7 步）：
  //   ★ 这是玩家做"继续顶 or 封灯撤退"决定的核心数字 —— 它应该在视野里一直看得见，而不是只能靠感觉。
  const hud = nightHud(state);
  elPhase.textContent = isTide(state) ? `壶潮 ${Math.ceil(hud.tideLeft)}s` : p.name;
  // 潮位 = tideOf（data/combat.js 的唯一式子）。
  //   【B49】原来这里写的是 Math.min(day, 12)，而实际上限是 WAVES.TIDE_MAX = 8 ——
  //   玩家会在第 9~12 天看到“潮位 9/10/11/12”，但出怪上限/间隔早就不动了（数字说谎）。
  elTide.textContent = `潮位 ${tideOf(state)}`;
  // 今晚是什么夜（W14-A 第 4 步）：白天预告、夜里报时段；颜色取自“主力兵种”的色，与场上敌人一眼对得上
  if (elNightTheme) {
    const nh = nightHud(state);
    elNightTheme.textContent = isTide(state) ? `${nh.theme} · ${nh.seg}` : `今晚 ${nh.theme}`;
    elNightTheme.title = `${nh.theme}：${nh.note}（主力：${nh.signatures.join(' / ')}）`;
    elNightTheme.style.color = nh.color || '';
  }
  // 还剩几波（第 7 步）：与刷怪器**同一个式子**算出来的估数（cap 卡住时实际会更少 → 文案带"≈"）
  if (elWaveLeft) {
    const n = hud.left;
    if (n == null || isDawn(state)) elWaveLeft.classList.add('hidden');
    else {
      elWaveLeft.classList.remove('hidden');
      elWaveLeft.textContent = isTide(state) ? `还剩 ≈${n} 波` : `今夜 ≈${n} 波`;
      elWaveLeft.title = `本夜还剩 ≈${n} 批（每批数量随潮位/时段变）· 与刷怪节奏同一个式子`;
    }
  }
  bar.style.width = `${(p.frac * 100).toFixed(1)}%`;
  elLayer.textContent = layerName(state);
  elHp.textContent = `${Math.max(0, Math.ceil(state.playerHp))}/${state.playerMaxHp || 100}`;
  if (elHpMeter) {
    const hpPct = Math.max(0, Math.min(100, (state.playerHp / (state.playerMaxHp || 100)) * 100));
    elHpMeter.style.width = `${hpPct.toFixed(1)}%`;
    elHpMeter.parentElement.parentElement.classList.toggle('critical', hpPct <= 25);
  }
  if (elSat) {
    const injury = state.playerInjury ? ` · ${injuryName(state.playerInjury)}` : '';
    elSat.textContent = `${Math.round(state.playerHunger || 0)}${injury}`;
    elSat.title = `饱食 ${Math.round(state.playerHunger || 0)}/${SURVIVAL.PLAYER.HUNGER_MAX}${injury}`;
    if (elSatMeter) {
      const satPct = Math.max(0, Math.min(100, (state.playerHunger || 0) / SURVIVAL.PLAYER.HUNGER_MAX * 100));
      elSatMeter.style.width = `${satPct.toFixed(1)}%`;
      elSatMeter.parentElement.parentElement.classList.toggle('critical', satPct <= 20);
    }
  }
  elKills.textContent = state.kills;

  // Boss 血条（第 7 步：多一个阶段读数 + 血条上 50% 刻度，让“转折点”看得见）
  const bs = state.bossRef;
  if (bs && bs.alive) {
    bossWrap.classList.remove('hidden');
    const ph = (bs.bossPhase || 1) >= 2 ? '二阶段' : '一阶段';
    bossName.textContent = `蚀巢核心 · 第 ${(bs.tier | 0) + 1} 轮 · ${ph}`;
    bossFill.style.width = `${Math.max(0, (bs.hp / bs.maxHp) * 100).toFixed(1)}%`;
  } else {
    bossWrap.classList.add('hidden');
  }

  // 里程碑横幅
  if (state.banner) {
    if (state._bannerRef !== state.banner) {
      state._bannerRef = state.banner;
      bannerEl.innerHTML = `<h2>${state.banner.title}</h2><p>${state.banner.sub}</p>`;
    }
    bannerEl.classList.remove('hidden');
  } else if (state._bannerRef) {
    state._bannerRef = null;
    bannerEl.innerHTML = '';
    bannerEl.classList.add('hidden');
  }

  // 情境提示（建造模式 > Boss > 大潮 > 灯光档位 > 营地状态）
  const bossNight = state.day % 7 === 0;
  const ws0 = state.workers || [];
  const buildDef = state.building ? BUILD[state.building] : null;
  const nearLamp = state.buildings.find((b) => !b.site && (b.type === 'lamp' || b.type === 'purifier')
    && Math.hypot(b.x + 0.5 - state.player.x, b.y + 0.5 - state.player.y) <= 2.4);
  const bl = blightStats(state);
  const hollowW = ws0.find((w) => w.hollow);
  const nearHollow = ws0.find((w) => w.hollow && Math.hypot(w.x - state.player.x, w.y - state.player.y) <= SOOTHE_CFG.radius);
  let colony = null;
  if (nearHollow) colony = `${nearHollow.name} 蚀化了 · 按住 E 安抚（${SOOTHE_CFG.fuel} 燃料）`;
  else if (hollowW) colony = `${hollowW.name} 蚀化了 · 去安抚她，或用净光柱（8）照 ${SOOTHE_CFG.autoSec} 秒`;
  else if (ws0.length && !state.res.food) colony = '断粮 · 7 建幽菌田（需光照）';
  else if ((state.playerRestT || 0) > 0) colony = `休整中 · 还需 ${Math.ceil(state.playerRestT)}s`;
  else if (state.playerInjury > 0) colony = `${injuryName(state.playerInjury)} · 靠营地火按 Z 吃热食`;
  else if ((state.playerHunger || 0) <= SURVIVAL.PLAYER.LOW_HUNGER) colony = '饱食偏低 · 按 Z 吃口粮';
  else if (ws0.some((w) => w.morale < 25)) colony = '有人士气崩溃 · 把营地照亮，并备足食物';
  else if (bl.level3 > 0) colony = `3 级蚀痕 ${bl.level3} 格 · 夜里会渗出蚀兽（光爆 / 净光柱可净化）`;
  else if (bl.tiles > 0) colony = `蚀痕 ${bl.tiles} 格 · 不能建造、农田停产（光照会慢慢抚平）`;
  else if (state.buildings.some((b) => b.type === 'farm' && !b.site && (b.growth || 0) >= 1)) colony = '幽菌田成熟 · E 采收';
  const lampHint = nearLamp
    ? `${BUILD[nearLamp.type].name}：${LIGHT_LEVELS[nearLamp.level == null ? 1 : nearLamp.level].name}档 · R 调节（越亮越费）`
    : null;
  // 建造模式：把鼠标下的落点能不能放（以及为什么不能）直接写在提示行里
  let placeMsg = '';
  if (buildDef) {
    const ptr = pointer();
    const { tx, ty } = screenToTile(ptr.sx, ptr.sy);
    const err = ptr.sx >= 0 ? placeError(state, state.building, tx, ty) : '把鼠标移到地图上';
    placeMsg = err ? ` · <em class="hi-warn">✕ ${err}</em>` : ' · <em class="hi-ok">✓ 可放置</em>';
  }
  const actTxt = state.nearAct ? actLabel(state.nearAct) : null;
  // 第 5 步：手上是发射器时，提示行多一句 F（属最低优先级的“环境提示”）
  const wandHint = canFire(heldTool(state)) ? 'F 开火 · 辉光棒（约 3 发 1 燃料）' : null;
  // 第 5 步 5b：结构装载体。进行中的长按**优先**显示（玩家必须看到还差几秒）
  const carryHold = state.carryT > 0 ? `${state.carryPrompt} · ${(CARRY.MOUNT_SECS - state.carryT).toFixed(1)}s…` : null;
  const carryHint = state.carryPrompt ? `${state.carryPrompt}（放开就重来）` : null;
  // 第 7 步：封灯撤退 —— 长按中的倒计时（与背负同一个手势语言）
  const sealHold = state.sealT > 0 ? `封灯撤退 · ${(RETREAT.HOLD - state.sealT).toFixed(1)}s…（松开就取消）` : null;
  // 只在“现在真能封”的时候把代价说出来 —— 否则每晚都要看一遍“潮还没压上来”的唠叨
  const sealLine = isTide(state) && !sealError(state) ? sealHint(state) : null;
  // 黎明：还剩几只蚀兽没化完（提示行用；纯计数、不分配数组）
  let dawnLeft = 0;
  if (isDawn(state)) for (const e of state.enemies) if (e.alive && !(e.def && e.def.boss)) dawnLeft += 1;
  const nh = nightHud(state);            // 今晚的主题/时段/下一波（W14-A 第 4 步；内部带缓存）
  const mainHint = buildDef
    ? `${buildDef.name} · ${costText(buildDef.cost, true)} · 工期 ${workOf(state.building)}${placeMsg} · 左键放置 · Esc 取消`
    : state.demolish
      ? '拆除 · 左键点掉（工地全退 · 建成退半）· X / Esc 退出'
      : (bs && bs.alive)
      ? '蚀巢核心逼近营地 · 集火本体'
      : (state.storeWarnT > 0)
        ? `<em class="hi-warn">${state.storeWarnTxt || '仓储已满，材料正在丢失'}</em>`
      : (bossNight && state.t < TIDE_START)
        ? '今晚大潮 · 备足燃料，塔放进光里'
        : (state.t >= DUSK_START && state.t < TIDE_START)
          ? `黄昏 · 今晚「${nightHud(state).theme}」：${nightHud(state).note} · N 安排今夜`
          : (isDawn(state) && dawnLeft > 0)
            ? `黎明 · 残留蚀兽 ${dawnLeft} 只正在消解（Boss 除外）· 夜辉草还能抢收`
            : nh.soon
              ? `<em class="hi-warn">下一波以 ${nh.group} 为主（${nh.tag}）· ${Math.max(0, Math.ceil(nh.secs))}s</em>${carryHint ? ' · ' + carryHint : ''}`
              : actTxt
            ? `<em class="hi-act">E：${actTxt}</em>`
            : carryHint || lampHint || colony || wandHint
              ? (carryHint || lampHint || colony || wandHint)
              : sealLine
                ? sealLine
                : state.milestone.bossDefeated
                  ? '序章完成 · 下一轮大潮每 7 天更强'
                  : '夜里蚀潮会来 · 在灯照范围内布塔迎战';
  // 一句话提示（toast）优先盖在最上面：拖放、撤销、缩放结果都要立刻看得见
  const toastTxt = state.toast && performance.now() - state.toast.at < 1800 ? state.toast.txt : null;
  // 长按进行中：除 toast 之外它就最优先（玩家要知道“还差几秒 / 已经开始了”）
  hintEl.innerHTML = toastTxt ? `<em class="hi-ok">${toastTxt}</em>` : (sealHold ? `<em class="hi-warn">${sealHold}</em>` : (carryHold ? `<em class="hi-act">${carryHold}</em>` : mainHint));

  renderSidebar();          // 常驻侧栏：资源 + 拓荒队
  renderHotbar();           // 常驻快捷栏（底部）
  renderPanelHost(state);   // 按键面板（内部按签名比对，变化才重建）
  refreshWTip();            // 侧栏悬停提示（自绘，元素常驻，不会因侧栏重建而闪）
}

// 侧栏：常用材料（常驻）+ 拓荒队（常驻，可折叠）
const RES_ROWS = [
  { k: 'ore', name: '辉髓', cls: 'r-ore' },
  { k: 'vine', name: '藤木', cls: 'r-vine' },
  { k: 'stone', name: '石头', cls: 'r-stone' },
  { k: 'coal', name: '木炭', cls: 'r-coal' },
  { k: 'fuel', name: '燃料', cls: 'r-fuel' },
  { k: 'food', name: '食物', cls: 'r-food' },
];
const RES_ROWS_DEEP = [
  { k: 'data', name: '档案', cls: 'r-data' },
  { k: 'core', name: '母髓', cls: 'r-core' },
  { k: 'night', name: '夜髓', cls: 'r-night' },
];
const COST_CLASS = { ore: 'r-ore', vine: 'r-vine', fuel: 'r-fuel', data: 'r-data', core: 'r-core', food: 'r-food', night: 'r-night' };
const COST_NAME = { ore: '辉髓', vine: '藤木', fuel: '燃料', data: '档案', core: '母髓', food: '食物', night: '夜髓' };
function costText(cost, full) {
  let s = '';
  for (const k in cost) s += `<em class="${COST_CLASS[k] || ''}">${full ? COST_NAME[k] : COST_NAME[k][0]}${cost[k]}</em>`;
  return s;
}

function resRow(state, r, dim) {
  const v = state.res[r.k] || 0;
  return `<div class="sb-res ${r.cls}${dim ? ' dim' : ''}"><span class="ricon">${resIcon(r.k, 13)}</span><i>${r.name}</i><b data-live="res-${r.k}">${v}</b></div>`;
}

// 材料数字原位刷新：不进签名、不重建 DOM（工人每采一次就重建的话，名册悬停与滚动都会被打断）
function refreshResLive() {
  if (!sidebarEl) return;
  const set = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  for (const r of RES_ROWS) set(sidebarEl.querySelector(`[data-live="res-${r.k}"]`), String(state.res[r.k] || 0));
  for (const r of RES_ROWS_DEEP) set(sidebarEl.querySelector(`[data-live="res-${r.k}"]`), String(state.res[r.k] || 0));
  const row = sidebarEl.querySelector('[data-live="stg"]');
  if (row) {
    const st = storageStats(state);
    set(row.querySelector('b'), `${st.local.used}/${st.local.cap}${st.localFull ? ' 满' : ''}`);
    // 满仓只由容器/面板容量条标红；侧栏整行保持稳定色，避免整块警示抢走视线。
    row.style.color = '#c9b48a';
  }
  // 装备位（手上那件工具）
  const tr = sidebarEl.querySelector('[data-live="tool"]');
  if (tr) {
    const k = heldTool(state);
    set(tr.querySelector('b'), k ? `${RES_NAME[k] || k}（手）` : '空手');
    tr.style.color = k ? (RES_COLOR[k] || '#dfe9ff') : '#929aac';   // 辅助色：≥4.5:1（原来 #7f8d9e 只有 4.1）
  }
  // 补给站燃料每 4 秒就变一次 —— 也不该触发侧栏重建
  const cs = cacheStats(state);
  set(sidebarEl.querySelector('[data-live="cache"]'), `${cs.count} 站 · ${cs.fuel} 燃料`);
  refreshRosterLive();
}

// 名册本身不重建（重建会打断悬停提示、把地图高亮闪断），只原位改四个小条与职业点
function refreshRosterLive() {
  if (!sidebarEl) return;
  const ws = state.workers || [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const dot = sidebarEl.querySelector(`[data-live="wjob-${i}"]`);
    if (dot) dot.style.background = JOB_COLOR[w.job] || '#8fa0b5';
    const san = w.sanity == null ? SANITY_MAX : w.sanity;
    const vals = [w.hp / w.maxHp * 100, w.hunger, w.morale, san];
    const cols = ['#ff9d9d', '#ffd76e', moraleTier(w.morale).color, sanityTier(san).color];
    for (let k = 0; k < vals.length; k++) {
      const el = sidebarEl.querySelector(`[data-live="wbar-${i}-${k}"]`);
      if (!el) continue;
      el.style.width = `${(Math.max(0, Math.min(100, vals[k])) | 0)}%`;
      el.style.background = cols[k];
    }
  }
}

// 光压汇总：光源数量、总亮度倍率、燃料消耗速度（供玩家做"把光给谁"的决策）
// 另外单独统计光路（点亮的棱镜 / 总棱镜）与诱饵灯 —— 它们不产光，但属于同一套决策
function lightSummary() {
  let count = 0, power = 0, perSec = 0, prism = 0, prismLit = 0, decoy = 0, decoyFuel = 0;
  for (const b of state.buildings) {
    const def = BUILD[b.type];
    if (!def) continue;
    if (b.site) continue;                                     // 工地不算光压 / 诱饵
    if (b.type === 'prism') { prism++; if (b.relayHop != null) prismLit++; continue; }
    if (def.decoy) { if (b.fuel > 0) { decoy++; decoyFuel += b.fuel || 0; } continue; }   // 诱饵不算光压
    if (!def.power || !(b.fuel > 0) || b.off) continue;
    const lv = LIGHT_LEVELS[b.level == null ? 1 : b.level] || LIGHT_LEVELS[1];
    count += 1;
    power += lv.r;
    if (def.burnSec) perSec += lv.burn / (burnSecOf(b, def) * lampBurnMul(state));   // 火种不同，耗料速度不同
  }
  return { count, power, perSec, perMin: perSec * 60, prism, prismLit, decoy, decoyFuel };
}

// —— F 键：手持开火（W14-A 第 5 步）——
// 手持辉光棒时朝**鼠标方向**打一束辉光：单目标命中弹出（射线只会打中第一个挡路的敌人）。
// 【为什么不是"打最近的敌人"】那就变成了自动瞄准 —— 玩家的乐趣在“我自己瞄”。
// 燃料走**小数债务**（与塔同一条纪律）：每发记 0.34，满 1 才真扣容器（约 3 发 1 燃料）。
// 不靠环境光：这正是它最大的价值 —— 深渊里那点黑，它自己就是那束光。
export function fireHand() {
  if (!state.started || state.paused || screenOpen()) return 'no';
  if (state.fireCd > 0) return 'cd';
  const k = heldTool(state);
  if (!canFire(k)) {                                    // 手上没发射器：说一次（节流），别每按一次都刷屏
    if (!state._noWandT || state._noWandT < performance.now()) {
      state._noWandT = performance.now() + 4000;
      toast(state, '手上没有发射器 · 制造台能做一根「辉光棒」');
    }
    return 'nowand';
  }
  const p = state.player;
  // 方向：鼠标指着哪就往哪打（鼠标不在画面里就用朝向/默认向右）
  const ptr = pointer();
  let dx = 1, dy = 0;
  if (ptr.inside && ptr.sx >= 0) {
    const t = screenToTile(ptr.sx, ptr.sy);
    dx = t.tx + 0.5 - p.x; dy = t.ty + 0.5 - p.y;
    if (Math.hypot(dx, dy) < 0.2) { dx = 1; dy = 0; }
  }
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  // 命中：沿射线找最近的敌人（垂距 ≤ BEAM_R，且投影在 [0, RANGE] 内 → 只打“前面”）
  let target = null, bestT = Infinity;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const ex = e.x - p.x, ey = e.y - p.y;
    const along = ex * dx + ey * dy;
    if (along < 0 || along > HAND_FIRE.RANGE) continue;
    const perp = Math.abs(-dx * ey + dy * ex);
    if (perp > HAND_FIRE.BEAM_R) continue;
    if (along < bestT) { bestT = along; target = e; }
  }
  // 燃料：小数债务（扣不出就不开火，提示一次）
  state.handDebt = (state.handDebt || 0) + HAND_FIRE.FUEL_PER_SHOT;
  const want = Math.floor(state.handDebt);
  if (want > 0) {
    if (withdraw(state, { fuel: want })) {
      state.handDebt -= want;
      state.handDebt = Math.max(0, state.handDebt - HAND_FIRE.FUEL_PER_SHOT);   // 这一发没打出去
      if (!state._noFuelT || state._noFuelT < performance.now()) {
        state._noFuelT = performance.now() + 4000;
        toast(state, '燃料不足 · 辉光棒点不着（约 3 发 1 燃料）');
      }
      return 'nofuel';
    }
    state.handDebt -= want;
  }
  state.fireCd = HAND_FIRE.CD;
  const end = target ? { x: target.x, y: target.y } : { x: p.x + dx * HAND_FIRE.RANGE, y: p.y + dy * HAND_FIRE.RANGE };
  state.beams.push({ x1: p.x, y1: p.y, x2: end.x, y2: end.y, t: 0, life: 0.16, color: '198,240,255' });
  sfx('shoot', { x: p.x, y: p.y, rate: 1.05 });
  if (target) {
    const dmg = HAND_FIRE.DMG * (state.pulseMul || 1);
    applyDamage(state, target, dmg, HAND_FIRE.TYPE);
    state.floaties.push({ x: target.x, y: target.y - 0.5, txt: `-${Math.round(dmg)}`, color: '#cfefff', t: 0, life: 0.5 });
  }
  return 'ok';
}

// 手持装备的每帧账目（冷却 + 燃料小数债务）
// 【为什么这也要衰减】手里没拿发射器时债务也得继续计 —— 否则“换掉再拿回”就能免燃料
function updateHand(s, dt) {
  if (s.fireCd > 0) s.fireCd = Math.max(0, s.fireCd - dt);
  if (s.handDebt > 0 && !canFire(heldTool(s))) s.handDebt = Math.max(0, s.handDebt - dt * 0.5);   // 收手后慢慢散掉
}

// R 键：循环最近光源的亮度档位（低/中/高）
function cycleLampLevel() {
  const p = state.player;
  let best = null, bestD = 2.4;
  for (const b of state.buildings) {
    const def = BUILD[b.type];
    if (!def || !def.power || b.site) continue;
    if (def.fireMat) continue;                       // 炉火不是灯：R 键不调炉子的档（火种才是它的“档位”）
    const d = Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y);
    if (d <= bestD) { bestD = d; best = b; }
  }
  if (!best) return false;
  best.level = ((best.level == null ? 1 : best.level) + 1) % LIGHT_LEVELS.length;
  const lv = LIGHT_LEVELS[best.level];
  state.floaties.push({ x: best.x, y: best.y - 0.5, txt: `亮度：${lv.name}`, color: '#aee9ff', t: 0, life: 0.9 });
  state._sidebarSig = null;      // 光压条立即刷新
  return true;
}
function renderSidebar() {
  if (!sidebarEl) return;
  const ws = state.workers || [];
  const sum = lightSummary();
  const bl = blightStats(state);
  const gs = graveStats(state);
  const cs = cacheStats(state);
  const sig = `${fold.res}|${fold.camp}|${fold.roster}|`
    + `${sum.count}|${sum.power.toFixed(2)}|${sum.perMin.toFixed(2)}|${sum.prism}|${sum.prismLit}|${sum.decoy}|${bl.tiles}|${bl.level3}|${gs.count}|${cs.count}|`
    + ws.map((w) => `${w.name}${w.hollow ? 'H' : ''}${w.downed ? `D${Math.ceil(w.downT || 0)}` : ''}${w.rescueState === 'escort' ? 'E' : ''}${w.medicalState && w.medicalState !== 'none' ? `M${w.medicalState[0]}` : ''}|${bondLabel(w)}`).join(',')   // 只放低频字段：血/饱食/士气/职业走原位刷新
    + `|${state.order || 'auto'}`;
  if (state._sidebarSig === sig) { refreshResLive(); return; }   // 没变：只原位刷数字
  state._sidebarSig = sig;

  let html = foldHead('res', '材料');
  let resBody = '';
  for (const r of RES_ROWS) resBody += resRow(state, r, false);
  resBody += '<div class="sb-div"></div>';
  for (const r of RES_ROWS_DEEP) resBody += resRow(state, r, true);
  html += foldBody('res', resBody);

  // 营地状态：光压 / 燃耗（决策支撑）+ 蚀痕
  const srow = (col, ico, label, body, extra = '') => `<div class="sb-res" style="color:${col}"${extra}><span class="ricon">${icon(ico, 13)}</span><i>${label}</i><b>${body}</b></div>`;
  let campBody = '';
  campBody += srow('#8fd0ff', 'light', '光压', `${sum.count} 盏 · ${sum.power.toFixed(1)}×`);
  campBody += srow('#ff9d5c', 'fire', '燃耗', `${sum.perMin.toFixed(2)}/分`);
  const blCol = bl.level3 > 0 ? '#ff8ad8' : bl.tiles > 0 ? '#c07bff' : '#8fa0b5';
  campBody += srow(blCol, 'blight', '蚀痕', `${bl.tiles} 格${bl.level3 ? ` · ${bl.level3}格3级` : ''}`, ' data-tipkey="blight" data-tiplabel="蚀痕" data-tiptext="无光的土地会被黑暗腐蚀；光照可以慢慢撸平它"');
  if (gs.count) campBody += srow('#e8d9a8', 'grave', '墓碑', `${gs.count} 座 · 半径 ${gs.maxRadius.toFixed(1)}`, ' data-tipkey="grave" data-tiplabel="墓碑" data-tiptext="墓碑随天数变亮，成为营地的灯"');
  campBody += srow('#c9b48a', 'storage', '仓储', '... ', ' data-live="stg" data-tipkey="stg" data-tiplabel="仓储" data-tiptext="采到的材料自动进入最近的容器；本层容器都满时材料会丢失"');
  campBody += srow('#cfe0f0', 'pick', '装备', '... ', ' data-live="tool" data-tipkey="tool" data-tiplabel="装备" data-tiptext="工具是真物品：拿在手上就不在仓库里；在制造台（B → 生产 → 制造台，需研究「石工」）制造与切换"');
  if (cs.count) campBody += `<div class="sb-res" style="color:#ffcf8a" data-tipkey="cache" data-tiplabel="补给站" data-tiptext="每 4 秒给 6 格内最缺油的灯加 1 燃料"><span class="ricon">${icon('cache', 13)}</span><i>补给</i><b data-live="cache">${cs.count} 站 · ${cs.fuel} 燃料</b></div>`;
  if (sum.prism) {
    campBody += srow(sum.prismLit < sum.prism ? '#7f93a8' : '#a8ecff', 'prism', '光路', `${sum.prismLit} / ${sum.prism} 接亮`, ' data-tipkey="prism" data-tiplabel="光路" data-tiptext="棱镜不耗燃料：被照亮时把光接力出去；打碎任何一面，下游整条都会灭"');
  }
  if (sum.decoy) campBody += srow('#9fc3e0', 'decoy', '诱饵', `${sum.decoy} 盏 · ${sum.decoyFuel} 燃料`, ' data-tipkey="decoy" data-tiplabel="诱饵灯" data-tiptext="不发光、不照亮、不压蚀痕 —— 只把蚀兽引过来"');
  html += foldHead('camp', '营地') + foldBody('camp', campBody);

  html += `<div class="whead fold" data-fold="roster"><span>拓荒队 ${ws.length} 人</span><span class="worder">${ORDER_NAME[state.order || 'auto'] || '自动'}</span><span class="wchev">${fold.roster ? '▸' : '▾'}</span></div>`;
  let rosterBody = '';
  if (!ws.length) {
    rosterBody = '<div class="wtitle">无人生还…</div>';
  } else {
    rosterBody = ws.map((w, i) => {
      const san = w.sanity == null ? SANITY_MAX : w.sanity;
      const tier = sanityTier(san);
      const fl = statusFlag(w);
      const flagHtml = `<span class="wstat"${fl ? ` style="color:${fl.color}" title="${fl.tip}"` : ''}>${fl ? icon(fl.ico, 12) : ''}</span>`;
      if (w.hollow) {
        return `<div class="wrow hollow">
          <span class="wjobdot" data-live="wjob-${i}" style="background:#c07bff"></span>
          ${flagHtml}
          <span class="wname">${w.name}</span>
          <span class="wbars">${statBar(san, '#c07bff', `wbar-${i}-3`)}</span>
        </div>`;
      }
      if (w.downed) {
        return `<div class="wrow downed">
          <span class="wjobdot" data-live="wjob-${i}" style="background:#ffcf8a"></span>
          ${flagHtml}
          <span class="wname">${w.name}</span>
          <span class="wbars"><span class="wdown">倒地 · ${Math.ceil(w.downT || 0)}s</span></span>
        </div>`;
      }
      if (w.rescueState === 'escort') {
        return `<div class="wrow downed">
          <span class="wjobdot" data-live="wjob-${i}" style="background:#9ef7d8"></span>
          ${flagHtml}
          <span class="wname">${w.name}</span>
          <span class="wbars"><span class="wdown">护送至铺位</span></span>
        </div>`;
      }
      if (w.medicalState === 'treating' || w.medicalState === 'queued') {
        return `<div class="wrow medical">
          <span class="wjobdot" data-live="wjob-${i}" style="background:#9fe8d5"></span>
          ${flagHtml}
          <span class="wname">${w.name}</span>
          <span class="wbars"><span class="wdown">${w.medicalState === 'treating' ? '治疗中' : '等待医疗位'}</span></span>
        </div>`;
      }
      return `<div class="wrow">
        <span class="wjobdot" data-live="wjob-${i}" style="background:${JOB_COLOR[w.job] || '#8fa0b5'}"></span>
        ${flagHtml}
        <span class="wname">${w.name}</span>
        <span class="wbars">${statBar(w.hp / w.maxHp * 100, '#ff9d9d', `wbar-${i}-0`)}${statBar(w.hunger, '#ffd76e', `wbar-${i}-1`)}${statBar(w.morale, '#7dffb0', `wbar-${i}-2`)}${statBar(san, tier.color, `wbar-${i}-3`)}</span>
      </div>`;
    }).join('');
  }
  html += foldBody('roster', `<div class="wbody">${rosterBody}</div>`);
  sidebarEl.innerHTML = html;
  refreshResLive();
}

function bondLabel(w) {
  let s = '';
  for (const n in (w.bonds || {})) { const l = bondLevel(w.bonds[n]); if (l > 0) s += `${n}${l}`; }
  return s;
}

// 名册异常标记：颜色 + 图标双编码（色盲也能看出“这个人出事了”）
// 没出事就不画：名册本来就窄，不能给每个人都挂一串徽章
function statusFlag(w) {
  if (w.hollow) return { ico: 'blight', color: '#c07bff', tip: '蚀化' };
  if (w.downed) return { ico: 'hp', color: '#ffcf8a', tip: `倒地 · 还能撑 ${Math.ceil(w.downT || 0)}s` };
  if (w.medicalState === 'treating') return { ico: 'hp', color: '#9fe8d5', tip: '医疗站治疗中' };
  if (w.medicalState === 'queued') return { ico: 'hp', color: '#9fe8d5', tip: '等待医疗位' };
  const san = w.sanity == null ? SANITY_MAX : w.sanity;
  if (san < 25) return { ico: 'sanity', color: '#c07bff', tip: '心志将崩' };
  if (w.morale < 25) return { ico: 'morale', color: '#ff8a6a', tip: '士气崩溃' };
  if ((w.overwork || 0) > 0) return { ico: 'hunger', color: '#d7b58a', tip: `透支 ${w.overwork} 层` };
  if (w.hunger < 20) return { ico: 'hunger', color: '#ffd76e', tip: '饥饿' };
  if (w.hp / w.maxHp < 0.35) return { ico: 'hp', color: '#ff9d9d', tip: '重伤' };
  return null;
}

// 侧栏三段折叠（材料 / 营地 / 拓荒队）：同一套机制 —— 点标题行开关，状态存在 localStorage
// （拓荒队原来就是这套，只是当时只有它一个，现在三段并列，所以统一成 fold.res/camp/roster）
const UI_KEY = 'deep-light-ui-v1';
const fold = { res: false, camp: false, roster: false };
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (saved.fold) Object.assign(fold, saved.fold);
  else if (saved.rosterCollapsed) fold.roster = true;      // 旧记录迁移
} catch (e) { /* 忽略损坏的记录 */ }
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ fold })); } catch (e) { /* 忽略 */ }
}
function toggleFold(which) {
  if (!(which in fold)) return;
  fold[which] = !fold[which];
  saveUi();
  state._sidebarSig = null;      // 强制重绘侧栏
  renderSidebar();
}
// 折叠标题行（右侧可插一段小字）+ 内容体
function foldHead(which, title, right = '') {
  return `<div class="sb-sec fold" data-fold="${which}"><span>${title}</span>${right}<span class="wchev">${fold[which] ? '▸' : '▾'}</span></div>`;
}
function foldBody(which, inner) {
  return `<div class="sb-body${fold[which] ? ' off' : ''}" data-body="${which}">${inner}</div>`;
}
function toggleRoster() { toggleFold('roster'); }
function statBar(v, color, liveKey) {
  const pct = Math.max(0, Math.min(100, v)) | 0;
  return `<span class="wbar"><i${liveKey ? ` data-live="${liveKey}"` : ''} style="width:${pct}%;background:${color}"></i></span>`;
}

boot();
window.__state = state;   // 调试：控制台可读取全局状态
window.__held = held;      // 调试：检测按键是否被引擎捕获
window.__resolve = () => resolveInteract(state, state.cursor);   // 调试：解析当前可交互对象（与游戏内一致：鼠标优先）
window.__hoverInfo = (tx, ty) => hoverInfoAt(state, tx, ty);   // 调试：某一格的悬停信息（含篝火/墓碑/夜辉草/潮穴/掉落物/拓荒者）
window.__equip = (k) => equipTool(state, k);                   // 调试：装备工具
window.__unequip = () => unequipTool(state);                   // 调试：收好工具
window.__fire = () => fireHand();                              // W14-A 第 5 步：手持开火（返回 'ok'/'cd'/'nowand'/'nofuel'/'no'）
window.__place = (type, tx, ty) => tryPlace(state, type, tx, ty); // 调试：程序化放置
window.__load = (tx, ty, mods, force) => {                          // 调试：给某格的塔装/拆载荷（默认按研究门槛；force=true 越过，供测试）
  const b = (state.buildings || []).find((x) => x.x === tx && x.y === ty);
  if (!b) return '这里没有建筑';
  const d = BUILD[b.type];
  if (!d || !d.dmg) return `${d ? d.name : b.type} 不是塔（只有塔有载荷槽）`;
  if (b.site) return '工地还没盖完';
  const slots = force ? MAX_SLOTS : slotsOf(state);
  if (slots <= 0) return '还没有载荷槽（先研究「载荷学」）';
  const list = mods == null ? [] : mods;
  const err = loadError(list, slots);
  if (err) return err;
  b.mods = list.slice();
  b._ps = null;                                                    // 载荷变了 → 丢弃缓存的组合数值
  return null;
};
window.__demolish = (tx, ty) => {                                  // 调试：程序化拆除
  const b = buildingAt(state, tx, ty);
  if (!b) return '这里没有建筑';
  return demolish(state, b);
};
window.__upgrade = (tx, ty) => {                                   // W14-A 第 6 步：程序化升级塔
  const b = buildingAt(state, tx, ty);
  if (!b) return '这里没有建筑';
  const err = upgradeBuilding(state, b);
  return err || { type: b.type, level: b.level, hp: Math.round(b.hp), mult: TOWER_LV[b.level - 1] };
};
window.__recruit = () => recruitWorker(state);                     // 调试：招募拓荒者
window.__sites = () => (state.buildings || []).filter((b) => b.site).map((b) => ({ type: b.type, x: b.x, y: b.y, work: Math.round(b.work || 0), need: workOf(b.type) }));   // 调试：工地列表
window.__finish = (tx, ty) => {                                    // 调试：直接把某格工地盖完
  const b = (state.buildings || []).find((x) => x.site && x.x === tx && x.y === ty);
  if (!b) return 'no-site';
  advanceBuild(state, b, 999);
  return true;
};
window.__refineCheck = () => (state.workers || []).map((w) => ({ name: w.name, job: w.job, need: (() => { try { return needRefine(state, w); } catch (e) { return 'ERR ' + e.message; } })(), fuel: state.res.fuel, ore: state.res.ore, furnaces: state.buildings.filter((b) => b.type === 'furnace').length }));   // 调试：炼油判定
window.__goto = (tx, ty) => {                                      // 调试：按瓦格下移动指令（走真实寻路）
  const p = findPath(state.map, Math.floor(state.player.x), Math.floor(state.player.y), tx, ty);
  if (!p) { state.dest = { x: tx, y: ty, ok: false, at: performance.now() }; return null; }
  state.player.setPath(p);
  state.dest = { x: tx, y: ty, ok: true, at: performance.now() };
  return p;
};
window.__step = (dt) => { update(dt); draw(ctx); };   // 调试：手动推进一帧（rAF 被节流时用于测试）
window.__steps = (n, dt = 1 / 60) => {                 // 调试：暂停状态下也能确定性推进 n 个模拟步
  for (let i = 0; i < n; i++) simStep(dt);
  draw(ctx);
  drawHud();
  return { t: state.t, day: state.day };
};
window.__pause = (v) => { state.paused = v === undefined ? !state.paused : !!v; };   // 调试/游戏：暂停
// —— W13-A 操作手感：调试句柄 ——
window.__keys = () => ({                              // 当前输入层状态（鼠标职责验证用）  l: pointer().l, r: pointer().r, m: pointer().m,
  alt: pointer().alt, shift: pointer().shift, ctrl: pointer().ctrl,
  inside: pointer().inside, sx: Math.round(pointer().sx), sy: Math.round(pointer().sy),
  tile: state.cursor ? { tx: state.cursor.tx, ty: state.cursor.ty } : null,
});
window.__hot = () => ({ cat: state.buildCat, slot: state.hotSlot, building: state.building, list: buildListOf(state) });   // 调试：快捷栏状态
window.__focus = () => panelFocusInfo();                              // 调试：面板焦点（回车会点哪一行）
window.__seen = () => seenStats(state);                               // 调试：已经说过的首次提示
window.__hint = (key) => {                                            // 调试：强制再看一条首次提示
  if (state.seen) delete state.seen[key];
  return { key, txt: HINTS[key] || null, shown: maybeHint(state, key, showFirstNote) };
};
window.__selectHot = (i) => selectHot(state, Number(i) | 0);        // 调试：选快捷栏第 i 格（0 基）
window.__cycleCat = (d) => { cycleCat(state, d == null ? 1 : d); return state.buildCat; };
window.__zoom = (d) => { zoomBy(state, d == null ? 1 : d); return settings.scale; };
window.__undo = () => doUndo(state);                                 // 调试：撤销放置
window.__undoInfo = () => state.undo ? { ...state.undo, age: Math.round(performance.now() - state.undo.at) } : null;window.__camPan = () => (state.camPan ? { x: +state.camPan.x.toFixed(2), y: +state.camPan.y.toFixed(2) } : null);
window.__path = (sx, sy, tx, ty) => findPath(state.map, sx, sy, tx, ty);   // 调试：寻路（验寻路正确性/预算）
window.__assets = () => assetStats();      // 调试：素材到货情况（哪些到了/哪些缺/哪些还等你交图）
window.__toast = () => (state.toast ? state.toast.txt : null);
window.__audio = () => audioStats();                                  // 调试：音频引擎状态
window.__sfxBank = () => sfxBankStats();                              // 调试：音效文件到货情况（哪些用了你的文件）
window.__ambientBeds = () => ambientStats();                          // 调试：环境音床状态（哪些床在响）
window.__sfx = (id, opts) => sfx(id, opts || {});                     // 调试：直接放一个音效
window.__overlap = () => overlapStats(state);                         // 调试：实体重叠统计（分离后应≈0）
window.__music = (id) => {                                            // 调试：音乐状态 / 手动一键切曲
  if (id) playStinger(id);
  return musicStatus();
};
window.__musicDir = () => musicDir();                                 // 调试：音乐目录（放文件的位置）
window.__musicTick = (dt = 0.1, n = 1) => {                           // 调试：手动推进音乐状态机（rAF 被节流时也能测）
  for (let i = 0; i < n; i++) updateMusic(state, dt);
  return musicStatus();
};
// —— W13-C 性能：体检仪 ——
window.__perf = (reset) => {                                          // 调试：分阶段耗时报告
  if (reset === true) { perfReset(); return 'perf 已清零'; }
  return perfReport();
};
window.__perfTable = () => { const r = perfReport(); return r; };// 压力测试：一次性堆出"最坏情况"，输出每步/每帧耗时与等效帧率
// —— W14-A 战斗观测台（只读，不改 state）——
window.__combat = () => combatTable(state);    // 全部战斗数值 + 当前生效乘子（调平衡前先看这张表）
window.__wave = () => waveReport(state);       // 当前波次状态（潮位/上限/间隔/出怪构成）
window.__dps = () => dpsReport(state);         // 理论每秒伤害 + 对每种敌人的有效伤害
window.__abilities = () => abilityReport(state);   // W14-A 第 3 步：四种行为的现场计数（蓄力/突进/引信/光环）
window.__survival = () => survivalReport(state);   // W15-B 第 0 步：生存资源、人员、死亡与节点基线（只读）
window.__expedition = () => expeditionReport(state); // W15-B 第 0 步：区块远征基线（只读）
window.__eco = () => ecologyReport(state);             // W15-C E0：生态/群系/前线观测（只读）
window.__crew = () => crewReport(state);                // W16-D N0：拓荒者身份/任务/风险/关系观测（只读）
window.__tasks = () => taskBoardStats(state);           // W16-D N1：任务板预约与调度观测（只读）
window.__visual = () => visualReport();                // W16-E V0：视觉规格/对比度观测（只读）
window.__chunk = () => ({ x: state.chunkX || 0, y: state.chunkY || 0, discovered: Object.keys(state.chunkStore || {}), active: state.layers && state.layers.surface === state.layers[state.layerId] });
window.__carry = () => ({ ...(state.carried
  ? { carrying: BUILD[state.carried.type].name, type: state.carried.type, x: state.carried.x, y: state.carried.y, hp: Math.round(state.carried.hp), layer: state.layerId }
  : { carrying: null }), packCap: packContainer(state).cap, progress: +(state.carryProgress || 0).toFixed(3) });   // W14-A 第 5 步 5b：背上的结构体
// W14-A 第 7 步：威胁预告 + 封灯撤退（调试口）
//   __forecast() → HUD 正在报的那几个数字（剩余秒数/剩余波数/本段/下一波）
//   __seal()     → 现在能不能封、封下去要付什么、长按进度
//   __seal('now')→ 跳过长按直接封（测试用；正常玩法只有 Y 长按这一条路）
window.__forecast = () => {
  const h = nightHud(state);
  return { theme: h.theme, seg: h.seg, tideLeft: h.tideLeft, left: h.left, nextWaveIn: h.secs,
           interval: +spawnInterval(state, segAtRel((state.t || 0) - TIDE_START), state.diff || { waveMul: 1 }).toFixed(3),
           inTide: h.inTide, day: state.day, t: +state.t.toFixed(1) };
};
window.__seal = (mode) => {
  const info = { err: sealError(state), hint: sealHint(state), stats: litLampStats(state),
                 hold: +(state.sealT || 0).toFixed(3), lastSealDay: state.lastSealDay | 0, day: state.day,
                 t: +state.t.toFixed(1), tideLeft: +Math.max(0, TIDE_END - state.t).toFixed(1) };
  if (mode === 'now') info.done = sealNow(state);
  return info;
};
window.__lab = () => labReport(state);         // W14-A 第 2 步：穷举全部载荷组合（修饰器 × 塔）的数值表
// —— W14-A 第 8 步：标准局回放台 ——
// 注入的全是**游戏自己的入口**（tryPlace / advanceBuild / interact.tick / skillQueued / sealNow），
// 所以曲线反映的是真机制；回放期间强制关掉自动存档（免得 7 天长跑写盘）。
window.__replay = (opts) => {
  window.__settings.autosave = false;
  const bAt = (tx, ty) => buildingAt(state, tx, ty);
  const freeTile = (tx, ty) => {
    const m = state.map;
    if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) return false;
    if (!m.isWalk(tx, ty)) return false;
    if (m.occBuild && m.occBuild[ty * m.w + tx]) return false;
    if (reservedTileError(state, tx, ty)) return false;
    return !bAt(tx, ty);
  };
  const ringSpot = (p, rMin, rMax) => {
    const px = Math.floor(p.x), py = Math.floor(p.y);
    for (let r = rMin; r <= rMax; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (freeTile(px + dx, py + dy)) return { tx: px + dx, ty: py + dy };
      }
    }
    return null;
  };
  const towerSpot = (S, lit, rMin, rMax) => {
    for (const l of lit) {
      for (let r = rMin; r <= rMax; r++) {
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          if (freeTile(l.x + dx, l.y + dy)) return { tx: l.x + dx, ty: l.y + dy };
        }
      }
    }
    return null;
  };
  return runReplay(opts, {
    state: () => state,
    newGame: (seed, diff) => newGame(seed, diff),
    step: (dt) => simStep(dt),
    place: (type, tx, ty) => tryPlace(state, type, tx, ty),
    finish: (tx, ty) => window.__finish(tx, ty),
    buildingAt: bAt,
    refuel: (b) => {                                   // 与 interact.js 的 refuel 分支逐字一致
      if (!b) return;
      const def = BUILD[b.type];
      const room = def && def.maxFuel ? def.maxFuel - (b.fuel || 0) : 1;
      if (room <= 0) return;
      withdrawOne(state, 'fuel', 1, b.x + 0.5, b.y + 0.5);
      b.fuel = (b.fuel || 0) + 1;
    },
    harvest: (b) => tick(state, { kind: 'harvest', b }),
    goto: (tx, ty) => window.__goto(tx, ty),                      // 真实寻路（与玩家点地图同一条路）
    sealError: () => sealError(state),
    addFire: (b, n) => addFire(state, b, n == null ? 1 : n),     // 熔炉点火的真实入口
    setRecipe: (b, id) => setRecipe(state, b, id),
    workOnce: (b) => workOnce(state, b),                          // 手做一次（与玩家按住 E 同一条路径）
    craftError: (b, id) => craftError(state, b, id),
    pulse: () => { state.skillQueued = 1; },
    seal: () => sealNow(state),
    ringSpot,
    towerSpot,
  });
};
window.__stress = (nEnemies = 60, seconds = 10, buildings = 40) => {
  const S = state;
  // 蚀潮（夜里）：环境光 = 0 才是光照/渲染的真正最坏情况，怪也真的会扑上来。
  // （以前这里写死 t=110 —— 那是**白天**，全图 ambient=1.0，光照开销恰好是最轻的，量出来的性能偏乐观）
  S.t = TIDE_START + 10;
  S.day = Math.max(1, S.day);
  window.__give('ore', 400); window.__give('vine', 400); window.__give('stone', 200);   // 先把材料堆满，建筑才铺得开
  const px = S.player.x, py = S.player.y;
  // 建筑：在玩家附近铺一圈灯（真的发光 → 光照与渲染都进入最坏情况）
  let placed = 0;
  for (let r = 3; r < 3 + buildings / 6 && placed < buildings; r++) {
    for (let k = 0; k < 6 && placed < buildings; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tx = Math.round(px + Math.cos(a) * r), ty = Math.round(py + Math.sin(a) * r);
      if (window.__place('lamp', tx, ty)) continue;
      window.__finish(tx, ty);
      const b = S.buildings.find((x) => x.x === tx && x.y === ty);
      if (b) { b.fuel = 30; placed += 1; }
    }
  }
  for (let i = 0; i < nEnemies; i++) {
    window.__spawn(i % 7 === 0 ? 'shell' : 'bud', px + 4 + (i % 12) * 0.9, py + 4 + ((i / 12) | 0) * 0.9);
  }
  perfReset();
  const steps = Math.round(seconds * 60);
  const view = { x: S.camera.x, y: S.camera.y };
  const light0 = S._lightRuns || 0;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) simStep(1 / 60);
  const stepMs = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < steps; i++) { S.camera.x = view.x; S.camera.y = view.y; draw(ctx); }
  const drawMs = performance.now() - t1;
  const perStep = stepMs / steps, perDraw = drawMs / steps;
  return {
    enemies: (S.enemies || []).filter((e) => e.alive).length,
    buildings: S.buildings.length,
    lightRuns: (S._lightRuns || 0) - light0,           // 这段里光照真的重算了几次
    msPerStep: +perStep.toFixed(3), msPerDraw: +perDraw.toFixed(3),
    fpsEquivalent: +(1000 / (perStep + perDraw)).toFixed(1),
    report: perfReport(seconds, steps),
  };
};
window.__bodies = () => ({
  player: { x: +state.player.x.toFixed(2), y: +state.player.y.toFixed(2) },
  workers: (state.workers || []).filter(w => w.layerId === state.layerId).map(w => ({ n: w.name, x: +w.x.toFixed(2), y: +w.y.toFixed(2), job: w.job })),
  enemies: (state.enemies || []).filter(e => e.alive).map(e => ({ k: e.ekind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), r: e.r })),
  collided: state._collided || 0,
});
// 用真实的 DOM 事件驱动画布（绕过 Playwright 键盘/鼠标不达时的排查）：仅供测试脚本用
// ⚠️ 点/右键的处理器读的是 pointer()（由 mousemove 维护），**不看事件自己的坐标**，
//    所以这两个口子必须先自己发一次 mousemove —— 否则传进来的 (sx,sy) 会被静默忽略，
//    实际作用在“上一次鼠标停留的那一格”（写测试脚本时极容易误判成“右键没反应”）。
window.__click = (sx, sy, mods = {}) => {
  window.__move(sx, sy);
  const r = canvas.getBoundingClientRect();
  const cx = r.left + (sx * r.width) / canvas.width, cy = r.top + (sy * r.height) / canvas.height;
  canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0, ...mods }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy, button: 0, ...mods }));
  canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy, button: 0, ...mods }));
  return { cx: Math.round(cx), cy: Math.round(cy) };
};
window.__rclick = (sx, sy) => {
  window.__move(sx, sy);
  const r = canvas.getBoundingClientRect();
  const cx = r.left + (sx * r.width) / canvas.width, cy = r.top + (sy * r.height) / canvas.height;
  canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2 }));
  return { cx: Math.round(cx), cy: Math.round(cy) };
};
window.__move = (sx, sy) => {
  const r = canvas.getBoundingClientRect();
  const cx = r.left + (sx * r.width) / canvas.width, cy = r.top + (sy * r.height) / canvas.height;
  canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
  return { cx: Math.round(cx), cy: Math.round(cy) };
};
// 真实鼠标测试用：格子 → **客户端坐标**（clientX/Y）。
// 为什么需要：上面几个口子发的是合成事件；要验真实输入路径就得让 Playwright 的
// mouse.move/down/up 打在正确像素上，而画布是缩放过的（内部 720×480 → CSS 尺寸）。
// 与逐帧摄像机同步（含中键拖屏偏移），所以要在每帧都取一次、不要提前缓存。
window.__screenOf = (tx, ty) => {
  const r = canvas.getBoundingClientRect();
  const ox = Math.round(state.camera.x * TILE - VIEW_W / 2);
  const oy = Math.round(state.camera.y * TILE - VIEW_H / 2);
  const sx = tx * TILE - ox + TILE / 2, sy = ty * TILE - oy + TILE / 2;
  const cx = r.left + (sx * r.width) / canvas.width, cy = r.top + (sy * r.height) / canvas.height;
  return { cx: Math.round(cx), cy: Math.round(cy), inside: sx >= 0 && sy >= 0 && sx < canvas.width && sy < canvas.height };
};

window.__quick = (v) => { state.quickPause = v === undefined ? !state.quickPause : !!v; syncPause(); return state.paused; };  // 调试：快速暂停
window.__lamp = () => cycleLampLevel();                            // 调试：调亮度档位
window.__blight = () => blightStats(state);                        // 调试：蚀痕统计
window.__blightDbg = () => blightDebug(state);                     // 调试：蚀痕内部状态
window.__store = () => ({
  stats: storageStats(state), layer: state.layerId,
  containers: allContainers(state, false).map((c) => ({ kind: c.kind, x: c.x, y: c.y, layer: c.layerId, used: usedOf(c), cap: c.cap, stock: Object.assign({}, c.ref.stock) })),
  pack: Object.assign({}, (state.pack && state.pack.stock) || {}),
});   // 调试：仓储详情
window.__give = (k, n) => deposit(state, k, n == null ? 1 : n, state.player.x, state.player.y);   // 调试：直接入库
window.__take = (k, n) => withdrawOne(state, k, n == null ? 1 : n, state.player.x, state.player.y);
window.__eat = (hot) => hot ? eatHotMeal(state) : eatBestMeal(state);  // 调试：进食（true = 强制热食）
window.__patrolHit = (tx, ty) => ({ sector: inPatrolSector(state, tx, ty), active: patrolActive(state) });   // 调试：巡逻驱散判定
window.__mind = () => (state.workers || []).map((w) => ({ name: w.name, traits: w.traits, sanity: Math.round(w.sanity == null ? 100 : w.sanity), hollow: !!w.hollow, grief: w.grief, bonds: w.bonds, job: w.job }));   // 调试：心志/专长/羁绊
window.__graves = () => (state.graves || []).map((g) => ({ ...g, r: graveStats(state).maxRadius }));   // 调试：墓碑
window.__outposts = () => outpostReport(state);                         // N6a：前哨意图/驻守观测
window.__revive = (name) => {
  const g = (state.graves || []).find((x) => !name || x.name === name);
  return g ? reviveAtGrave(state, g) : 'no-grave';
};
window.__soothe = (name) => { const w = (state.workers || []).find((x) => x.name === name && x.hollow); return w ? soothe(state, w) : 'no-hollow'; };   // 调试：安抚
window.__rescue = (name, mode = 'down') => {
  const w = (state.workers || []).find((x) => x.name === name) || (state.workers || [])[0];
  if (!w) return 'no-worker';
  if (mode === 'down') { w.hp = 0; updateWorkers(state, 0); return { name: w.name, downed: !!w.downed, downT: w.downT }; }
  if (mode === 'start') return startPlayerRescue(state, w);
  if (mode === 'cancel') { state.rescue = null; w.rescueBy = null; return 'ok'; }
  return { name: w.name, downed: !!w.downed, rescue: state.rescue ? state.rescue.actor : null };
};
window.__screens = { open: openScreen, close: closeScreens, back: backScreen, top: screenTop };  // 调试：界面
window.__newGame = (seed, diff) => { newGame(seed == null ? (Math.random() * 1e9) | 0 : seed, diff || 'normal'); closeScreens(); };  // 调试：直接开新局
window.__saveSlot = (slot) => saveGame(state, slot || 'auto');     // 调试：存档
window.__loadSlot = (slot) => { const d = loadGame(slot || 'auto'); if (d) loadFromData(d); closeScreens(); return !!d; };
// 调试：从**内存里的存档对象**重建世界（不碰 localStorage）。检测器的 save.roundtrip 用它真跑一遍读档路径 ——
// 【为什么需要】`__check()` 只跑到“检测项”，不会碰 loadFromData/restoreBuildings；
//   而这些函数一旦有未定义变量（如缺失的 m），普通游玩看不出来，**只有读档那一刻才崩**。
window.__reload = (data) => { loadFromData(data); closeScreens(); return true; };
window.__wipe = () => clearSave();                                 // 调试：清空所有存档
window.__settings = settings;                                      // 调试：读取设置
window.__ambient = () => ambientOf(state);             // 调试：读取当前环境光强度
window.__spawn = (kind, x, y) => {               // 调试：指定出怪（Boss 会登记为血条目标）
  const e = new Enemy(kind, x, y);
  if (e.def && e.def.boss) { e.tier = state.bossTier; state.bossRef = e; state.bossTier += 1; }
  state.enemies.push(e);
  return e;
};
window.__research = (id) => unlockTech(state, id);   // 调试：解锁研究
// —— W12-D 知识锁调试句柄 ——
window.__relics = () => ({ total: relicTotal(state), got: state.relics, tiles: Object.keys(state.relicTiles || {}).length });   // 调试：残页
window.__grantRelic = (sid, idx) => grantRelic(state, sid || 'handbook', idx == null ? 0 : idx);   // 调试：直接发残页
window.__series = (sid) => seriesGot(state, sid || 'handbook');
window.__knowledge = () => ({   // 调试：知识锁全景
  relics: relicTotal(state), observed: state.observed, body: state.body,
  soothed: (state.mind && state.mind.soothed) || 0,
  seen: Object.keys(state.research.unlocked).length,
});
window.__observe = (kind, n) => {                 // 调试：直接加观察计数
  if (kind === 'seep') state.observed = Object.assign({ seep: 0 }, state.observed, { seep: (state.observed.seep || 0) + (n || 1) });
  else { const e = state.codex[kind] || (state.codex[kind] = { kills: 0, unlocked: false }); e.kills += (n || 1); }
  return true;
};
window.__body = (kind, n) => {                    // 调试：直接加身体计数
  if (!state.body) state.body = {};
  state.body[kind] = (state.body[kind] || 0) + (n || 1);
  return state.body[kind];
};
window.__sect = (id) => sectOpen(state, id);      // 调试：分区是否揭开
window.__cost = (id) => costOf(state, id);        // 调试：实际成本（含软分支 ×3）
window.__knowSeen = (id) => knowSeenId(state, id);
window.__descend = () => {                            // 调试：使用离玩家最近的一口竖井（同真实玩法）
  const bs = state.buildings.filter((b) => b.type === 'shaft');
  if (!bs.length) return 'no-shaft';
  let best = bs[0], bd = Infinity;
  for (const b of bs) {
    const d = Math.hypot(b.x + 0.5 - state.player.x, b.y + 0.5 - state.player.y);
    if (d < bd) { bd = d; best = b; }
  }
  return useShaft(state, best);
};

