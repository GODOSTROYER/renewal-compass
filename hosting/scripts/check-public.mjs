/**
 * Single read-only smoke check of the submitted publication. No credentials,
 * note writes, raw organizer calls, or assumptions about event arrivals.
 */
import assert from 'node:assert/strict';
const origin = 'https://renewal-compass-crm.tarun-aditya.chatgpt.site';
const hasAllActionSources = process.argv.includes('--require-action-sources');
const opts = { redirect: 'error', signal: AbortSignal.timeout(15_000) };
const [page, response] = await Promise.all([
  fetch(origin, opts),
  fetch(new URL('/api/account-snapshot', origin), {
    ...opts, headers: { Accept: 'application/json' },
  }),
]);
assert.equal(page.status, 200, 'Public dashboard does not open');
assert.match(await page.text(), /<title>Renewal Compass(?: [^<]*)?<\/title>/i);
assert.equal(response.status, 200, 'Public snapshot does not load');
const data = await response.json();
assert.equal(data.mode, 'live', 'Public submission must not use sample data');
assert.equal(data.accounts.length, 2, 'Both assigned accounts must appear');
assert.ok(data.syncHealth, 'Expected reviewer sync metadata');
const result = data.accounts.map((a) => {
  const scope = new Set((a.evidence ?? []).map((x) => x.id));
  const book = a.bookValue ?? {};
  assert.ok(Number.isFinite(book.amount) && book.currency, 'Contract value must be typed');
  assert.ok(book.evidenceIds?.length && book.evidenceIds.every((id) => scope.has(id)),
    'Book references must be in this account');
  const actions = (a.recommendation?.actions ?? []).slice(0, 3);
  assert.equal(actions.length, 3, 'Expected three actionable ranked moves');
  assert.ok(actions.every((x) => x.owner && x.deal && x.success), 'Each move needs an owner, deal, and closure test');
  const sourcedActions = actions.filter((x) => x.evidenceIds?.length && x.evidenceIds.every((id) => scope.has(id))).length;
  if (hasAllActionSources) assert.equal(sourcedActions, 3, 'Every ranked move needs an exact in-account source');
  assert.ok((a.notes ?? []).every((n) => !Object.hasOwn(n, 'body') && !Object.hasOwn(n, 'text')), 'Reviewer must not receive note bodies');
  return { account: a.id, currency: book.currency, book: book.amount, sourcedActions, signals: a.signals?.length ?? 0 };
});
console.log(JSON.stringify({ syncStatus: data.syncStatus, signalState: data.syncHealth.signalState,
  signalCheckedAt: data.signalCheckedAt, accounts: result }, null, 2));
if (data.syncHealth.signalState === 'fresh-empty') console.log('Successful empty check; no newly arrived event demonstrated.');
if (data.syncStatus === 'stale') console.warn('Saved snapshot only. Separated from a successfully refreshed feed.');
