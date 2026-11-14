# Renewal Compass — Sites Worker

This wrapper serves the audited CRM UI and synchronizes with the organizer's documented MCP. It never sends a Player Token or raw MCP cache to the browser. Default deployment serves synthetic fixture data until reviewer mode is explicitly configured.

## Check and package

Copy `.openai/hosting.example.json` to `.openai/hosting.json` and set your own hosting project ID. Run `node scripts/build.mjs` followed by `node --test worker/runtime.test.mjs`. The build uses Node only and embeds the exact allowlisted browser assets under `crm/` in a Cloudflare Worker ES module. The production artifact is `dist/server/index.js`; `dist/.openai/hosting.json` declares the D1 `DB` binding and `dist/.openai/drizzle/` contains the schema migration. Use the Sites source/version workflow with the exact project and pushed revision; never publish runtime data in Git.

## Runtime configuration (names only)

- `AQ_TOKEN`: organizer's credential, a private runtime secret; do not use any other copy of this credential concurrently with the live Worker.
- `AQ_REVIEW_MODE`: unset keeps this a sample site, `site-authenticated` requires authenticated Site requests, and `normalized` permits anyone with access to the deployed URL to view the minimized fictional read model. Enable the latter only for the authorized judging audience.
- `AQ_ADMIN_KEY`: optional independent runtime secret for intentional note writes and trusted scheduled refresh. Never reuse the organizer token for this.
- `AQ_PRIVATE_PLAN`: optional private JSON configuration for known event-specific strategies. Install only via runtime configuration when authorized; no source inclusion. The generic fallback still works without it.

- `AQ_PLAN_A` / `AQ_PLAN_B`: optional server-only account plans, applied only when their exact account name matches.

## Live limits and boundaries

While the dashboard is open, it polls the cached endpoint. In the Worker, `waitUntil` attempts an organizer refresh when needed. All users, refreshes and note writes share a D1 atomic 61-second reservation, committed before the network call. Upstream failures never release that slot early. On first deployment, the board may take several minutes to fetch accounts, signals, and each paperwork set. The browser marks missing signal checks pending and old checks stale.

There is no timer after viewers leave. An approved unattended service can call the authenticated `POST /api/admin/refresh` route if independently configured; none is included. Note writes require the separate admin key and explicit operator action; no automatic retries. The reviewer board exposes note title/status, not note body. Contract and email source IDs remain visible but raw snippets do not. The externally visible board still contains fictional organizer account claims and ranked recommendations, so review the deployed access policy before sharing.
