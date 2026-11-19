# PT-17 — Telemetry privacy and diagnostic redaction

> **Status: draft scope charter only.** This file reserves the grouped PR scope before implementation. It is not a privacy approval, Worker deployment, or captured-production-log attestation. Remove or replace it with the real implementation record before marking this PR ready or mergeable.

## Issues in this PR

- #560 — Define privacy-approved telemetry and sensitive-log redaction
- #630 — Enforce and test Worker provider-metric log field allowlist

## Intended outcome

Unify the narrow Worker provider-metric allowlist work with the broader telemetry/privacy controls, while keeping implementation and deployment lanes separate where required.

## Scope and delivery boundary

1. Inventory browser, Pages, Worker, Durable Object, and third-party sinks. Obtain owner approval for purpose, field allowlist, retention, sampling, access, and deletion **before enabling new telemetry collection**.
2. Verify provider metrics preserve only the approved event/provider/duration/success semantics and allowlisted scalar fields. Captured success/cache/failure and auth-edge logs must exclude ticker, account identifiers, API keys, credentials, URLs, bodies, arbitrary errors, and provider payloads.
3. Verify Worker/DO exception diagnostics use fixed categories rather than serializing arbitrary exception data. Include captured-log tests for auth, provider, cache, and error paths.
4. Preserve the existing boundary: Worker/DO-only code is delivered directly to `main` and must have exact-SHA deployment evidence. This `dev` PR may carry client-side or documentation changes only; it must not re-route backend deployment through a frontend PR.
5. Add bounded, non-identifying correlation only after privacy approval, with tested sampling, access, retention, and deletion controls.

## Non-negotiable invariants

- No credentials, tokens, IPs, account IDs, tickers, full URLs, raw provider payloads, or financial snapshots in diagnostic fields.
- No new collection or broadened telemetry before explicit privacy approval.
- Do not claim Worker source commits are production deployed without exact-main SHA and successful deployment workflow evidence.

## Acceptance evidence required before ready

- Complete sink inventory and approved telemetry policy.
- Captured-log redaction tests and exact-head security/CI results.
- If Worker code changes, a separate direct-to-main deployment record with exact SHA and workflow result.
- Clear separation of implementation, privacy approval, and production verification status.
