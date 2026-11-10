# Stage 1 — financial integrity implementation record

**Date:** 2026-11-11  
**Repository:** armave/portfolio-terminal  
**Target branch:** `dev`  
**Delivery:** one coordinated client/domain Pull Request  
**Scope:** transaction journal confidence, broker reconciliation safety and margin-risk transparency

## Implementation delivered in this PR

- [x] Preserve the margin-risk input's source observation timestamp and quote/account freshness on the returned snapshot.
- [x] Carry those provenance fields into the Margin Intelligence context instead of dropping them after calculation.
- [x] Pass the full calculated risk snapshot into Margin Risk Overview.
- [x] Show long and short exposure, cash, margin debit, eligible collateral and its provenance, initial margin, broker maintenance requirement, concentration add-on, total maintenance requirement, estimated financing costs, input freshness and source observation time.
- [x] Label configured maintenance and stop-out values as configured thresholds/buffers.
- [x] Render missing broker margin requirements as “Not reported”; do not substitute zero or claim broker confirmation.
- [x] Preserve Russian localization for all newly visible labels and provenance states.
- [x] Mark cash-holding buy/sell/adjustment events as incomplete in the stock-lot replay because no cash-holding acquisition-lot cost-basis contract exists yet.
- [x] Add Vitest regression coverage for snapshot provenance, localization, UI wiring and cash-holding replay status.
- [x] Preserve existing broker execution/cashflow reconciliation behavior as read-only; no automatic broker-to-ledger writeback is added.

## Existing Stage 1 foundations preserved

The PR builds on the existing transaction journal and idempotency foundation, immutable balance-adjustment reversals, stock-trade FIFO lot replay and parity, and broker execution/cashflow/fee matching. It does not duplicate these systems or switch canonical portfolio state away from the existing positions/closed-history model.

## Explicit limitations and operational acceptance gates

- [ ] Run typecheck, full Vitest suite, production build, dead-code/dependency audits and browser smoke on the exact PR head.
- [ ] Complete authenticated live Freedom/TradeNet reconciliation QA with anonymized broker fixtures.
- [ ] Complete backup/export/import and encrypted cloud-restore rehearsal with journal parity.
- [ ] Complete real cross-tab and cross-device stale-revision/conflict QA.
- [ ] Implement cash-holding acquisition-lot cost basis and realized P&L only after defining a versioned event/accounting contract.
- [ ] Extend trade/lot and corporate-action correction semantics only after exact inverse accounting is modeled.
- [ ] Add broker-reported eligible collateral and initial/maintenance margin inputs only after verifying the actual endpoint contract and units. The current client snapshot does not document those fields.
- [ ] Do not enable a canonical-ledger cutover or automatic reconciliation writeback in this PR.

## Deployment topology

This PR contains client/domain and documentation changes only. No Cloudflare Worker, Durable Object or server-side authorization code is changed, so no direct-to-`main` deployment is required.
