# Wave 2 workstream PT-02 — Transaction integrity and audit history

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Implementation PR:** [#357 — Draft](https://github.com/armave/portfolio-terminal/pull/357)  
**Dedicated branch:** `feat/wave2-pt-02-transaction-integrity`  
**Base:** `dev`

## Objective

Make supported financial mutations atomic, idempotent, auditable, and recoverable without an unapproved ledger cutover.

## Dependencies

PT-01 financial contracts are merged. `PortfolioState.positions` remains canonical active-position state. PT-04, PT-06, and PT-08 consume PT-02's stable transaction/event contracts.

## Wave 2.1 implementation delivered in this PR

- [x] Added schema-versioned transaction event types and runtime validation in `src/types/portfolioTransaction.ts` and `src/domain/portfolioTransactionJournal.ts`.
- [x] Added stable event IDs, actor/source, effective/recorded timestamps, optional currency/amount/quantity/fee fields, command fingerprint, and optional caller idempotency key.
- [x] Added immutable append and import-merge helpers. Exact duplicate records are ignored; conflicting event IDs/idempotency keys are rejected.
- [x] Added optional `transactionEvents` to `PortfolioState`; new portfolios initialize it; legacy snapshots without it normalize to an empty journal.
- [x] Included the journal in the same full portfolio snapshot commit as the corresponding financial state. The existing store persistence-before-publish boundary is reused; failed persistence leaves state and events unpublished.
- [x] Generic `setState` cannot replace the journal. Validated `importState` merges it and cannot erase previously committed events with an older/empty backup.
- [x] Journaled margin-position buys and partial/full sales, including gross amount, commissions, allocated financing, realized P&L, cash movement, and debt movement.
- [x] Journaled cash/free-cash adjustments, margin-debt adjustments, and rollover interest/debt changes. Automatic rollover keys prevent reapplication of the same rollover timestamp.
- [x] Journaled cash-cushion holding additions, sales, and removals. Cash-holding sale events record commission, net proceeds, debt repayment, and cash surplus, but do not invent cost basis or realized P&L.
- [x] Journaled manual active-tranche removal and closed-trade display-history removal as corrections, distinct from actual sale events.
- [x] Portfolio reset preserves prior transaction events and appends a reset marker.
- [x] Explicit idempotency keys are bound to a canonical command fingerprint; reusing a key for a different request is rejected.
- [x] Added Vitest coverage for event validation, append/merge, key conflicts, reload/replay, buy/sell, cash-holding, rollover, corrections, reset, malformed imports, and persistence rollback.

### Semantics and safety

- The journal is an append-only audit/verifier layer in the existing portfolio snapshot. It is **not** a new financial source of truth.
- `PortfolioState.positions` and existing tranche/cash/debt semantics remain unchanged and canonical.
- A cash-cushion holding added without a manually supplied execution price is recorded without a unit price or gross amount. A quote or stored display price is not promoted to cost basis.
- Removing a tranche or holding is recorded as a tracking correction, not a sale; it has no sale proceeds or cash settlement.
- Deleting a closed-trade display record is recorded as a history correction; the transaction sale event remains in the journal.
- Reset does not erase the transaction journal.
- Idempotency is local to the persisted portfolio snapshot and requires a caller-supplied key, except for the automatic rollover/reset keys. Calls without a key are treated as distinct intentional commands.

## Remaining PT-02 scope — not claimed complete

- [ ] Inventory and route every mutation path, including dividends, fees, imports, external broker executions, corporate actions, and cloud restoration.
- [ ] Add transaction-to-position replay/parity verification. The current implementation records audit events but does not reconstruct canonical positions from the journal.
- [ ] Define explicit deposit, withdrawal, transfer, and dividend cash-flow posting semantics; current manual cash/debt setters are balance adjustments, not classified external flows.
- [ ] Add cloud/multi-device transaction coordination, cross-tab stale-write protection, and server-side idempotency/revision semantics. Current idempotency is within the local persisted snapshot and is not a distributed transaction guarantee.
- [ ] Add a reviewed migration/rollback procedure and backup/restore round-trip evidence for large/legacy records.
- [ ] Add correction/reversal relationships for imported broker executions and corporate actions, including provenance and actor identity.
- [ ] Add a final mutation-path inventory proving that no supported financial command can change balances/positions without the intended journal semantics.

## Acceptance criteria

- [x] For the integrated mutation paths above, state and journal append commit together through the store's existing persistence boundary; persistence failure does not publish either.
- [x] Replaying the same explicit idempotency key and fingerprint does not reapply a supported command; key reuse with a different fingerprint is rejected.
- [ ] Every financial mutation path in the full application is covered, including external cash flows, dividends, fees, imports, and broker sync.
- [ ] Journal replay/parity independently verifies canonical positions/cash for supported flows.
- [x] Events include actor/source and effective/recorded timestamps; corrections and resets are represented without deleting transaction evidence.
- [ ] Cloud snapshots, multi-device writes, legacy backup/restore, and revision conflicts have explicit migration/compatibility evidence.
- [x] `PortfolioState.positions` remains the active-position source of truth; no ledger cutover is included.

## Exact-head validation — 2026-11-06

<badge>Candidate: `cbddd2908be9de126675a849e44939ef3eca7a54`</badge>

All three required workflows completed successfully against the exact PR head and base `c7ae6a6d808c7645a9686e32983f0209ec613f88`:

- [x] [Pull Request CI #2886](https://github.com/armave/portfolio-terminal/actions/runs/42174609605) — passed: TypeScript typecheck, **1,571 tests across 133 files**, production build, production browser smoke, desktop/mobile browser performance artifact, dead-code validation, full dependency audit (high-severity threshold), and production dependency audit.
- [x] [Operations Browser Journey #214](https://github.com/armave/portfolio-terminal/actions/runs/42174609580) — passed: unit/Worker tests, build, production-browser account/Settings journey, dead-code validation, full/production dependency audits.
- [x] [Trade Lifecycle Browser Smoke #179](https://github.com/armave/portfolio-terminal/actions/runs/42174609659) — passed: **134 tests across 5 files**, production build, and production-browser trade lifecycle including partial/full exits, oversell rejection, cash holding, margin debt settlement, reload recovery, and Closed History.

These workflows validate deterministic fixtures and the checked-in production build. They do not establish live authenticated TradeNet behavior or cross-device/distributed idempotency.

## Required validation

Vitest known-answer lifecycle tests for buy → add → partial sale → full close; fees; cash/debt and cash-holding operations; rollover; idempotent retry/reload; malformed import; corrections/reset; and persistence failure rollback.

Still outstanding for PT-02 completion: dividends, deposit/withdrawal classifications, broker-execution import, replay/parity, cross-tab/cloud revision conflicts, and legacy backup round-trip evidence.

## Parallel ownership and integration rules

PT-02 owns transaction/event type definitions, idempotency, and mutation/audit semantics. PT-04/PT-06 consume its event/cash-flow contracts. PT-07 owns market-data and FX provenance. Do not add competing schemas in consumer streams. Avoid broad changes to quote/provider modules owned by PT-07.

## Repository-wide rules

- Preserve established calculation contracts and current persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Preserve English/Russian localization and add Vitest coverage for important behavior.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PR targets `dev`; Worker/server-only changes follow the direct-to-`main` deployment rule.
- Keep this PR Draft until implementation scope and exact-head CI/review gates are complete. Do not merge automatically.
