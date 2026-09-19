// core/assets.js —— 素材接入（W13-F）
//
// 设计原则（与 assets/README.md 一致）：
//   · **世界层继续程序化绘制**（光照是活的，静态贴图会破坏"光决定可见性"）
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

export const REG = new Map();          // key → { key, kind, src, pxW, pxH, sheet, img, ok, err }
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
  return e && e.ok ? e.img : null;
}
export function hasAsset(key) { const e = REG.get(key); return !!(e && e.ok); }
export function specOf(key) { return REG.get(key) || null; }

function loadOne(e) {
  return new Promise((resolve) => {
    if (!e || !e.src) return resolve(null);
    const img = new Image();
    img.onload = () => { e.img = img; e.ok = true; bump(); resolve(img); };
    img.onerror = () => { e.ok = false; e.err = 'missing'; resolve(null); };   // 没有这张图是**正常状态**
    img.src = e.src;
  });
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
  const rows = [...REG.values()].map((e) => ({ key: e.key, src: e.src || null, ok: !!e.ok, err: e.err }));
  return {
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    missing: rows.filter((r) => r.src && !r.ok).map((r) => r.key),
    // 还没配置 src 的 = 等着你交图的（提示词见 assets/PROMPTS.md）
    unconfigured: rows.filter((r) => !r.src).map((r) => r.key),
    version,
    rows,
  };
}
