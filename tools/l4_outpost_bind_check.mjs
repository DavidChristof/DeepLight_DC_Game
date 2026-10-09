// Isolated production-module checks. No browser, DOM, storage, or gameplay replay.
import { bindSurfaceChunk } from '../js/world/chunks.js';
import { createMap } from '../js/world/map.js';
import { Worker } from '../js/entities/worker.js';
import { ensureCrewCard } from '../js/data/colonists.js';
import { ECOLOGY } from '../js/data/ecology.js';
import { SURVIVAL } from '../js/data/survival.js';

const tests = [];
const need = (name, passed) => tests.push([name, !!passed]);
function scene(outpost, withWorker = true) {
  const w = new Worker('probe', 0.5, 0.5, { good: '', bad: '' });
  ensureCrewCard(w, 0, 1, { id: 'probe' });
  const c = { id: '0,0', cx: 0, cy: 0, map: createMap(2, 2), buildings: [], beacons: [], enemies: [], workers: withWorker ? [w] : [] };
  if (outpost !== undefined) c.outpost = outpost;
  const s = { layerId: 'surface', layers: {}, chunkStore: {}, pack: { stock: {} }, floaties: [], day: 1 };
  return { s, c, w, bind: () => bindSurfaceChunk(s, c) };
}
function alert(extra = {}) {
  return { id: 'legacy-alert', kind: 'blight', message: 'controlled legacy alert', workerId: 'probe', status: 'open', ...extra };
}
for (const absent of [undefined, null]) {
  const x = scene(absent); x.bind();
  need(absent === null ? 'explicit null preserved' : 'missing property preserved', x.c.outpost === absent && (absent !== undefined || !Object.hasOwn(x.c, 'outpost')));
  need(absent === null ? 'null binding is idempotent' : 'missing binding is idempotent', (() => { x.bind(); return x.c.outpost === absent; })());
}
{
  const x = scene({ alerts: [], nextT: 4, ticks: 7 }); x.bind();
  need('existing settlement timer and ticks preserved', x.c.outpost.nextT === 4 && x.c.outpost.ticks === 7 && x.c.outpost.alerts.length === 0);
}
{
  const x = scene({ alerts: [alert()] }); x.bind();
  need('legacy pending alert migrates and downs matching worker', x.w.downed && x.w.hp === 0 && x.w.downT === SURVIVAL.RESCUE.DOWNED_SECS && x.c.outpost.alerts[0].status === 'resolved' && x.c.outpost.alerts[0].rescuePending === false);
  const before = JSON.stringify({ o: x.c.outpost, w: x.w, fx: x.s.floaties }); x.bind();
  need('resolved legacy alert is not activated twice', before === JSON.stringify({ o: x.c.outpost, w: x.w, fx: x.s.floaties }));
  need('legacy object still receives settlement defaults', x.c.outpost.nextT === ECOLOGY.OUTPOST_SETTLE_SEC && x.c.outpost.ticks === 0);
}
for (const [name, extra] of [['explicit false respected', { rescuePending: false }], ['resolved alert respected', { status: 'resolved' }], ['unmatched worker remains pending', { workerId: 'someone-else' }]]) {
  const x = scene({ alerts: [alert(extra)] }); x.bind();
  need(name, !x.w.downed && x.w.hp === SURVIVAL.WORKER.BASE_HP);
}
{
  const x = scene({ alerts: [alert()] }, false); x.bind();
  need('empty chunk does not consume pending alert', x.c.outpost.alerts[0].status === 'open' && x.c.outpost.alerts[0].rescuePending === true);
}
{
  const x = scene({ alerts: [alert()] }); x.s.layerId = 'depth1'; const before = JSON.stringify(x.c.outpost); x.bind();
  need('non-surface context does not activate or normalize alerts', !x.w.downed && JSON.stringify(x.c.outpost) === before);
}
console.log(JSON.stringify({ ok: tests.every(t => t[1]), scope: 'isolated production-module probes only; NOT browser acceptance, save roundtrip, replay, input or performance', ran: tests.length, tests }, null, 2));
if (tests.some(t => !t[1])) process.exitCode = 1;
