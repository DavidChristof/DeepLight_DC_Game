import { canonical, digest, FORMAL_KEYS } from './l4_matrix_artifact.mjs';
import { BUILD } from '../js/data/buildings.js';
import { RECIPE_OF } from '../js/data/tools.js';
import { SURVIVAL } from '../js/data/survival.js';
import { ECOLOGY } from '../js/data/ecology.js';
const keyOf = e => e.path.split('/').at(-1);
const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function snapshotBook(s) {
  const book = {}, nodes = {};
  const stock = (id, box) => { for (const [k, n] of Object.entries(box || {})) if (n) book[id + '/' + k] = n; };
  stock('pack', s.stores.pack);
  for (const c of s.chunks) {
    const id = `${c.x},${c.y}`;
    for (const b of c.beacons) stock(`${id}/camp/${b.x},${b.y}`, b.stock);
    for (const b of c.buildings) {
      if (b.stock) stock(`${id}/store/${b.x},${b.y}`, b.stock);
      if (b.fuel) book[`${id}/slot/${b.type}/${b.x},${b.y}/${b.fireMat || 'fuel'}`] = b.fuel;
    }
    for (let j = 0; j < c.nodes.length; j += 2) if (c.nodes[j + 1]) nodes[`${id}/${c.nodes[j]}`] = c.nodes[j + 1];
  }
  if (s.equip.held) book['playerHeld/' + s.equip.held] = 1;
  for (const w of s.workers) if (w.tool) book[`workerHeld/${w.crew.id}/${w.tool}`] = 1;
  stock('deathPack', s.deathPack?.stock);
  if (s.deathPack?.held) book['deathHeld/' + s.deathPack.held] = 1;
  return { book, nodes };
}
function category(e) {
  const s = e.stack;
  if (e.kind === 'node') {
    if (s.includes('consumeRemoteNode')) return 'remoteCharge';
    if (s.includes('updateWorkers') && e.delta < 0) return 'localCharge';
    return 'unknown';
  }
  if (s.includes('withdrawFraction') && s.includes('handleDeath')) return 'deathPenalty';
  if (s.includes('handleDeath')) return 'deathMove';
  if (s.includes('workOnce')) return 'recipe';
  if (s.includes('payBuild')) return 'construction';
  if (s.includes('burnBuildingFuel')) return 'burn';
  if (s.includes('addFire') || s.includes('lightFire')) return 'fireTransfer';
  if (s.includes('transfer (')) return 'transfer';
  if (s.includes('systems/interact.js') && keyOf(e) === 'fuel') return 'refuel';
  if (s.includes('settleRemoteNeeds')) return 'eat';
  if (s.includes('depositToChunk')) return 'remoteMine';
  if (s.includes('deposit (') && s.includes('updateWorkers')) return 'localMine';
  return 'unknown';
}
export function auditLedgerReport(report) {
  const fails = [], need = (v, path) => { if (!v) fails.push(path); };
  need(report?.codeFingerprint === '45e27812' && report?.sourceHash === '790a3093', 'source');
  need(report?.runs?.length === 2 && !report.error, 'runs');
  const [a, b] = report?.runs || [];
  if (!a?.ledger || !b) return { ok: false, fails: [...fails, 'missing observed/control runs'] };
  need(a.observed === true && b.observed === false, 'observationSwitch');
  need(equal(a.initial, b.initial) && equal(a.end, b.end) && equal(a.commands, b.commands)
    && a.rngCalls === b.rngCalls && a.steps === b.steps, 'fullSwitchEquality');
  need(a.steps === 63792 && a.rngCalls === 1006, 'threeDayRun');
  for (const r of [a, b]) {
    need(digest(JSON.stringify(r.initial)) === r.initialHash && digest(JSON.stringify(r.end)) === r.endHash, 'snapshotHashes');
    need(r.roundtripExact && r.roundtripDifferences?.length === 0 && r.menu.ok && r.after.ok, 'runChecks');
  }
  for (const k of FORMAL_KEYS) need(report.storage?.[k] === true, 'storage.' + k);
  const l = a.ledger, start = snapshotBook(a.initial), end = snapshotBook(a.end);
  need(l.gaps.length === 0 && l.observerRemoved, 'mutationCoverage');
  need(equal(start.book, l.initial) && equal(start.nodes, l.initialNodes), 'initialBook');
  need(equal(end.book, l.final) && equal(end.nodes, l.finalNodes), 'finalBook');
  const inventory = { ...l.initial }, nodeBook = { ...l.initialNodes }, groups = {}, totals = {}, counts = {}, unknown = [];
  const penalties = [];
  l.events.forEach((e, i) => {
    const cat = category(e), key = keyOf(e), book = e.kind === 'node' ? nodeBook : inventory;
    need(Number.isFinite(e.delta) && e.after - e.before === e.delta && (book[e.path] || 0) === (e.before || 0), 'eventContinuity.' + i);
    if (cat === 'unknown') unknown.push(i);
    if (cat === 'deathPenalty') {
      const jump = a.commands.find(c => c.action === 'worldTimeJump' && c.step === e.step + 24 && c.day === e.day);
      need(!!jump, 'deathContext.' + i);
      const chunk = jump?.chunk?.join(',');
      const available = Object.entries(inventory).filter(([path]) => (path.startsWith(chunk + '/camp/') || path.startsWith(chunk + '/store/') || path.startsWith('pack/')) && path.endsWith('/fuel')).reduce((sum, [, n]) => sum + n, 0);
      const expected = Math.floor(available * SURVIVAL.DEATH.FUEL_LOSS);
      penalties.push({ event: i, day: e.day, chunk, available, paid: -e.delta, expected });
      need(-e.delta === expected, 'deathFraction.' + i);
    }
    book[e.path] = e.after || 0;
    const total = totals[cat] || (totals[cat] = {}); add(total, e.kind === 'node' ? e.tile : key, e.delta);
    counts[cat] = (counts[cat] || 0) + 1;
    const group = groups[`${cat}:${e.step}:${e.day}:${e.t}`] || (groups[`${cat}:${e.step}:${e.day}:${e.t}`] = { cat, net: {} });
    add(group.net, key, e.delta);
    if (cat === 'burn') need(e.path.includes('/slot/') && e.delta < 0, 'burn.' + i);
    if (cat === 'eat') need(key === 'food' && e.delta === -1, 'eat.' + i);
    if (cat === 'localCharge' || cat === 'remoteCharge') need(e.delta === -1, 'charge.' + i);
  });
  need(!unknown.length, 'unclassifiedEvents');
  need(equal(clean(inventory), l.final) && equal(clean(nodeBook), l.finalNodes), 'journalEnd');
  for (const [id, g] of Object.entries(groups)) if (['transfer', 'fireTransfer', 'refuel', 'deathMove'].includes(g.cat)) {
    need(Object.values(g.net).every(n => n === 0), 'transferBalance.' + id);
  }
  const built = a.end.chunks.flatMap(c => c.buildings.filter(bld => !a.initial.chunks.find(i => i.x === c.x && i.y === c.y)?.buildings.some(i => i.x === bld.x && i.y === bld.y && i.type === bld.type)));
  const cost = {}; for (const building of built) for (const [k, n] of Object.entries(BUILD[building.type].cost)) add(cost, k, -n);
  need(equal(cost, totals.construction), 'constructionCost');
  const recipe = RECIPE_OF.fuel, batches = (totals.recipe?.[recipe.out] || 0) / recipe.n, recipeNet = { [recipe.out]: batches * recipe.n };
  for (const [k, n] of Object.entries(recipe.cost)) add(recipeNet, k, -batches * n);
  need(Number.isInteger(batches) && batches > 0 && equal(recipeNet, totals.recipe), 'recipeRatio');
  // This source has no axes or tool changes; each observed charge yields one.
  need(!a.initial.workers.some(w => w.tool === 'axe') && !l.events.some(e => e.path.endsWith('/axe')), 'miningBonusScope');
  const tileRes = { 2: 'ore', 3: 'vine', 1: 'stone' };
  for (const [kind, mined] of [['localCharge', 'localMine'], ['remoteCharge', 'remoteMine']]) {
    const expected = {}; for (const [tile, n] of Object.entries(totals[kind] || {})) add(expected, tileRes[tile], -n);
    need(equal(expected, totals[mined]), 'nodeToStock.' + mined);
  }
  const totalOf = book => { const r = {}; for (const [path, n] of Object.entries(book)) add(r, path.split('/').at(-1), n); return r; };
  return { ok: fails.length === 0, fails, scope: 'one current three-day supply continuation plus observation-off control',
    source: report.codeFingerprint, startHash: a.initialHash, endHash: a.endHash, steps: a.steps, rngCalls: a.rngCalls,
    events: l.events.length, counts, totals, recipeBatches: batches, penalties, unknown,
    initialTotals: totalOf(l.initial), finalTotals: totalOf(l.final),
    notOriginal83InputLedger: true, notAllThreeStrategiesEventJournal: true };
}
export function auditLedgerArtifact(value, raw) {
  const audit = auditLedgerReport(value?.report);
  if (value?.format !== 'l4-ledger-results-v1' || digest(raw) !== '81ba6178' || JSON.stringify(value) !== raw) audit.fails.push('artifactHashOrFormat');
  audit.ok = audit.fails.length === 0; return audit;
}
export function auditCategoryArtifact(value, raw) {
  const fails = [], need = (v, p) => { if (!v) fails.push(p); }, report = value?.report;
  need(value?.format === 'l4-ledger-categories-v1' && digest(raw) === 'c3f20557'
    && JSON.stringify(value) === raw, 'artifactHashOrFormat');
  need(report?.codeFingerprint === '45e27812' && !report.error && report.runs?.length === 2, 'sourceAndRuns');
  const [a, b] = report?.runs || [];
  if (!a?.ledger || !b) return { ok: false, fails: [...fails, 'missingRuns'] };
  need(a.observed === true && b.observed === false && equal(a.initial, b.initial)
    && equal(a.end, b.end) && a.rngCalls === b.rngCalls, 'fullSwitchEquality');
  for (const r of [a, b]) need(digest(JSON.stringify(r.end)) === r.hash && r.roundtripExact
    && r.menu.ok && r.after.ok, 'snapshotAndRoundtrip');
  for (const k of FORMAL_KEYS) need(report.storage?.[k] === true, 'storage.' + k);
  const l = a.ledger, start = snapshotBook(a.initial), end = snapshotBook(a.end);
  need(!l.gaps.length && l.observerRemoved, 'coverage');
  need(equal(start.book, l.initial) && equal(start.nodes, l.initialNodes), 'initialBook');
  need(equal(end.book, l.final) && equal(end.nodes, l.finalNodes), 'finalBook');
  const inventory = { ...l.initial }, nodes = { ...l.initialNodes }, counts = {}, totals = {}, unknown = [];
  for (const [i, e] of l.events.entries()) {
    const book = e.kind === 'node' ? nodes : inventory;
    need(Number.isFinite(e.delta) && e.after - e.before === e.delta && (book[e.path] || 0) === e.before, 'continuity.' + i);
    if (e.after) book[e.path] = e.after; else delete book[e.path];
    const cat = e.stack.includes('completeBuilding') ? 'initialFuel'
      : e.stack.includes('withdrawFromChunk') && e.stack.includes('updateOutpostSettlement')
        && !e.stack.includes('settleRemoteNeeds') ? 'guard' : category(e);
    if (cat === 'unknown') unknown.push(i);
    counts[cat] = (counts[cat] || 0) + 1;
    add(totals[cat] ||= {}, e.kind === 'node' ? String(e.tile) : keyOf(e), e.delta);
    if (cat === 'initialFuel') need(e.path === `0,0/slot/lamp/${a.target.x},${a.target.y}/fuel`
      && e.before === 0 && e.after === BUILD.lamp.maxFuel, 'initialFuelSource');
    if (cat === 'guard') need(e.path === '1,0/store/4,37/fuel' && e.delta === -ECOLOGY.OUTPOST_GUARD_FUEL_PER_TICK, 'guardPayment');
  }
  need(equal(inventory, l.final) && equal(nodes, l.finalNodes), 'finalReplay');
  need(unknown.length === 0, 'unknown');
  need(counts.initialFuel === 1 && a.initialSlot === 0 && a.completedSlot === BUILD.lamp.maxFuel, 'completion');
  need(counts.guard === a.remoteTicks[1] - a.remoteTicks[0] && counts.guard === 1, 'guardTicks');
  need(equal(totals.construction, Object.fromEntries(Object.entries(BUILD.lamp.cost).map(([k, n]) => [k, -n]))), 'cost');
  need((totals.localMine?.vine || 0) === -(totals.localCharge?.['3'] || 0), 'nodeToStock');
  return { ok: fails.length === 0, fails, scope: report.scope, source: report.codeFingerprint,
    hash: digest(raw), endHash: a.hash, events: l.events.length, counts, totals, unknown,
    slots: [a.initialSlot, a.completedSlot], remoteTicks: a.remoteTicks,
    formalKeysRestored: report.storage, notFairStrategyMatrix: true };
}
if (typeof process !== 'undefined' && process.versions?.node) {
  const { pathToFileURL } = await import('node:url');
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { readFile } = await import('node:fs/promises'), { inflateSync } = await import('node:zlib');
    const raw = inflateSync(Buffer.from(await readFile('docs/fixtures/l4-ledger-full.deflate.b64', 'utf8'), 'base64')).toString('utf8');
    const value = JSON.parse(raw), audit = auditLedgerArtifact(value, raw);
    if (process.argv.includes('--selftest')) {
      const tests = [['original audit', audit.ok]];
      for (const [name, mutate] of [
        ['missing resource event', r => r.runs[0].ledger.events.splice(0, 1)],
        ['changed quantity', r => r.runs[0].ledger.events[0].delta++],
        ['missing node event', r => r.runs[0].ledger.events.splice(r.runs[0].ledger.events.findIndex(e => e.kind === 'node'), 1)],
        ['changed control state', r => r.runs[1].end.res.ore++],
        ['unknown caller', r => r.runs[0].ledger.events[0].stack = 'unknown'],
        ['missing formal restore', r => r.storage[FORMAL_KEYS[0]] = false],
      ]) { const r = structuredClone(value.report); mutate(r); tests.push([name + ' rejected', !auditLedgerReport(r).ok]); }
      console.log(JSON.stringify({ ok: tests.every(t => t[1]), scope: 'rules helper mutation checks, not gameplay regression', tests }, null, 2));
      if (tests.some(t => !t[1])) process.exitCode = 1;
    } else { console.log(JSON.stringify(audit, null, 2)); if (!audit.ok) process.exitCode = 1; }
  }
}
