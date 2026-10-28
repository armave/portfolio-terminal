# Portfolio Terminal — Audit and Refactoring Plan

**Audit date:** 2026-10-28  
**Base:** `main` at `a5f34d6950abd29299d2927b25fae91967a14c0d`  
**Status:** focused refinement implemented; broad compatibility audit remains in progress.

## Scope and method

Reviewed repository metadata, package scripts, the current architecture and audit notes, CI/deployment workflows, selected portfolio-store/domain/service/UI code, and the active branch graph through the GitHub repository API. A local `git clone` was attempted but the environment could not resolve `github.com`; no local typecheck, test, dead-code, or build result is claimed. The pull-request CI must validate the exact final head.

The repository already contains substantial protections for backup validation, cloud revision conflicts, quote ordering, authenticated cloud encryption migration, and financial rollover/rounding behavior. This pass deliberately avoids reimplementing those protections or changing financial semantics without targeted evidence and regression tests.

## Confirmed change in this PR

- [x] Fix the cash-holdings daily quote range, which displayed literal `{formatUSD(...)}` placeholders instead of formatted high/low prices.
- [x] Extract the range formatter as a pure helper and add a focused regression test.
- [x] Keep the change presentation-only: no portfolio state, quote provenance, provider priority, or financial calculations are changed.
- [x] Create this audit plan with prioritized follow-up work and branch-divergence findings.
- [ ] Run all required CI checks on the final PR head after the Stocktwits lazy-load refinement and review the final diff.

## Prioritized refactoring roadmap

### P0 — Financial and data integrity

- Preserve canonical active positions in `PortfolioState.positions`; treat legacy `holdings` as a compatibility projection, not a second source of truth.
- Continue regression coverage for FIFO tranche allocation, commission minimums, partial/full liquidation, debt-first proceeds settlement, realized P&L, and closed-trade history.
- Keep the active runtime rollover calculation and legacy cloud-import `processRollovers` path distinct until their historical rounding/time-boundary contract is explicitly reconciled. Do not unify them based on naming alone.
- Keep backup import validation fail-closed for malformed container shapes, invalid tranche quantities/prices, and aggregate-share/tranche mismatches.
- Preserve transactional rollback when local persistence fails and revision checks when cloud writes conflict.

### P1 — Async and broker reconciliation

- Keep quote results ordered by request sequence and trade timing; a rejected/no-op update must not notify subscribers or persist state.
- Verify broker snapshot staleness and quote freshness independently. A successful account fetch must not make an older quote fresh, and failed refreshes must not erase valid local holdings.
- Audit the Freedom TradeNet executed-trade cache and custom-event flow. Replace remaining ad-hoc window globals only after every producer/consumer and initial hydration path is covered by tests.
- Keep broker aggregate quantities separate from app-owned lots/cost basis and preserve explicit mismatch reporting.

### P1 — Branch rebasing and integration

- `perf/onload-request-optimization` is **diverged** from current `main`: 2 commits ahead and 5 behind at the time of audit. Its diff touches `app.ts`, `src/App.tsx`, `src/components/MarketInsightsPanel.tsx`, and `src/components/TickerTab.tsx`.
- Do not force-push or mechanically rebase that branch without reviewing the two unique commits and their async lifecycle assumptions against the current Preact-root and store changes.
- Preferred integration: fetch the latest `main`, replay only still-valid commits onto a fresh branch, resolve conflicts by intent rather than accepting whole-file sides, then run typecheck/tests/build/dead-code checks and inspect request counts, loading state, terminal focus, and stale-response behavior.
- This PR does not rewrite or force-update the existing performance branch. That avoids disturbing in-flight work while its unique changes are still being reviewed.

### P2 — Type and architecture refinement

- Replace broad `any` casts at module boundaries with shared portfolio/broker types, prioritizing broker executed-trade payloads, broker assumptions, and command scenario inputs.
- Keep financial domain functions deterministic and free of UI/network dependencies.
- Continue deleting only proven dead/no-op code after checking all call sites; do not remove root-level runtime or Worker files based on size or age.
- Avoid introducing a new framework or dependencies for boundary cleanup.

### P2 — CI and deployment

- Keep PR checks for typecheck, Vitest, production build, dead-code validation, and high-severity production dependency audit.
- Treat CI results as valid only for the exact final head; historical green runs do not validate new commits.
- Review duplicate workflow execution and stale branch triggers separately before consolidating workflows, because branch protection may depend on current check names.
- Keep deployment restricted to intended main-branch/manual events and read-only permissions for build jobs.

## Validation and merge gate

Required on the same final commit:

```sh
npm run typecheck
npm test
npm run build
npm run validate:dead-code
npm audit --omit=dev --audit-level=high
```

Also inspect the final diff for changes to financial calculations, persisted formats, broker/API boundaries, secrets, and unrelated files. Browser verification should confirm the daily high/low display in the cash-holdings panel and review the key responsive layouts.

**Current limitation:** source changes were committed through the GitHub repository API because local network resolution prevented cloning. Therefore, the focused regression test has been added but has not been executed locally in this session. Keep the PR unmerged until its CI run passes all required gates.

## Follow-up checkpoint — 2026-10-28

- [x] Re-read the current `main` and `perf/onload-request-optimization` versions of `TickerTab.tsx` and the active-orders listener in `App.tsx`.
- [x] Confirmed the current `main` version already refreshes active orders when `state.activeView` changes. The performance branch version still uses only `isMarginDeskActive` as the effect dependency, so blindly replaying its older lifecycle commit would regress the current behavior.
- [x] Reviewed the unique `fixed onload behavior` commit diff. It changes startup sequencing and DOM listener null guards in the root runtime; it must be reconciled against the current `src/main.ts` / `app.ts` startup and state-loading lifecycle rather than cherry-picked wholesale.
- [x] Reconfirmed that the audit PR has no merge-base divergence from `main`.
- [x] Reviewed the optional Stocktwits request optimization on the performance branch and ported the user-triggered lazy-load behavior into this PR. The feed now avoids a network request until the user presses Load; after that, ticker changes and refreshes continue to work.
- [ ] Review request counts and stale-response behavior in a browser before proposing any further performance-branch integration.
- [ ] Complete final browser verification for the quote display and Stocktwits opt-in loading.

**Rebase decision:** no forced rebase or cherry-pick is justified yet. The active-orders dependency improvement is already present on `main`; the remaining startup change is broader than a safe mechanical port and should be reviewed separately.
