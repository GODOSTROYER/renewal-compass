# AI reviewer path · contract v1

Start with this guide, then [the human proof path](REVIEW.md). The read-only deployed read model is `GET /api/account-snapshot` on the dashboard origin linked in that guide. Request it once when authorized; do not call the organizer, supply credentials, refresh in a loop, or attempt an operator write. Reading the deployed route can trigger the Worker's normal rate-limited synchronization. For an offline review, use an already saved response instead.

## Contract and example

[Reviewer snapshot schema v1](reviewer-snapshot.schema.json) is a JSON Schema 2020-12 contract, identified as `urn:renewal-compass:reviewer-snapshot:1`. This versions the review contract, not the deployed response: the response currently has no `schemaVersion` field. Additional fields may appear. [The complete synthetic example](reviewer-snapshot.example.json) conforms to this schema and is explicitly `mode: fixture`. It requires no private plan, organizer response, credentials, or network access. It must never be presented as a live account or used to pass the public-production smoke check.

Core joins are `account.id`, account-local `evidence[].id`, and each action's `evidenceIds`. A reference must resolve within the same account. A record without a public `claim` may be indexed, withheld, or redacted; its presence does not prove its contents. An explicitly labeled organizer file index is not a document inspection. A nonempty claim can still be merely stakeholder-reported, stale, contradicted, or wrong. `confidence` is a source label, not a numeric probability. A job title, relationship, source reference, or successful game result does not establish signing authority.

## Review in this order

1. Check `mode`, `releaseFingerprint`, `syncStatus`, `syncHealth.signalState`, `signalCheckedAt`, and the selected account's `syncHealth.paperworkCheckedAt`. Missing or invalid timestamps mean unknown. `sourceAt` is roster provenance, not proof every account's paperwork is current. A fresh-empty feed differs from pending, failed, or stale data. A saved response is not independently proven fresh now.
2. Read `bookValue` and its exact sources. Keep annual contracted value and currency separate from invoice totals, modeled savings, opportunity values, and `gameValue`. Unknown amounts are `null`, never assumed zero.
3. Rank `recommendation.actions` exactly as the UI does: ascending integer `move` (missing sorts last), then descending `urgency` (missing means zero), retaining received order on ties. Inspect the first three without assuming later actions are invalid. Each move needs an action, owner, deal context, completion test, and account-local sources. The structural audit examines these ranked first three.
4. Read the linked claims and their source/confidence labels. Explain how each source changes the decision, who can verify the remaining gap, and what must not be assumed. `decisionConstraint` is a proposed guardrail, not proof an action was attempted. A completion test is not an observed result.
5. Keep game `move`, organizer scenario date, organizer feed arrival, CRM observation timestamps, sourced timing, and `proposedCheckpoint` separate. A proposed checkpoint is an internal verification target, not a customer commitment. Do not reopen locked or expired proposals.
6. Report incomplete buying roles, paperwork, value, and timing explicitly. A sparse newly assigned account is provisional discovery, not a failed request for invented facts. Human handoff uses **Copy next move**; copying creates no task, message, or booking.

## Machine checks and honest interpretation

Run from `hosting/` in the public repository, or the root of a standalone hosting checkout:

```sh
node scripts/build.mjs
node --test worker/runtime.test.mjs scripts/check-public.test.mjs scripts/compare-public.test.mjs tests/sample-data.test.mjs
node --test worker/live-loop.test.mjs
node scripts/verify-release.mjs /path/to/saved-live-snapshot.json
```

The synthetic live-loop rebuilds `dist/`; keep it separate. The offline release verifier needs a saved **live** response from that exact compiled release; the synthetic example is intentionally ineligible. Build/tests do not deploy or submit anything.

The optional public smoke checker is `node scripts/check-public.mjs --require-action-sources`. Its `renewal-compass-structural-audit/1` report uses `structurallyComplete`, `referencedActions`, and `allBriefsStructurallyComplete`, not “fully verified.” `evidenceSupport` separately counts unique referenced records with claims, without a visible claim, explicitly indexed records, and stakeholder-reported claims. `freshness` separately reports clocks, feed state, and later failures. Passing reference checks does not prove facts, buying authority, current freshness, complete ingestion, organizer publication, or completed customer actions.

For two saved states, use [offline comparison](OFFLINE-COMPARISON.md). A newly present ID, a reappearance, an action reorder, and a resolved risk are different claims. Record the reviewed commit and compiled fingerprint; source publication and deployment are separate facts.
