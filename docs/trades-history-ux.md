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

## Shared synchronization ownership

Scheduled Closed History refresh, Manual Sync, Trades-page initialization/recalculation, and follow-up work after a new broker fill enter the same account/session-generation-scoped coordinator. Compatible same-session requests join one active operation; a stronger provider refresh queues behind a cache-only Trades pass. A late result from a previous account session cannot update the active session.

The coordinator is the owner of the separately encrypted cloud-history pull/merge, cashflow baseline or overlapping incremental fetch, existing fee allocation/audit calculation, canonical store commit, local snapshot/sidecar persistence, and revision-aware cloud-history push. The Trades desk only renders canonical state and requests that operation. It no longer has a second cashflow API, allocation, or history persistence path. A follow-up is queued when broker executions or other fee-allocation inputs change; the coordinator compares their input fingerprint so distinct snapshots do not join stale work. The saved checkpoint reflects the trade set used to select the cashflow fetch window so a fill arriving during that fetch is not skipped.

The explicit broker-history refresh carries a request ID. Incoming stream/background rows can update what the desk displays but cannot finish a different foreground refresh; only its matching completion may settle that loader. This is independent from the cloud workspace indicator and cashflow-reconciliation state.

Operation diagnostics are bounded and in-memory only (counts, coalescing/queue counts and durations). They are not sent to telemetry services and do not satisfy PT-16 privacy/retention approval or PT-17 production observability acceptance.

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


## Shared operation feedback

The global Cloud indicator and the Trades foreground TradeNet refresh use the same presentation-only `OperationActivityIndicator`. Their state owners remain separate: cloud workspace sync is sourced from cloud sync status, while the Trades indicator is sourced only from the matching broker execution-history refresh request. Cashflow reconciliation, fee recalculation and quiet cloud-history hydration do not drive the Trades spinner.

Both workspace indicators use the shared 700 ms appearance delay and 650 ms minimum visible duration. The lower-level delayed-visibility controller retains its 400 ms default for other callers. The shared component does not schedule, coalesce or perform synchronization work.


## Cash Activity workspace

Trades has two views: **Closed trades** and **Cash Activity**. The Cash Activity view reads the canonical store's normalized broker cashflows and app-owned cash/debt journal events; it does not start its own provider requests or create a parallel cash state.

The header remains linked to the existing broker-history/cashflow synchronization owner. Selecting Cash Activity is not itself a refresh. Opening the tab is not blocked by the foreground Trades execution-history loader; that loader remains scoped to the Closed trades view.

The ledger supports search, category and period filters, verified USD inflow/outflow summaries, and an admin-only manual entry form. Provisional and unclassified source rows remain visible with a quality label, but are excluded from verified USD totals. Non-USD rows are visible and excluded from those totals. Manual outflows reject when current available USD cash is insufficient; they do not create margin borrowing. Margin interest is a separate explicit debt-capitalization category.

English and Russian copy is routed through the existing localization dictionaries. The ledger is responsive: summary cards collapse to two columns on narrow screens, manual entry controls become one column, and activity rows reflow into stacked mobile cards.
