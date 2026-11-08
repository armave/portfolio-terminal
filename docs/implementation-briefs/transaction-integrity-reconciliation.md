# Implementation brief — Transaction integrity & broker reconciliation

**Parent contract:** `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
**Branch:** `impl/transaction-reconciliation`  
**Target:** plan branch  
**Status:** implemented; authenticated live-account validation remains open

## Mission

Make imported executions, fees, cash movements and broker corrections deterministic and explainable. Re-syncing broker history must never double-count trades or cashflows.

## Required investigation

Trace broker order history, execution history, app-created trade events, transaction journal, FIFO/cost-basis calculations, fees, dividends, interest, deposits/withdrawals, cash reconciliation and performance-history consumers.

Determine which APIs provide stable account/order/execution IDs, fill sequence, revision/correction references, timestamps, currencies, fee breakdowns and status transitions. Record endpoint fixtures and data limitations.

## Implementation requirements

- Keep order and execution/fill identities distinct. One order may have several partial fills.
- Use broker-stable identities and revision semantics; do not rely only on ticker/date/price/quantity heuristics when stable IDs exist.
- Make sync/replay idempotent across retries, pagination overlap, app restarts and broker revisions.
- Correctly handle partial fills, duplicate pages, cancel/replace, bust/correct, trade corrections and late-arriving executions.
- Normalize commissions, exchange/regulatory fees, taxes, dividends, interest, deposits and withdrawals into explicit event types and currencies.
- Ensure cash delta, position delta, fee impact and realized P&L reconcile exactly once. Document FIFO/average-cost selection and rounding.
- Add a reconciliation report that identifies app-vs-broker position, cash and history differences with source evidence and suggested resolution.
- Require user approval before applying corrective changes; preserve the previous state and audit trail.
- Respect PR #391's performance availability guard. Do not modify its two files or recreate its fix.

## Likely areas to inspect

- Transaction journal/event types and helpers.
- Broker execution reconciliation modules and tests.
- Freedom trade/balance adapters.
- Closed-history fee and cashflow mapping.
- Store actions only where necessary; coordinate if a shared store file becomes unavoidable.

## Required tests

- Same response replayed many times.
- Pagination overlap and duplicate execution.
- One order with multiple partial fills.
- Correct/cancel/replace/bust and later revision.
- Same ticker/time with distinct executions.
- Fee revision and late-arriving commission.
- Dividend, financing interest, deposit/withdrawal and multi-currency movement.
- App restart/backup/restore and known-balance reconciliation.

## Implemented revision and source contract

- The TradeNet history fixture retains `id`/trade ID as the execution reference and `order_id` as the parent order reference. The authenticated order stream maps order operations 1 and 2 to BUY, 3 to SELL, and 4 to SELL_SHORT before the generic history normalizer.
- Audit revision chains are append-only and source-scoped. A new revision links to the previous revision head; replaying the same facts is a no-op, including a correction that later reverts to an earlier value.
- Restore order is resolved from `relatedEventId`, not device timestamps. When concurrent devices create multiple correction heads from the same parent, the resolver returns every competing head and a later broker import does not select or extend either branch automatically.
- Parent-order aggregation requires a verified common order ID. Missing or conflicting identity remains provisional rather than being inferred from ticker/time/quantity alone.
- Imported broker evidence does not post cash, debt or position deltas to the canonical portfolio. The journal stores signed account movement separately from positive fee/financing-cost magnitudes.

## Acceptance checklist

- [x] Provider identity contract is documented by the normalized TradeNet history fixture and order-stream contract: fill ID is distinct from parent `order_id`. Provider account identity and revision markers are not exposed by the verified fixtures and remain a documented limitation.
- [x] Stable-ID import/replay is idempotent across repeated responses and overlapping pages. Conflicting same-ID records are surfaced, and A → B → A corrections remain append-only revisions.
- [x] Verified parent-order partial fills are grouped only within that order. Missing order identity and multiple possible groups remain explicit provisional findings.
- [x] Broker cashflow categories preserve source currency and signed amount; deposits/withdrawals normalize operation direction. Unknown descriptions remain generic adjustments rather than guessed categories.
- [x] Execution/cashflow reconciliation explains mismatches without changing portfolio state; position/cash snapshot reconciliation remains read-only in the existing broker reconciliation boundary.
- [x] FIFO/cost-basis and realized/unrealized P&L formulas were not changed; existing store accounting fixtures remain part of exact-head CI.
- [x] PR #391's performance guard files are untouched; their regression checks remain part of CI.
- [x] Focused regressions, full Vitest/Worker tests, typecheck, production build, browser journeys, performance/dead-code/dependency checks pass on the tested head.
- [x] Reviewed the complete `PortfolioStore` write surface against the PT-02 mutation inventory: buy/sell/partial close, cash/debt, rollover, reset, cash-holding add/sell/remove, tranche removal, closed-history cleanup, import/restore and generic snapshot reconciliation. Derived quote/target/active-view/configuration changes are not financial journal commands.
- [ ] Authenticated Freedom/TradeNet account verification of account scoping, stable provider IDs, parent order semantics, bust/correct behavior and cashflow signs. CI fixtures are not live-account evidence.
- [ ] Multi-device backup/restore and cross-tab QA with an authenticated account.

## Explicit non-goals

Do not redefine long/short position direction (PR #1), margin maintenance formulas (PR #2), tenant authorization (PR #4), or corporate action ingestion (PR #5).