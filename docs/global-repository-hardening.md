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
