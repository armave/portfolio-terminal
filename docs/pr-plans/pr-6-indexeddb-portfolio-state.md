# PR 6 — Crash-safe local portfolio persistence

**Status:** Implementation committed; draft pending final exact-head CI.  
**Proposed PR title:** `feat(storage): add crash-safe IndexedDB portfolio persistence`  
**Branch:** `feat/indexeddb-portfolio-state-2026-11-05` · **Base:** `main`  
**Priority:** Critical

## Goal

Give the administrator portfolio a versioned IndexedDB snapshot with atomic revision-checked commits, migration from the existing localStorage payloads, and recovery from interrupted writes. Keep `PortfolioStore` as the only owner of in-memory portfolio state and keep Gateway credentials and cloud persistence separate.

## Architecture and commit semantics

### Dedicated database

- Database: `portfolio-terminal-state`, version 1.
- Object store: `snapshots`.
- Current generation key: `current`.
- A complete committed record contains portfolio state, broker execution/cashflow history, broker rules, device desk preference, schema version, revision/parent revision, commit id, origin id, and commit timestamp.
- This database is separate from the existing `portfolio-terminal-secure-storage` Gateway credential database. No credentials are copied into the portfolio snapshot; `gatewaySecret` and embedded history arrays are stripped from the portfolio-state object.

### Synchronous store API compatibility — deliberate boundary

`PortfolioStore.update()` and its many callers are synchronous today. Converting the entire store and all action flows to async would be a much broader API migration and would risk publishing a candidate before the persistence result is known.

This PR therefore uses a two-stage local commit:

1. `saveState()` writes one compact, versioned write-ahead journal record to localStorage synchronously. This is the commit boundary for the existing synchronous store: `true` means the local recovery entry was written, not that the IndexedDB mirror has completed.
2. An asynchronous IndexedDB readwrite transaction applies the journal using revision compare-and-commit. The complete generation is checkpointed locally only after the IndexedDB transaction commits; the journal is removed only after that checkpoint succeeds.

The journal stores the full portfolio state but omits unchanged history/rules/device preference; omitted fields inherit from its parent generation. The committed IndexedDB record remains complete.

The UI receives `pending`, `ready`, `degraded`, and `conflict` status updates. A failed IndexedDB transaction leaves the local recovery entry in place and is surfaced as a localized warning. A failed synchronous journal write rejects the store mutation. There is no claim that `saveState() === true` means the IndexedDB mirror is already complete.

**Constraint:** this compatibility design still requires localStorage for the synchronous write-ahead entry. In a browser where localStorage itself is inaccessible, durable store mutations fail closed; this PR does not yet make `PortfolioStore` a pure asynchronous IndexedDB client. A future async-store migration would be required to remove that dependency completely.

### Revisions, recovery and reset

- IndexedDB performs current-revision read, expected-revision comparison, and write inside one readwrite transaction.
- The local journal is ordered by `parentRevision` / `revision`; multiple competing children are surfaced as a conflict rather than silently chosen.
- Failed transactions and failed checkpoint writes retain their journal entries for retry.
- A clear tombstone is written before local/IndexedDB cleanup. It preserves broker rules and device view, shadows older snapshots, purges pre-clear journals before creating the empty generation, and blocks new writes until reset finalization succeeds. This prevents an interrupted reset from replaying an older portfolio mutation.
- Conflicting/stale journals are preserved and reported; automatic data-merging is intentionally not attempted.

### Startup and isolation

- Authenticated administrator startup awaits local snapshot hydration before importing the administrator workspace.
- Guest startup does not hydrate the administrator's local IndexedDB portfolio.
- `app.ts` avoids persisting a Gateway secret before that hydration gate.
- Cloud encryption, cloud revision coordination, Worker/Durable Object routes, and the existing Gateway credential store are unchanged.

### Legacy and backup compatibility

- Existing current/legacy state keys, closed-history sidecar, broker-rules key, and device desk preference are read as a migration baseline.
- Migration is idempotent and the old evidence is retained; no one-way deletion is required for a successful migration.
- Existing backup/import/export formats are unchanged.
- Legacy state/history/rules mirrors remain best-effort compatibility mirrors; the journal/IndexedDB generation is the new recovery path.

## Implementation checklist

- [x] Inventory current storage keys, callers, startup dependencies, reset paths, and backup/import/export boundaries.
- [x] Add a separate versioned portfolio IndexedDB database; leave Gateway credential storage isolated.
- [x] Store a complete state/history/rules generation as one IndexedDB record.
- [x] Add local write-ahead journal entries and preserve the synchronous PortfolioStore API without treating an IndexedDB-pending write as IndexedDB-complete.
- [x] Add revision compare-and-commit and reject ambiguous/stale journal chains.
- [x] Await local IndexedDB hydration before administrator workspace import; skip this hydration for guests.
- [x] Migrate existing localStorage snapshots/history/rules idempotently and preserve legacy evidence.
- [x] Preserve backup/import/export formats.
- [x] Surface IndexedDB unavailable/error, localStorage getter/write errors, transaction failures, and revision conflicts as explicit degraded/recovery states.
- [x] Add tombstone-based reset recovery; reject saves while a reset is still being finalized.
- [x] Preserve Gateway credential and cloud persistence boundaries.
- [x] Add Vitest scenarios for legacy migration, first-run chained writes, compact journals, retry after IndexedDB failure, stale revision conflict, clear interruption, localStorage access failure, and history clearing after reload.
- [x] Add English/Russian persistence warning translations.
- [x] Extend Playwright production-browser smoke to verify a committed IndexedDB snapshot after backup import.
- [ ] Verify exact final commit with TypeScript, full Vitest, production build, Chromium smoke, dead-code validation, and both dependency audits.

## Known validation limits / follow-up

- Revision conflicts are covered with a deterministic injected database adapter; a true two-tab browser race test is still desirable.
- Browser smoke verifies that the production app writes a correctly shaped IndexedDB snapshot, but does not kill a browser process in the middle of a transaction or simulate real browser quota exhaustion.
- Blocked-upgrade, abort, and transaction error paths are handled in the adapter/service and surfaced as degraded states; all browser-specific failure modes are not reproduced in Playwright.
- LocalStorage remains a synchronous write-ahead dependency for current `PortfolioStore` callers. Removing that dependency requires a separate, deliberate async API migration.
- A conflict preserves both the current committed generation and recovery journals; the UI warns rather than attempting an automatic merge.

## Files changed

- `src/services/portfolioStateDatabase.ts` — dedicated IndexedDB adapter and transactional compare-and-commit.
- `src/services/storage.ts` — versioned snapshots, migration, local journal, hydration, recovery, status, and reset tombstone.
- `src/services/storage.test.ts` — migration and failure/recovery regression coverage.
- `src/services/portfolioAuthenticatedStartupRuntime.ts` and tests — administrator hydration gate / guest isolation.
- `app.ts`, `src/App.tsx`, `src/services/i18n-ru.ts`, `src/services/i18n.test.ts` — startup wiring and localized recovery warnings.
- `scripts/browser-smoke.mjs` — production-browser IndexedDB assertion.
- Store and subscriber test doubles updated to implement the browser `Storage` interface.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
node scripts/browser-smoke.mjs
``

Do not mark ready or merge until all exact-head checks pass and any remaining limitations are reviewed.

## Integration baseline

The PR is being revalidated after PRs #313 and #315 were merged into `main` (current main baseline at review: `22450fc944f87d1c78185ebf0870f43d31fd2fb9`). In particular, verify the merged startup, portfolio-store failure handling, and broker-sync changes remain intact when this branch is integrated.
