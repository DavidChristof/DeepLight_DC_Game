# 蚀渊拓荒者 Deep-Light

当前版本：**v0.8.0-alpha.1「余辉共鸣」** · 完整流程开发原型。版本范围与已知限制见 [`CHANGELOG.md`](CHANGELOG.md)。

2D 顶视角永夜殖民经营与蚀潮防守游戏原型。拓荒队依靠有限的辉髓维持灯火，在地表建造和远征，并逐层探索深渊。

**光 = 燃料 = 生命 = 安全区。** 点亮据点可以生产、驻守，也会使黑暗注意到你。

## 运行

项目使用原生 JavaScript ES Modules 与 Canvas 2D，无构建步骤和 npm 依赖。在项目根目录运行：

```powershell
py -3.12 serve.py 8000
```

然后打开 <http://localhost:8000>。ES Modules 不能直接通过 `file://` 启动。本机的 `python` 命令指向 LilyPond 嵌入式解释器，请使用 `py -3.12`。

## 开发状态

基础循环目前可玩到采集建造、蚀潮防守、深层探索、Boss 与第七天大潮。战斗、生存、生态、拓荒者、首局引导、前哨和视觉样板均有首轮实现。余辉共鸣 W20-R 的三站结局、存档记录与 R6 全局回归已完成。

**当前阶段、下一步和未验收项只查 [`docs/STATUS.md`](docs/STATUS.md)。** 详细终局阶段门见 [`docs/ENDGAME.md`](docs/ENDGAME.md)。

浏览器控制台的开发自检：

```js
__check()                   // 当前预期 80 项，0 失败；四种局面都要跑
__check({roundtrip:true})   // 存档往返
__srcCheck()                // 当前预期 91 个源码文件，0 失败
```

完整验证步骤与存档保护规则见 [`HANDOFF.md`](HANDOFF.md) §3；静态审计通过不能代替尚未执行的浏览器验收。

## 文档导航

地表采空的资源和新开凿的岩壁会随存档保存。旧档未记录的岩壁开凿无法补回。

| 想了解 | 先看 |
|---|---|
| 当前进度与下一步 | [`docs/STATUS.md`](docs/STATUS.md) |
| 版本记录与交付边界 | [`CHANGELOG.md`](CHANGELOG.md)、[`VERSION`](VERSION) |
| 接手、代码地图、验证纪律 | [`HANDOFF.md`](HANDOFF.md)；编码代理另读 [`AGENTS.md`](AGENTS.md) |
| 玩法和操作 | [`GUIDE.md`](GUIDE.md) |
| 设计原则与远期构想 | [`DESIGN_V2.md`](DESIGN_V2.md) |
| 当前终局计划和阶段门 | [`docs/ENDGAME.md`](docs/ENDGAME.md) |
| Bug、测试数据与失误记录 | [`docs/BUG_HUNT.md`](docs/BUG_HUNT.md) |
| 各专题计划与历史 | [`docs/COMBAT.md`](docs/COMBAT.md)、[`docs/SURVIVAL.md`](docs/SURVIVAL.md)、[`docs/ECOLOGY.md`](docs/ECOLOGY.md)、[`docs/COLONISTS.md`](docs/COLONISTS.md)、[`docs/FIRST_SLICE.md`](docs/FIRST_SLICE.md)、[`docs/EXPEDITION_OUTPOST.md`](docs/EXPEDITION_OUTPOST.md)、[`docs/UI.md`](docs/UI.md)、[`docs/VISUAL_UI.md`](docs/VISUAL_UI.md)、[`docs/ART_REBUILD.md`](docs/ART_REBUILD.md) |
| 玩家可见文案和素材管线 | [`docs/COPY.md`](docs/COPY.md)、[`assets/PROMPTS.md`](assets/PROMPTS.md)、[`assets/SOUND.md`](assets/SOUND.md) |

历史工程计划 [`OPTIMIZE_PLAN.md`](OPTIMIZE_PLAN.md) 与载荷子计划 [`docs/PAYLOAD.md`](docs/PAYLOAD.md) 保留供查证，不作为当前任务表。
