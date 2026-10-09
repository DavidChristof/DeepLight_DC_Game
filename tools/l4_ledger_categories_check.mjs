// Independent file verification; not a browser gameplay regression.
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { auditCategoryArtifact } from './l4_ledger_rules.mjs';
const raw = inflateSync(Buffer.from(await readFile('docs/fixtures/l4-ledger-categories.deflate.b64', 'utf8'), 'base64')).toString('utf8');
const value = JSON.parse(raw), audit = auditCategoryArtifact(value, raw);
if (!process.argv.includes('--selftest')) {
  console.log(JSON.stringify(audit, null, 2));
  if (!audit.ok) process.exitCode = 1;
} else {
  const tests = [['original file', audit.ok]];
  for (const [name, mutate, expected] of [
    ['missing actual guard event', v => { const es = v.report.runs[0].ledger.events; es.splice(es.findIndex(e => e.stack.includes('withdrawFromChunk')), 1); }, 'guardTicks'],
    ['wrong completion amount', v => { v.report.runs[0].ledger.events.find(e => e.stack.includes('completeBuilding')).after--; }, 'initialFuelSource'],
    ['unobserved mutation', v => v.report.runs[0].ledger.gaps.push({ path: 'unobserved' }), 'coverage'],
    ['control state changed', v => v.report.runs[1].end.res.ore++, 'fullSwitchEquality'],
    ['missing node event', v => { const es = v.report.runs[0].ledger.events; es.splice(es.findIndex(e => e.kind === 'node'), 1); }, 'continuity.'],
    ['unknown source', v => { v.report.runs[0].ledger.events[0].stack = 'unknown'; }, 'unknown'],
    ['storage not restored', v => { v.report.storage['deep-light-saves-v2'] = false; }, 'storage.deep-light-saves-v2'],
  ]) {
    const changed = structuredClone(value); mutate(changed);
    const result = auditCategoryArtifact(changed, JSON.stringify(changed));
    // Require the semantic failure too, not just the pinned artifact digest.
    tests.push([name, !result.ok && result.fails.some(f => f.startsWith(expected))]);
  }
  console.log(JSON.stringify({ ok: tests.every(t => t[1]), scope: 'category verifier mutation checks, not browser acceptance', tests }, null, 2));
  if (tests.some(t => !t[1])) process.exitCode = 1;
}
