# Trades history synchronization ownership

## Status and scope

The administrator Closed History workflow now uses one app-owned synchronization coordinator for scheduled refresh, Manual Sync, Trades-page initialization/recalculation, and broker-fill follow-up. The implementation is client-side; it does not change Worker or Durable Object endpoints, persisted portfolio schemas, fee formulas, or cloud revision semantics.

## Ownership

- `app.ts` remains the runtime composition root and creates `createTradesHistorySyncRuntime`.
- `src/services/tradesHistorySyncRuntime.ts` owns account/session-scoped in-flight work, operation identity, coalescing, refresh priority, and bounded in-memory diagnostics.
- The app-owned reconciliation operation owns cloud-history pull/merge, cashflow retrieval, existing fee-allocation and audit calculations, canonical-store commit, local snapshot/sidecar persistence, and the conditional encrypted cloud-history push.
- `ClosedHistoryDesk` owns presentation, user intent, and view-local foreground broker-refresh state. It requests shared reconciliation and renders canonical store data; it does not independently fetch or persist cashflows or fees.
- `src/domain/` remains the owner of deterministic merge, cashflow normalization, allocation, audit, and trade-checkpoint calculations.

The shared coordinator is deliberately not another financial store. `PortfolioStore` remains the only canonical portfolio-state owner, and `PortfolioState.positions` remains canonical.

## Operation semantics

The runtime accepts two modes:

- `refresh`: pull cloud history and merge local/current history, then refresh cashflows when required. Scheduled and manual calls keep their existing provider-refresh behavior. A Trades-page read can skip a cashflow provider request when a completed baseline already contains the same latest closed-trade checkpoint.
- `recalculate`: reuse the accepted cashflow rows and rerun existing fee-allocation/audit calculations after relevant portfolio inputs change. It does not initiate another cashflow provider request.

Requests are scoped by authenticated account identity plus session generation. Same-session callers join compatible active work. A stronger provider refresh waits behind a cache-only Trades pass; a refresh waits behind an active local recalculation. A provider refresh can satisfy an overlapping recalculation. A broker event that adds or changes execution history requests a forced follow-up refresh so a fill arriving during an earlier cashflow read is not missed.

The trade checkpoint is captured before the cashflow request and persisted only after the resulting local/cloud work succeeds. It is not recomputed from broker rows that arrived during that request: those later fills remain eligible for a follow-up pass. Cashflow baseline and trade checkpoint storage remain account-scoped and retain their prior compatibility semantics.

## Foreground progress ownership

The Trades page's explicit **Refresh history** action has a request ID. A matching result settles that request. Generic stream events and other background broker updates may refresh the displayed execution rows, but they do not settle an unrelated foreground request. The delayed-visibility controller remains a presentation-only layer; unrelated cloud-history or fee work does not drive the broker spinner.

The coordinator generates an operation ID and tracks status, start/completion times, duration, counts, coalescing, and queued refreshes. These diagnostics are bounded and in-memory only. They do not contain or expose account/session keys, tickers, amounts, portfolio payloads, credentials, encryption material, or raw provider responses. The app does not transmit them to an external telemetry service. No PT-16 telemetry sink, retention policy, or privacy approval is implied.

## Persistence and recovery invariants

1. Cloud workspace state and encrypted Closed History remain separately revisioned records.
2. Provider execution rows are merged with saved history; bounded/incremental pages do not replace the complete accepted history.
3. Existing fee allocation and audit helpers are reused unchanged. No FIFO, commission, margin-interest, realized-P&L, or rounding formula changes are included.
4. A rejected `commitClosedHistoryFeeSync` leaves the previous snapshot active.
5. A failed portfolio snapshot save restores the prior in-memory snapshot and stops before a cloud-history push.
6. Local saved-history sidecar failure is surfaced as a cache warning and follows the existing cloud-checkpoint behavior; it is not silently represented as a successful local sidecar write.
7. Cloud-history writes continue to use the existing session guard and revision-aware API. Conflicts are not retried by inventing a new revision or overwriting a newer remote record.
8. A late result from a different session generation cannot update the active session's synchronization status or store.
9. Valid empty provider snapshots remain valid inputs. Missing, malformed, incomplete, or unavailable financial observations are not coerced into zero values.

## Validation and remaining release evidence

Vitest covers coordinator coalescing, queued/forced refresh priority, cache-only recalculation, account-generation changes, diagnostic redaction, and request-owned reducer settlement. Source-level Trades tests assert the application entry points share one owner, the desk has no independent history write path, and English/Russian copy remains paired.

The exact PR head must still pass the repository's GitHub Actions gates: typecheck, full Vitest, production build, dead-code/dependency/security checks, financial regression where path filters apply, production browser smoke, and Operations Browser Journey. A passing mocked browser journey is not live authenticated TradeNet proof. Live broker lifecycle/reconnect validation and the separate PT-17 authenticated performance/observability acceptance gates remain distinct.

No Worker deployment is required by this client-only change. The PR targets `dev`; production promotion to `main` remains a separate, validated release step that preserves `main`'s production-only ancestry.
