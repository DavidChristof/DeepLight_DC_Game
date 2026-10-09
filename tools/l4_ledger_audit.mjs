// Read-only audit of the actual independent input report. No inferred events.
import { genMap, surfaceChunkMapSeed } from '../js/world/gen.js';
import { biomeIdAt } from '../js/data/ecology.js';
import { BUILD } from '../js/data/buildings.js';
const add = (to, stock) => { for (const [k, v] of Object.entries(stock || {})) to[k] = (to[k] || 0) + v; };
function accounts(view) {
  const a = { pack: { ...view.pack } };
  for (const c of view.containers) {
    const chunk = c.layer === 'surface' ? view.chunk.join(',') : c.layer?.replace('surface:', '');
    const id = `${chunk}/${c.kind}/${c.x},${c.y}`;
    if (a[id]) throw Error('duplicate container ' + id);
    a[id] = { ...c.stock };
  }
  return a;
}
function changes(before, after) {
  const rows = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    for (const key of new Set([...Object.keys(before[id] || {}), ...Object.keys(after[id] || {})])) {
      const delta = (after[id]?.[key] || 0) - (before[id]?.[key] || 0);
      if (delta) rows.push({ account: id, key, delta });
    }
  }
  return rows;
}
function totals(snapshot) {
  const stock = {}, slots = {}, tools = {};
  add(stock, snapshot.stores.pack);
  for (const c of snapshot.chunks) {
    for (const b of c.beacons) add(stock, b.stock);
    for (const b of c.buildings) {
      add(stock, b.stock);
      if (b.fuel) add(slots, { [b.fireMat || 'fuel']: b.fuel });
    }
  }
  if (snapshot.equip?.held) add(tools, { [snapshot.equip.held]: 1 });
  for (const w of snapshot.workers) if (w.tool) add(tools, { [w.tool]: 1 });
  if (snapshot.deathPack) add(stock, snapshot.deathPack.stock);
  return { stock, slots, tools, deathPack: snapshot.deathPack };
}
function nodes(snapshot) {
  return snapshot.chunks.map(c => {
    const map = genMap(96, 72, surfaceChunkMapSeed(snapshot.seed, c.x, c.y), biomeIdAt(c.x, c.y));
    // Saved nodes are a FLAT [index, amount, index, amount] list, not pairs.
    const sums = {};
    for (let j = 0; j < c.nodes.length; j += 2) {
      const type = map.tiles[c.nodes[j]];
      sums[type] = (sums[type] || 0) + c.nodes[j + 1];
    }
    return { chunk: `${c.x},${c.y}`, sums };
  });
}
export function auditInputLedger(report) {
  const transfers = [], unresolved = [], initial = totals(report.initialSnapshot), final = totals(report.finalSnapshot);
  report.inputs.forEach((e, inputIndex) => {
    if (e.kind !== 'click') return;
    const rows = changes(accounts(e.before), accounts(e.after));
    if (!rows.length) return;
    const net = {}; for (const r of rows) add(net, { [r.key]: r.delta });
    const sameTime = e.before.day === e.after.day && e.before.t === e.after.t;
    if (sameTime && Object.values(net).every(n => n === 0)) transfers.push({ inputIndex, label: e.text, rows, net });
    else unresolved.push({ inputIndex, reason: '同期模拟或非转移净变化，不能归为纯搬运', rows, net });
  });
  const constructionCost = {}, initialization = {}, newBuildings = [];
  for (const c of report.finalSnapshot.chunks) for (const b of c.buildings) {
    const old = report.initialSnapshot.chunks.find(i => i.x === c.x && i.y === c.y)?.buildings
      .some(i => i.type === b.type && i.x === b.x && i.y === b.y);
    if (old) continue;
    const d = BUILD[b.type];
    add(constructionCost, d.cost);
    if (!b.site && d.maxFuel && !d.fireMat) add(initialization, { fuel: d.maxFuel });
    newBuildings.push({ chunk: `${c.x},${c.y}`, type: b.type, x: b.x, y: b.y, cost: d.cost,
      note: '建成后默认槽量按既有BUILD规则单列，非玩家搬运' });
  }
  const firstNodes = nodes(report.initialSnapshot), lastNodes = nodes(report.finalSnapshot);
  const originStart = firstNodes.find(c => c.chunk === '0,0').sums;
  const originEnd = lastNodes.find(c => c.chunk === '0,0').sums;
  const oreOutputRequired = (final.stock.ore || 0) - (initial.stock.ore || 0) + (constructionCost.ore || 0);
  const oreNodeNetLoss = originStart[2] - originEnd[2];
  const vineOutputRequired = (final.stock.vine || 0) - (initial.stock.vine || 0) + (constructionCost.vine || 0);
  const vineNodeNetLoss = originStart[3] - originEnd[3];
  const oreSourceGap = oreOutputRequired - oreNodeNetLoss;
  if (oreSourceGap) unresolved.push({ category: 'ore source attribution', amount: oreSourceGap,
    reason: '节点净减少不等于实际采集次数；原报告未逐事件记录矿脉补量，不能将差额推断为矿工收益' });
  const refuels = report.inputs.flatMap((e, inputIndex) => {
    if (e.code !== 'KeyE') return [];
    const lamp = v => v.fuel.find(b => b.chunk === '1,0' && b.type === 'lamp');
    const b = lamp(e.before), a = lamp(e.after);
    if (!a || !b || a.site || b.site || a.fuel <= b.fuel) return [];
    const rows = changes(accounts(e.before), accounts(e.after));
    return [{ inputIndex, slotBefore: b.fuel, slotAfter: a.fuel, rows }];
  });
  return { format: 'l4-input-ledger-audit-v1', scope: 'independent 83-input chain, not original six-run event ledger',
    complete: false, proofId: report.proofId, initial, final, transfers,
    newBuildings, constructionCost, initialization, refuels, firstNodes, lastNodes,
    sources: { oreOutputRequired, oreNodeNetLoss, oreSourceGap, vineOutputRequired, vineNodeNetLoss },
    unresolved, notes: [
      `${transfers.length}个零时间点击区间可独立验证搬运双方；不把同期采集视为转移。`,
      '新探索区块的确定性资源存量不是采集收入。',
      '工具从容器移到人物后仍需计入；原逐输入ledger未记录装备，起终完整快照有记录。',
      '未发生进食、制作或救援，不能从本链验证这些事件。燃耗／岗位支付须补逐事件证据。',
      '材料成本按当前数据表核对；表无变化不代表历史事件已全被记录。',
    ] };
}
if (typeof process !== 'undefined' && process.versions?.node) {
  const { pathToFileURL } = await import('node:url');
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { readFile } = await import('node:fs/promises'), { inflateSync } = await import('node:zlib');
    const value = JSON.parse(inflateSync(Buffer.from(await readFile('docs/fixtures/l4-independent-input.deflate.b64', 'utf8'), 'base64')));
    const audit = auditInputLedger(value.report);
    console.log(JSON.stringify({ ...audit, transfers: audit.transfers.map(t => ({ inputIndex: t.inputIndex, rows: t.rows })) }, null, 2));
  }
}
