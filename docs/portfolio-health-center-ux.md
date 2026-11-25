# Portfolio Health Center and reconciliation entry

## Status and scope

**Implemented on dev as a client-only administrator Combined Portfolio refinement.** Production availability depends on a separately reviewed promotion to main.

The Portfolio Health Center gives a compact view of four existing source contracts and a direct entry to the existing read-only broker reconciliation panel. It does not create a new financial store, sync scheduler, broker request, telemetry sink, or reconciliation engine.

## Source status semantics

- **TradeNet account stream** is live only after the active administrator session has a connected browser socket and validated events from both the portfolio and orders channels. A connected socket awaiting either event is shown as waiting; a disconnected stream is shown with the REST fallback path. Stream health is in-memory and account-session scoped.
- **Market quotes** summarize tracked positive-quantity Margin positions and cash holdings with the existing quote freshness classifier. Missing or unusable prices are classified as unavailable; unknown timestamps, stale observations and incomplete provider quality remain visible as attention items. Delayed observations are not relabelled as live.
- **Trade history** is provider-confirmed only when the app has recorded a successful REST execution-history completion for the current administrator account session. Cached executions remain available but are not promoted to a confirmed provider refresh. Live order fills do not advance the REST refresh timestamp.
- **Cloud portfolio** reuses the existing cloud status and last-confirmed sync timestamp. Conflicts and errors remain distinct; a failure does not discard the last confirmed timestamp or imply that the broker stream has failed.

The cards describe separate sources. No single overall connected state is inferred from them.

## Reconciliation entry

The **Review broker activity** action opens Trades and expands its existing reconciliation section. That section compares broker executions, cashflows and quote evidence with app journal records. Review notes remain audit-only; the workflow is read-only and does not resolve findings or write financial state.

## Boundaries

- No changes to the canonical portfolio positions, persisted accounting records, financial formulas, cashflow posting behavior, broker APIs, Worker routes, Durable Object storage or authorization.
- No source is marked current without a source-specific confirmation event.
- Missing, stale, incomplete or unavailable data is not converted to zero.
- All new user-facing copy uses the English/Russian localization dictionary.
- The status subscription contains only the changed session key; it does not publish portfolio or broker payloads.

## Validation

Vitest covers quote-state qualification, the requirement for both private stream channels, cached-versus-provider-confirmed history, stream health notifications, reconciliation shortcut routing and English/Russian parity. Exact-head GitHub Actions remains the authoritative typecheck, full test, build, browser and security validation.
