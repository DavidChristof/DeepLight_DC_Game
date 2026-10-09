// W21-P P3：恢复信息的显示预算，不参与模拟。
export const RECOVERY = Object.freeze({
  refreshMs: 500,
  hudLimit: 3,
  // 与现行worker自主进食分支的士气门槛一致；只用于显示阻碍。
  eatMoraleMin: 25,
  priority: Object.freeze({ rescue: 0, injury: 1, hunger: 2, light: 3, repair: 4 }),
});
