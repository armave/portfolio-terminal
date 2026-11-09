# PT-04 implementation — broker market-price provenance comparison

**Prepared:** 2026-11-09  
**Tracking issue:** [#332](https://github.com/armave/portfolio-terminal/issues/332)  
**Existing charter:** [Wave 3 PT-04](../wave-3/workstreams/PT-04-reconciliation-completion.md)  
**Implementation target:** `dev`; no Worker/Cloudflare changes in this slice.  
**Status:** First implementation slice delivered in this PR. The broader PT-04 roadmap remains open.

## Existing baseline retained

This PR builds on, and does not replace, the merged read-only reconciliation work:

- PR #358: aggregate broker/app quantity comparison, provenance and conservative stale/partial handling.
- PR #380: transaction-level matching for executions, partial fills, duplicates, commissions, cashflows and event timing.
- PR #385: provisional reconciliation while broker feeds are loading, refreshing, stale or failed.
- PR #398: legacy closed-sale matching against broker sell fills.

The on-demand Trades / Closed History review remains the entry point. No large always-visible reconciliation panel is added to the portfolio desk.

## Delivered in this PR

### Read-only price evidence comparison
- [x] Add a deterministic domain contract to compare app-owned quote observations with broker-reported position market prices.
- [x] Normalize tickers and require an exact currency match; never infer a currency or reverse/guess an FX pair.
- [x] Retain the distinct app and broker providers, source observation times and receipt times in each price finding.
- [x] Validate app quote age against the comparison time independently of a persisted `fresh` flag.
- [x] Confirm a price difference only when both sides have explicit provider, currency, observation/receipt timestamps, complete quality and fresh/live evidence.
- [x] Keep delayed, stale, partial, missing-timestamp and otherwise unverifiable observations provisional.
- [x] Suppress price findings when the broker snapshot is stale or unavailable.
- [x] Report conflicting app or broker prices as ambiguous instead of choosing a row arbitrarily.
- [x] Keep comparison read-only; it never changes positions, lots, cash, debt, cost basis or transaction events.

### Trades review integration
- [x] Reuse the existing on-demand **Reconcile broker activity** surface in Trades.
- [x] Supply app margin-position and cash-holding quote metadata alongside the latest broker account snapshot.
- [x] Preserve the existing transaction execution/cashflow reconciliation unchanged.
- [x] Show quote comparison status, matched pair count, source, timestamps, warnings and provisional/confirmed price findings.
- [x] Add English/Russian translations for the new labels and safety explanations.
- [x] Keep the component accessible through the existing labelled, expandable section.

### Tests added
- [x] Confirmed same-currency price difference with fresh complete provenance.
- [x] Absolute/relative price tolerance.
- [x] Provisional outcome for missing/unknown freshness and a quote whose source timestamp is old even when its saved freshness flag says `fresh`.
- [x] Currency mismatch without FX conversion.
- [x] Stale broker snapshot suppression.
- [x] Missing broker observation timestamp.
- [x] Conflicting app and broker price rows.
- [x] Source-object immutability.
- [x] No comparable ticker/currency pair does not produce a false successful match.
- [x] Russian copy/status and Trades state-wiring tests.

## Explicitly deferred

These items are still open in issue #332 and are not represented as delivered by this PR:

1. **Historical price / FX reconciliation:** sourced FX-pair checks and historical candle comparison/corrections need dedicated contracts and known-answer fixtures.
2. **Corporate-action reconciliation:** compare sourced split/dividend/rename/merger/spin-off evidence against accepted app-owned actions; never treat provider evidence alone as a financial posting.
3. **Resolution proposals and audited writeback:** PT-04 must remain read-only until PT-02 supplies accepted correction/reversal and idempotent store-command semantics. Any later resolution must be user-confirmed, revision-checked and journaled.
4. **Authenticated live TradeNet validation:** CI fixtures do not prove production provider identifiers, quote semantics, fees, corrections or actual account data. Record source paths/timestamps without credentials.
5. **Manual real-browser validation:** the PR browser workflows are synthetic or mocked and must not be represented as a live broker verification.

## File ownership and boundaries

Client/domain files changed:
- `src/domain/brokerQuoteReconciliation.ts` and `src/domain/brokerQuoteReconciliation.test.ts`
- `src/components/BrokerTransactionReconciliation.tsx` and its localization/status tests
- `src/components/ClosedHistoryDesk.tsx` and its wiring tests

No edits to Worker/Durable Object code, broker adapter normalization, PT-02 journal semantics, app accounting formulas, market-data providers or corporate-action write paths are part of this slice.

## Validation checklist

- [x] Domain tests cover fresh/stale/partial/missing provenance, currency mismatch, tolerance, ambiguity and immutability.
- [x] Component tests cover English/Russian wording and status classifications.
- [x] Trades wiring tests verify the app and broker provenance sources are supplied.
- [ ] Exact-head `npm run typecheck`.
- [ ] Exact-head `npm test`.
- [ ] Exact-head production build, browser smoke, dead-code validation and dependency audits.
- [ ] Operations Browser Journey and Trade Lifecycle Browser Smoke pass on exact PR head.
- [ ] Authenticated live TradeNet QA recorded separately; not satisfied by mocked CI.

## Merge criteria for this slice

- Price comparisons are source-backed, read-only and never infer FX.
- Confirmed differences require both app and broker observations to be fresh and complete; anything less is provisional or withheld.
- The existing execution/cashflow matching behavior and persisted state remain unchanged.
- English/Russian copy and Vitest coverage pass.
- Exact-head required checks pass.

Merge of this slice does **not** close issue #332. Historical/FX/corporate-action checks, user-reviewed PT-02-linked resolution proposals and authenticated live broker validation remain follow-up release gates.
