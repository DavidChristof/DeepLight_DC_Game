# assets/sprites/ —— 图片素材放这里

**把 PNG 丢进这个目录，刷新页面就生效**，不用改代码。

要交哪些图、每张的尺寸与豆包提示词 → 见 [`../PROMPTS.md`](../PROMPTS.md)（13 张：主菜单插画 ×1、蚀兽图鉴 ×6、拓荒者半身像 ×6）。

## 命名（必须完全一致）

```
title_art.png                 960×540   主菜单背景插画
codex_bud.png                  96×96    图鉴·蚀芽
codex_shell.png                96×96    图鉴·蚀壳
codex_moth.png                 96×96    图鉴·噬光虫
codex_owl.png                  96×96    图鉴·夜枭
codex_blind.png                96×96    图鉴·盲蚀兽
codex_core.png                 96×96    图鉴·蚀巢核心（Boss）
colonist_miner.png            128×128   拓荒者半身像·矿工
colonist_farmer.png           128×128   拓荒者半身像·农人
colonist_nightwatch.png       128×128   拓荒者半身像·守夜人
colonist_tinker.png           128×128   拓荒者半身像·技师
colonist_scholar.png          128×128   拓荒者半身像·学者
colonist_fallback.png         128×128   通用拓荒者
```

## 自检

1. 刷新页面（`Ctrl+F5`，图片有缓存）
2. 控制台执行 `__assets()`
   - `ok` = 已经用上的张数
   - `missing` = 声明了但没找到的文件（**不影响游戏**，只是那块继续用程序绘制）
3. 看效果：主菜单背景 / 图鉴面板（`C`，击杀达标的才显示）/ 侧栏名册悬停

> 一张都不放也能正常玩：缺图的地方自动回退，**不会出现破图**。
