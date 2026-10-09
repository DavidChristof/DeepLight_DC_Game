// Test-only passive mutation journal. No simulation/RNG calls or production imports.
export function observeLedger(state, allContainers) {
  const events = [], gaps = [], undo = [], properties = new WeakMap(), rawOf = new WeakMap();
  const nodesSeen = new WeakSet();
  let step = 0, phase = 'initial', stopped = false;
  const stack = () => (new Error().stack || '').split('\n').filter(l => !l.includes('l4_event_ledger.mjs')).slice(1, 9).join('\n');
  const unwrap = v => v && typeof v === 'object' ? rawOf.get(v) || v : v;
  const layer = id => id === 'surface' ? `${state.chunkX | 0},${state.chunkY | 0}` : id?.replace('surface:', '');
  const containerId = c => `${layer(c.layerId)}/${c.kind}/${c.x},${c.y}`;
  function book() {
    const result = {};
    const add = (path, value) => { if (value) result[path] = (result[path] || 0) + value; };
    const stock = (id, box) => { for (const [k, n] of Object.entries(box || {})) add(id + '/' + k, n); };
    for (const c of allContainers(state, false)) stock(containerId(c), c.ref.stock);
    stock('pack', state.pack?.stock);
    if (state.equip?.held) add('playerHeld/' + state.equip.held, 1);
    for (const w of new Set(Object.values(state.chunkStore || {}).flatMap(c => c.workers || []).concat(state.workers || []))) {
      if (w.tool) add(`workerHeld/${w.crew?.id || w.name}/${w.tool}`, 1);
    }
    for (const [id, c] of Object.entries(state.chunkStore || {})) for (const b of c.buildings || []) {
      add(`${id}/slot/${b.type}/${b.x},${b.y}/${b.fireMat || 'fuel'}`, b.fuel || 0);
    }
    stock('deathPack', state.deathPack?.stock);
    if (state.deathPack?.held) add('deathHeld/' + state.deathPack.held, 1);
    return result;
  }
  function nodeBook() {
    const result = {};
    for (const [id, c] of Object.entries(state.chunkStore || {})) {
      const a = c.map?.nodeAmt; if (!a) continue;
      for (let i = 0; i < a.length; i++) if (a[i]) result[`${id}/${i}`] = a[i];
    }
    return result;
  }
  const initial = book(), initialNodes = nodeBook(); let expected = { ...initial }, expectedNodes = { ...initialNodes };
  function emit(kind, path, before, after, extra = {}) {
    if (stopped || before === after) return;
    if (events.length >= 50000) throw Error('ledger event safety limit');
    const delta = (after || 0) - (before || 0);
    events.push({ step, phase, day: state.day, t: state.t, kind, path, before, after, delta, stack: stack(), ...extra });
    if (kind === 'resource') expected[path] = (expected[path] || 0) + delta;
    if (kind === 'node') expectedNodes[path] = (expectedNodes[path] || 0) + delta;
  }
  function wrapStock(box, id) {
    if (!box || typeof box !== 'object') return box;
    const target = unwrap(box), proxy = new Proxy(target, {
      set(o, k, v) { const before = o[k] || 0; o[k] = v; emit('resource', id + '/' + String(k), before, o[k] || 0); return true; },
      deleteProperty(o, k) { const before = o[k] || 0; delete o[k]; emit('resource', id + '/' + String(k), before, 0); return true; },
    });
    rawOf.set(proxy, target); return proxy;
  }
  function watch(owner, prop, wrap, changed) {
    if (!owner || properties.get(owner)?.has(prop)) return;
    const desc = Object.getOwnPropertyDescriptor(owner, prop);
    if (!desc || !('value' in desc) || !desc.configurable || !desc.writable) return;
    let value = wrap(desc.value);
    const set = properties.get(owner) || new Set(); set.add(prop); properties.set(owner, set);
    Object.defineProperty(owner, prop, { enumerable: desc.enumerable, configurable: true,
      get: () => value, set: next => { const old = value; value = wrap(next); changed?.(old, value); } });
    undo.push(() => Object.defineProperty(owner, prop, { ...desc, value: unwrap(value) }));
  }
  function stockOwner(owner, id) {
    watch(owner, 'stock', box => wrapStock(box, id), (a, b) => {
      for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) emit('resource', id + '/' + k, a?.[k] || 0, b?.[k] || 0);
    });
  }
  function heldOwner(owner, prop, id) {
    watch(owner, prop, v => v, (a, b) => { if (a) emit('resource', id + '/' + a, 1, 0); if (b) emit('resource', id + '/' + b, 0, 1); });
  }
  function bind() {
    for (const c of allContainers(state, false)) stockOwner(c.ref, containerId(c));
    stockOwner(state.pack, 'pack'); heldOwner(state.equip, 'held', 'playerHeld');
    for (const w of new Set(Object.values(state.chunkStore || {}).flatMap(c => c.workers || []).concat(state.workers || []))) heldOwner(w, 'tool', `workerHeld/${w.crew?.id || w.name}`);
    for (const [id, c] of Object.entries(state.chunkStore || {})) {
      for (const b of c.buildings || []) {
        watch(b, 'fuel', v => v, (a, n) => emit('resource', `${id}/slot/${b.type}/${b.x},${b.y}/${b.fireMat || 'fuel'}`, a || 0, n || 0));
        watch(b, 'fireMat', v => v, (a, n) => {
          if (!b.fuel) return;
          emit('resource', `${id}/slot/${b.type}/${b.x},${b.y}/${a || 'fuel'}`, b.fuel, 0);
          emit('resource', `${id}/slot/${b.type}/${b.x},${b.y}/${n || 'fuel'}`, 0, b.fuel);
        });
      }
      const map = c.map, target = unwrap(map?.nodeAmt);
      if (!target || nodesSeen.has(target)) continue;
      nodesSeen.add(target);
      const proxy = new Proxy(target, {
        get(o, k) { const v = Reflect.get(o, k, o); return typeof v === 'function' ? v.bind(o) : v; },
        set(o, k, v) { const before = o[k]; Reflect.set(o, k, v, o);
          if (/^\d+$/.test(String(k))) emit('node', `${id}/${k}`, before, o[k], { tile: map.tiles[Number(k)] });
          return true; },
      });
      rawOf.set(proxy, target); map.nodeAmt = proxy;
      undo.push(() => { if (map.nodeAmt === proxy) map.nodeAmt = target; });
    }
    watch(state, 'deathPack', v => v, (a, b) => {
      for (const k of new Set([...Object.keys(a?.stock || {}), ...Object.keys(b?.stock || {})])) emit('resource', 'deathPack/' + k, a?.stock?.[k] || 0, b?.stock?.[k] || 0);
      if (a?.held) emit('resource', 'deathHeld/' + a.held, 1, 0);
      if (b?.held) emit('resource', 'deathHeld/' + b.held, 0, 1);
      stockOwner(b, 'deathPack');
    });
    stockOwner(state.deathPack, 'deathPack');
  }
  function sync(nextStep, nextPhase) {
    step = nextStep; phase = nextPhase; bind();
    const actual = book();
    for (const path of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if ((expected[path] || 0) !== (actual[path] || 0)) gaps.push({ step, phase, path,
        expected: expected[path] || 0, actual: actual[path] || 0, day: state.day, t: state.t });
    }
    expected = { ...actual };
    const actualNodes = nodeBook();
    for (const path of new Set([...Object.keys(expectedNodes), ...Object.keys(actualNodes)])) {
      if ((expectedNodes[path] || 0) !== (actualNodes[path] || 0)) gaps.push({ step, phase, kind: 'node', path,
        expected: expectedNodes[path] || 0, actual: actualNodes[path] || 0, day: state.day, t: state.t });
    }
    expectedNodes = { ...actualNodes };
  }
  bind();
  return { sync, stop() {
    if (stopped) throw Error('ledger already stopped');
    sync(step, 'final'); const final = book(), finalNodes = nodeBook(); stopped = true;
    for (const restore of undo.reverse()) restore();
    const net = {}; for (const e of events) if (e.kind === 'resource') net[e.path] = (net[e.path] || 0) + e.delta;
    return { format: 'l4-event-ledger-v1', initial, final, initialNodes, finalNodes, events, gaps,
      complete: gaps.length === 0, net, nodeEvents: events.filter(e => e.kind === 'node').length,
      observerRemoved: true, limitations: ['TypedArray bulk methods are bound to the original array; any unobserved inventory change is a gap, not accepted attribution.',
        'Mutation stacks identify actual call sites; rule classification and recipe/consumption reconciliation are separate acceptance work.'] };
  } };
}
