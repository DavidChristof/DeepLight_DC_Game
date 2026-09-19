// firstSlice.js —— W17-F1/F2/F3：首局软引导、第一潮与一次远征收口。
//
// 这里只记录玩家已经做过的事，并把一句短提示交给 main.js 的现有提示横幅。
// 不锁输入、不发资源、不改波次；光压只在既有锁夜结果上做观测记录；远征只观察真实区块往返；回放状态由 firstSlice.active=false 隔离。
import { FIRST_SLICE } from '../data/firstSlice.js';
import { BUILD } from '../data/buildings.js';
import { isDawn, isTide, DUSK_START } from '../core/time.js';

function addHistory(slice, phase, day, t) {
  const last = slice.history[slice.history.length - 1];
  if (last && last.phase === phase) return;
  slice.history.push({ phase, day: Math.max(1, day | 0), t: Math.max(0, Number(t) || 0) });
  if (slice.history.length > FIRST_SLICE.MAX_HISTORY) slice.history.splice(0, slice.history.length - FIRST_SLICE.MAX_HISTORY);
}

function queueGuide(state, text) {
  if (text) state._sliceGuide = text;
}

function litLampCount(state) {
  let n = 0;
  for (const b of state.buildings || []) {
    const d = BUILD[b.type];
    if (d && d.power > 0 && (b.fuel || 0) > 0 && !b.off) n += 1;
  }
  return n;
}

function isAwayFromCamp(state) {
  return state && state.layerId === 'surface' && ((state.chunkX | 0) !== 0 || (state.chunkY | 0) !== 0);
}

// 事件只接受当前阶段，重复事件不会重复弹提示或增长历史。
export function advanceFirstSlice(state, event) {
  const slice = state && state.firstSlice;
  if (!slice || !slice.active) return false;
  const day = state.day, t = state.t;
  if (event === 'wake' && slice.phase === 'wake') {
    slice.flags.wake = true;
    addHistory(slice, 'wake', day, t);
    slice.phase = 'gather';
    queueGuide(state, FIRST_SLICE.GUIDE.gather);
    return true;
  }
  if (event === 'gather' && slice.phase === 'gather') {
    slice.flags.gather = true;
    addHistory(slice, 'gather', day, t);
    slice.phase = 'light';
    queueGuide(state, FIRST_SLICE.GUIDE.light);
    return true;
  }
  if (event === 'lit' && slice.phase === 'light' && !slice.flags.firstLight) {
    slice.flags.firstLight = true;
    addHistory(slice, 'light', day, t);
    queueGuide(state, FIRST_SLICE.GUIDE.lit);
    return true;
  }
  if (event === 'dusk' && slice.phase === 'light') {
    slice.flags.dusk = true;
    slice.metrics.duskLamps = litLampCount(state);
    addHistory(slice, 'dusk', day, t);
    slice.phase = 'dusk';
    queueGuide(state, FIRST_SLICE.GUIDE.dusk);
    return true;
  }
  if (event === 'tide' && slice.phase === 'dusk') {
    slice.flags.tide = true;
    slice.metrics.tidePressure = Math.max(0, Number(state.nightLightPressure) || 0);
    slice.metrics.tideChallengeMul = Math.max(1, Number(state.nightChallengeMul) || 1);
    addHistory(slice, 'tide', day, t);
    slice.phase = 'tide';
    queueGuide(state, FIRST_SLICE.GUIDE.tide.replace('0', String(Math.round(slice.metrics.tidePressure))));
    return true;
  }
  if (event === 'aftermath' && slice.phase === 'tide') {
    slice.flags.aftermath = true;
    slice.metrics.aftermathBlight = state._blightAny ? 1 : 0;
    addHistory(slice, 'aftermath', day, t);
    slice.phase = 'aftermath';
    queueGuide(state, FIRST_SLICE.GUIDE.aftermath);
    return true;
  }
  if (event === 'expedition' && slice.phase === 'aftermath' && isAwayFromCamp(state)) {
    slice.flags.expedition = true;
    slice.metrics.expeditionCx = state.chunkX | 0;
    slice.metrics.expeditionCy = state.chunkY | 0;
    slice.metrics.expeditionDay = Math.max(1, day | 0);
    addHistory(slice, 'expedition', day, t);
    slice.phase = 'expedition';
    queueGuide(state, FIRST_SLICE.GUIDE.expedition);
    return true;
  }
  if (event === 'complete' && slice.phase === 'expedition' && !isAwayFromCamp(state)) {
    slice.flags.complete = true;
    slice.metrics.returnDay = Math.max(1, day | 0);
    addHistory(slice, 'complete', day, t);
    slice.phase = 'complete';
    queueGuide(state, FIRST_SLICE.GUIDE.complete);
    return true;
  }
  return false;
}

// 每个渲染帧最多消费一句待显示提示；状态更新本身仍可在固定步里完成。
export function tickFirstSlice(state, show) {
  if (!state || !state.firstSlice || !state.firstSlice.active) return;
  if (state.firstSlice.phase === 'wake') advanceFirstSlice(state, 'wake');
  if (state.firstSlice.phase === 'light' && state.t >= DUSK_START) advanceFirstSlice(state, 'dusk');
  if (state.firstSlice.phase === 'dusk' && isTide(state)) advanceFirstSlice(state, 'tide');
  if (state.firstSlice.phase === 'tide' && isDawn(state)) advanceFirstSlice(state, 'aftermath');
  if (state.firstSlice.phase === 'aftermath' && isAwayFromCamp(state)) advanceFirstSlice(state, 'expedition');
  if (state.firstSlice.phase === 'expedition' && !isAwayFromCamp(state)) advanceFirstSlice(state, 'complete');
  if (state._sliceGuide && typeof show === 'function') {
    const text = state._sliceGuide;
    state._sliceGuide = null;
    show(text);
  }
}
