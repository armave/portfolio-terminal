# Global Repository Hardening — Audit and Implementation Record

**Target:** one PR against `main`  
**Primary constraint:** preserve financial semantics, persisted data compatibility, provider integrations, and user workflows.

## Scope and observed baseline

The repository uses Preact, TypeScript, Vite, Vitest, a modular `src/` tree, root-level runtime/compatibility files, and a Cloudflare Worker. Existing CI already runs Node 22, `npm ci`, typecheck, tests, dead-code validation, a production dependency audit, and the production build.

The architecture guide records prior migration work covering canonical portfolio state, quote race protection, persistence rollback, cloud revision conflicts, and terminal cleanup. This PR must verify those invariants against the current head rather than reimplement them blindly.

## Findings and actions

### Fixed in this PR

- **Repository ignore rules:** removed the broad `.github*` ignore pattern. It could hide newly created GitHub Actions workflows, security policies, issue templates, and PR templates from Git. Narrowed Wrangler ignores to local Wrangler artifacts.

### Required audit gates for this PR

1. **Baseline and runtime map**
   - Verify current entry points, scripts, worker deployment, PWA scope, and compatibility shims.
   - Run all merge-gate commands on the same final commit.
   - Do not remove root-level files based only on age or size.

2. **Worker trust boundaries**
   - Check every action for authentication, action-specific method/schema validation, bounded input, and safe upstream handling.
   - Treat CORS as browser policy, not authentication.
   - Verify error responses and telemetry never disclose gateway/provider credentials, raw broker payloads, or account identifiers.
   - Test malformed requests, missing credentials, invalid actions/symbols, upstream failures/timeouts, and cloud revision conflicts.

3. **Portfolio and financial integrity**
   - Keep `PortfolioState.positions` canonical and compatibility views derived.
   - Ensure invalid operations and persistence failures cannot partially mutate balances, debt, tranches, commissions, or closed-trade history.
   - Preserve existing rounding, commission, interest, rollover, and P&L behavior unless a proven defect has explicit regression coverage.

4. **Quotes and cloud synchronization**
   - Ensure stale asynchronous quote results cannot overwrite newer trades or recreate closed positions.
   - Preserve encrypted payload compatibility, local data, revision checks, and explicit conflict handling.
   - Verify concurrent writes and failed persistence/sync behavior.

5. **Architecture and dependencies**
   - Trace `app.ts`, `state-store.js`, `worker.js`, and `src/` call sites before deleting or moving code.
   - Investigate the React/Preact dependency and plugin overlap; remove only packages proven unnecessary by build/test evidence.
   - Consolidate duplicate financial logic only when behavior is equivalent and covered by tests.

6. **CI, release, and documentation**
   - Keep pull-request validation enabled, least-privilege workflow permissions, and deployment restricted to intended events/branches.
   - Verify workflow action pinning before changing versions; do not guess immutable SHAs.
   - Update architecture and operations documentation only after confirming the implementation and deployment configuration.

## Validation commands

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run validate:dead-code
npm audit --omit=dev --audit-level=high
```

Also inspect the final diff, GitHub Actions results for the exact PR head, Worker-specific tests, and representative financial regression outputs.

## Acceptance criteria

- The broad `.github*` ignore rule is gone.
- All required checks are green on the same final commit, or any baseline failure is explicitly evidenced and explained.
- Financial behavior and existing persisted data remain compatible.
- Security fixes are backed by tests; unverified risks are documented rather than marked fixed.
- No secrets, generated artifacts, unrelated features, or accidental deletions are included.
- Documentation matches the final architecture and deployment.

## Verification status

This document records audit scope and implementation requirements. The GitHub API changes alone do not execute the project test suite or constitute a penetration test. Report actual local/CI results before declaring the full audit complete.


## Progress log

### 2026-10-25 — Pass 2: repository and Worker boundary review

**Completed in branch**
- Added gateway tests for missing credentials, wrong X-App-Auth, wrong Bearer credentials, unsupported methods, and unknown actions. The tests assert rejected requests do not call the upstream fetch mock.
- Added tests for invalid provider symbols and declared request bodies over the configured 20 MiB limit, also asserting no upstream request occurs.
- Confirmed the existing PR CI workflow already runs on pull requests and pushes to main, uses Node 22 and npm ci, and runs typecheck, tests, dead-code validation, production dependency audit, and production build. It also declares read-only repository permissions and workflow concurrency cancellation. Avoid duplicating these existing gates without a demonstrated gap.

**Review notes / not yet resolved**
- The Worker maintains module-level provider response, in-flight, and cooldown maps. Response cache entries are capped at 500, but cooldown and in-flight maps need lifecycle review under high-cardinality traffic; cache keys and account isolation must be verified for each provider/action.
- The Worker enforces gateway authentication for non-OPTIONS requests and validates supported actions and symbols. The new tests characterize these expected contracts but have not been executed in this editing session.
- The existing upstream timeout helper keeps cancellation wired through response-body consumption. Continue checking each response parsing path and ensure cancellation/size handling is consistent.
- React/Preact overlap is not yet changed: remove dependencies only after confirming imports, JSX runtime, tests, and production build behavior.
- Financial-state, encrypted cloud sync, and deployment permissions still require targeted review and actual CI results.

**Validation status**
- GitHub PR metadata confirms the working PR is open and draft.
- No local test/build execution has been performed through the GitHub file-editing connector.
- The available workflow-run lookup returned no run for the earlier PR head; verify checks again after the latest commit.
- Do not mark any security finding fixed solely because a regression test has been added.


### 2026-10-25 — Pass 3: streamed request body bound

**Implemented in branch**
- Replaced unbounded `request.clone().arrayBuffer()` inspection with streamed byte counting capped at `MAX_REQUEST_BYTES`.
- The bounded request is reconstructed from at most the configured limit so downstream POST handlers can still parse it. The original `Content-Length` is removed before reconstruction so a stale or forged declared size is not reused.
- Added a regression test for a chunked POST body that exceeds the limit without a `Content-Length` header.

**Security reasoning**
- `Request.clone()` tees the stream; consuming one branch while leaving the original branch unread can buffer data in the other branch. The implementation therefore consumes the original stream, enforces the limit, then rebuilds a bounded request for the handler.
- This is a source-level fix and test addition, not yet a verified runtime result. Confirm Cloudflare Workers' Request/Blob behavior with the Worker test suite and deployment-compatible runtime before considering this closed.

**Still pending**
- Execute Worker tests and the full CI suite; verify a workflow run for the latest commit.
- Continue auditing provider cache isolation/lifecycle, cloud state concurrency, financial invariants, and legacy runtime ownership.


### 2026-10-25 — Pass 4: CI feedback loop

**Observed CI result for commit `128922df79942c5c1d9864cdc505469975bc9a4b`**
- `npm ci`: passed.
- `npm run typecheck`: passed.
- `npm test`: failed on one newly added assertion only. The Worker correctly returned the full descriptive invalid-symbol error; the test incorrectly expected the shorter exact string. The run reported 310 passed tests and 1 failed test across 23 files.
- The chunked oversized-body regression passed in that run, providing runtime evidence that the bounded stream path works in the GitHub Actions Node test environment.
- Build, dead-code validation, and dependency audit were skipped because the test step failed.

**Corrective action**
- Updated the invalid-symbol assertion to match the stable message prefix instead of requiring exact text. This is a test expectation correction; production behavior was not weakened.
- New CI runs should be checked against the latest commit before considering this resolved.


### 2026-10-25 — Pass 5: CI green and pre-body authentication

**Observed CI success**
- For commit `4ea97305656a61ed31f9c9218e77e1aefb41110c`, both the `Validate` and `Pull Request CI` workflows completed successfully.
- Both workflows passed dependency installation, typecheck, tests, dead-code validation, production dependency audit, and production build. This resolves the prior single test assertion failure for that commit.

**Additional security issue found and fixed after that green run**
- Source review found POST body size enforcement was performed before gateway authentication. An unauthenticated caller could therefore make the Worker consume up to the request-body limit before receiving 401.
- Moved gateway-secret validation ahead of POST body reading (while retaining method/origin checks and unauthenticated OPTIONS preflight handling).
- Removed an unused action hint variable and added a regression test asserting unauthenticated POST bodies are not read.
- This change is newer than the green CI run; it is not verified until new workflows complete successfully.

**Next verification**
- Confirm both workflows pass on the latest PR head, especially the no-body-read assertion and oversized streamed-body tests.
- Continue auditing Worker action-specific access, financial state and cloud synchronization before making architecture-wide changes.
