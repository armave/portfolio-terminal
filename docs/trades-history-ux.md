# Trades history UX contract

The Trades desk presents cached records immediately while keeping broker freshness explicit.

## Provider freshness and refresh

- The Trades header distinguishes TradeNet execution history from cashflow reconciliation.
- The displayed provider-refresh timestamp advances only after a successful TradeNet REST execution-history read.
- Re-emitting cached rows because a healthy stream is connected, or reusing a recent cached read, does not advance provider freshness.
- The explicit **Refresh history** action uses the existing waitable interactive broker request so it performs a provider catch-up rather than merely replaying cached history.
- A failed refresh leaves last-known-good history visible and labels it stale with a retry path.
- The automatic catch-up requested when Trades mounts is quiet when cached rows are already available. The header refresh indicator is reserved for the explicit **Refresh history** action; a desk with no cached records keeps its initial loading state until the first read settles.
- The global cloud indicator represents encrypted cloud workspace synchronization, not broker freshness. Background checkpoint writes and scheduled guest-projection reads do not enter an animated pending state; explicit/manual operations own the aggregate progress state. Errors and revision conflicts remain visible. A successful quiet checkpoint also cannot clear an explicit Manual Sync that is still in progress; errors and revision conflicts continue to surface immediately.
- Repeated Manual Sync requests within one authenticated session join the active request instead of launching duplicate provider calls. Requests from a different account session or a later authentication generation of the same account remain isolated, and late results from an old session cannot overwrite the current session's status.

## Sorting and filtering

Filtering is applied before sorting and pagination. The summary remains scoped to the filtered rows. Sorting supports newest, oldest, exact highest/lowest net P&L, and largest position. Rows with unknown dates, missing P&L, upper-bound P&L, or missing share counts sort after known values; unknown financial values are never coerced to zero for ranking. Sort order and filters are presentation state and do not mutate portfolio records.

## Financial quality explanations

- Upper-bound net P&L is labeled as an upper bound when commission inputs are incomplete.
- Unknown/incomplete net P&L is excluded from exact net P&L and win-rate totals.
- Incomplete commissions explain that displayed known costs are a lower bound.
- These explanations do not change accounting, FIFO matching, commission allocation, or any financial formula.

All added user-facing copy must be localized in English and Russian. The feature is client-only; broker API contracts, Worker behavior, persisted portfolio schema, and canonical PortfolioState.positions remain unchanged.



## Recalculation and checkpoint efficiency

The Trades fee-allocation fingerprint is a memoized presentation/runtime dependency, not a new accounting cache. It is invalidated when cashflows, broker executions, app closed trades, tranche funding rules, tranche mixes, or (when broker execution history is absent) canonical open positions change. When broker executions are present, open positions are not passed as an allocation source, so quote-only position updates do not force the same large input projection and JSON serialization to run again. The deterministic allocator and its inputs remain unchanged.

Cloud workspace checkpoints read the current canonical state without committing a timestamp-only portfolio mutation. A timer firing is not itself a portfolio change; actual durable mutations continue to update their existing local-save metadata. Cloud revision, encryption, conflict, and last-known-good behavior remain unchanged.
