# Wave 2 workstream PT-02 — Transaction integrity and audit history

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Implementation PR:** Draft branch is open for parallel implementation; upgrade this PR as code and tests land.  
**Dedicated branch:** `feat/wave2-pt-02-transaction-integrity`  
**Base:** `dev`, currently `c7ae6a6d808c7645a9686e32983f0209ec613f88`

## Objective

Make supported financial mutations atomic, idempotent, auditable, and recoverable without an unapproved ledger cutover.

## Dependencies

PT-01 financial contracts (merged), current PortfolioState.positions remains canonical. PT-04, PT-06, PT-08 consume its stable transaction/event contracts.

## Scope

- [ ] Inventory every mutation path: buy/add, partial/full sell, cash movement, balance edit, dividends/fees, import, reset, rollover, cloud restore, and confirmed AI mutation.
- [ ] Define a versioned append-only transaction/audit envelope: stable event ID, idempotency key, event type, effective/recorded timestamps, actor/source, portfolio/account identity, currency, quantities, unit price, fees, references, and correction/reversal links.
- [ ] Define transaction types for trade, deposit, withdrawal, dividend, fee, interest, transfer, adjustment, corporate action, and correction; distinguish external cash flows from investment returns.
- [ ] Implement the minimum safe journal/ledger append and event-to-current-state verification while preserving PortfolioState.positions as canonical active positions.
- [ ] Make each financial command atomic across state update, persistence, event append, and resulting projections; define failure/rollback behavior.
- [ ] Apply idempotency at the mutation boundary so repeated requests/import retries cannot double-apply a transaction.
- [ ] Define migration and backup compatibility, schema versioning, replay/parity tooling, and rollback; do not switch canonical source to the ledger in this PR.
- [ ] Define concurrency/revision semantics for multiple tabs and cloud conflicts; stale commands must be rejected or explicitly reconciled.

## Acceptance criteria

- [ ] Every supported financial mutation either commits fully or leaves the previous persisted and in-memory financial state unchanged.
- [ ] Replaying the same idempotency key cannot change balances, quantities, fees, or P&L more than once.
- [ ] Journal records can explain and independently verify current positions/cash for supported flows.
- [ ] Every event carries actor/source and effective/recorded timestamps; corrections are linked and do not silently overwrite history.
- [ ] Existing backups, cloud snapshots, imports, closed-trade history, and rollover behavior remain compatible.
- [ ] PortfolioState.positions remains the active-position source of truth until a separately reviewed migration decision.

## Required validation

Vitest known-answer lifecycle tests: buy → add → partial sale → full close; fees; dividends; deposit/withdrawal; margin cash/debt; idempotent retry; stale revision; concurrent write; persistence failure rollback; reload/recovery; legacy import/backup parity; event replay against canonical positions.

## Parallel ownership and integration rules

PT-02 owns transaction/event type definitions and mutation semantics. Publish a small reviewed contract early on this branch. PT-04/PT-06 may create local contract fixtures, but must not invent competing event shapes. Avoid broad changes to quote/provider modules owned by PT-07.

## Repository-wide rules

- Preserve the established financial calculation contracts and current persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Keep English/Russian localization complete; add translation parity tests for all new user-facing strings.
- Add Vitest coverage for every meaningful behavior change and independent known-answer fixtures for financial math.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PRs target `dev`; Worker/server-only changes follow the direct-to-`main` deployment rule. Split mixed work rather than violating the deployment policy.
- Do not merge automatically. Update the issue and Wave 2 umbrella roadmap with exact tested SHA, CI evidence, manual QA status, and remaining work.
