# PR 6 — Crash-safe local portfolio persistence

**Status:** Draft implementation scaffold. This branch currently contains the scoped implementation plan only; storage implementation, migration, and regression tests are pending.

**Proposed PR title:** `feat(storage): add crash-safe IndexedDB portfolio persistence`

**Branch:** `feat/indexeddb-portfolio-state-2026-11-05`  
**Base:** `main`  
**Priority:** Critical  
**Dependency:** None. PRs 5–7 are independent workstreams.

## Goal

Remove the multi-key localStorage rollback limitation for durable portfolio data by introducing a versioned, transaction-safe local persistence boundary. Preserve existing portfolio ownership, backup compatibility, account/session isolation, and the existing cloud revision/encryption protocol.

`PortfolioStore` remains the only owner of in-memory portfolio state. Persistence is a storage implementation detail; this PR must not create a second store.

## Evidence and current boundary

- `src/services/storage.ts` currently writes a portfolio snapshot and related records through multiple localStorage keys. Its rollback logic is best-effort because the browser does not provide a multi-key localStorage transaction.
- The current storage module has explicit portfolio, closed-history, broker-rule, and account-specific history-baseline records plus legacy snapshot recovery. Inventory the exact durable keys and their callers before selecting the new envelope.
- The application already uses a separate IndexedDB database named `portfolio-terminal-secure-storage` for encrypted Gateway credentials. Do not silently reuse or change that credential database as part of this migration.
- Existing store and storage tests cover failed writes, rollback attempts, legacy migration, separate history persistence, reset behavior, and recovery after failures. Extend these contracts rather than replacing their intent.

## Scope

- `src/services/storage.ts` and a new focused portfolio-persistence adapter/module under `src/services/`.
- `src/store/portfolioStore.ts` and startup/hydration runtime modules only where an asynchronous durable read/write boundary requires a carefully staged integration.
- Direct storage/store tests and production-browser backup/import/reset tests.
- A migration/recovery note and refinement-tracker update.

Do not modify cloud encryption, cloud revision coordination, Durable Object storage, Worker routes, broker credentials, financial calculation modules, or broker reconciliation logic.

## Implementation checklist

- [ ] Inventory every read/write caller, persisted key, startup dependency, reset path, import/export path, and account/session boundary before changing the storage contract.
- [ ] Design a dedicated versioned portfolio-state IndexedDB database/schema; keep Gateway credential storage isolated.
- [ ] Define the atomic commit unit for portfolio snapshot and related durable history/metadata so a crash cannot publish a mixed generation.
- [ ] Add a monotonically increasing local revision or equivalent compare-and-commit guard to prevent stale tabs from silently replacing newer state.
- [ ] Integrate async hydration safely: the application must not expose an unhydrated default portfolio as if it were the committed saved portfolio.
- [ ] Do not preserve a synchronous-looking API that reports success before an asynchronous IndexedDB transaction has committed.
- [ ] Preserve legacy localStorage reads and implement an idempotent, versioned migration into IndexedDB.
- [ ] Verify the IndexedDB commit before marking migration complete or removing any legacy recovery source.
- [ ] Preserve backup/export formats and support restoring older valid backups through the existing migration boundary.
- [ ] Define an explicit degraded mode for browsers without IndexedDB and for quota, blocked-upgrade, abort, transaction, and serialization failures; never report an unsuccessful write as durable.
- [ ] Preserve session/account isolation and ensure a user switch cannot complete a write into the next user's workspace.
- [ ] Test browser restart/reload recovery after interrupted writes, failed migrations, corrupted records, and partial restore attempts.
- [ ] Test two tabs writing from the same revision and prove that stale commits are rejected or reconciled deterministically.
- [ ] Add Vitest coverage plus real-browser IndexedDB tests using the repository's existing Playwright harness; justify any new dependency before adding it.
- [ ] Document migration rollback and recovery steps, then update the refinement tracker.

## Non-goals and guardrails

- No change to portfolio accounting formulas or PortfolioStore state ownership.
- No Cloudflare Worker, Durable Object, cloud encryption envelope, cloud revision header, or remote sync protocol change.
- No movement of broker/Gateway credentials into ordinary portfolio records.
- No silent deletion of legacy localStorage data.
- No backup schema break or destructive one-way migration.
- Do not introduce a second persistence source of truth; define one committed local generation and a clear migration/fallback policy.

## Acceptance criteria

- [ ] Related portfolio records commit atomically as one validated generation.
- [ ] A crash or rejected transaction leaves the previous committed generation recoverable.
- [ ] Migration from current and legacy localStorage payloads is idempotent and verified before legacy cleanup.
- [ ] Import, export, reset, closed-history recovery, and account switching remain compatible.
- [ ] Quota/unavailable/blocked/aborted storage is surfaced as failure or explicit degraded mode, never false success.
- [ ] Concurrent tabs cannot silently overwrite a newer committed generation.
- [ ] Cloud synchronization and credential isolation remain unchanged.
- [ ] TypeScript, full Vitest, dead-code validation, audits, production build, and browser storage-recovery journeys pass on the exact PR head.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
```

The Chromium suite must exercise initial migration, restart recovery, failed transaction, quota/unavailable fallback, concurrent-tab conflict, import/export, and reset. Record exact-head CI evidence.
