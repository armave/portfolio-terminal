# Full-reset history integrity — 2026-10-31

**Repository:** `armave/portfolio-terminal`  
**Base branch:** `main`  
**Base commit:** `a896e0c1a337b1f95020532ef51f38a16295498b`  
**Working branch:** `fix/clear-history-on-blank-reset-2026-10-31`  
**Scope:** full portfolio reset, separately persisted closed history, and cloud-history revision handling.

## Confirmed defect

The Settings reset confirmation promised to clear holdings, balances, and history locally and in KV cloud. The implementation did not meet that contract:

1. `createBlankState()` does not include separately owned `brokerExecutedTrades` and `cashflows` fields, as well as several newer broker and guest-assignment fields.
2. `PortfolioStore.importState()` merges its input into the existing state. Passing `createBlankState()` therefore left omitted fields from the previous portfolio in memory.
3. Large closed-history data is persisted under `portfolio_closed_history_v1`, outside the normal portfolio JSON. The reset path did not overwrite that record with empty arrays.
4. Cloud history has its own Durable Object key and revision. The reset path did not update it. In addition, `pushCloudHistory()` deliberately rejected empty snapshots, so the ordinary history writer could not express a deletion.
5. The history writer's no-change fingerprint could also suppress a later empty write after another device had repopulated cloud history since a previous reset.

The effect was observable data resurrection: the next history-desk hydration could merge old locally saved or cloud-saved broker rows and cashflows back into a portfolio that had been presented as reset.

## Changes implemented

### Canonical store reset

Added `PortfolioStore.resetToBlankState()`. It applies the canonical blank portfolio while clearing:
- active positions and cash holdings;
- closed app trades, broker executions, broker cashflows, and legacy history/tranche arrays;
- operation-level cash/margin classifications and guest tranche assignments;
- the guest portfolio projection and broker account snapshot;
- cached portfolio-equity values, selected ticker, and pending mutation.

It deliberately retains user configuration rather than treating account settings as portfolio content: broker assumptions, provider API keys, the active Gateway Secret, and refresh preferences remain in place.

### Local history persistence

`saveSavedHistory()` now returns a boolean so callers can detect storage failure. The reset writes an explicit `{ brokerExecutedTrades: [], cashflows: [] }` snapshot to the independent history key before reload can restore older rows.

### Cloud history reset

Added `clearCloudHistory()`, which shares the existing serialized history-write queue and revision checks. Unlike an ordinary history save, it intentionally permits an encrypted empty snapshot and forces a write, bypassing the ordinary same-payload fingerprint. The write still fetches the current server revision and uses `If-Match`; it does not weaken the Worker or Durable Object validation.

The UI reset clears local state immediately, then confirms the separate cloud-history clear. A local-storage failure or cloud failure is surfaced to the user instead of claiming the complete reset succeeded. The confirmation now clarifies that this clears the app's saved TradeNet history snapshot; it does not delete broker-held execution records, which may be fetched again on a later broker-history refresh.

### Regression coverage

Added tests for:
- clearing all portfolio-owned and broker-history state while preserving user settings;
- writing and reading an explicit empty local history snapshot;
- reporting local history persistence failures;
- clearing cloud history with an encrypted empty snapshot;
- clearing again after another device has repopulated the record, using the latest revision rather than an old no-change fingerprint;
- Russian localization of reset completion and failure states.

## Compatibility and risk posture

- No Worker, Durable Object, authentication, encryption format, endpoint, or persisted schema was changed. The existing `/api/history` encrypted-payload and revision contract is reused.
- Ordinary `pushCloudHistory()` continues to treat empty arrays as a no-op. Only the explicit full-reset method can force an empty history record.
- Normal portfolio sync and separate history sync remain separate responsibilities.
- Broker calculations, FIFO matching, fees, commissions, rollover behavior, and trade economics are unchanged.

## Branch and validation

This branch starts directly from the merged PR #179 result on `main`; no old audit branch was rebased or force-updated.

A local clone was attempted but the environment still cannot resolve `github.com`. No local typecheck, Vitest, build, dependency audit, or browser test is claimed. The PR's exact-head CI must pass typecheck, tests, production build, dead-code validation, and production dependency security audit before merge. Browser verification of the full reset and the post-reset Trades desk state remains a release review item.
