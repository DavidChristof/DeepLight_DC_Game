# 音效（`assets/sfx/`）

**完整清单、每条多长、什么风格、什么时候响 → 看 [`../SOUND.md`](../SOUND.md) 的第二节。**

快速上手（三步）：

1. 把你的音效文件放进这个目录（子目录也行，比如 `sfx/ui/click.wav` → 写 `"click": "ui/click.wav"`）
2. 在 `manifest.json` 里登记：

```json
{
  "sounds": {
    "click": "click_v2.wav",
    "mine": "mine_hit.wav",
    "shoot": "tower_shot_a.wav"
  }
}
```

3. 刷新页面 —— 登记过的就用你的文件，**没登记的继续用合成音**（可以一条一条换，不用一次交齐）

- 格式：`.wav` / `.mp3` / `.ogg` / `.m4a` / `.flac`（浏览器能解码的都行；44.1kHz 单声道足够）
- 名字随便起，manifest 指到就行；同名 id 放新文件 = 直接替换
- 音量配平**不用你改**：播放时沿用 `js/data/sfx.js` 里那条音效的 `vol`（音量档）与 `dedupe`（合并窗口），
  所以你只管把音色做好听，不用去猜"这条该多大声"
- 一条音效的**最大时长没有硬限制**，但高频音（`click` / `shoot` / `mine` / `build` / `kill`）请务必短
- 自检：控制台 `__sfxBank()` 看哪些换成了文件；`__sfx('mine')` 试听
