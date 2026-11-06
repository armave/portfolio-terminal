# Wave 2 workstream PT-02 — Transaction integrity and audit history

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Implementation PR:** [#357](https://github.com/armave/portfolio-terminal/pull/357)  
**Dedicated branch:** `feat/wave2-pt-02-transaction-integrity`  
**Base:** `dev`

## Wave 2.1 delivery

Wave 2.1 is the first additive transaction-integrity release. It deliberately retains the existing portfolio snapshot as canonical and adds an append-only audit/verifier journal beside it. It is not a migration to a ledger as the source of truth.

- [x] Schema-versioned event contracts and validation, stable IDs, source/actor, effective and recorded timestamps, currency and amount details, idempotency key and request fingerprint.
- [x] Append-only journal helpers with frozen event records and arrays; duplicate import records are ignored while conflicting IDs or idempotency keys are rejected.
- [x] Atomic persistence for covered store-owned financial mutations: state and event persist together before subscribers see the new snapshot. Persistence rejection leaves the previous in-memory state and journal unchanged.
- [x] Explicit actor and source attribution for manual commands and confirmed AI actions. Confirmed AI actions carry a request-scoped idempotency key from confirmation through the store; retrying the same sale request with a later wall-clock timestamp does not apply it twice.
- [x] Journal margin-position buys and partial/full sells with gross value, commissions, allocated financing cost, net proceeds, cash/debt movement and realized P&L.
- [x] Journal cash/free-cash and margin-debt adjustments, rollover interest/debt movement, and cash-cushion holding add/sell/remove actions.
- [x] Journal tracking/history cleanup as correction events rather than inventing a sale. Cash-holding adds without a manual execution price do not infer cost basis; cash-holding sales do not claim realized P&L when that holding type has no cost-basis model.
- [x] Import read-only broker execution and cashflow evidence with stable external references and revision links. Cashflows are classified as dividend, fee, margin interest, deposit, withdrawal, transfer, or corporate-action evidence where the source description supports it. These imported broker rows are audit evidence only: they do not post again to local cash/debt/positions that already reflect the canonical account snapshot.
- [x] Replay explicit app-owned journal deltas and verify parity against canonical positions, cash-holding quantities, free cash and margin debt. Snapshot/import discrepancies create explicit reconciliation events; they are not guessed as executions and do not invent cost basis, fees or P&L.
- [x] Older local/cloud snapshots without a journal remain readable. Validated backup import/export preserves schema-v1 events and rejects malformed transaction history rather than silently discarding it. Cloud payload validation accepts valid events and rejects malformed journal rows.
- [x] Validated state restore merges the event journal append-only. Conflicting event history is rejected without replacing local state.
- [x] Cloud snapshot writes retain the existing revision/ETag `If-Match` guard; stale updates are rejected with a conflict response rather than silently replacing newer cloud state. Per-tab writes are serialized, and tests cover a pull completing after a queued write was submitted. The app directs users to export, pull, reconcile, then retry; it does not auto-merge concurrent financial changes.
- [x] English/Russian conflict messaging and Vitest regression coverage for event schema/merge, mutation lifecycle, retry/reload, AI attribution, broker history, replay/parity, malformed cloud/backup payloads, and persistence rollback.
- [x] Production build budget retained. The transaction journal is split into its own bundle chunk; the existing entry and gzip limits were not raised.

## Ownership and canonical-state safety

- `PortfolioState.positions` and the existing cash/debt fields remain canonical. The journal is an audit and verification layer, not a competing source of truth.
- No silent change to FIFO, P&L, commission, financing, cash settlement, rollover, rounding or timezone semantics.
- Broker execution/cashflow imports preserve provider facts and provenance but do not double-post those external facts into the already-refreshed canonical portfolio.
- Reconciliation records only observed signed quantity/cash/debt deltas. It never infers whether a missing snapshot delta was a buy, sale, deposit, fee, commission, or corporate action.
- Corporate-action cashflow rows are classified as external evidence only. This PR does not apply stock-split ratios, merger consideration, spin-off basis allocations, or tax treatment to canonical holdings.

## Exact-head validation

The final commit and exact-head workflow results are recorded in PR [#357](https://github.com/armave/portfolio-terminal/pull/357). Merge only after all three required workflows complete successfully on the final commit:
- Pull Request CI: typecheck, complete Vitest suite, dead-code validation, audits, production build and bundle budget.
- Operations Browser Journey: unit/Worker suite and production browser account/Settings journey.
- Trade Lifecycle Browser Smoke: production browser trade lifecycle and deterministic lifecycle tests.

Automated fixtures do not establish authenticated live TradeNet correctness. No manual authenticated broker QA or real multi-device concurrency test is claimed.

## Explicit follow-on scope — not a Wave 2.1 blocker

- [ ] Full PT-02 mutation-path ownership review across all future portfolio features and provider-specific imports; new financial commands must use the journal-aware store boundary.
- [ ] Server-side idempotency and a distributed transaction protocol. Current command idempotency is persisted in the portfolio journal; cloud revision checks reject stale writes, but no global exactly-once guarantee exists.
- [ ] Cross-tab local write coordination/merge. Cloud revision conflicts prevent last-writer-wins overwrite, but conflicting changes require a human export/pull/reconcile workflow.
- [ ] Executable corporate-action accounting and explicit broker correction/reversal workflows, including position/cost-basis/tax treatment.
- [ ] A separate gated decision on any future canonical ledger cutover, with a versioned migration and rollback plan.
- [ ] Manual validation against an authenticated live TradeNet account and real multi-device usage. The checked-in browser tests are deterministic fixtures.
- [ ] Older builds may not understand the additive event journal if they rewrite an imported snapshot. Before rolling back to a build predating this schema, export a current JSON backup; restore that backup in a journal-aware build.

## Delivery status

Wave 2.1 can be reviewed and merged as the additive first release once exact-head CI is green. Tracking issue #330 remains open for the follow-on PT-02 scope above. PT-04, PT-06, PT-07 and PT-08 retain their own implementation branches and PRs.

