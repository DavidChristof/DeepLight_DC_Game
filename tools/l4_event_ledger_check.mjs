import { observeLedger } from './l4_event_ledger.mjs';
const make = () => {
  const w = { name: 'probe', crew: { id: 'w' }, tool: null };
  const c = { workers: [w], buildings: [{ type: 'lamp', x: 2, y: 2, fuel: 3, fireMat: null }],
    map: { tiles: new Uint8Array([2, 0]), nodeAmt: new Int8Array([5, 0]) } };
  const state = { day: 1, t: 0, chunkX: 0, chunkY: 0, chunkStore: { '0,0': c }, workers: [w],
    pack: { stock: {} }, equip: { held: 'pick' }, deathPack: null };
  const beacon = { stock: { ore: 4, pick: 1 } };
  return { state, c, w, beacon, containers: () => [{ kind: 'camp', layerId: 'surface', x: 0, y: 0, ref: beacon }] };
};
const x = make(), trace = observeLedger(x.state, x.containers);
x.beacon.stock.ore++; x.c.map.nodeAmt[0]--;
x.beacon.stock.pick--; x.w.tool = 'pick';
x.beacon.stock.ore--; x.state.pack.stock.ore = 1;
x.c.buildings[0].fuel--;
x.state.deathPack = { stock: { ...x.state.pack.stock }, held: x.state.equip.held };
x.state.pack.stock = {}; x.state.equip.held = null;
trace.sync(1, 'unit');
const beforeRemoval = JSON.stringify(x.state), result = trace.stop();
const tests = [
  ['resource and node journal has no gaps', result.gaps.length === 0],
  ['actual node mutation recorded', result.events.some(e => e.kind === 'node' && e.delta === -1)],
  ['death stock destination recorded', result.events.some(e => e.path === 'deathPack/ore' && e.delta === 1)],
  ['equipped tool recorded', result.events.some(e => e.path === 'workerHeld/w/pick' && e.delta === 1)],
  ['removing observation preserves data', beforeRemoval === JSON.stringify(x.state)],
  ['data property descriptor restored', 'value' in Object.getOwnPropertyDescriptor(x.state.pack, 'stock')],
];
const y = make(), missed = observeLedger(y.state, y.containers);
y.c.map.nodeAmt.fill(0); // Bound bulk method deliberately bypasses per-index trap.
missed.sync(1, 'bulk'); const negative = missed.stop();
tests.push(['unobserved bulk node write is rejected', !negative.complete && negative.gaps.some(e => e.kind === 'node')]);
console.log(JSON.stringify({ scope: 'observer unit checks, not browser acceptance', ok: tests.every(t => t[1]), tests }, null, 2));
if (tests.some(t => !t[1])) process.exitCode = 1;
