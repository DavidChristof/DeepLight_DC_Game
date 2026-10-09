// Development evidence integrity only; this does not turn a failed run green.
import { digest, FORMAL_KEYS } from './l4_matrix_artifact.mjs';
export const INPUT_FILE = 'docs/fixtures/l4-independent-input.deflate.b64';
export const INPUT_HASH = 'dcbacf56';
export function auditInputArtifact(value, raw) {
  const fails = [], need = (ok, path) => { if (!ok) fails.push(path); };
  const r = value?.report;
  need(value?.format === 'l4-independent-input-v1', 'format');
  need(typeof raw === 'string' && digest(raw) === INPUT_HASH, 'wholeFileHash');
  need(r?.proofId === 'l4-independent-input-2026-10-08T08:52:22.085Z', 'proofId');
  need(r?.source?.codeFingerprint === '4b01428d' && r?.source?.sourceFiles === 95, 'historicalSource');
  for (const k of ['resourceInjection', 'teleport', 'syntheticGameInput']) need(r?.source?.[k] === false, 'source.' + k);
  need(Array.isArray(r?.inputs) && r.inputs.length === 83, 'inputs.length');
  (r?.inputs || []).forEach((e, i) => {
    need(e?.trusted === true && ['key', 'click'].includes(e.kind), `inputs.${i}.trustedKind`);
    for (const side of ['before', 'after']) need(e?.[side]?.pack && Array.isArray(e?.[side]?.containers)
      && Array.isArray(e?.[side]?.nodes) && Array.isArray(e?.[side]?.fuel), `inputs.${i}.${side}`);
  });
  for (const [side, hash] of [['initial', 'dce097d2'], ['final', 'f66f4ac5']]) {
    need(r?.[side + 'Snapshot'] && r?.[side + 'SnapshotHash'] === hash
      && digest(JSON.stringify(r[side + 'Snapshot'])) === hash, side + 'SnapshotHash');
  }
  for (const k of FORMAL_KEYS) need(r?.storage?.[k] === true, 'storage.' + k);
  need(r?.freeze?.steps === 1200 && r?.freeze?.before === '46e2ba10'
    && r?.freeze?.after === r?.freeze?.before && r?.freeze?.differences?.length === 0, 'freeze');
  // The exact original failure is part of the evidence, not an acceptance gate.
  need(r?.roundtrip?.semanticExact === false && r?.roundtrip?.byteExact === false
    && r?.roundtrip?.before === 'a28554f' && r?.roundtrip?.after === 'f66f4ac5'
    && r?.roundtrip?.differences?.length === 2, 'originalFailurePreserved');
  need(r?.roundtrip?.differences?.[0]?.path === '.firstSlice.startedT'
    && r?.roundtrip?.differences?.[1]?.path === '.resonance.sites.first.trial', 'failurePaths');
  return { ok: fails.length === 0, scope: 'file integrity, not gameplay acceptance', fails,
    hash: typeof raw === 'string' ? digest(raw) : null, proofId: r?.proofId,
    inputs: r?.inputs?.length, initialHash: r?.initialSnapshotHash, finalHash: r?.finalSnapshotHash,
    originalRoundtripPassed: r?.roundtrip?.semanticExact === true,
    originalDifferences: r?.roundtrip?.differences, storage: r?.storage };
}

async function cli() {
  const { readFile } = await import('node:fs/promises');
  const { inflateSync } = await import('node:zlib');
  const args = process.argv.slice(2), selftest = args[0] === '--selftest';
  const path = args[selftest ? 1 : 0] || INPUT_FILE;
  const raw = inflateSync(Buffer.from(await readFile(path, 'utf8'), 'base64')).toString('utf8');
  const value = JSON.parse(raw), result = auditInputArtifact(value, raw);
  if (!result.ok) throw Error(JSON.stringify(result));
  if (!selftest) { console.log(JSON.stringify(result, null, 2)); return; }
  const tests = [['original integrity', result.ok], ['original failed run not relabeled', !result.originalRoundtripPassed]];
  for (const [name, change] of [
    ['missing input', a => a.report.inputs.pop()],
    ['synthetic event', a => a.report.inputs[0].trusted = false],
    ['missing ledger', a => delete a.report.inputs[0].after],
    ['changed initial', a => a.report.initialSnapshot.res.ore++],
    ['changed final', a => a.report.finalSnapshot.res.ore++],
    ['hidden failure', a => a.report.roundtrip.semanticExact = true],
    ['unrestored storage', a => a.report.storage[FORMAL_KEYS[0]] = false],
    ['wrong source', a => a.report.source.codeFingerprint = '32eaa57b'],
  ]) {
    const a = structuredClone(value); change(a);
    tests.push([name + ' rejected', !auditInputArtifact(a, JSON.stringify(a)).ok]);
  }
  console.log(JSON.stringify({ scope: 'local helper checks, not browser gameplay regression',
    ok: tests.every(t => t[1]), tests }, null, 2));
  if (tests.some(t => !t[1])) process.exitCode = 1;
}
if (typeof process !== 'undefined' && process.versions?.node) {
  const { pathToFileURL } = await import('node:url');
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await cli(); } catch (e) { console.error(String(e)); process.exitCode = 1; }
  }
}
