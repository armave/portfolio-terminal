# Portfolio Terminal architecture refinement tracker

**Repository:** `armave/portfolio-terminal`  
**Current work:** Portfolio sync runtime extraction  
**Base:** `main` at `0eb0ffdb347bc523f729d9bcb8eae39671c87431`

This is the continuing checklist for the architecture-refinement program. A checked item means code has been implemented; validation is tracked separately so implementation is not confused with a passing CI run.

## Completed

- [x] Establish the canonical live `PortfolioState` contract and typed blank-state factory.
- [x] Extract legacy portfolio holding and cloud-holding migrations.
- [x] Use canonical state in the app runtime and preserve account/device settings on workspace clearing.
- [x] Extract the Russian static localization dictionary without changing the translation API.
- [x] Add production-browser smoke coverage for desktop, tablet, and phone.
- [x] Extract portfolio state, selector, and active-desk subscriptions while preserving store compatibility exports.
- [x] Extract navigation permission checks and explicit live-quote refresh event bindings.
- [x] Extract manual portfolio-sync UI event wiring, injected broker/cloud operations, result messaging, and event completion into `src/services/portfolioSyncRuntime.ts`.
- [x] Add focused Vitest coverage for the portfolio sync runtime adapter.
- [x] Merge the preceding foundation work in [PR #245](https://github.com/armave/portfolio-terminal/pull/245).

## Current PR — portfolio sync runtime

- [x] Preserve the existing role-specific sync policy in `manualPortfolioSync.ts`.
- [x] Move `portfolio:sync-request` binding out of `app.ts`.
- [x] Inject broker request, quote refresh, cloud push, and guest snapshot operations.
- [x] Preserve success, partial-success, failure notifications, and request resolution.
- [x] Add Vitest coverage for admin, guest, partial-failure, unauthenticated, and listener-disposal behavior.
- [x] Exact-head GitHub Actions passed on `cd29b1ac2acac2dbb22db42985bda5f5dbfe13ea`: 961 tests across 85 files, typecheck, build, dead-code, both dependency audits, and production browser smoke. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41411746504) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41411746503).
- [ ] Review feedback.
- [ ] Merge this PR.

## Remaining architecture work

### P1 — application runtime boundaries

- [ ] Extract authenticated session lifecycle: identity changes, credential verification, login/logout, and guest/admin transitions.
- [ ] Extract broker runtime: broker event coordination, account refresh, executed-trade refresh, and active-order refresh.
- [ ] Extract guest portfolio synchronization: publication, hydration, assignment lifecycle, and session guards.
- [ ] Extract startup lifecycle: initialization, retry, offline startup, rollover timer, and visibility handling.

### P1 — API compatibility facade

- [ ] Decompose `src/services/api.ts` into cloud-state/encryption, revision coordination, authentication/session, broker transport, and market-data responsibilities.
- [ ] Preserve Gateway Secret resolution, encryption compatibility, session-bound caches, request coalescing, cloud revision checks, and serialized cloud writes.

### P1 — authenticated browser coverage

- [ ] Admin and guest login journeys.
- [ ] Account switching and stale-session/data-isolation journeys.
- [ ] Broker refresh and partial-source-failure journeys.
- [ ] Backup import and portfolio reset journeys.
- [ ] Cloud sync and revision-conflict journeys.
- [ ] Guest assignment publication and history journeys.

### P2 — portfolio store modularization

- [ ] Extract transaction calculation/command boundaries from `PortfolioStore` without introducing a second state owner.
- [ ] Add parity/regression coverage for FIFO allocation, commissions, margin interest, debt settlement, realized P&L, and rollover accounting before moving those responsibilities.

### P2 — dependency maintenance

- [ ] Review and resolve the known low/moderate development dependency advisories.
- [ ] Re-run full and production dependency audits after updates.

## Non-negotiable guardrails

- Do not change financial formulas, FIFO allocation, commissions, margin interest, rollover semantics, debt settlement, realized P&L, or persisted backup formats as incidental refactor work.
- Keep `PortfolioStore` as the single portfolio state owner.
- Preserve i18n keys and translation behavior.
- Add Vitest coverage for every extracted runtime/service boundary.
- Keep client changes grouped in a focused PR.
- Change Cloudflare Workers on `main` only when a demonstrated server-side change is required; no Worker change is needed for the current sync-runtime extraction.
