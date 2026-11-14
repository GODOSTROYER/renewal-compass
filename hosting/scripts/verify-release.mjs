/**
 * Offline audit of a saved public snapshot plus the local Worker.
 * Usage: node scripts/verify-release.mjs /path/to/snapshot.json
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

if (!process.argv[2]) {
  console.error('Pass a saved reviewer snapshot JSON file. No fetch is performed.');
  process.exit(2);
}
const bytes = await readFile(process.argv[2]);
const snapshot = JSON.parse(bytes);
const bundle = await readFile(new URL('../dist/server/index.js', import.meta.url));
const {workerWith} = await import('data:text/javascript;base64,' + bundle.toString('base64'));
const results = [];
function check(name, fn) {
  try { fn(); results.push({name, pass: true}); }
  catch (e) { results.push({name, pass: false, error: e.message}); }
}
const digest = (data) => createHash('sha256').update(data).digest('hex');
const sourceFingerprint = bundle.toString('utf8').match(/^const RELEASE_FINGERPRINT="([a-f0-9]{64})";\n/);
const reconstructed = sourceFingerprint ? digest(bundle.subarray(Buffer.byteLength(sourceFingerprint[0]))) : null;

check('saved organizer snapshot is not a fixture', () => {
  assert.equal(snapshot.mode, 'live');
  assert.ok(Array.isArray(snapshot.accounts) && snapshot.accounts.length);
});
check('local fingerprint corresponds to the compiled Worker and assets', () => {
  assert.ok(sourceFingerprint, 'Rebuild the Worker first');
  assert.equal(sourceFingerprint[1], reconstructed, 'Compiled bundle digest mismatch');
});
check('saved public snapshot identifies the same build', () => {
  assert.ok(reconstructed, 'No local build identity');
  assert.equal(snapshot.releaseFingerprint, reconstructed, 'Snapshot comes from a different or unidentified release');
});
for (const account of snapshot.accounts ?? []) {
  const ledger = new Set((account.evidence ?? []).map(e => e.id));
  const scoped = ids => Array.isArray(ids) && ids.length && ids.every(id => ledger.has(id));
  check(account.id + ' · source scope and disambiguated dates', () => {
    assert.equal(ledger.size, account.evidence.length, 'Duplicate evidence IDs');
    if (Number.isFinite(account.bookValue?.amount)) assert.ok(scoped(account.bookValue.evidenceIds), 'Booked number has no scoped source');
    for (const action of account.recommendation?.actions ?? []) {
      if (action.evidenceIds?.length) assert.ok(scoped(action.evidenceIds), 'Cross-account action source');
      if (action.decisionConstraint) assert.ok(scoped(action.decisionConstraint.evidenceIds), 'Unsupported decision constraint');
      if (action.proposedCheckpoint) {
        assert.match(action.proposedCheckpoint.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(action.proposedCheckpoint.basis, 'Proposed date requires a planning basis');
        if (action.proposedCheckpoint.evidenceIds?.length) assert.ok(scoped(action.proposedCheckpoint.evidenceIds));
      }
    }
  });
  check(account.id + ' · reviewer redaction', () => {
    for (const note of account.notes ?? []) {
      assert.equal(Object.hasOwn(note, 'body'), false);
      assert.equal(Object.hasOwn(note, 'text'), false);
    }
    for (const entry of account.evidence ?? []) {
      if (['Organizer paperwork / contract','Organizer signal attachment / email'].includes(entry.source)) {
        assert.equal(Object.hasOwn(entry, 'claim'), false, 'Raw document preview is not permitted');
      }
    }
  });
}

const worker = workerWith({upstreamFetch: () => {throw Error('This verifier does not use networks');}});
const get = path => worker.fetch(new Request('https://local-verification.invalid' + path), {}, {waitUntil() {}});
const [live, fixtureQuery, note] = await Promise.all([
  get('/api/account-snapshot'), get('/api/account-snapshot?mode=fixture'), get('/api/admin/write-note'),
]);
check('local Worker is fail-closed when an organizer reviewer session is not configured', () => {
  assert.equal(live.status, 403);
  assert.equal(fixtureQuery.status, 403);
  assert.equal(note.status, 401);
});
const ok = results.every(x => x.pass);
console.log(JSON.stringify({ok, scope:'saved observation and local Worker only', networkRequests:0,
  snapshotSha256:digest(bytes), signalCheckedAt:snapshot.signalCheckedAt, buildFingerprint:reconstructed, results}, null, 2));
if (!ok) process.exitCode = 1;
