# Compare two saved public observations

Run from the hosting source directory with Node 22+:

```sh
node --test scripts/compare-public.test.mjs
node scripts/compare-public.mjs /path/to/before.json /path/to/after.json
```

The optional CLI reads local JSON files only. It does not fetch, authenticate, refresh the organizer, write notes, or alter either input. Keep saved observations outside the public checkout when they contain private account details. The report includes the input SHA-256 digests, ordered account/signal IDs, linked action source IDs, and a machine-readable `ok`; exit code 1 means the comparison is not admissible.

Both inputs must be live read models from the same identified release, with successful signal checks in forward order and fresh-at-observation feed states. Stale, failed, pending, mismatched-release, malformed-reference, duplicate-identity, and note-body exposure cases fail closed. The CLI does not prove that saved files are authentic or current now, and does not compare their timestamps with today's wall clock. Use the separate release verifier to compare a saved fingerprint to the built artifact.

A new ID present only in the second file is **not automatically a new event**. `first-observed-id-after-baseline` requires the Worker's explicit observation state, a shared baseline, a previously present account, and a first observation between the two successful checks. Known-ID reappearances and same-ID content changes are separate classifications. Without the observation trail the result remains unproven. A new roster account and its paperwork-clock transition are reported separately; a successful paperwork check does not certify document contents or deal readiness.

Organizer scenario dates and arrival fields are copied as labeled fields, not interpreted as publication times. `organizerPublicationProven` is always false. A missing ID means absent from the later saved feed, not resolved. Changed ranked actions or linked source IDs do not prove that a customer action happened, that a proposal reopened, or that a task was sent. No organizer-publication or action-completion claim can be established by this comparison alone.
