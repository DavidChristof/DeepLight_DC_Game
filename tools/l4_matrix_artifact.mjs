// L4 development evidence only. No production imports or storage writes.
export const FORMAL_KEYS = ['deep-light-saves-v2', 'deep-light-settings-v1', 'deep-light-ui-v1'];
export const POLICIES = ['supply', 'return', 'onsite'];
export function digest(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function auditMatrix(report) {
  const fails = [];
  const need = (ok, path) => { if (!ok) fails.push(path); };
  need(report?.sourceHash === '790a3093', 'sourceHash');
  need(report?.codeFingerprint === '4b01428d', 'codeFingerprint');
  need(!report?.error, 'report.error');
  need(Array.isArray(report?.runs) && report.runs.length === 6, 'runs.length');
  for (const k of FORMAL_KEYS) need(report?.storage?.[k] === true, 'storage.' + k);
  const runs = Array.isArray(report?.runs) ? report.runs : [];
  runs.forEach((r, i) => {
    const p = 'runs[' + i + '].';
    if (!r || typeof r !== 'object') { need(false, p + 'record'); return; }
    need(r.policy === POLICIES[Math.floor(i / 2)] && r.repeat === i % 2 + 1, p + 'policy/repeat');
    need(!r.partial, p + 'partial');
    need(r.initial && r.end && Array.isArray(r.initial.chunks) && Array.isArray(r.end.chunks), p + 'fullSnapshots');
    need(!!r.initial && r.initialHash === '5479c839' && digest(JSON.stringify(r.initial)) === r.initialHash, p + 'initialHash');
    need(!!r.end && typeof r.endHash === 'string' && digest(JSON.stringify(r.end)) === r.endHash, p + 'endHash');
    need(equal(r.initial, runs[0]?.initial), p + 'commonInitial');
    need(Array.isArray(r.commands) && r.commands.length > 0, p + 'commands');
    need(Array.isArray(r.daily) && r.daily.length > 0, p + 'daily');
    need(Number.isInteger(r.steps) && r.steps > 0 && r.steps <= 80000, p + 'steps');
    need(Number.isInteger(r.rngCalls) && r.rngCalls >= 0, p + 'rngCalls');
    const duration = 400 * (r.endAt?.day - r.start?.day) + r.endAt?.t - r.start?.t;
    need(Number.isFinite(duration) && duration >= 1200 && duration <= 1200.41, p + 'threeWorldDays');
    need(r.roundtripExact === true && Array.isArray(r.roundtripDifferences) && r.roundtripDifferences.length === 0, p + 'roundtrip');
    for (const key of ['menu', 'after']) {
      need(r[key]?.ok === true && r[key].ran === 86 && Array.isArray(r[key].fails) && r[key].fails.length === 0, p + key);
    }
  });
  const same = {};
  for (let i = 0; i < POLICIES.length; i++) {
    const a = runs[i * 2], b = runs[i * 2 + 1], policy = POLICIES[i];
    same[policy] = !!a && !!b && equal(a.initial, b.initial) && equal(a.end, b.end)
      && equal(a.commands, b.commands) && a.rngCalls === b.rngCalls;
    need(same[policy] && report?.same?.[policy] === true, 'repeat.' + policy);
  }
  return { ok: fails.length === 0, fails, runs: runs.length, same,
    source: report?.sourceHash, code: report?.codeFingerprint };
}
export function makeArtifact(report) {
  const audit = auditMatrix(report);
  if (!audit.ok) throw new Error('矩阵结果不完整：' + audit.fails.join(', '));
  // Keep original field/array order and every field, including failure provenance.
  const raw = JSON.stringify(report);
  // Repeated snapshots exceed deflate's 32KiB window. Reference exact repeated
  // JSON substrings, then compress; reconstruction must be byte-for-byte equal.
  const candidates = [...new Set(report.runs.flatMap(r =>
    ['initial', 'end', 'commands', 'daily', 'crew'].map(k => JSON.stringify(r[k]))))]
    .filter(s => s && s.length >= 256).sort((a, b) => b.length - a.length);
  const dictionary = [], parts = [raw];
  for (const text of candidates) {
    const count = parts.reduce((n, p) => n + (typeof p === 'string' ? p.split(text).length - 1 : 0), 0);
    if (count < 2) continue;
    const ref = dictionary.push(text) - 1, next = [];
    for (const p of parts) {
      if (typeof p !== 'string') { next.push(p); continue; }
      const split = p.split(text);
      split.forEach((s, i) => { if (i) next.push(ref); if (s) next.push(s); });
    }
    parts.splice(0, parts.length, ...next);
  }
  const artifact = { format: 'l4-matrix-results-v1', dictionary, parts, reportHash: digest(raw), audit };
  if (reportTextOf(artifact) !== raw) throw Error('结果字典无损重建失败');
  return artifact;
}
export function reportTextOf(value) {
  if (typeof value?.reportText === 'string') return value.reportText;
  if (!Array.isArray(value?.parts) || !Array.isArray(value?.dictionary)
    || !value.dictionary.every(s => typeof s === 'string')) throw Error('invalid report parts');
  return value.parts.map(p => {
    if (typeof p === 'string') return p;
    if (Number.isInteger(p) && p >= 0 && p < value.dictionary.length) return value.dictionary[p];
    throw Error('invalid dictionary reference');
  }).join('');
}
export function auditArtifact(value) {
  if (value?.format !== 'l4-matrix-results-v1') {
    return { ok: false, fails: ['artifact.format/reportText'] };
  }
  let report, raw;
  try { raw = reportTextOf(value); report = JSON.parse(raw); }
  catch { return { ok: false, fails: ['artifact.JSON'] }; }
  const audit = auditMatrix(report);
  if (digest(raw) !== value.reportHash) audit.fails.push('artifact.reportHash');
  audit.ok = audit.fails.length === 0;
  return { ...audit, reportHash: value.reportHash };
}

async function cli() {
  const { readFile } = await import('node:fs/promises');
  const { inflateSync } = await import('node:zlib');
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') {
    // Negative tests only: these never claim a fabricated matrix is real evidence.
    const tests = [
      ['empty matrix rejected', !auditMatrix({}).ok],
      ['missing runs rejected', auditMatrix({ runs: [] }).fails.includes('runs.length')],
      ['invalid artifact rejected', !auditArtifact({}).ok],
      ['invalid JSON rejected', !auditArtifact({ format: 'l4-matrix-results-v1', reportText: '{' }).ok],
      ['array order preserved', !equal([1, 2], [2, 1])],
      ['object keys normalized', equal({ b: 2, a: 1 }, { a: 1, b: 2 })],
      ['field removal detected', !equal({ fuel: 1, food: 2 }, { fuel: 1 })],
      ['unicode hash deterministic', digest('灯😀') === digest('灯😀')],
      ['exact dictionary reconstruction', reportTextOf({dictionary:['😀'],parts:['a',0,'b',0]}) === 'a😀b😀'],
      ['invalid dictionary reference rejected', !auditArtifact({format:'l4-matrix-results-v1',dictionary:[],parts:[0]}).ok],
    ];
    if (args[1]) {
      const input = await readFile(args[1], 'utf8');
      const raw = args[1].endsWith('.b64') ? inflateSync(Buffer.from(input, 'base64')).toString('utf8') : input;
      const artifact = JSON.parse(raw), checked = auditArtifact(artifact);
      if (!checked.ok) throw Error('不能用无效结果做变异检查：' + checked.fails.join(','));
      const report = JSON.parse(reportTextOf(artifact));
      for (const [name, change] of [
        ['missing full snapshot', r => delete r.runs[0].end],
        ['changed end state', r => r.runs[0].end.res.fuel++],
        ['changed command', r => r.runs[1].commands[0].step++],
        ['changed RNG count', r => r.runs[1].rngCalls++],
        ['failed roundtrip', r => r.runs[0].roundtripDifferences.push({path:'fuel'})],
        ['unrestored formal key', r => r.storage[FORMAL_KEYS[0]] = false],
        ['incomplete world duration', r => r.runs[0].endAt.t -= 2],
        ['missing sixth run', r => r.runs.pop()],
      ]) {
        const changed = structuredClone(report); change(changed);
        tests.push([name + ' rejected', !auditMatrix(changed).ok]);
      }
      const changed = structuredClone(artifact); changed.reportHash = '0';
      tests.push(['wrong whole report hash rejected', !auditArtifact(changed).ok]);
    }
    console.log(JSON.stringify({ scope: 'artifact helper negative/unit checks, NOT browser acceptance',
      ok: tests.every(([, pass]) => pass), tests }, null, 2));
    if (tests.some(([, pass]) => !pass)) process.exitCode = 1;
    return;
  }
  if (!args[0]) throw Error('Usage: node tools/l4_matrix_artifact.mjs <results.deflate.b64|results.json>');
  const input = await readFile(args[0], 'utf8');
  const raw = args[0].endsWith('.b64') ? inflateSync(Buffer.from(input.trim(), 'base64')).toString('utf8') : input;
  const result = auditArtifact(JSON.parse(raw));
  console.log(JSON.stringify({ ...result, bytes: Buffer.byteLength(raw, 'utf8'), file: args[0] }, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (typeof process !== 'undefined' && process.versions?.node) {
  const { pathToFileURL } = await import('node:url');
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await cli(); } catch (e) { console.error(String(e)); process.exitCode = 1; }
  }
}
