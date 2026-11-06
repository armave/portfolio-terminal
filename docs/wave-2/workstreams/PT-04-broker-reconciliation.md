# Wave 2 workstream PT-04 — Broker reconciliation and data provenance

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#332](https://github.com/armave/portfolio-terminal/issues/332)  
**Implementation PR:** Draft branch is open for parallel implementation; upgrade this PR as code and tests land.  
**Dedicated branch:** `feat/wave2-pt-04-broker-reconciliation`  
**Base:** `dev`, currently `c7ae6a6d808c7645a9686e32983f0209ec613f88`

## Objective

Compare broker-reported facts with app-owned portfolio/accounting state and make every discrepancy explainable without automatic correction.

## Dependencies

PT-01 financial contracts (merged), PT-03 Freedom broker adapter (merged), PT-03.1 snapshot-quality correction (#354 if present on base); PT-02 transaction/event contract for matching imported executions and any resolution writes.

## Scope

- [ ] Consume the normalized broker snapshot and preserve provider, source, observedAt, receivedAt, currency, quality, warnings, and last-known-good state.
- [ ] Build deterministic comparison for account balances, cash, position quantities, executions/trades, fees, dividends/cashflows, currency, and timestamps.
- [ ] Classify differences: pending/timing, unmatched execution, duplicate execution, fee/commission, currency/FX, corporate action, quote/freshness, unsupported field, incomplete snapshot, and unresolved.
- [ ] Implement read-only reconciliation results first. Do not mutate app-owned lots/cost basis or dismiss differences based on aggregate broker quantity.
- [ ] After PT-02 transaction contract is stable, add candidate matching of broker executions to app transaction events using stable identities and conservative matching tolerances.
- [ ] Add reviewed resolution proposals with before/after preview, actor confirmation, idempotency, and PT-02 audit references; keep automatic writeback out of scope.
- [ ] Show last-known-good snapshot age and explicit stale/partial/error status.
- [ ] Add a concise reconciliation surface in the relevant account/portfolio workflow, with details available without exposing secrets/raw payloads.

## Acceptance criteria

- [ ] An incomplete or stale broker response cannot be treated as a fully reconciled account.
- [ ] Every discrepancy is classified or explicitly marked unresolved, with source values, timestamps, currencies, and matching evidence.
- [ ] An aggregate position mismatch never silently rewrites app-owned lots, cost basis, or transactions.
- [ ] Failed refreshes retain last valid state and clearly expose freshness/error status.
- [ ] Resolution proposals are previewed, explicitly confirmed, idempotent, and audited through PT-02.
- [ ] Broker and application values remain distinguishable in all reconciliation views.

## Required validation

Vitest fixtures for exact match, timing lag, missing/duplicate/reordered executions, partial snapshot, malformed currency/amount, fee mismatch, currency mismatch, stale quote, provider outage, conflict/retry, and no-mutation guarantee. Browser journey for inspect → compare → preview resolution (confirmation only when PT-02 contract available). Live authenticated TradeNet checks are separate/manual.

## Parallel ownership and integration rules

PT-04 owns reconciliation result/classification schemas and read-only comparison. PT-02 owns transaction records/idempotency/audit. PT-07 owns market quote/history provenance. Integrate via explicit types; do not modify another stream's owned module without coordination.

## Repository-wide rules

- Preserve the established financial calculation contracts and current persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Keep English/Russian localization complete; add translation parity tests for all new user-facing strings.
- Add Vitest coverage for every meaningful behavior change and independent known-answer fixtures for financial math.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PRs target `dev`; Worker/server-only changes follow the direct-to-`main` deployment rule. Split mixed work rather than violating the deployment policy.
- Do not merge automatically. Update the issue and Wave 2 umbrella roadmap with exact tested SHA, CI evidence, manual QA status, and remaining work.
