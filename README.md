# Renewal Compass

An evidence-first CRM for the customer-success manager walking into Monday. For each of two accounts, see what is worth protecting, who can move it, the next three actions, what could slip, and who can close each evidence gap.

**[Open the judge dashboard](https://renewal-compass-crm.tarun-aditya.chatgpt.site)** · **[Two-minute review guide](hosting/docs/REVIEW.md)** · **[Hosted implementation](hosting/README.md)**

### Start here

1. Open either account and expand a contract book source. Contract value, invoices, and game commitments are distinct and are never added together.
2. Read the three ranked actions. A proposed verification checkpoint is not a contractual deadline. The source trail explains which facts are supported and which still need checking.
3. Open the second account and check the freshness badge. A successful check with no new events is different from a stale feed. The dashboard retains and labels its last verified snapshot on a temporary upstream failure.

### Run and test

This Node 20+ repository has no package-install step. For a safe, local sample, serve the hosted UI on loopback:

```sh
cd hosting
python3 -m http.server 8314 --bind 127.0.0.1 --directory crm
```

Open `http://127.0.0.1:8314` in sample mode. To verify the exact production adapter, stop the preview as needed and run:

```sh
node scripts/build.mjs
node --test worker/runtime.test.mjs
```

From repository root, `node --test *.test.mjs` covers the alternative Node backend and its independent reasoning tests. Optional browser QA (requires Playwright with Chromium): from `hosting/`, run `node tests/manager-readiness-ui.cjs`. That test uses isolated synthetic data, not organizer credentials.

### Deployment boundaries

The hosted adapter is a Cloudflare Worker with a D1 cache. It keeps organizer credentials server-side and uses a single shared call budget across refresh and approved writes. Public viewers see the minimized read model, not raw organizer source files or note bodies. The reviewer page is read-only. A separate operator authorization is needed to write a note. See [operating facts and limits](hosting/README.md) for the current refresh path and [verification guide](hosting/docs/REVIEW.md) for how to tell a genuine new event from fixture, replay, or a successful empty check.

The root-level Node server is an alternative deployment, not the submitted service. Do not publish local discovery files, private plan settings, raw caches, or credentials.

### Judge proof check · 14 November 2026

The submitted service was verified without sign-in at 10:06 UTC on Worker revision `5c207f4`: both books (£350,000 and €140,000), six evidence-backed decision constraints, and the same two known organizer signals reappearing in the feed. This is observed feed recovery, not two new arrivals. The production response fingerprint matched the locally built Worker and assets. Proposed checkpoints are not customer deadlines.

- **Eastern Counties:** open Account brief → Exact sources. `paperwork:A/profile.json` backs the annual book. `fo_dpia_2` identifies the missing-document blocker; `srv_dataflow` is the engineering handoff. The first move is delivering the pack and getting Fatima to confirm receipt and the DPIA decision date.
- **Aldermoor:** `paperwork:B/profile.json` backs the annual book. `ba_deputy_0` identifies continuity risk; the first move is documenting the deputy's rollout and naming a backup who can reproduce one rollout. The deputy's exact departure date remains unverified.

To reproduce the public acceptance checks, run `node scripts/check-public.mjs --require-action-sources` from `hosting/`. For a separate synthetic end-to-end ingestion check, run `node --test worker/live-loop.test.mjs`. It rebuilds the Worker and proves a synthetic signal can change an exact sourced first action, without contacting the organizer.

### The Monday handoff

Select either account and use **Copy next move** to take the verification task, owner, dates with their basis, success test, and source IDs into your own workflow. It does not send or assign anything. The decision constraint tells you what to avoid until evidence is in. The timeline labels scenario, feed, and CRM observation clocks separately. The observation trail is not evidence that the organizer published a new event or resolved a risk.

The [judge-window refresh workflow](.github/workflows/questathon-refresh.yml) is configured to make a single unauthenticated request on a best-effort cadence, ending with the judging window. A committed workflow alone does not establish successful scheduling, consistent cadence, or event delivery.
