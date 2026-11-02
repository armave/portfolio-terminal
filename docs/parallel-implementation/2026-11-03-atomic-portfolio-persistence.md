# fix: make portfolio persistence atomic before publishing updates

## Purpose
Prevent portfolio operations from appearing committed in the UI when the local snapshot/closed-history save fails.

## Confirmed starting point
- `src/store/portfolioStore.ts`: `notify()` calls `saveState(this.state)` but ignores its boolean return.
- `PortfolioStore.update()` assigns the new normalized state before attempting persistence and notifies subscribers regardless of the save result.
- `src/services/storage.ts`: `saveState()` correctly returns `false` when `persistPortfolioSnapshot()` fails; the storage layer already attempts rollback of written localStorage keys.

## Implementation scope
- Own only the persistence commit/publish boundary in `src/store/portfolioStore.ts` (`notify()`, `update()`, and tightly related helpers) and persistence/store tests.
- Compute a candidate state, persist it first for persistent mutations, then publish it and notify subscribers only after success.
- On failure retain the previous in-memory state, do not notify portfolio or active-view listeners, and expose a typed/actionable failure result or callback for UI feedback.
- Preserve explicitly non-persistent `persist=false` updates (quotes/transient/server-derived updates) without writing storage.
- Ensure `lastUpdated`, active view, and derived selectors never advertise an uncommitted candidate.
- Do not modify sale cost-basis accounting; that is isolated in PR #2.

## Required tests
- Failed `saveState` leaves state unchanged and does not notify subscribers.
- Failed active-view mutation does not notify active-view subscribers.
- Successful persistent update saves before publishing and notifies exactly once.
- `persist=false` updates still publish without calling storage.
- Closed-history sidecar failure does not publish its associated portfolio mutation.
- UI receives a visible error rather than showing false transaction success.

## Acceptance
- [ ] No persistent financial mutation is visible as committed unless `saveState()` succeeds.
- [ ] Existing storage rollback behavior remains intact.
- [ ] Transient update behavior is preserved.
- [ ] Targeted regression tests, full Vitest, typecheck, production build, dead-code and dependency audits, and browser smoke tests pass.

## Parallel ownership
PR #2 owns only sale methods/accounting helpers in `portfolioStore.ts`; this PR owns the separate `notify()/update()` persistence boundary. Avoid changing sale logic here.

