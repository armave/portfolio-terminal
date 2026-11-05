# Portfolio Terminal architecture refinement tracker

**Repository:** `armave/portfolio-terminal`  
**Current work:** Dependency security maintenance  
**Base:** `71efbb16420cdb1a6ef2d2457ea8291e6a85743a`

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

## Merged PR #255 — cloud state security and revision runtimes

- [x] Extract AES-GCM encryption/decryption, legacy CryptoJS decryption, shared cloud-key retrieval, and active Gateway Secret lookup into `cloudStateSecurity.ts`.
- [x] Preserve the `api.ts` compatibility exports for `setSecretGetter` and `clearCloudEncryptionSecretCache`.
- [x] Preserve the existing Worker route, request headers, cache invalidation, AES-GCM envelope format, legacy ciphertext compatibility, and retry behavior after shared-key failures.
- [x] Extract cloud revision persistence, pull-generation tracking, and serialized snapshot-write ordering into `cloudRevisionCoordinator.ts`.
- [x] Preserve the distinction between writes queued before a concurrent pull and writes that follow prior queued writes in the same tab.
- [x] Add 12 focused Vitest cases covering security round trips, key cache invalidation/retry, legacy decryption, tamper rejection, credential precedence, revision restoration, storage failures, write serialization, stale-pull protection, and recovery.
- [x] Validation on final PR head `74831217256bd1b0337b702754e26ae5511dfd72`: 1,036 tests across 98 files; typecheck, production build, dead-code validation, both dependency audits, and desktop/tablet/phone production browser smoke passed. Full dependency tree still has 9 low/moderate advisories (2 low, 7 moderate); production audit reports 0 vulnerabilities. [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41430277038) · [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41430277303).
- [x] Squash-merged to `main` as `da9f9e747e44a1eebc132fab8fc8bcca9abf4785`.

## Merged PR #256 — authenticated browser journeys

- [x] Extend the existing Playwright smoke harness rather than adding a second browser-test stack.
- [x] Exercise first-run administrator bootstrap through the real AuthModal form.
- [x] Exercise administrator sign-out and account switching to a guest in the same browser context.
- [x] Verify failed sign-in remains recoverable and does not preserve the previous administrator session.
- [x] Verify guests fetch only the server-scoped guest projection and do not request the administrator cloud workspace.
- [x] Exact-head validation: 1,036 tests across 98 files; typecheck/build, dead-code validation, both audits and production browser smoke passed. Squash-merged to `main` as `5b55f0a3c883e2333e533fbada04dbd803353dc6`.

## Merged PR #257 — cloud state sync runtime

- [x] Extract encrypted portfolio pull/push, revision-aware queued writes, closed-history pull/push, legacy history migration, and migration caches into an injectable runtime.
- [x] Keep the existing `api.ts` cloud-sync functions as compatibility exports.
- [x] Preserve stale-session guards, read-only guest pulls, durable history-before-compaction ordering, separate history revisions, force-clear semantics, duplicate read/write coordination, encryption upgrades, and conflict-safe `If-Match` behavior.
- [x] Port the missing explanatory Settings warnings from the older cloud-data-loss branch; retain current Russian translations and add accessibility assertions.
- [x] Retain the already-merged reset/session binding and stale-pull guards; do not merge stale branch histories.
- [x] Final-head validation on `40e2f04c495125b7b3cbfe2896e5690e85886f79`: typecheck, 1,036 tests across 98 files, dead-code validation, both audits, production build, and Chromium browser smoke passed. Entry bundle: 499,837 / 500,000 bytes; gzip: 159,744 / 165,000 bytes. Full dependency audit: 9 low/moderate advisories (2 low, 7 moderate); production audit: 0 vulnerabilities. [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41437200885) · [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41437200940).
- [x] Squash-merged to `main` as `fdfa6c63f19fec4e50fd1823f61fc9d632798d86`.

## Merged PR #258 — authentication and provider transport runtimes

- [x] Extract authenticated Worker request transport and GET request coalescing into `authTransportRuntime.ts`.
- [x] Extract Freedom TradeNet endpoints and token/date-scoped cashflow caching into `freedomBrokerTransportRuntime.ts`.
- [x] Extract Yahoo quotes, fallback normalization, deep-data, Market News and Stocktwits transport into `marketDataTransportRuntime.ts`.
- [x] Preserve `api.ts` public compatibility bindings; reduce the facade from 975 to 461 lines.
- [x] Preserve token-scoped caches, no-store behavior, request coalescing, force refresh, cancellation, retry, and session-generation guards.
- [x] Add 23 focused Vitest tests across auth, broker, and market-data runtimes.
- [x] Exact-head validation on `b0af43ae522a3b4f00666536113fa366440157f6`: 1,059 tests across 101 files; typecheck, build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41440860641) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41440860590) passed.
- [x] Squash-merged to `main` as `8d48af39e9afe52157a1d7489ff9918b9e65bda0`.

## Merged PR #259 — production browser recovery and assignment journeys

- [x] Extend the existing Playwright production smoke using only mocked Worker routes.
- [x] Model revisioned state/history endpoints with ETags and deterministic 412 conflict injection.
- [x] Exercise broker partial-source failure, cloud revision conflict, backup export/import/reset, and guest assignment/history publication.
- [x] Verify the published guest snapshot is readable by the authenticated guest without access to the administrator shared workspace.
- [x] Exact-head validation on `3073ec1c8c202ea5a75d588b68b9097fba439f01`: 1,059 tests across 101 files; typecheck, build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41457467471) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41457467610) passed.
- [x] Squash-merged to `main` as `59b3ce8a1d606624d0a36c81096d1479793e77fc`.

## Merged PR #261 — portfolio transaction calculation boundary

- [x] Extract pure FIFO sale-lot allocation, sale commission calculation, and debt-first sale-proceeds settlement into `portfolioTransactions.ts`.
- [x] Keep portfolio state ownership, position mutation, rollover, and realized-trade persistence in `PortfolioStore`.
- [x] Add direct tests for FIFO partial allocation, legacy fee fallback, tranche aliases, commission normalization, and debt/cash settlement.
- [x] Exact-head validation on `41ef4e3f03cabbbe218fd1b9419ea57f2cd366d8`: typecheck, 1,067 tests across 102 files, production build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production build bundle: 482,981 / 500,000 bytes; gzip: 154,907 / 165,000 bytes.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41460523660) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41460523688) passed.
- [x] Squash-merged to `main` as `13ff76f843259bdc37937e85060cbf52af7548e2`.

## Merged PR #262 — staged sale accounting characterization

- [x] Characterize proportional allocation and one-time consumption of a position-level margin charge across staged partial exits.
- [x] Characterize fractional-share partial exits, FIFO lot balance, and existing per-record cent rounding.
- [x] Characterize debt-first proceeds settlement across multiple partial exits.
- [x] Keep production financial code unchanged; this PR adds tests only.
- [x] Exact-head validation on `77929c0e28207112916c983c6f3d367e3a8f1880`: typecheck, 1,070 tests across 102 files, production build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production build bundle: 482,981 / 500,000 bytes; gzip: 154,907 / 165,000 bytes.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41461251079) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41461251288) passed.
- [x] Squash-merged to `main` as `057f7a0b0ad3975e8960dc9195e4b7b4d88f2e7b`.

## Merged PR #263 — sale financing and realized accounting

- [x] Extract portfolio-weighted margin-interest calculation and proportional per-sale allocation into `calculateSaleAccounting`.
- [x] Preserve the position-level one-shot margin charge floor, allocated debt weighting, and cent rounding.
- [x] Extract total commissions, gross profit, net profit, and net cash proceeds calculations.
- [x] Keep rollover state, debt/cash settlement, position updates, closed-trade construction, and persistence in `PortfolioStore`.
- [x] Add deterministic tests for multi-position debt weighting, accrued tranche interest, partial-exit allocation, realized totals, and the one-shot charge floor.
- [x] Exact-head validation on `72df188f724df887d0d98631c91c15c86aa3e84e`: typecheck, 1,072 tests across 102 files, production build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production build bundle: 483,601 / 500,000 bytes; gzip: 155,060 / 165,000 bytes.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41462093840) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41462093564) passed.
- [x] Squash-merged to `main` as `4375feae30a0841c2751464abc656e7ec18bd001`.

## Merged PR #264 — closed-trade record construction

- [x] Extract legacy-compatible closed-trade field mapping and holding-day rounding into `createClosedTradeRecord`.
- [x] Extract requested/date/fallback close-timestamp precedence into `resolveClosedTradeTimestamp`.
- [x] Preserve ID format and `Date.now()` call placement in `PortfolioStore`.
- [x] Preserve every persisted field and compatibility alias.
- [x] Add deterministic tests for full record shape, 1.5-day rounding, invalid-date holding-day behavior, and timestamp precedence.
- [x] Exact-head validation on `a35f462536c434f5f3985e15774347b676559c45`: typecheck, 1,075 tests across 102 files, production build, dead-code validation, both dependency audits, and production Chromium smoke passed.
- [x] Production build bundle: 484,136 / 500,000 bytes; gzip: 155,166 / 165,000 bytes.
- [x] Production dependency audit: 0 vulnerabilities; full dependency tree retains 9 low/moderate advisories (2 low, 7 moderate).
- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41462722752) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41462722707) passed.
- [x] Squash-merged to `main` as `dcb203c6ebfc45e2a2e94b82b383f445f43e837b`.

## PR #265 — development dependency security maintenance

- [x] Override Workbox's off-main-thread Rollup plugin from 3.0.0-pre1 to 4.0.0, removing the vulnerable EJS 3.1.10 / Jake 10 / filelist 1 dependency chain.
- [x] Override Workbox's glob dependency to fixed 14.0.2 and minimatch to fixed 11.0.1.
- [x] Regenerate `package-lock.json` with npm on GitHub Actions and inspect the resolved dependency graph.
- [x] Validate exact PR head `02d44477663a1385db2f206ac329cb6dcc03b7f0`: TypeScript, 1,075 Vitest tests across 102 files, production build, dead-code validation, and production Chromium smoke all passed.
- [x] Production bundle remained within its existing budget: 484,136 / 500,000 bytes; gzip 155,166 / 165,000 bytes.
- [x] Full dependency audit reduced from 9 advisories to 4 low-severity dependency-tree exposures from the single remaining `deepmerge` advisory (GHSA-gcqx-w48m-w2h4). The full audit's configured high-severity threshold passes; the production-only audit reports 0 vulnerabilities.
- [x] Reviewed the remaining `deepmerge` advisory: no patched release is published. `npm audit fix --force` proposes a breaking downgrade of `vite-plugin-pwa` to 0.2.1, so that unsafe fix is not applied.
- [x] Remove the temporary lock-refresh workflow after lockfile generation; only `package.json`, `package-lock.json`, and this tracker are retained in the PR.
- [ ] Review and merge [PR #265](https://github.com/armave/portfolio-terminal/pull/265).

## Remaining architecture work

### P1 — application runtime boundaries

- [x] Complete guest assignment commands and serialized snapshot/ledger publication in PR #254, preserving durable server ledger behavior, legacy backfill, reassignment history, and stale-data gating.
- [x] Complete broker provider-read runtime extraction in PR #253 while keeping account classification and financial calculations app-owned.
- [x] Extract `startApp` orchestration: role-aware workspace hydration, shared-cloud pull, quote bootstrap, rollover ordering, and startup cloud-write recovery.

### P1 — API compatibility facade

- [x] Extract cloud-state encryption and Gateway Secret resolution into `cloudStateSecurity.ts`, retaining `api.ts` compatibility exports.
- [x] Extract cloud revision persistence, pull-generation tracking, and serialized snapshot-write ordering into `cloudRevisionCoordinator.ts`.
- [x] Extract cloud-state pull/push operations and closed-history synchronization in PR #257, preserving session-bound caches, request coalescing, cloud revision checks, and serialized writes.
- [x] Extract authentication/session transport in PR #258; keep `api.ts` compatibility exports.
- [x] Extract broker and market-data transport in PR #258.

### P1 — authenticated browser coverage

- [x] Admin bootstrap, guest sign-in, admin-to-guest sign-out/switch, failed-login recovery, and role-scoped workspace isolation in PR #256.
- [x] Broker refresh and partial-source-failure journeys in PR #259.
- [x] Backup import and portfolio reset journeys in PR #259.
- [x] Cloud sync and revision-conflict journeys in PR #259.
- [x] Guest assignment publication and guest-readable LOTS history journeys in PR #259.

### P2 — portfolio store modularization

- [x] Extract pure FIFO allocation, sale commissions, debt-first settlement, portfolio-weighted margin-interest allocation, realized sale totals, and closed-trade record construction into `portfolioTransactions.ts`.
- [x] Add parity/regression coverage for FIFO allocation, commissions, margin interest, staged debt settlement, realized P&L, holding-day rounding, and rollover accounting while keeping `PortfolioStore` as the single state owner.

### P2 — dependency maintenance

- [x] Review and apply available development-tooling security updates in PR #265; the OMT/EJS/Jake/filelist chain and vulnerable glob/minimatch versions are replaced.
- [x] Re-run exact-head full and production dependency audits: four low-severity dependency-tree exposures remain from the single unpatched `deepmerge` advisory; production dependencies report zero vulnerabilities.
- [ ] Revisit `deepmerge` when a compatible upstream fix is published.

## Non-negotiable guardrails

- Do not change financial formulas, FIFO allocation, commissions, margin interest, rollover semantics, debt settlement, realized P&L, or persisted backup formats as incidental refactor work.
- Keep `PortfolioStore` as the single portfolio state owner.
- Preserve i18n keys and translation behavior.
- Add Vitest coverage for every extracted runtime/service boundary.
- Keep client changes grouped in a focused PR.
- Change Cloudflare Workers on `main` only when a demonstrated server-side change is required.

## PR #305 — frontend runtime, UI lifecycle, and accessibility follow-up

**Status:** Focused PR scope implemented. PRs #303 and #304 have both merged, and their mainline changes are integrated into this branch at `8242ae2`; the branch is zero commits behind `main`. The wider component-by-component responsive/accessibility review remains follow-up work.

- [x] Preserve `app.ts` as the runtime composition root; the audit confirmed existing dedicated startup, authentication/session, navigation, broker-refresh, quote-refresh, portfolio-sync, and equity-sync runtimes.
- [x] Reference-count nested-dialog background isolation and page scroll locking; restore the original styles and scroll position only after the final dialog closes.
- [x] Cancel delayed scenario-modal close callbacks during unmount.
- [x] Ignore market-status requests whose auth generation no longer matches the active account identity.
- [x] Ignore Closed History fee-allocation completion after its owning effect is disposed.
- [x] Remove duplicate authentication-overlay transition declarations without changing the global reduced-motion policy or startup-critical CSS.
- [x] Add Russian localization regression coverage for auth, scenario modal, and market-status copy while preserving the existing Preact VNode translation hook.
- [x] Add 44px minimum hit targets and visible keyboard focus rings to common scenario, auth-submit, empty-state, and external-quote actions.
- [x] Preserve existing lazy desk/modal imports and entry bundle budgets; existing Vitest architecture tests continue to enforce both.
- [ ] Finish broad component-by-component responsive/accessibility review beyond the changed controls and existing production-browser journey coverage.
- [x] Integrate the latest `main` after both prerequisite PRs merged; the PR diff remains disjoint from their domain/store paths.
- [x] Run final exact-head CI on the integrated head and update the PR checklist.

Earlier integrated-head validation checkpoint passed on `8e0bef23a64d16ab0e408579ffb2b65fb48ecd54` in [Pull Request CI run 41775241690](https://github.com/armave/portfolio-terminal/actions/runs/41775241690): TypeScript, 117 Vitest files, production build, production browser smoke, dead-code validation, full dependency audit at the configured high-severity threshold, and production-only audit (0 vulnerabilities). The production entry bundle was 435,336 raw bytes / 134,747 gzip bytes. Four low-severity development dependency advisories remain through `deepmerge`. The latest exact-head validation is recorded in the PR description.

## PR #313 — margin-risk input validity and scenario coverage

**Status:** Implementation committed; exact-head validation is pending.

- [x] Validate finite non-negative debt, position value, and collateral inputs.
- [x] Validate configured maintenance and stop-out ratios, including their ordering and denominator boundaries.
- [x] Return explicit unavailable results for invalid inputs, invalid assumptions, and numeric overflow.
- [x] Represent undefined zero-denominator equity ratios and position buffers as `null`, not NaN or infinity.
- [x] Preserve valid-input margin-risk calculations and current configured threshold semantics.
- [x] Update application/AI context and Summary Metrics consumers to preserve unavailable risk status.
- [x] Add deterministic Vitest coverage for zero debt/assets, negative equity, threshold equality, invalid inputs/ratios, and overflow.
- [x] Add English/Russian copy and localization assertions.
- [ ] Complete exact-head TypeScript, full Vitest, dead-code validation, dependency audits, production build, and browser smoke on the final PR head.
