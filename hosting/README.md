# Renewal Compass — Sites Worker

This wrapper serves the evidence-linked CRM UI and synchronizes with the organizer's documented MCP. It never sends a Player Token or raw MCP cache to the browser. Default deployment serves synthetic fixture data until reviewer mode is explicitly configured.

## Check and package

Public checkouts without `.openai/hosting.json` use the public example manifest for local build and test verification only. Configure a real `.openai/hosting.json` through the hosting workflow before deployment; an existing real manifest is copied unchanged.

From this directory, use Node 22 or newer. No package installation or credentials are needed for local verification:

```sh
node scripts/build.mjs
node --test worker/runtime.test.mjs scripts/check-public.test.mjs
node --test worker/live-loop.test.mjs
```

Run the live-loop test separately: it rebuilds `dist/` itself. These commands run local synthetic responses only and do not certify a live organizer integration. For a static UI preview, run `python3 -m http.server 8000 --directory crm --bind 127.0.0.1`, open http://127.0.0.1:8000, then stop with Ctrl+C.

 Run the build first: the tests import the assembled Worker, not its unbundled source. The build uses Node only and embeds the exact allowlisted browser assets under `crm/` in a Cloudflare Worker ES module. The production artifact is `dist/server/index.js`; `dist/.openai/hosting.json` declares the D1 `DB` binding and `dist/.openai/drizzle/` contains the schema migration. Use the Sites source/version workflow with the exact project and pushed revision; never publish runtime data in Git.

## Runtime configuration (names only)

- `AQ_TOKEN`: organizer's credential, a private runtime secret; do not use any other copy of this credential concurrently with the live Worker.
- `AQ_REVIEW_MODE`: unset keeps this a sample site, `site-authenticated` requires authenticated Site requests, and `normalized` permits anyone with access to the deployed URL to view the minimized fictional read model. Enable the latter only for the authorized judging audience.
- `AQ_ADMIN_KEY`: optional independent runtime secret for intentional note writes and trusted scheduled refresh. Never reuse the organizer token for this.
- `AQ_PRIVATE_PLAN`: optional private JSON configuration for known event-specific strategies. Install only via runtime configuration when authorized; no source inclusion. The generic fallback still works without it.

## Live limits and boundaries

While the dashboard is open, it polls the cached endpoint. The Worker tries a rate-limited refresh before answering a stale dashboard request and refreshes an already-current dashboard in the background. As visits allow, it also rechecks the roster and paperwork periodically. A successful empty signal feed is distinguished from a failed or stale check. Invalid upstream payloads do not replace the last valid snapshot. All users, refreshes and note writes share a D1 atomic 61-second reservation, committed before the network call. Upstream failures never release that slot early. On first deployment, the board may take several minutes to fetch accounts, signals, and each paperwork set. The browser marks missing signal checks pending and old checks stale.

There is no timer after viewers leave. An approved unattended service can call the authenticated `POST /api/admin/refresh` route if independently configured; none is included. Note writes require the separate admin key and explicit operator action; no automatic retries. The reviewer board exposes note title/status, not note body. Contract and email source IDs remain visible but raw snippets do not. The externally visible board still contains fictional organizer account claims and ranked recommendations, so review the deployed access policy before sharing.

## Judge quick start and reproducibility

See [the reviewer proof path](docs/REVIEW.md) for a two-minute evaluation, credential-free local preview, exact verification commands, and limits of the evidence. In the public repository this directory is published as `hosting/`; run commands from that directory. No competition submission is performed by the build or test commands.

`AQ_ACTION_EVIDENCE` is an optional account-name and exact-action-text overlay for source links on curated actions. Set it only in runtime configuration. It appends links for already existing actions; the mapper rejects references not in that account's evidence ledger.

`AQ_ACTION_CHECKPOINTS` may add a clearly labeled internal verification date for an existing action that lacks a calendar deadline. It cannot replace organizer timing or an existing checkpoint. Internal targets are not customer commitments or calendar bookings.

## Evolving organizer roster

The organizer roster may grow beyond the original A/B accounts. New accounts must remain visible as provisional discovery when paperwork, value, deadlines or buying authority are not yet verified. Missing values are unknown, not zero; a sparse account is not a fully verified three-action brief.

`node scripts/check-public.mjs --min-accounts=3` performs read-only publication GETs and reports each account's verification level. Add `--require-action-sources` to fail if any reported account has no sourced action. Do not poll this script continuously. `node scripts/verify-release.mjs /path/to/saved-snapshot.json` audits saved publication evidence and the local built Worker offline. Use a saved snapshot from the matching release when checking its build fingerprint; historical snapshots without that marker cannot establish release identity. Account-local source and checkpoint checks apply to the roster present in that saved evidence. Neither command proves a newly arrived real signal or submits an organizer note.

## Operator decision and release workflow

Use [the operator decision guide](docs/OPERATIONS.md) before moving from evidence review to a customer action, runtime change, or release. Reviewers can inspect sources and copy a handoff without writing a note. A successful build, public page, or copied handoff is not a submitted entry, a sent customer message, or proof of a completed action.
