# Reviewer proof path

## Two-minute evaluation

1. Open https://renewal-compass-crm.tarun-aditya.chatgpt.site. Check whether the board identifies sample data or organizer-backed data before interpreting counts.
2. Inspect freshness and pending/stale signals. A zero count is not evidence of no risk if the feed is pending or stale.
3. Open an account and follow the recommendation, supporting source IDs, and paperwork gaps. Recommendations are decision support, not verified customer outcomes.
4. Compare an account with the board priorities. Check that incomplete evidence is visible rather than represented as certainty.
5. Do not attempt a note write during a read-only evaluation. Notes are operator-controlled; displayed note status is not proof of an organizer write.

The URL is a deployed snapshot, not proof that the latest Git revision is deployed. Record the evaluated commit and deployment revision separately. Never include credentials, raw organizer responses, private plans, or customer snippets in a review screenshot or repository issue.

## Reproduce without credentials

From the repository root (the hosting source lives in `hosting/`):

```sh
cd hosting
node --version
node scripts/build.mjs
node --test worker/runtime.test.mjs
python3 -m http.server 8000 --directory crm --bind 127.0.0.1
```

Use a current Node.js release with built-in `fetch`, `Request`, and the test runner (Node 22 recommended). Open http://127.0.0.1:8000. Stop the server with Ctrl+C. This is a synthetic, static UI preview, not an emulation of D1, Site authentication, or live synchronization. No Player Token is required. A browser console request for `/config.js` may be absent in the static source; the Worker injects production configuration at build time.

To build the deployment artifact, run `node scripts/build.mjs` from `hosting/`. It replaces `dist/`, validates the exported fetch handler, embeds the browser assets, and copies hosting metadata and migrations. Building does not deploy, migrate a database, schedule refreshes, or submit an entry.

## What the tests prove, and do not prove

Run `node --test worker/live-loop.test.mjs` separately for an isolated synthetic organizer empty → new event → sourced first move → deduplication → stale-cache recovery check against the assembled Worker.

`worker/runtime.test.mjs` exercises the runtime with mocked upstream responses and database behavior. Passing tests are useful regression evidence, not a live organizer integration certification. Inspect the test output for the exact covered cases and failures. A static preview does not exercise the Worker security boundary.

Live verification needs an authorized runtime secret, a D1 binding and applied schema, an intentional review access mode, and the deployed revision. Configure these through the hosting service, never in browser code or committed files. Organizer rate limits and shared credential use remain operational constraints. Do not run ad hoc organizer calls concurrently with the deployed Worker.

## Submission boundary

This repository and deployment are review artifacts. Neither publishing source nor deploying the dashboard confirms competition submission, scoring, live signal completeness, or successful organizer note writes. Submission and organizer mutations require the owner's separate authorization. Never paste a token into a README, URL, screenshot, chat transcript, or shell example.

## One-command public check

From `hosting/`, run `node scripts/check-public.mjs --require-action-sources`. This checks the existing public URL once without a login and confirms both accounts, exact in-account sources on the ranked moves, and the public note-body boundary. The output identifies stale, successfully empty, or signal-present data without treating any of them as proof that a new event arrived. It never calls the organizer directly or writes a note.
