# PR 3 — Complete market-data, account and settings workflows

**Status:** Draft execution plan; implementation not yet started.  
**Base:** `main` at `056211e03fcc4154538c45f969bc608268120dac` (2026-11-05).  
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
- The repository's `docs/refinement-plan-2026-10-31.md` still records authenticated real-browser verification work for Market Insights request counts, Market Depth live disconnect/reconnect, no-data/retry states and burst/deep-table behavior.
- Latest main includes the current TradeNet sequence/parser compatibility fixes. Do not revert or duplicate them.

## Implementation scope

### 1. Market-data journeys

- [ ] Add an isolated production-browser journey covering the quote provider primary/fallback path, stale/unknown timestamp display, and ticker switching while requests are delayed.
- [ ] Verify News requests are limited to the News view; deep data is limited to supported Fundamentals/Earnings/Analysts views; Stocktwits requests occur only after opt-in.
- [ ] Verify cached revisit and explicit refresh behavior without duplicate in-flight work.
- [ ] Verify stale or out-of-order responses cannot overwrite the current ticker's display or portfolio quote.
- [ ] Cover Market Depth first connection, readiness before first depth payload, valid first book, disconnect, socket error, retry, ticker switch, and no-data state.
- [ ] Verify frame-coalesced rendering and the expanded detailed table at narrow and wide viewports.
- [ ] Preserve the distinction between socket connection status and a validated live order book.

### 2. Account and settings journeys

- [ ] Cover account creation, rename, role changes, password reset, deletion and session revocation in the actual Settings UI.
- [ ] Verify the final-admin protection and self-deletion restriction.
- [ ] Verify language preferences persist through reload and role-specific user management does not leak to guests.
- [ ] Verify broker assumptions reject invalid values and persist valid zero/non-zero values.
- [ ] Verify refresh cadence accepts only 15/30/60 seconds and role changes use the correct cadence.
- [ ] Verify provider configuration restore/backup behavior where exposed by the UI.
- [ ] Verify guest sessions continue to see only their authenticated projection, not the owner workspace or Closed History.

### 3. Live-service release verification

- [ ] Record the production Worker/Pages commit and workflow outcomes for the exact integrated head.
- [ ] Use a real authenticated TradeNet session to verify the Market Depth diagnostic values for the target ticker: initial depth, first payload raw/accepted/ignored rows, current provider bid/ask rows and visible distinct price levels.
- [ ] Verify a real disconnect/reconnect and no-data condition if safely reproducible without placing orders.
- [ ] Clearly label simulations and mocked Worker journeys; do not describe them as live broker verification.

## Likely files and boundaries

Primary ownership:
- `src/components/MarketInsightsPanel.tsx`
- `src/components/MarketDepthModal.tsx`
- `src/components/SettingsDesk.tsx`
- Quote, provider, request-policy, refresh and market-depth services under `src/services/`
- Relevant account/market tests, including Worker tests only if a concrete Worker defect is established
- A dedicated operations journey, e.g. `scripts/browser-smoke-operations.mjs`
- A dedicated workflow file if required to avoid editing shared CI files concurrently
- `docs/refinement-plan-2026-10-31.md` to reconcile completed browser checks with evidence

PR 1 owns the terminal/trade lifecycle and PR 2 owns scenario/AI workflows and localization. Do not edit those components or the shared monolithic `scripts/browser-smoke.mjs` while parallel work is in progress.

## Worker/server policy

Do not make speculative Worker changes. If a specific server-side defect is established by a reproducible test or live evidence:
1. Add the Worker regression test.
2. Commit and push Worker/server changes directly to `main` per repository workflow.
3. Confirm the Worker deployment workflow succeeds.
4. Keep frontend changes in this client PR and document the exact server commit dependency.

No Worker code is included merely to broaden this PR.

## Non-goals

- No changes to financial calculations, portfolio accounting, or trade execution.
- No change to quote provider priority unless supported by source and regression evidence.
- No change to TradeNet subscription protocol without verified provider documentation or payload evidence.
- No account-model change: guest projections remain read-only and scoped.
- No new framework or dependency unless required and justified.
- No secret, broker SID or raw private provider payload exposed in the browser or logs.

## Acceptance criteria

1. Market-data provider fallback, timestamps, request policy, ticker scoping and retry behavior are covered by end-to-end tests.
2. No stale/unknown quote is presented as fresh.
3. Market Depth is LIVE only after a validated depth payload in the current connected session.
4. Disconnect, retry and ticker changes cannot leak a previous order book.
5. Account-management and settings operations persist correctly and enforce admin/guest permissions.
6. English/Russian labels and accessible names remain correct.
7. Guest access remains strictly projection-scoped and read-only.
8. Mocked CI checks and real authenticated-service checks are clearly distinguished.
9. Vitest, dedicated browser journeys and repository validation gates pass.

## Validation checklist

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run validate:dead-code`
- [ ] `npm run audit:dependencies`
- [ ] `npm run audit:production`
- [ ] `npm run build`
- [ ] Dedicated production-browser operations journey
- [ ] Responsive checks at 320, 360, 390, 768, 1024 and 1440px
- [ ] English/Russian localization and accessibility checks
- [ ] Authenticated live TradeNet release check, with diagnostics recorded
- [ ] Final review of broker permissions, stale data, secrets and server/client boundaries

Do not mark this PR ready or merge it until code implementation, automated checks and required release evidence are complete.
