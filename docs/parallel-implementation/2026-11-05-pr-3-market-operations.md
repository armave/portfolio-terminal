# PR 3 — Complete market-data, account and settings workflows

**Status:** Implementation and deterministic automated verification complete; ready for merge into `dev`.  
**Base:** `dev`.  
**Live-service follow-up:** [#328](https://github.com/armave/portfolio-terminal/issues/328) tracks authenticated TradeNet and real-browser release verification.  
**Branch:** `work/market-operations-e2e-2026-11-05`  
**Priority:** High  
**Ownership:** Market-data lifecycle, account/settings journeys, and operational resilience.

## Goal

Verify that market and account operations behave correctly when sources are delayed, stale, incomplete, unavailable or switched during an in-flight request. Improve only concrete gaps found by isolated Vitest and browser journeys.

## Confirmed baseline

- Quote services already contain provider contracts, fallback sequencing, freshness/provenance rules, request gating, cache/coalescing, timeout and stale-response controls.
- Market Insights has request-policy and wiring tests; Stocktwits is opt-in and article selection is ticker-scoped.
- Market Depth has a tested live-only display policy, payload normalization, stream lifecycle, retry, frame coalescing and order-book aggregation.
- Admin/guest auth, cloud isolation, user management and guest assignment ownership already have dedicated unit/server tests and production-browser smoke coverage.
- The repository's `docs/refinement-plan-2026-10-31.md` records authenticated real-browser verification still needed for Market Insights request counts, Market Depth live disconnect/reconnect, no-data/retry states and burst/deep-table behavior.
- Latest main includes current TradeNet sequence/parser compatibility fixes. Do not revert or duplicate them.

## Findings and implementation

### 1. Correct Market Insights news failure semantics

**Finding:** `createMarketInsightsProviderClient.fetchMarketNews` caught non-abort provider errors, logged them, and returned an empty array. This made a network/provider outage indistinguishable from a successful response containing no articles. The Market Insights component already has a failure state and refresh affordance, but could not reach the failure state for these transport errors.

- [x] Continue logging non-abort news provider errors through the existing callback.
- [x] Re-throw the provider error so the UI can display the actual failure instead of a false empty feed.
- [x] Preserve AbortError behavior and retryability; failed requests are not cached as successful empty results.
- [x] Add Vitest coverage that asserts error propagation and a successful subsequent retry.

### 2. Bound the Market Depth first-book wait

**Finding:** A ready WebSocket could continue answering heartbeats without sending a depth snapshot. The modal would remain in its connected/awaiting-data state indefinitely because the socket-connect timeout is cleared once the ready message arrives.

- [x] Start a 15-second first-depth watchdog after a correctly scoped ready event.
- [x] Cancel the watchdog as soon as the first timestamp-valid depth message is accepted.
- [x] If no valid book arrives, report the existing localized no-data message, mark the stream disconnected from a live-book perspective, and close the socket so the modal exposes Retry.
- [x] Clear the watchdog on stop, socket close, error, and retry.
- [x] Add injectable timeout configuration for deterministic tests.
- [x] Add Vitest tests for no-book timeout and cancellation after valid depth arrives.

The watchdog does not claim that a production socket has been verified. It bounds a previously unending no-data state and is covered with deterministic runtime tests.

### 3. Account and Settings browser journey

- [x] Add isolated `scripts/browser-smoke-operations.mjs`; keep the shared `scripts/browser-smoke.mjs` untouched.
- [x] Exercise account creation with guest as the default role.
- [x] Exercise rename, role changes, language changes and password reset through the actual Settings UI.
- [x] Exercise account deletion through the actual confirmation dialog.
- [x] Verify the UI does not expose self-delete for the signed-in administrator.
- [x] Verify the Worker contract rejects demotion of the final administrator and the UI surfaces the server error.
- [x] Verify account language is saved server-side and restored after page reload.
- [x] Verify administrator refresh cadence selection is persisted separately from guest cadence.
- [x] Verify a guest does not inherit the administrator's 30-second refresh selection and defaults to 15 seconds.
- [x] Verify stop-out equity above maintenance equity is rejected; verify valid broker assumptions are persisted.
- [x] Verify guests cannot see User Management, Broker Rules, or admin backup actions, retain manual Sync, and hydrate only their assigned projection.
- [x] Verify guest sign-in does not read the admin user directory or shared cloud workspace.
- [x] Check Settings surface clipping/page overflow at 320, 360, 390, 768, 1024 and 1440px.

The browser journey uses a deterministic mocked Worker API. It tests browser/UI integration and must not be described as a real production authorization or TradeNet session.

### 4. Dedicated CI workflow

- [x] Add `.github/workflows/operations-browser.yml` with typecheck, full unit/Worker tests, production build, Chromium browser journey, dead-code validation and both dependency audits.
- [x] Keep workflow and browser script isolated from PR #323's trade browser journey and the shared smoke script.

## Follow-up release verification (not blocking merge; tracked in [#328](https://github.com/armave/portfolio-terminal/issues/328))

### Market-data browser evidence

- [x] Add browser-level request checks for News failure/retry, Fundamentals-only deep-data loading, no News refetch on tab switch, and Stocktwits opt-in.
- [x] Verify Market Insights provider outage → visible error → retry recovery in the production-built browser journey with the Worker API mocked.
- [ ] Exercise explicit refresh, cache revisit and ticker switching while older requests are delayed in a real browser trace.
- [ ] Verify source fallback and stale/unknown timestamp presentation in a real browser trace.

Existing service/policy tests cover deterministic fallback, freshness, request gating, caching, request coalescing and cancellation. Live provider traces are tracked in #328 and are not claimed by this PR.

### Market Depth browser/live evidence

The real-browser and authenticated TradeNet checks below are tracked in [#328](https://github.com/armave/portfolio-terminal/issues/328):

- [ ] Verify a successful first validated book in a browser, with no LIVE state before the first depth payload.
- [ ] Verify disconnect/reconnect, retry, no-data and ticker invalidation in a real browser.
- [ ] Verify burst updates and the expanded detailed table at narrow and wide widths.
- [ ] In a real authenticated TradeNet session, record initial depth and first-payload raw/accepted/ignored rows, provider bid/ask row counts and visible price levels without placing orders.

The new first-depth watchdog is unit-tested; its behavior is not represented as proof of a production TradeNet socket.

### Release evidence

The following production-readiness evidence is tracked in [#328](https://github.com/armave/portfolio-terminal/issues/328):

- [ ] Record production Pages/Worker commit and workflow outcomes for the final integrated head.
- [ ] Record exact authenticated live-service diagnostics using a read-only TradeNet session.
- [ ] Complete final English/Russian accessible-name review for affected Market Depth states. The Settings browser journey covers EN/RU account settings and responsive layouts.

## Boundaries and non-goals

- No financial calculation, portfolio accounting, or trade execution changes.
- No provider-priority changes without reproducible evidence.
- No TradeNet subscription-protocol change without verified provider documentation or payload evidence.
- No account-model change: guest projections remain read-only and scoped.
- No speculative Worker/server change. If a concrete Worker defect is established, add its Worker regression test and follow the repository direct-to-`main` deployment process.
- No secret, broker SID or raw private provider payload exposed in the browser or logs.
- PR #323 owns trade lifecycle and transaction UI. PR #324 owns scenario/AI workflows and shared localization. Do not edit their owned files or the shared monolithic browser smoke script.

## Validation checklist

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run validate:dead-code`
- [x] `npm run audit:dependencies`
- [x] `npm run audit:production`
- [x] `npm run build`
- [x] Dedicated operations browser journey on exact head `7e421a6397f66ed6a2206ea9f7b2393a7e62fd11` ([workflow run](https://github.com/armave/portfolio-terminal/actions/runs/42064239401))
- [x] Vitest regressions for news failure/retry and Market Depth first-book timeout/cancellation
- [x] Settings browser journey covers admin/guest CRUD, permission boundaries, language, cadence, broker-rule validation and responsive widths
- [x] Mocked-browser Market Insights outage → visible error → manual refresh recovery; Fundamentals-only deep-data request; Stocktwits opt-in and no News refetch on tab switch.
- [ ] Market Depth browser/live recovery checks (successful first book, disconnect/reconnect, retry, ticker invalidation) — tracked in #328.
- [ ] Authenticated live TradeNet release check with diagnostics recorded — tracked in #328.
- [x] Review the change boundary: no Worker/server routes or trade execution changes; no secrets or raw private provider payloads are introduced.

Automated checks passed on the referenced exact head; live-service verification is deliberately separate and must be completed before the market-data work is described as production-verified.