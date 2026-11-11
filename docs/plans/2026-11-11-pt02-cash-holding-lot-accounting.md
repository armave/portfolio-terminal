# PT-02 implementation slice — cash-holding lot accounting

**Date:** 2026-11-11  
**Repository:** `armave/portfolio-terminal`  
**Branch:** `feat/pt02-cash-holding-lot-accounting`  
**Target:** `dev`  
**Delivery:** one client/domain Pull Request

## Delivered

- [x] Add optional `CashStockLot` metadata to cash holdings without requiring a snapshot migration.
- [x] Store stable lot identity, exact acquisition date/time, entered price, quantity and buy commission for manually priced cash-holding additions.
- [x] Keep unpriced additions quantity-only and incomplete for cost-basis replay.
- [x] Preserve app-owned lots during Freedom portfolio classification; complete app lots take precedence over broker-derived aggregate average prices. Partial app coverage has no aggregate average.
- [x] Reuse the existing FIFO allocation engine for cash-holding sales.
- [x] Persist cash-holding sale allocations, sale fees, realized P&L and remaining lots in the same atomic state/event update.
- [x] Add a dedicated cash-holding replay projection and optional parity comparison against canonical cash-holding lots.
- [x] Classify broker-only quantity changes, unpriced legacy additions, stale/partial cost-basis histories and tracking removals as incomplete. No synthetic lot or cost basis is created.
- [x] Keep manual cash additions outside free-cash settlement as before. No claim of broker execution is added.
- [x] Add tests for multi-lot FIFO partial sales, realized P&L, event coverage, reload persistence, quote/average-price classification and broker-average safety.

## Accounting behavior

For a cash holding with complete app-recorded lots, a sale consumes oldest lots first. The sale event retains exact lot allocations and realized P&L after allocated buy commissions, sell commission and financing cost (zero for this cash-holding path). The canonical holding snapshot retains the remaining lot quantities and recomputed weighted average entry price.

A cash-holding buy made without an explicit entry price does not create a lot. A broker average price does not become a synthetic lot. If a cash holding contains any quantity not covered by known app-recorded lots, aggregate average cost remains unavailable. A sale is still allowed for legacy/unpriced holdings, but the event omits lot allocations and realized P&L and is reported incomplete by lot replay.

Removing a cash holding from tracking remains a tracking correction, not an implied sale. No proceeds or realized P&L are recorded for that operation.

## Validation

- [x] Vitest fixtures added for cash-holding lot creation, multi-lot FIFO sale, realized P&L, remaining-lot parity, incomplete legacy handling and broker average-price preservation.
- [ ] Exact-head GitHub Actions typecheck, full Vitest, production build, dependency/dead-code audits and browser journeys.
- [ ] Authenticated live Freedom/TradeNet validation.
- [ ] Backup/export/import and encrypted cloud-restore rehearsal.
- [ ] Real multi-device stale-revision/conflict QA.

## Explicit non-goals

- No Cloudflare Worker, Durable Object or server-side authorization changes.
- No direct broker writeback or automated reconciliation corrections.
- No conversion of imported broker averages or unpriced aggregate holdings into app-owned lots.
- No cash-settlement change for manual cash-holding additions.
- No new trade, cash-lot or corporate-action reversal semantics.
- No canonical-ledger cutover; `PortfolioState` remains authoritative.
