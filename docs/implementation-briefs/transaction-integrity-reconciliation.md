# Implementation brief — Transaction integrity & broker reconciliation

**Parent contract:** `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
**Branch:** `impl/transaction-reconciliation`  
**Target:** plan branch  
**Status:** implementation scaffold

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

## Acceptance checklist

- [ ] Stable broker identity/revision contract documented with fixtures.
- [ ] Import and replay are idempotent.
- [ ] Partial fills and corrections update active history exactly once.
- [ ] Fees and cashflows have explicit type/sign/currency.
- [ ] Reconciliation explains every mismatch and never silently mutates state.
- [ ] Historical cost basis and realized/unrealized P&L match golden examples.
- [ ] PR #391 tests remain intact and pass.
- [ ] Vitest, typecheck, lint, build, browser smoke and i18n checks pass.

## Explicit non-goals

Do not redefine long/short position direction (PR #1), margin maintenance formulas (PR #2), tenant authorization (PR #4), or corporate action ingestion (PR #5).