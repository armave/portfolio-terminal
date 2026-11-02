# Portfolio Terminal architecture refinement tracker

**Repository:** `armave/portfolio-terminal`  
**Current work:** Cloud state security runtime extraction  
**Base:** `3b16d36cec87a02db31a45630c4751dde34b310b`

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
- [x] Merge the credential and account-switch runtime extraction in [PR #248](https://github.com/armave/portfolio-terminal/pull/248).
- [x] Merge session-bound guest snapshot hydration in [PR #249](https://github.com/armave/portfolio-terminal/pull/249).
- [x] Merge browser lifecycle wiring and administrator rollover timer extraction in [PR #251](https://github.com/armave/portfolio-terminal/pull/251).
- [x] Extract account-scoped broker request event coordination and waitable request disposal.
- [x] Extract first-load credential restoration, validation, auth fallback, and startup failure sequencing.
- [x] Extract fresh and deterministic legacy guest tranche assignment ID generation.
- [x] Merge consolidated broker/startup/guest-ID runtimes in [PR #252](https://github.com/armave/portfolio-terminal/pull/252).

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

## Merged PR #248 — credential and account-switch runtime

- [x] Extract credential validation, save/persist sequencing, and the authenticated-user identity publication boundary.
- [x] Keep app initialization and portfolio storage behind typed injected callbacks.
- [x] Preserve guest immediate Balance navigation, guest-only snapshot hydration, admin shared-cloud pull, and quote refresh ordering.
- [x] Keep `handleSaveGatewaySecret` as an exported compatibility wrapper.
- [x] Add Vitest coverage for empty/invalid credentials, initial guest startup, guest/admin account switching, persistence failure, and startup failure.
- [x] Validation on final PR head `77356836d17d4fb2ffb2505d6cdc3ae7b8bf002d`: 976 tests across 87 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41414975296) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41414975300).
- [x] Squash-merged to `main` as `e05a8c910195fddcdc9318083c90f066706d70e6`.

## Merged PR #249 — guest portfolio hydration runtime

- [x] Move guest snapshot fetching and account-generation checks behind a typed hydration service.
- [x] Preserve server-scoped guest-only projection loading and reject responses for changed account, credential, role, or login generation.
- [x] Preserve the current guest-accessible desk while refreshing the snapshot.
- [x] Build a clean guest workspace without carrying administrator holdings, broker rows, cashflows, credentials, or API keys.
- [x] Keep portfolio import, persistence, and rendering injected through the existing single app store owner.
- [x] Add Vitest coverage for guest-role gating, desk preservation/fallback, successful hydration, and stale-session rejection.
- [x] Validation on implementation head `560a2727664e950e5bb9838ddfb21dd13946ac12`: 982 tests across 88 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone browser smoke all passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41415633570) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41415633535).
- [x] Squash-merged to `main` as `0ebb5937c13b725f9887273d3055adb12f5300c7`.

## Merged PR #250 — broker refresh request runtime

- [x] Add a typed broker refresh adapter for payload-free scheduled requests and awaitable manual-refresh requests.
- [x] Preserve scheduled request ordering: account info, executed trades, then active orders.
- [x] Reuse the same waitable request methods for manual portfolio sync.
- [x] Keep broker response listeners, account classification, active-order target resolution, and financial calculations in the app unchanged.
- [x] Add Vitest coverage for scheduled order, individual events, and waitable success/failure results.
- [x] Validation on implementation head `399bfe4a0eab23fa39bac2a23e67f713ac454d7d`: 985 tests across 89 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone browser smoke passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41416763228) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41416763350).
- [x] Marked ready for review and squash-merged to `main` as `6aa70eafb05ed5627072aae0a6d5d36f2f6f4988`.

## Merged PR #251 — startup lifecycle runtime

- [x] Extract administrator-only rollover timer ownership and cancellation.
- [x] Preserve the 60-second cadence and visibility guard; recheck the active role before each callback.
- [x] Extract visibility-return handling while keeping the existing administrator rollover and quote-refresh order.
- [x] Extract startup retry/offline event bindings with disposer support.
- [x] Keep session restore, credential verification, portfolio hydration, app initialization, and rollover accounting app-owned.
- [x] Add Vitest coverage for timer cadence, visibility, role switching, startup retry/offline dispatch, and disposal.
- [x] Validation on final PR head `b2727bbe7cb14f056b65725298f67c6240f32872`: 991 tests across 90 files; typecheck, build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41418140232) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41418140126).
- [x] Squash-merged to `main` as `abe430d91482b25666bba01bc622268a79ba6feb`. The full dependency tree still reports low/moderate advisories; the production-only audit reports zero vulnerabilities.

## Merged PR #252 — consolidated broker and startup runtimes

[PR #252](https://github.com/armave/portfolio-terminal/pull/252)

- [x] Move administrator broker request listeners for account info, executed trades, and active orders into `portfolioBrokerRequestRuntime.ts`.
- [x] Preserve account-session scoping in `App.tsx`, including in-flight request coalescing and stale-session checks.
- [x] Preserve the startup refresh order: executed trades, active orders, then account balances and positions.
- [x] Preserve waitable refresh completion semantics, converting rejected reads to `false`.
- [x] Add Vitest coverage for startup ordering, request routing, waitable failures, and listener disposal.
- [x] Move `initApp` first-load credential restoration, validation, auth fallback, and failure sequencing into `portfolioStartupRuntime.ts`.
- [x] Preserve the first-account setup rule that retains the legacy Gateway Secret until administrator bootstrap.
- [x] Preserve the rule that an unresolved identity never renders a cached administrator workspace.
- [x] Extract fresh guest assignment IDs and deterministic legacy assignment IDs into a tested domain helper.
- [x] Extract authenticated `startApp` orchestration into `portfolioAuthenticatedStartupRuntime.ts`, preserving admin/guest workspace selection, cloud-pull and rollover order, and role-specific refresh settings.
- [x] Preserve guest Balance navigation before and after initial quote refresh.
- [x] Preserve initial quote refresh gating, analyst-consensus refresh, and pending startup cloud-write recovery.
- [x] Add Vitest coverage for administrator, guest, and unauthenticated startup sequences and delayed quote completion.
- [x] Move authenticated `startApp` orchestration behind a typed adapter while keeping account identity, storage, cloud sync, quote providers, and portfolio state operations injected.
- [x] Add Vitest coverage for admin, guest, unauthenticated startup ordering and quote-refresh/cloud-write completion sequencing.
- [x] Exact-head validation on implementation commit `7f56f493ad1cbd5c4195b372c35dae9ad7b637a1`: 1,007 tests across 94 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed.
- [x] [Validate run 41420700536](https://github.com/armave/portfolio-terminal/actions/runs/41420700536) and [Pull Request CI run 41420700654](https://github.com/armave/portfolio-terminal/actions/runs/41420700654) both passed all steps.
- [x] Production-only dependency audit: 0 vulnerabilities. Full dependency tree: 9 low/moderate advisories (2 low, 7 moderate), unresolved and not represented as fixed.
- [x] Validation on final PR head `c76705379c7a60db2573ce292bdcd601ccd9394a`: 1,007 tests across 94 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41420921896) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41420921853).
- [x] Production-only dependency audit: 0 vulnerabilities. Full dependency tree: 9 low/moderate advisories (2 low, 7 moderate), unresolved.
- [x] Squash-merged to `main` as `91a03a29395f944cfbc2c07623ba886536bc09f3`.

## Merged PR #253 — broker data runtime

- [x] Move administrator account-info, executed-trade, and active-order provider reads into `portfolioBrokerDataRuntime.ts`.
- [x] Keep the app as the single portfolio-store owner and inject current account/session boundaries.
- [x] Preserve in-flight request coalescing by account identity and session generation.
- [x] Preserve incremental execution-history baselines, fee-allocation recovery, and bounded-page merging.
- [x] Preserve stale-session rejection and broker refresh/error events.
- [x] Add focused Vitest coverage for account, trade-history, and active-order reads.
- [x] Validation on final PR head `4e173d2c7c4f0ad449f724d4a5eea4d69317195e`: 1,015 tests across 95 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed. [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41422557776) · [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41422557677).
- [x] Production-only dependency audit: 0 vulnerabilities. Full dependency tree: 9 low/moderate advisories (2 low, 7 moderate), unresolved.
- [x] Merged to `main` as `01f1545b2a1e3103be39d44c274dac9a8773dfa4`.

## Merged PR #254 — guest assignment runtime

- [x] Move the closed-trade allocation command behind a typed runtime boundary.
- [x] Move active-tranche guest assignment and unassignment behind the same boundary.
- [x] Move serialized guest projection and durable ledger publication out of `app.ts`.
- [x] Preserve legacy active-assignment ID backfill and closed/unassigned assignment history.
- [x] Keep all portfolio state ownership in the app store; inject state, persistence, authorization, and API operations.
- [x] Add focused Vitest coverage for commands, readiness gates, publication payloads, queue serialization, and recovery after publication failure.
- [x] Validation on PR head `52ca8cd824ce7618a935cf11ca7208a9144b902a`: 1,023 tests across 96 files; typecheck, production build, dead-code validation, both dependency audits, and production browser smoke passed. [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41427655823) · [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41427655797).
- [x] Squash-merged to `main` as `3b16d36cec87a02db31a45630c4751dde34b310b`.

## Current PR #255 — cloud state security runtime

- [x] Extract AES-GCM encryption, legacy CryptoJS decryption, shared cloud-key retrieval, and active Gateway Secret lookup into a focused runtime.
- [x] Preserve the `api.ts` compatibility exports for `setSecretGetter` and `clearCloudEncryptionSecretCache`.
- [x] Preserve the existing Worker route, request headers, cache invalidation, AES-GCM envelope format, legacy ciphertext compatibility, and retry behavior after shared-key failures.
- [x] Add focused Vitest coverage for round trips, server-owned-key caching, failure retry, legacy decryption, tamper rejection, and credential getter precedence.
- [ ] Run exact-head typecheck, Vitest, build, audits, dead-code validation, and production browser smoke.
- [ ] Review and merge.

## Remaining architecture work

### P1 — application runtime boundaries

- [x] Complete guest assignment commands and serialized snapshot/ledger publication in PR #254, preserving durable server ledger behavior, legacy backfill, reassignment history, and stale-data gating.
- [x] Complete broker provider-read runtime extraction in PR #253 while keeping account classification and financial calculations app-owned.
- [x] Extract `startApp` orchestration: role-aware workspace hydration, shared-cloud pull, quote bootstrap, rollover ordering, and startup cloud-write recovery.

### P1 — API compatibility facade

- [x] Extract cloud-state encryption and Gateway Secret resolution into `cloudStateSecurity.ts`, retaining `api.ts` compatibility exports.
- [x] Extract cloud revision persistence, pull-generation tracking, and serialized snapshot-write ordering into `cloudRevisionCoordinator.ts`.
- [ ] Extract cloud-state pull/push operations and closed-history synchronization while preserving session-bound caches, request coalescing, cloud revision checks, and serialized writes.
- [ ] Separate authentication/session transport from the compatibility facade.
- [ ] Separate broker transport and market-data transport from the compatibility facade.

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
