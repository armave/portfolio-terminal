# Wave 2 workstream PT-04 — Broker reconciliation and data provenance

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#332](https://github.com/armave/portfolio-terminal/issues/332)  
**Implementation PR:** [#358](https://github.com/armave/portfolio-terminal/pull/358) — Draft; read-only quantity reconciliation slice implemented, transaction-level reconciliation remains deferred.  
**Dedicated branch:** feat/wave2-pt-04-broker-reconciliation  
**Base:** dev (refresh/rebase against latest dev before final readiness; other Wave 2 streams are in parallel).

## Objective

Compare broker-reported facts with app-owned portfolio/accounting state and make every discrepancy explainable without automatic correction.

## Dependencies

PT-01 financial contracts and PT-03 Freedom broker adapter are merged. The snapshot-quality correction from PR #354 is expected in the Wave 1 baseline. PT-02 owns transaction/event and idempotency contracts; transaction matching or resolution writes must wait for that interface. PT-07 owns market/FX provenance; this stream must not create its own quote or FX source contract.

## Delivered in this implementation slice

- [x] Pure, deterministic, read-only comparison of app margin positions plus app cash-backed holdings against broker account-wide position quantities.
- [x] Ticker normalization for the dot-US suffix and aggregation by ticker/currency; no FX conversion or unlike-currency summation.
- [x] Classification of quantity mismatches, app-only/broker-only positions, currency mismatches, and unclassified rows.
- [x] Conservative handling of partial, empty, unloaded, unavailable, and stale broker snapshots. Missing-row findings are suppressed unless the broker snapshot is complete and fresh; unverified values are provisional.
- [x] Explicit quantity and amount tolerances; app cash-balance comparison is available to callers only when semantically equivalent app-side values are supplied. The current UI intentionally does not compare cash balances because it lacks an independent comparable app-side balance.
- [x] Provider, source, quality, receipt time, observation time, warnings, and snapshot age are retained from both REST and authenticated WebSocket account refreshes.
- [x] Last accepted snapshot metadata is preserved separately from a failed/partial refresh issue; an unsuccessful refresh marks the saved snapshot stale rather than replacing its data or provenance.
- [x] Admin Cash & Non-Margin Holdings desk includes a read-only reconciliation panel with status, source/timestamps/age, discrepancy rows, warnings, and English/Russian copy.
- [x] Regression tests cover combined margin+cash quantity matching, mismatches, missing sides, partial/empty/unloaded/stale data, provisional timestamp handling, currency mismatch, optional cash-balance comparison, unavailable data, genuine zeroes, and no-mutation behavior.
- [x] REST and WebSocket runtime tests verify that the normalized snapshot metadata event is emitted alongside the backward-compatible data-only event.

## Remaining scope — intentionally deferred

- [ ] Reconcile broker executions against app transaction events, including duplicate/reordered fills and timing differences. Wait for PT-02 transaction identity/idempotency/audit contract.
- [ ] Reconcile commissions, fees, dividends, interest, and cashflows. Define source semantics with PT-02 before comparison or resolution writes.
- [ ] Add reviewed discrepancy resolution proposals with before/after preview, explicit confirmation, idempotency, and audit references. No automatic writeback.
- [ ] Consume PT-07 normalized price/history/FX provenance for quote/FX/corporate-action discrepancies when those contracts exist.
- [ ] Add a browser journey for inspecting a discrepancy and previewing (not committing) a resolution.
- [ ] Perform authenticated production TradeNet verification. Mocked CI does not establish live provider behavior.

## Acceptance criteria

- [x] An incomplete, empty, unloaded, unavailable, or stale broker response cannot be treated as a fully reconciled account.
- [x] An aggregate position mismatch never silently rewrites app-owned lots, cost basis, cash, or transactions.
- [x] Failed refreshes retain last accepted data and provenance while exposing stale/error status and the most recent rejection warnings.
- [x] Broker and app quantities remain distinguishable; current Freedom broker quantities are compared to app margin plus cash-backed holdings.
- [ ] Every supported transaction/fee/cashflow discrepancy is classified after PT-02 contracts are integrated.
- [ ] Resolution proposals are previewed, explicitly confirmed, idempotent, and audited through PT-02.

## Required validation

Exact-head typecheck, full Vitest suite, production build, dead-code validation, dependency audits, operations browser journey, and trade lifecycle browser smoke. Live authenticated TradeNet and Market Depth checks remain separate/manual. PT-04 tests use deterministic synthetic fixtures; they do not prove broker session behavior.

## Parallel ownership and integration rules

PT-04 owns reconciliation result/classification schemas and read-only comparison. PT-02 owns transaction records/idempotency/audit. PT-07 owns market quote/history/FX provenance. Integrate via explicit types; do not modify another stream's owned module without coordination.

## Repository-wide rules

- Preserve established financial calculation contracts and persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Keep English/Russian localization complete; add translation parity tests for all new user-facing strings.
- Add Vitest coverage for every meaningful behavior change and independent known-answer fixtures for financial math.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PRs target dev; Worker/server-only changes follow the direct-to-main deployment rule. Split mixed work rather than violating the deployment policy.
- Do not merge automatically. Update the issue and Wave 2 umbrella roadmap with exact tested SHA, CI evidence, manual QA status, and remaining work.
