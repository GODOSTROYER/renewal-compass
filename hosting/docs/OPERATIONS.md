# From account evidence to an operator decision

This guide describes a human review process. It neither configures an unattended refresh nor authorizes a mutation.

## Decide what can safely happen next

1. **Identify the context.** Confirm sample versus organizer-backed mode, the selected account, and feed freshness. A stale brief can support preparation, but not a claim that nothing changed.
2. **Inspect the exact source.** Open the first move's account-local source IDs. Distinguish reported claims, verified records, and indexed files whose contents were not retrieved. Stop if a link is missing or points to another account.
3. **Check the constraint.** A closed, locked, declined, or expired proposal is not reopened by a recommendation. If the move requests future research, keep that scope. A title does not establish signing authority.
4. **Validate ownership and time.** Confirm the person responsible and completion test. Separate game/scenario timing from feed-arrival time, CRM observation time, and proposed calendar checkpoints. Do not describe a proposed checkpoint as a customer commitment.
5. **Prepare the handoff.** Use **Copy next move**, inspect its draft, and review recipients separately. Copying sends nothing and creates no task or booking. A human must decide whether to send or schedule it.
6. **Handle gaps explicitly.** For a new sparse account, ask for contract value, buying roles, paperwork, and exact timing as needed. Unknown is not zero. Preserve the provisional label until the evidence supports a stronger decision.

## If synchronization is incomplete

A successful empty signal check and a failed or stale check are different states. Preserve the last good brief after failure. Do not repeatedly refresh or run a second tool with the organizer credential to force an update: the deployment shares an upstream reservation across readers and authorized writes. Roster and paperwork discovery can take multiple slots. Investigate configuration and deployment logs through the authorized hosting workflow, without copying secrets or raw cache into an issue.

## Release gates

Run from `hosting/` in the public repository, or from the root of a standalone hosting checkout.

1. Build and run the local verification commands in [the README](../README.md). The build replaces `dist/`; run build-dependent suites sequentially.
2. Review the source diff and access mode. The public example manifest is for local validation, not a production deployment configuration. Use the real D1 binding, applied migrations, and intentional reviewer access mode through the hosting service.
3. Record the source commit and compiled release fingerprint. A source push and a deployment are separate operations; neither submits a competition entry.
4. After an independently authorized deployment, compare its saved public response with the local artifact using `node scripts/verify-release.mjs /path/to/saved-snapshot.json`. A missing or different fingerprint is a failed identity gate, not permission to rewrite the evidence.
5. If a public smoke check is needed and authorized, run it once with the expected roster minimum. Keep the JSON result and observation time private where appropriate. Do not continuously poll the check script.

## Notes and irreversible assumptions

Reviewers should not use note writes to test the board. An intentional organizer note requires separate operator authentication and the owner's authorization for the specific content. There is no automatic mutation retry. If acknowledgment is ambiguous, inspect the outcome through the authorized workflow before any retry. A displayed reviewer note status does not independently certify an organizer write. Never put a Player Token, operator key, raw customer document, or private plan into a note, handoff, repository, screenshot, or URL.
