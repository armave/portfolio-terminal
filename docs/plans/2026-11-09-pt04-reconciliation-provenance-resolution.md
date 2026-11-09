# PT-04 next-stage plan — provenance reconciliation and reviewed resolutions

**Prepared:** 2026-11-09  
**Tracking issue:** [#332](https://github.com/armave/portfolio-terminal/issues/332)  
**Existing charter:** [Wave 3 PT-04](../wave-3/workstreams/PT-04-reconciliation-completion.md)  
**Implementation target:** `dev` for client/domain; any Worker-only work remains direct-to-`main`.  
**Status:** Plan for implementation review; no application behavior changes in this plan PR.

## Audit baseline

The read-only reconciliation foundation is substantially further along than the broad roadmap title suggests:

- PR #358 added aggregate broker/app quantity comparison, provenance and conservative handling of incomplete or stale snapshots.
- PR #380 added transaction-level matching for executions, partial fills, duplicates, commissions, cashflows and event timing, with an on-demand Trades / Closed History review surface.
- PR #385 made reconciliation provisional while broker feeds are loading, refreshing, stale or failed.
- PR #398 added legacy closed-sale matching against broker sell fills.

These changes are the baseline. Do not rebuild the matcher or reintroduce the removed large reconciliation status panel on the portfolio desk.

## Remaining risks to close

1. **Price and history provenance:** reconciliation does not yet comprehensively compare app valuation prices, source observations, stale/delayed states, FX rates and corporate-action-adjusted history.
2. **Resolution workflow:** discrepancies are read-only. There is no complete proposal → user review → confirmed PT-02 command → audit-event lifecycle.
3. **False-positive control:** incomplete event history, ambiguous matching, missing fee fields or currency/FX inputs must remain provisional, not be treated as zero or confirmed mismatch.
4. **User-facing workflow evidence:** automated tests cover matcher behavior, but a dedicated browser journey must prove that users can inspect, defer, decline and confirm a safe resolution.
5. **Live validation:** fixtures do not prove actual authenticated Freedom/TradeNet identifier, correction or fee semantics.

## Implementation plan

### A. Complete price, FX and corporate-action comparison
- [ ] Consume PT-07 quote/history provenance: provider, instrument identity, currency, exchange, observation time, receipt time, session status and freshness.
- [ ] Detect stale/delayed/closed-session and app-vs-broker price differences without calling providers from the reconciliation engine.
- [ ] Compare FX only when a sourced, timestamped rate and an unambiguous pair direction are available.
- [ ] Match corporate-action evidence to supported app events; distinguish a missing adjustment from an unverified provider event.
- [ ] Keep missing FX, unsupported actions and incomplete histories as unknown/provisional.
- [ ] Preserve last-known-good snapshots and suppress absence-based findings while a feed is partial or unavailable.

### B. Add reviewable resolution proposals
- [ ] Define a typed proposal containing discrepancy ID, supporting source evidence, proposed action, affected financial fields, confidence and expiry/staleness checks.
- [ ] Present before/after values and the exact source facts used; do not present inferred matches as certain.
- [ ] Support defer/decline without mutating financial state.
- [ ] Confirm through an explicit PT-02 store command/event only after PT-02 correction, reversal and idempotency semantics are accepted.
- [ ] Make confirmation idempotent and append an audit-linked event; reject stale proposals if underlying portfolio/broker revisions changed.
- [ ] Never auto-rewrite app-owned lots, cost basis, cash or debt from aggregate broker values.

### C. Improve evidence and workflow traceability
- [ ] Ensure every finding retains normalized source, broker/execution reference, provider observation time, receipt time, amount/quantity, currency and matching rationale.
- [ ] Separate exact-ID matches from heuristic fallback matches and disclose ambiguity.
- [ ] Add reproducible snapshot fixtures so each discrepancy can be independently regenerated.
- [ ] Keep the existing on-demand compact reconciliation surface; localize all new copy in English/Russian.

## File ownership

Primary ownership:
- `src/domain/brokerTransactionReconciliation.ts` and its Vitest suite
- `src/components/BrokerTransactionReconciliation.tsx` and focused Closed History/Trades wiring
- `src/types/portfolioTransaction.ts` only by coordination with PT-02; prefer consuming the accepted event contract
- `src/services/marketDataContracts.ts`, `src/services/corporateActions.ts` as read-only consumers; coordinate with PT-07 instead of editing provider normalization
- `src/services/i18n.ts`, `src/services/i18n-ru.ts` and localization tests for any added strings

Avoid changing the PT-02 journal semantics, TradeNet adapter normalization, portfolio accounting formulas or tenant authorization.

## Required validation

- [ ] Vitest known-answer fixtures for exact/fallback identity, partial fills, duplicates, ordering, corrections, fees, cashflows, currency and ambiguous matches.
- [ ] Price/freshness/FX cases with stale, delayed, market-closed, missing timestamp, wrong FX direction and missing-rate inputs.
- [ ] Corporate-action split/dividend/rename evidence and replay cases; no silent portfolio mutation.
- [ ] Proposal expiry/staleness, decline/defer, confirmation, repeated confirmation, conflicting revisions and audit-event linkage.
- [ ] Assert comparison itself is read-only; only confirmed commands can mutate.
- [ ] English/Russian localization parity and component accessibility checks.
- [ ] Browser journey: open a finding, inspect supporting evidence, decline/defer, then confirm a valid proposal and verify the audit trail.
- [ ] `npm run typecheck`, `npm test`, dead-code validation, dependency audits and production build on the exact PR head.
- [ ] Operations Browser Journey and Trade Lifecycle Browser Smoke pass on the exact PR head.
- [ ] Authenticated live TradeNet verification is documented separately, including source paths and timestamps without credentials or tokens.

## Exit criteria and merge gate

- Findings are reproducible, source-backed and correctly qualified by feed completeness.
- Price, FX and corporate-action checks do not invent missing data.
- Resolutions are optional, explicit, revision-checked, idempotent and journaled through PT-02.
- No silent correction or automatic mutation is introduced.
- Live broker verification remains a separately recorded release gate.
