# Portfolio Terminal architecture refinement tracker

**Repository:** `armave/portfolio-terminal`  
**Current work:** Authenticated session identity and logout runtime extraction  
**Base:** `main` at `e01cab2b686ff3915907a05ca3151edea281af60`

This is the continuing checklist for the architecture-refinement program. A checked item means code has been implemented; validation is tracked separately so implementation is not confused with a passing CI run.

## Completed

- [x] Establish the canonical live `PortfolioState` contract and typed blank-state factory.
- [x] Extract legacy portfolio holding and cloud-holding migrations.
- [x] Use canonical state in the app runtime and preserve account/device settings on workspace clearing.
- [x] Extract the Russian static localization dictionary without changing the translation API.
- [x] Add production-browser smoke coverage for desktop, tablet, and phone.
- [x] Extract portfolio state, selector, and active-desk subscriptions while preserving store compatibility exports.
- [x] Extract navigation permission checks and explicit live-quote refresh event bindings.
- [x] Extract manual portfolio-sync UI event wiring, injected broker/cloud operations, result messaging, and event completion.
- [x] Merge the portfolio sync runtime extraction in [PR #246](https://github.com/armave/portfolio-terminal/pull/246).

## Merged PR #246 — portfolio sync runtime

- [x] Preserve role-specific sync policy in `manualPortfolioSync.ts`.
- [x] Move `portfolio:sync-request` binding out of `app.ts`.
- [x] Inject broker request, quote refresh, cloud push, and guest snapshot operations.
- [x] Preserve success, partial-success, failure notifications, and request resolution.
- [x] Add focused admin, guest, partial-failure, unauthenticated, and listener-disposal tests.
- [x] Exact-head GitHub Actions passed on `8e912e5f0c0a016947dfa57cdb4d1aa6896bf4f1`: 961 tests across 85 files, typecheck, build, dead-code validation, both dependency audits, and production browser smoke. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41411977641) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41411977666).
- [x] Squash-merged to `main` as `e01cab2b686ff3915907a05ca3151edea281af60`.

## Current PR — authenticated session runtime

- [x] Extract account identity publication and role/write-permission transitions into `src/services/portfolioSessionRuntime.ts`.
- [x] Preserve session-guard invalidation and cloud-encryption cache invalidation when identity changes.
- [x] Preserve the ordering that disables guest cloud writes before clearing a previous administrator workspace.
- [x] Move administrator authorization checks into the session runtime.
- [x] Move logout event handling, remote logout, local credential clearing, and reload into the session runtime.
- [x] Add focused Vitest coverage for admin/guest switching, repeated identity, failed identity lookup, authorization, logout failure cleanup, and listener disposal.
- [x] Exact-head GitHub Actions passed on `a18caee6baf540c34ebd537cefb0592d1516e73b`: 969 tests across 86 files, typecheck, production build, dead-code validation, both dependency audits, and production browser smoke at desktop, tablet, and phone viewports. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41413499908) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41413499889).
- [ ] Review feedback and merge.

## Remaining architecture work

### P1 — application runtime boundaries

- [ ] Extract credential verification and authenticated account-switch startup orchestration from `handleSaveGatewaySecret` and `startApp` without changing auth/storage semantics.
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
- Change Cloudflare Workers on `main` only when a demonstrated server-side change is required; no Worker change is needed for this client-side session-runtime extraction.
