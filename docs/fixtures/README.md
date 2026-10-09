# L4 可移交来源

## 最终收口证据（2026-10-09，D345）

L4／W22-L必需门收口，详细版本影响与历史边界见`../L4_EXPEDITION.md` D345。当前95文件指纹cf354bf8；旧矩阵不改写为当前六轮复放，旧22份未知差额和缺失原inputLog保留。

| 文件 | 内容与核验范围 |
|---|---|
| l4-outpost-after-regression.json / .png | 新局完整生产存读9b410cf7相同、0差异；无告警绑定保持与旧告警幂等；5次86/86、95源码、1200步0类、72001/0/54/118；正式三键恢复 |
| l4-ui-results.json | 实际1280×720／1920×1080，两份12/12受控经历、非空摘要、11条可信输入、焦点／滚动／展开刷新保持；正式三键恢复 |
| l4-ui-1280.png / l4-ui-1920.png | 游戏实际尺寸下的经历与操作入口截图 |
| l4-ui-1280-summary.png / l4-ui-1920-summary.png | 补给与满经历同屏截图，内部滚动不要求全部内容平铺 |
| l4-ui-first-fixture-failure.json | 外部记录按钮使游戏失焦的原失败；改游戏内F8采集，未放松焦点门 |
| l4-pressure-results.json / l4-pressure-pass.png | 40灯／72敌起末保持，各241帧，峰值6.3／6.0ms；8次切区最高6.9ms；远端脉冲、全部预算失败、最终回归与存储恢复 |
| l4-d332-checkpoints.json | 原正常返营639ab452和受控救援恢复4f2d0bc0，完整snapshot哈希不变；原条目无独立inputLog，不补造 |
| l4-rescue-complete.png | 原D332受控救援完成画面，不是本轮新跑或自然遭遇 |
| l4-closeout-audit.json / .png | 从仓库独立核对上述及旧矩阵、83输入、事件账本，17项通过，正式三键未变；含D332原始检查点，不依赖本机开发键 |

重验入口：`/__l4_outpost_roundtrip_test.html`修复验收按钮；`/__l4_ui_test.html`使用浏览器viewport设两尺寸，实际操作后游戏内F8采集、最后恢复结束；`/__p1_perf_test.html?l4=1`自动压力与回归，收尾清空iframe；`/__l4_closeout_test.html`只读已交付文件，不启动游戏或写正式键。图像文件为原始浏览器截图，没有后处理。后文日期记录保留原交付时状态。

`l4-healthy-checkpoint.deflate.b64`是完整JSON的zlib/deflate压缩后Base64文本，不是生产存档键。浏览器使用原生`DecompressionStream('deflate')`解压，无外部依赖；`__l4_policy_test.html`直接读取此文件，不要求本机已有开发检查点。

- 格式：`l4-checkpoint-v1`，快照位于`entry.snapshot`。
- 来源：seed4242／normal，真实采集、建箱点灯、卸货、派驻及出口返程，详见`../L4_EXPEDITION.md`。
- 来源日时：第1天188.933333秒，玩家在原点东侧，A健康驻守(1,0)，B在营地；不是已站在营地篝火旁。
- 快照校验：对`JSON.stringify(entry.snapshot)`逐UTF-16代码单元计算FNV-1a32，得到`790a3093`。此为一致性校验，不是密码学防篡改。
- 2026-10-06导出：JSON原文13343字节、压缩3773字节、Base64 5032字符；浏览器解压原文逐字一致，本地独立解压及快照哈希核对通过。
- 原条目未记录源码指纹；后来核对的未改生产JS为95文件，内容指纹`a50829fe`，版本`0.8.0-alpha.1`。校准页载入前核对当前源码，不把补核的指纹伪装成原条目字段。
- **旧条目没有独立inputLog**。文件明确携带缺失说明，不能据快照补猜原输入；可信操作的既有文字证据不等于完整逐键日志。L4-A该日志缺口仍未关闭。

2026-10-06独立存读修复后生产指纹为`cb85d25`：仅恢复已完工建筑原本已保存的work字段，并扩展save.roundtrip的施工状态／进度检查；不改数值、模拟推进或快照格式。旧来源文件逐字不变，载入后的规范化完整状态指纹为`5479c839`（旧恢复代码曾清零完工work，故不是先前的`4cc0c84f`）。三策略短跑均从新指纹开始，各两次6000步，六次生产存读完整字段一致；正式三日矩阵另记。

三条策略使用同一完整来源的深副本；受控救援的告警变更不包含在本文件中。测试期间关闭autosave、备份恢复正式三键。压缩不删除人物、敌人、库存、告警或研究默认字段。

随后当前区块nightops恢复跳过缺陷独立修复，指纹为`4b01428d`；只补已保存的夜辉草／潮穴状态恢复及roundtrip对账。来源文件与规范化起点不改。长矩阵报告区分两个独立存读修复、策略夹具错误与自然死亡后果，具体结果见L4_EXPEDITION／D333。

## 完整六轮结果（2026-10-08，D335）

`l4-matrix-results.deflate.b64`已经从现存六轮报告无损导出，**不是再次运行矩阵生成的另一批结果**。文件13422字节（包含换行）；去空白Base64为13316字符、deflate数据9987字节、解压JSON90684字节。物理文件SHA256：`4C6CB7C1C29307EB9D1527F0AD4D973867AF342DE8372ADEB5A4AB5EFA402548`；换行变更会改变物理SHA，但不改变报告内容校验。

格式为`l4-matrix-results-v1`。`dictionary`保存重复的完整JSON子串，`parts`中的字符串直接拼接、非负整数引用dictionary对应项；重建原报告JSON文本200157个UTF-16代码单元，FNV-1a32为`701ba65c`。这是文本级无损去重，不删快照字段、不排序数组、不过滤命令或失败来源。读取函数为`tools/l4_matrix_artifact.mjs`中的`reportTextOf()`；旧的`reportText`直接存储格式也可读取。`audit`只是附带摘要，读回时重新核对原报告，不信任摘要绿灯。

报告保留六轮完整起终点、42／8／22条各策略操作（每个复放同数）、每轮3条跨日记录、RNG计数、死亡跳时、人物经历、菜单／终点检查与生产存读结果。共同来源790a3093、规范化起点5479c839、生产代码4b01428d；三个策略终点分别6be3c1c0／8d902dde／7588525a。它不补齐旧来源缺失的inputLog，也不自动证明全链账本或性能门。

无依赖本地核对：

```powershell
node tools/l4_matrix_artifact.mjs docs/fixtures/l4-matrix-results.deflate.b64
node tools/l4_matrix_artifact.mjs --selftest docs/fixtures/l4-matrix-results.deflate.b64
```

第一条应报告6轮、same三项true、fails空、reportHash701ba65c；第二条为19项工具检查，含9项针对实际报告副本的变异拒绝，**不是游戏浏览器验收**。浏览器打开`/__l4_matrix_test.html`，点击“读回并校验结果文件”，无需旧开发storage即可校验该项目文件。本轮已实际读回通过。`.mjs`须以JavaScript MIME提供，项目serve.py已登记。

## 独立83输入补录及账本（2026-10-08，D339）

`l4-independent-input.deflate.b64`是完整补录报告，不是旧790a3093的输入历史。解压JSON265028字节、deflate10418字节、Base64 13892字符；报告FNV为dcbacf56，起终快照dce097d2／f66f4ac5，历史生产指纹4b01428d。原两项存读失败保留，文件完整性通过不等于原存读通过。

右侧浏览器`/__l4_artifact_test.html`从文件独立读回并核对，三个正式键未变化。完整浏览器读回与账本推导在`l4-input-readback-ledger.json`。16次零时间点击转移双方相抵；建箱／灯成本ore4/vine4，建灯默认槽30单列，实际补灯在输入77：箱fuel-1／槽28→29。装备也入账：库存pick1→0，但人物持有1→2，总数仍2。藤木产物12与节点净减12相抵。辉髓需解释产物157与节点净减135的差额22；不据矿工随机补矿规则推测已闭合。原报告没记录制作／进食／救援事件，不能从本链冒称覆盖。

```powershell
node tools/l4_input_artifact.mjs
node tools/l4_input_artifact.mjs --selftest
node tools/l4_ledger_audit.mjs
```

工具10项检查包含8种实际报告变异拒绝，不是浏览器游戏回归。账本工具始终报告complete=false及未解释项，不用总数掩盖缺证据。

## 缓存矿点超采修复（D340）

`l4-stale-mine-before.json`／`l4-stale-mine-after.json`是同一受控诊断：移除NPC、将玩家放到真实5份矿点，真实E后推进120步；修复前产20、修复后产5。没有注入资源，位置／NPC调整显式记录，不冒称自然路线。`__l4_mining_test.html`可重做该场景。

`l4-stale-mine-regression.json`为修复后45e27812版本完整浏览器报告：六态86/86、源码95/95、1200步0类，标准回放72001/0/54/118不变，三正式键恢复。原补录终态两字段重建语义复核通过；当前生产存读21a434e5→21a434e5，差异0。这是受控复核而非新输入链，也不是原a28554f字节恢复。原六轮与原输入仍保留历史指纹，不能冒称已在新版本整轮复验。

## 事件账本与存读诊断（D342）

D343：`node tools/l4_outpost_bind_check.mjs`独立模块边界13项通过；不访问浏览器、DOM或storage，不是存读／回放／压力验收。修复后指纹cf354bf8，浏览器验收因额度审批尚未执行；旧l4-outpost-before.json等保留为修复前证据，不改成after。测试页新增“修复验收与四态回归”按钮待原右侧审批恢复后执行。

| 文件 | 内容校验／范围 |
|---|---|
| l4-ledger-short.deflate.b64 | 21354afa；观测开关短校准，6000步／216事件，无缺口 |
| l4-ledger-full.deflate.b64 | 81ba6178；一条三日补给链及观测关对照，63792步／432事件／RNG1006、终点6be3c1c0，不是全部六轮逐事件日志 |
| l4-ledger-readback.json | 浏览器仓库文件独立读回／连续性／规则／快照核对；未知0、正式三键未变 |
| l4-ledger-categories.deflate.b64 | c3f20557；受控守灯／建灯两轮，46事件、初始槽30、岗位扣1、终点f82eb47 |
| l4-ledger-categories-readback.json | 本次浏览器类别文件独立核验，未知0、正式三键未变 |
| l4-outpost-before.json | 新局生产存读null→默认前哨差异及独立绑定复现；旧格式告警只兑现一次，未修复 |
| l4-outpost-diagnostic-interrupted.json | 第一次夹具JSON复制undefined中断，三键恢复 |
| l4-outpost-diagnostic-fixture-failures.json | 第二次夹具快速暂停／缺失告警文字两断言失败；保留，不是当前通过结果 |

浏览器`/__l4_artifact_test.html`两个事件账本按钮直接fetch仓库文件、不启动游戏。`/__l4_outpost_roundtrip_test.html`创建隔离新局、执行生产存读与绑定诊断，收尾恢复三正式键。完整范围和账户公式见L4_EXPEDITION D342；旧22份差额仍未知。

无依赖静态工具：`node tools/l4_event_ledger_check.mjs`（7项）、`node tools/l4_ledger_rules.mjs --selftest`（7项）、`node tools/l4_ledger_categories_check.mjs --selftest`（8项）；不带selftest的后两条输出完整规则审计。这些工具不是浏览器四态回归、压力或真键鼠证明。
