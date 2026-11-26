# Trades history synchronization ownership

## Status and scope

The administrator Closed History workflow now uses one app-owned synchronization coordinator for scheduled refresh, Manual Sync, Trades-page initialization/recalculation, and broker-fill follow-up. The implementation is client-side; it does not change Worker or Durable Object endpoints, persisted portfolio schemas, fee formulas, or cloud revision semantics.

## Ownership

- `app.ts` remains the runtime composition root and creates `createTradesHistorySyncRuntime`.
- `src/services/tradesHistorySyncRuntime.ts` owns account/session-scoped in-flight work, operation identity, coalescing, refresh priority, and bounded in-memory diagnostics.
- The app-owned reconciliation operation owns cloud-history pull/merge, cashflow retrieval, existing fee-allocation and audit calculations, canonical-store commit, local snapshot/sidecar persistence, and the conditional encrypted cloud-history push. For duplicate stable execution/cashflow IDs, authenticated cloud rows override local sidecar/cache copies; unique local-only rows are retained because the provider has no verified deletion/tombstone contract. A fresh broker cashflow response is applied after cloud rows and can correct a matching operation.
- `ClosedHistoryDesk` owns presentation, user intent, and view-local foreground broker-refresh state. It requests shared reconciliation and renders canonical store data; it does not independently fetch or persist cashflows or fees.
- `CashActivityLedger` is a read-only presentation projection inside the Trades desk. It does not fetch broker history, persist a separate cash ledger, or issue cash-posting commands. Existing app journal events—including legacy manual entries—remain visible as historical evidence; broker-imported records remain evidence-only.
- `src/domain/` remains the owner of deterministic merge, cashflow normalization, allocation, audit, and trade-checkpoint calculations.

The shared coordinator is deliberately not another financial store. `PortfolioStore` remains the only canonical portfolio-state owner, and `PortfolioState.positions` remains canonical. Cash Activity reads the same store: available USD cash remains `cashCushion.freeCash`, and signed `balance` remains the margin-debt source.

## Operation semantics

The runtime accepts two modes:

- `refresh`: pull cloud history first, merge local/current history while giving cloud rows precedence for duplicate stable IDs, then refresh cashflows when required. Unique local-only rows remain until a source with a verified deletion contract says otherwise. Scheduled and manual calls keep their existing provider-refresh behavior; fresh broker cashflow rows are applied last. A Trades-page read can skip a cashflow provider request when a completed baseline already contains the same latest closed-trade checkpoint.
- `recalculate`: reuse the accepted cashflow rows and rerun existing fee-allocation/audit calculations after relevant portfolio inputs change. It does not initiate another cashflow provider request.

Requests are scoped by authenticated account identity plus session generation. Same-session callers join compatible active work only when the current fee-allocation input fingerprint also matches. The fingerprint covers cashflows, broker executions, app closed trades, tranche funding rules and mixes, and canonical open positions only when broker executions are absent; it excludes quote-only changes. A stronger provider refresh waits behind a cache-only Trades pass. A recalculation whose input fingerprint changes during an active refresh or recalculation is queued and runs against the latest canonical state. A provider refresh can satisfy a matching-input recalculation. A broker event that changes the canonical execution inputs requests a follow-up refresh; same-date fills are detected by the existing closed-trade checkpoint.

The trade checkpoint is captured before the cashflow request and persisted only after the resulting local/cloud work succeeds. It is not recomputed from broker rows that arrived during that request: those later fills remain eligible for a follow-up pass. The coordinator's input fingerprint is computed when each request enters the app owner, so different inputs queue instead of joining an already-running pass. Cashflow baseline and trade checkpoint storage remain account-scoped and retain their prior compatibility semantics.

## Foreground progress ownership

The Trades page's explicit **Refresh history** action has a request ID. A matching result settles that request. Generic stream events and other background broker updates may refresh the displayed execution rows, but they do not settle an unrelated foreground request. The delayed-visibility controller remains a presentation-only layer; unrelated cloud-history or fee work does not drive the broker spinner.

The coordinator generates an operation ID and tracks status, start/completion times, duration, counts, coalescing, and queued refreshes. These diagnostics are bounded and in-memory only. They do not contain or expose account/session keys, tickers, amounts, portfolio payloads, credentials, encryption material, or raw provider responses. The app does not transmit them to an external telemetry service. No PT-16 telemetry sink, retention policy, or privacy approval is implied.

## Persistence and recovery invariants

1. Cloud workspace state and encrypted Closed History remain separately revisioned records.
2. Cloud execution/cashflow records override matching local sidecar copies, while unique local-only rows remain available for recovery. Bounded/incremental broker pages do not replace the complete accepted history; fresh provider corrections are applied last.
3. Existing fee allocation and audit helpers are reused unchanged. No FIFO, commission, margin-interest, realized-P&L, or rounding formula changes are included.
4. A rejected `commitClosedHistoryFeeSync` leaves the previous snapshot active.
5. A failed portfolio snapshot save restores the prior in-memory snapshot and stops before a cloud-history push.
6. Local saved-history sidecar failure is surfaced as a cache warning and follows the existing cloud-checkpoint behavior; it is not silently represented as a successful local sidecar write.
7. Cloud-history writes continue to use the existing session guard and revision-aware API. Conflicts are not retried by inventing a new revision or overwriting a newer remote record.
8. A late result from a different session generation cannot update the active session's synchronization status or store.
9. Valid empty provider snapshots remain valid inputs. Missing, malformed, incomplete, or unavailable financial observations are not coerced into zero values.

## Validation and remaining release evidence

Vitest covers coordinator coalescing for identical inputs, queued refreshes for changed fill/allocation snapshots, cache-only recalculation, account-generation changes, diagnostic redaction, and request-owned reducer settlement. Source-level Trades tests assert the application entry points share one owner, the desk has no independent history write path, and English/Russian copy remains paired.

The exact PR head must still pass the repository's GitHub Actions gates: typecheck, full Vitest, production build, dead-code/dependency/security checks, financial regression where path filters apply, production browser smoke, and Operations Browser Journey. A passing mocked browser journey is not live authenticated TradeNet proof. Live broker lifecycle/reconnect validation and the separate PT-17 authenticated performance/observability acceptance gates remain distinct.

No Worker deployment is required by this client-only change. The PR targets `dev`; production promotion to `main` remains a separate, validated release step that preserves `main`'s production-only ancestry.
