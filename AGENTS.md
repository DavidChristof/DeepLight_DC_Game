# AGENTS.md · 《蚀渊拓荒者 Deep-Light》

> 编码代理自动加载的**短入口**。动手改代码前读 [`docs/STATUS.md`](docs/STATUS.md) 和 [`HANDOFF.md`](HANDOFF.md) §0–3、§5–8；§4 的逐日历史按需查。当前阶段细节见 [`docs/ENDGAME.md`](docs/ENDGAME.md)。本文件只保留可执行的硬约束；与 `HANDOFF.md` 冲突时以其为准。

## 这是什么项目

2D 顶视角「永夜殖民经营 + 蚀潮防守」原型。**原生 JS ES Modules，Canvas 2D，零构建、零依赖、零 npm、零测试框架。**
基础循环可玩；现行阶段、数字和后续顺序只维护在 `docs/STATUS.md`。

## 跑起来（Windows PowerShell）

```powershell
cd d:\26Program\DC_Game
Start-Process py -ArgumentList "-3.12","serve.py","8000" -WindowStyle Hidden -PassThru
# 浏览器打开 http://localhost:8000
```

⚠️ **绝不要用 `python serve.py`** —— 本机 PATH 上的 `python` 是 LilyPond 的嵌入式解释器（没有 `_socket`），服务器起不来。必须 `py -3.12`。
ES Modules 不能走 `file://`，必须用这个服务器（它禁用了缓存）。

## 改完必须验证（四条，一条都不能省）

在浏览器 DevTools 控制台里跑：

```js
__check()                   // 期望 {ok:true, ran:80, fails:[]}
__check({roundtrip:true})   // 额外验证「存档→读档」往返
__srcCheck()                // 异步源码审计，期望 {ok:true, files:91, fails:[]}
```

并且 **`__check()` 必须在四种局面各跑一次**：主菜单 / 新开一局 / 读档往返后 / `__replay()` 跑过几天后。
原因：主菜单下场上没有灯柱、储物箱、蚀痕数组，**有些断言根本没被执行 → 空跑报绿**（这个坑已复发 3 次）。

长跑体检：`__watch(true, 20)` → 玩一局 → `__testLog()`（期望 0 类违例）。
平衡改动：`__replay({ seed: 4242, diff: 'normal', days: 3, policy: 'home' })` → 和 `HANDOFF.md` §4.3 的表对账。

> **浏览器控制失效时**：先确认服务与右侧浏览器连接；记录一次错误并继续独立的静态审计/实现，动态项保持“未验收”。不要自动切换到桌面 Edge，也不要要求作者代跑。可用隔离的临时浏览器驱动时仍须保护存档；不得把 `node_modules` / `package.json` 提交进仓库。Node 自检与源码静态审计不能冒充浏览器 `__check`、真输入或长跑通过。

## 硬约束（不要做的事）

1. **不引入任何依赖**：不加 npm / node_modules / 打包器 / 框架 / TypeScript / 测试框架。保持"双击就能跑"。
2. **不做**经验值 / 等级 / 装备词条池 / 无限刷怪与资源通胀（设计铁律）。
3. **不破坏三个核心**：光照 = 生命线 · 账本守恒（资源只走 `deposit`/`withdraw`）· 帧预算 16.6ms。
4. **数值只在 `js/data/` 里**：`systems/` 里不许写魔数（B13 的教训：表与实现分家必然出事）。
5. **改玩家可见的文字前**先读 `docs/COPY.md`（三原则 + 禁用清单 + 术语表）。
6. **破坏性操作先说再做**（删档 / 改存档格式 / 改数值表）。

## 高发 bug 家族（改代码时对着看）

- **返回 `null` = 成功**、返回错误字符串 = 失败（`tryPlace` / `withdrawOne` / `sealError` / `__place`）→ `if (!fn())` 是判断反了
- 跨模块隐式依赖：用了别的模块的导出却忘 `import`（`__srcCheck()` 专治）
- 多系统抢输入：交互优先级在 `js/systems/interact.js`，改完要真键鼠 E2E
- 派生数据不同步：缓存没失效 → 面板数字停住
- **新机制必须同时加断言**，否则下一轮必漏

## 游戏内自动化测试的存档纪律

用浏览器自动化测试时：`settings.autosave` **全程 `false`**；**每次 `page.reload()` 后第一条脚本里就要重新关掉**（reload 会从 localStorage 读回 `true`，这条漏过 3 次，其中一次真的污染了玩家存档）。storage 键：`deep-light-saves-v2` / `deep-light-settings-v1` / `deep-light-ui-v1`。

## 协作方式

作者用中文、指令极短（常常就一句「下一步。」）、期待你**自主执行**，但要求：

- **一步一验**：实现 → 真浏览器/真键鼠验证 → 同步文档 → 报告；禁止同一批里混新功能 + 修 bug
- **给数字，不给感觉**："感觉好多了"不算完成
- **诚实**：自己的失误也要登记进 `docs/BUG_HUNT.md`（项目里有 D1–D56 一整列"检测器自己犯的错"，那是刻意的）
- 报告格式：**做了什么 / 判据与数字 / 我自己的错误 / 必须告知你的事 / 下一步**

## 每完成一步，同步更新文档

①对应计划文件的阶段与证据 ②`docs/BUG_HUNT.md` 台账 ③`docs/STATUS.md` 当前状态 ④`HANDOFF.md` 的稳定约束/代码地图（发生变化时）⑤`README.md`（玩家可见内容变化时）。文档与代码冲突时以代码为准，并修正文档。

## 下一步该做什么

当前执行项及后续顺序见 [`docs/STATUS.md`](docs/STATUS.md)；本阶段的详细判据见 [`docs/ENDGAME.md`](docs/ENDGAME.md)。历史证据留在 `docs/BUG_HUNT.md`，不要把早期台账句复制回入口。
