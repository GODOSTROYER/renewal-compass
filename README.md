# Renewal Compass

An evidence-first CRM for the customer-success manager walking into Monday. For each assigned account, see what is worth protecting, who can move it, the next three actions, what could slip, and who can close each evidence gap.

**[Open the judge dashboard](https://renewal-compass-crm.tarun-aditya.chatgpt.site)** · **[Two-minute review guide](hosting/docs/REVIEW.md)** · **[Hosted implementation](hosting/README.md)**

### Start here

1. Open an assigned account and follow the annual contract value to its direct source. Invoice totals, game commitments, and annual contract values are distinct and never added together.
2. Read the three ranked actions. A proposed verification checkpoint is not a contractual deadline. The source trail explains which facts are supported and which still need checking.
3. Switch accounts and check the freshness badge and the selected account’s paperwork timestamp. A successful check with no new events is different from a stale feed. The dashboard retains and labels its last verified snapshot on a temporary upstream failure.

### Run and test

This Node 20+ repository has no package-install step. For a safe, local sample, serve the hosted UI on loopback:

```sh
cd hosting
python3 -m http.server 8314 --bind 127.0.0.1 --directory crm
```

Open `http://127.0.0.1:8314` in sample mode. To verify the exact production adapter, stop the preview as needed and run:

```sh
node scripts/build.mjs
node --test worker/runtime.test.mjs scripts/check-public.test.mjs scripts/compare-public.test.mjs
node --test worker/live-loop.test.mjs
```

From repository root, `node --test *.test.mjs` covers the alternative Node backend and its independent reasoning tests. Optional browser QA (requires Playwright with Chromium): from `hosting/`, run `node tests/manager-readiness-ui.cjs`. That test uses isolated synthetic data, not organizer credentials.

### Deployment boundaries

The hosted adapter is a Cloudflare Worker with a D1 cache. It keeps organizer credentials server-side and uses a single shared call budget across refresh and approved writes. Public viewers see the minimized read model, not raw organizer source files or note bodies. The reviewer page is read-only. A separate operator authorization is needed to write a note. See [operating facts and limits](hosting/README.md) for the current refresh path and [verification guide](hosting/docs/REVIEW.md) for how to tell a genuine new event from fixture, replay, or a successful empty check.

The root-level Node server is an alternative deployment, not the submitted service. Do not publish local discovery files, private plan settings, raw caches, or credentials.

### Historical judge proof · 14 November 2026

The submitted service was verified without sign-in at 10:16 UTC on Worker revision `03e0dd2`: both books (£350,000 and €140,000), six evidence-backed decision constraints, and the same two known organizer signals reappearing in the feed. This is observed feed recovery, not two new arrivals. The production response fingerprint matched the locally built Worker and assets. Proposed checkpoints are not customer deadlines.

- **Eastern Counties:** open Account brief → Exact sources. `paperwork:A/profile.json` backs the annual book. `fo_dpia_2` identifies the missing-document blocker; `srv_dataflow` is the engineering handoff. The first move is delivering the pack and getting Fatima to confirm receipt and the DPIA decision date.
- **Aldermoor:** `paperwork:B/profile.json` backs the annual book. `ba_deputy_0` identifies continuity risk; the first move is documenting the deputy's rollout and naming a backup who can reproduce one rollout. The deputy's exact departure date remains unverified.

To reproduce the public acceptance checks, run `node scripts/check-public.mjs --require-action-sources` from `hosting/`. For a separate synthetic end-to-end ingestion check, run `node --test worker/live-loop.test.mjs`. It rebuilds the Worker and proves a synthetic signal can change an exact sourced first action, without contacting the organizer.

### The Monday handoff

Select either account and use **Copy next move** to take the verification task, owner, dates with their basis, success test, and source IDs into your own workflow. It does not send or assign anything. The decision constraint tells you what to avoid until evidence is in. The timeline labels scenario, feed, and CRM observation clocks separately. The observation trail is not evidence that the organizer published a new event or resolved a risk.

The [judge-window refresh workflow](.github/workflows/questathon-refresh.yml) is configured to make a single unauthenticated request on a best-effort cadence, ending with the judging window. A committed workflow alone does not establish successful scheduling, consistent cadence, or event delivery.

Risk cards show the next move only when the account’s evidence uniquely supports the match. Exact duplicates are combined without merging distinct clocks, causes or actions. The same rule is tested on an unseen synthetic account.

A copied action preserves missing, pending, or stale evidence warnings, signal check time, and selected-account paperwork time. The next owner should recheck before committing. The temporary independent judging check and GitHub workflow are bounded to the judging window. After the window, use **Refresh data** or open the dashboard to request the next eligible check; there is no native always-on scheduler.

See the [operator guide](hosting/docs/OPERATIONS.md) for scope, refresh failures, and release identity verification.

### Compare evidence without guessing

In the CRM, **Why this move** explains the actual ranking and compares the first action and its sources with the first time you viewed that account in this tab. It is not a shared handoff log or organizer event history. Reloading starts a new baseline.

For a repeatable review, run `node scripts/compare-public.mjs before.json after.json` from `hosting/` using two saved observations with successful checks from the same release. [How to read the comparison](hosting/docs/OFFLINE-COMPARISON.md). The comparator separates roster and paperwork changes from unchanged, edited, first-observed or reappearing signal IDs; it never certifies organizer publication.

### Newly assigned accounts

The roster refresh accepts organizer-assigned additions without code changes or guessed account IDs. The browser labels new-account paperwork and missing proof explicitly; old account data stays available. To verify an expanded publication, run `node scripts/check-public.mjs --min-accounts=3` from `hosting/`. The third-account regression uses synthetic data and does not establish that the organizer has assigned a third account to this player.
