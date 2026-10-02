// core/assets.js —— 素材接入（W13-F）
//
// 设计原则（与 assets/README.md 一致）：
//   · 世界层默认程序化绘制；V8 材质可以作为不带光照的静态 albedo 接入
//     （光照仍由独立遮罩叠加，素材本身不得带辉光/阴影）
//   · AI 图只用在**信息/叙事层**：主菜单插画、图鉴立绘、拓荒者半身像
//   · 缺文件不报错、不影响任何逻辑 —— 没有图就自动用程序绘制/SVG 图标顶上
//
// 用法：
//   await loadAssets()          // boot 里 fire-and-forget，不阻塞开局
//   sprite('codex_bud')         // → HTMLImageElement | null（null = 还没到/没有）
//   hasAsset('title_art')       // → boolean（拼 HTML 前先问一句，避免破图）
//   assetStats()                // 调试：__assets()
//
// 图片一律用最近邻放大（调用方设 imageSmoothingEnabled = false）。

export const REG = new Map();          // key → { key, kind, src, pxW, pxH, sheet, img, ok, err, pending }
let loadedOnce = false;
let loadPromise = null;
let version = 0;                        // 每张图到货 +1：UI 可以靠它决定要不要重绘
const listeners = [];

export function onAssetsChanged(fn) { listeners.push(fn); }
function bump() { version++; for (const fn of listeners) { try { fn(); } catch (e) { /* 不让 UI 回调炸掉加载 */ } } }
export function assetVersion() { return version; }

// 注册表（data/sprites.js 调用；也可以直接喂 manifest）
export function register(spec) {
  if (!spec || !spec.key) return null;
  const e = { ok: false, img: null, err: null, ...spec };
  REG.set(spec.key, e);
  return e;
}

export function sprite(key) {
  const e = REG.get(key);
  // 带 renderW/renderH 的素材会在加载阶段生成最近邻缓存；运行时只拿缓存，
  // 原始母版仍保留在 e.img，方便尺寸审计与后续切换显示倍率。
  return e && e.ok ? (e.renderImg || e.img) : null;
}
export function hasAsset(key) { const e = REG.get(key); return !!(e && e.ok); }
export function specOf(key) { return REG.get(key) || null; }

function loadOne(e) {
  return new Promise((resolve) => {
    if (!e || !e.src) return resolve(null);
    const img = new Image();
    img.onload = () => {
      e.img = img;
      e.ok = true;
      prepareRenderCache(e);
      bump();
      resolve(img);
    };
    img.onerror = () => { e.ok = false; e.err = 'missing'; resolve(null); };   // 没有这张图是**正常状态**
    img.src = e.src;
  });
}

// 可选的运行时尺寸：源图保持原始像素，启动时一次性用最近邻生成显示缓存。
// 这样游戏帧内不做缩放；缓存失败时仍保留原图，由渲染器走直接回退路径。
function prepareRenderCache(e) {
  const frames = Array.isArray(e.frames) && e.frames.length ? e.frames.length : 1;
  const fw = Number(e.frameW || e.pxW || 0), fh = Number(e.frameH || e.pxH || 0);
  const rw = Number(e.renderW || 0), rh = Number(e.renderH || 0);
  if (!e || !e.img || !rw || !rh || !fw || !fh || (rw === fw && rh === fh)) return;
  if (typeof document === 'undefined' || !document.createElement) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = rw * frames;
    canvas.height = rh;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.imageSmoothingEnabled = false;
    const sourceMap = Array.isArray(e.sourceFrameMap) ? e.sourceFrameMap : null;
    const mirrors = Array.isArray(e.mirrorFrames) ? e.mirrorFrames : null;
    const crop = e.sourceCrop && Number.isFinite(e.sourceCrop.x) && Number.isFinite(e.sourceCrop.y)
      && Number.isFinite(e.sourceCrop.w) && Number.isFinite(e.sourceCrop.h) ? e.sourceCrop : null;
    const midW = rw * 2, midH = rh * 2;
    const mid = document.createElement('canvas');
    mid.width = midW * frames;
    mid.height = midH;
    const mc = mid.getContext('2d');
    if (!mc) return;
    mc.imageSmoothingEnabled = true;
    mc.imageSmoothingQuality = 'high';
    for (let i = 0; i < frames; i++) {
      const sourceIndex = Number.isInteger(sourceMap && sourceMap[i]) ? sourceMap[i] : i;
      const sx = sourceIndex * fw + (crop ? crop.x : 0);
      const sy = crop ? crop.y : 0;
      const sw = crop ? crop.w : fw;
      const sh = crop ? crop.h : fh;
      if (mirrors && mirrors[i]) {
        mc.save();
        mc.translate((i + 1) * midW, 0);
        mc.scale(-1, 1);
        mc.drawImage(e.img, sx, sy, sw, sh, 0, 0, midW, midH);
        mc.restore();
      } else {
        mc.drawImage(e.img, sx, sy, sw, sh, i * midW, 0, midW, midH);
      }
    }
    // 第二阶段固定用最近邻：最终缓存仍是清晰的像素块，不把浏览器的平滑结果带进游戏帧。
    c.imageSmoothingEnabled = false;
    for (let i = 0; i < frames; i++) c.drawImage(mid, i * midW, 0, midW, midH, i * rw, 0, rw, rh);
    e.renderImg = canvas;
    e.runtimeFrameW = rw;
    e.runtimeFrameH = rh;
  } catch (err) {
    e.renderImg = null;
    e.runtimeFrameW = 0;
    e.runtimeFrameH = 0;
    e.renderErr = err && err.message ? err.message : 'cache-failed';
  }
}

// 从 assets/manifest.json 读取声明（可选：manifest 不存在也能跑）
export async function loadAssets(manifestUrl = 'assets/manifest.json') {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error('no manifest');
      const data = await res.json();
      for (const s of (data && data.sprites) || []) register(s);
      // manifest 不给 src 的（或 data/sprites.js 里已经登记过但还没 src）跳过
      await Promise.all([...REG.values()].filter((e) => e.src).map(loadOne));
    } catch (e) {
      // 没有 manifest：不是错误，世界层本来就程序化绘制
      if (typeof console !== 'undefined') console.info('[assets] 未加载 manifest（正常：世界层程序化绘制）', e && e.message);
    }
    loadedOnce = true;
    return REG;
  })();
  return loadPromise;
}

export function assetsLoaded() { return loadedOnce; }

// 调试用：哪些到了、哪些没到、哪些没配
export function assetStats() {
  const rows = [...REG.values()].map((e) => {
    const width = e.img && Number.isFinite(e.img.naturalWidth) ? e.img.naturalWidth : 0;
    const height = e.img && Number.isFinite(e.img.naturalHeight) ? e.img.naturalHeight : 0;
    const expectedW = e.frameW || e.pxW || 0;
    const expectedH = e.frameH || e.pxH || 0;
    const frameCount = Array.isArray(e.frames) && e.frames.length ? e.frames.length : 1;
    const sourceFrameCount = Number.isInteger(e.sourceFrameCount) ? e.sourceFrameCount : frameCount;
    const minWidth = e.kind === 'spritesheet' ? expectedW * sourceFrameCount : expectedW;
    const v8Single = String(e.key || '').startsWith('v8_') && e.kind !== 'spritesheet' && frameCount === 1;
    const dimensionOk = !e.ok || !width || !height
      || (v8Single ? (width === expectedW && height === expectedH) : (width >= minWidth && height >= expectedH));
    // drawMode 描述当前实际可走的路径；尚未到货时先算 fallback，避免观测台把预期路径误报成已加载路径。
    const drawMode = !e.ok ? 'fallback' : (e.renderImg ? 'nearest-cache' : (e.kind === 'spritesheet' ? 'crop' : (dimensionOk ? 'direct' : 'fallback')));
    return {
      key: e.key, src: e.src || null, kind: e.kind || null, layer: e.layer || null, ok: !!e.ok, err: e.err, pending: !!e.pending,
      width, height, expectedW: minWidth, expectedH, dimensionOk, drawMode,
      runtimeScaled: !!e.renderImg, runtimeFrameW: e.runtimeFrameW || null, runtimeFrameH: e.runtimeFrameH || null,
      dimensionError: dimensionOk ? null : (v8Single
        ? `实际 ${width}×${height}，单帧必须精确为 ${expectedW}×${expectedH}`
        : `实际 ${width}×${height}，至少需要 ${minWidth}×${expectedH}`),
    };
  });
  return {
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    missing: rows.filter((r) => r.src && !r.ok).map((r) => r.key),
    // 还没配置 src 的 = 等着你交图的（提示词见 assets/PROMPTS.md）
    unconfigured: rows.filter((r) => !r.src).map((r) => r.key),
    pending: rows.filter((r) => r.pending).map((r) => r.key),
    dimensionErrors: rows.filter((r) => !r.dimensionOk).map((r) => ({ key: r.key, error: r.dimensionError })),
    version,
    rows,
  };
}
