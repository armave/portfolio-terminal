# Portfolio Terminal architecture refinement tracker

**Repository:** `armave/portfolio-terminal`  
**Current work:** Credential verification and authenticated account-switch runtime extraction  
**Base:** `fe8de28506809f39f65122aabbdc2fb3af142cdc`

This is the continuing checklist for the architecture-refinement program. A checked item means code has been implemented; validation is tracked separately so implementation is not confused with a passing CI run.

## Completed foundations

- [x] Establish the canonical live `PortfolioState` contract and typed blank-state factory.
- [x] Extract legacy portfolio holding and cloud-holding migrations.
- [x] Use canonical state in the app runtime and preserve account/device settings on workspace clearing.
- [x] Extract the Russian static localization dictionary without changing the translation API.
- [x] Add production-browser smoke coverage for desktop, tablet, and phone.
- [x] Extract portfolio state, selector, and active-desk subscriptions while preserving store compatibility exports.
- [x] Extract navigation permission checks and explicit live-quote refresh event bindings.
- [x] Extract manual portfolio-sync UI event wiring, injected broker/cloud operations, result messaging, and event completion.
- [x] Extract authenticated identity publication, role/write-permission transitions, administrator authorization, and logout handling.
- [x] Merge the sync-runtime extraction in [PR #246](https://github.com/armave/portfolio-terminal/pull/246).
- [x] Merge the authenticated session-runtime extraction in [PR #247](https://github.com/armave/portfolio-terminal/pull/247).

## Merged PR #246 — portfolio sync runtime

- [x] Preserve role-specific sync policy in `manualPortfolioSync.ts`.
- [x] Move `portfolio:sync-request` binding out of `app.ts`.
- [x] Inject broker request, quote refresh, cloud push, and guest snapshot operations.
- [x] Preserve success, partial-success, failure notifications, and request resolution.
- [x] Add focused admin, guest, partial-failure, unauthenticated, and listener-disposal tests.
- [x] CI: 961 tests across 85 files; typecheck, build, dead-code validation, dependency audits, and production browser smoke passed.
- [x] Squash-merged to `main` as `e01cab2b686ff3915907a05ca3151edea281af60`.

## Merged PR #247 — authenticated session runtime

- [x] Extract identity publication and role/write-permission transitions into `portfolioSessionRuntime.ts`.
- [x] Preserve session-guard and cloud-encryption cache invalidation.
- [x] Disable guest cloud writes before clearing a previous administrator workspace.
- [x] Extract administrator authorization checks.
- [x] Extract logout event handling, remote logout, local credential clearing, and reload.
- [x] Add focused Vitest coverage for admin/guest switching, identity failures, authorization, logout cleanup, and listener disposal.
- [x] CI on final PR head: 969 tests across 86 files; typecheck, build, dead-code, both dependency audits, and desktop/tablet/phone browser smoke passed.
- [x] Squash-merged to `main` as `fe8de28506809f39f65122aabbdc2fb3af142cdc`.

## Current PR — credential and account-switch runtime

- [x] Extract credential validation, save/persist sequencing, and the authenticated-user identity publication boundary.
- [x] Keep app initialization and portfolio storage behind typed injected callbacks.
- [x] Preserve guest immediate Balance navigation, guest-only snapshot hydration, admin shared-cloud pull, and quote refresh ordering.
- [x] Keep `handleSaveGatewaySecret` as an exported compatibility wrapper.
- [x] Add Vitest coverage for empty/invalid credentials, initial guest startup, guest/admin account switching, persistence failure, and startup failure.
- [x] Validation on implementation head `646a7da02c443673b3cfa7158c8fbba2acfe27cc`: 976 tests across 87 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke completed successfully. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41414716519) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41414716286).
- [ ] Review feedback and merge.

## Remaining architecture work

### P1 — application runtime boundaries

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

- [ ] Review and resolve known low/moderate development dependency advisories.
- [ ] Re-run full and production dependency audits after updates.

## Non-negotiable guardrails

- Do not change financial formulas, FIFO allocation, commissions, margin interest, rollover semantics, debt settlement, realized P&L, or persisted backup formats as incidental refactor work.
- Keep `PortfolioStore` as the single portfolio state owner.
- Preserve i18n keys and translation behavior.
- Add Vitest coverage for every extracted runtime/service boundary.
- Keep client changes grouped in a focused PR.
- Change Cloudflare Workers on `main` only when a demonstrated server-side change is required.
