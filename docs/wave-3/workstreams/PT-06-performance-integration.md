# Wave 3 PT-06 — Integrate portfolio performance with real transactions and valuation history

**Tracking issue:** #334  
**Merged calculation foundation:** PR #359  
**Dedicated branch:** feat/wave3-pt06-performance-integration  
**Target:** dev

## Objective

Turn the pure PT-06 calculation kernel into actual portfolio performance intelligence by mapping canonical portfolio events, cashflows and sourced valuations into its typed inputs.

## Scope

- Consume the accepted PT-02 event contract for external contributions/withdrawals and documented income/cost adjustments.
- Define how buys, sells, internal transfers, dividends, commissions, fees and margin interest affect returns; avoid double-counting adjustments already reflected in equity or transaction flows.
- Build a valuation-history adapter with observation timestamp, receipt timestamp, provider, currency, completeness and quality.
- Integrate PT-04 discrepancy quality and PT-07 instrument/history provenance into the input quality contract.
- Add security/account-level mapping for attribution where underlying flows and beginning/ending values reconcile.
- Surface TWR, MWR, period returns, since-inception return, income/cost summaries and contribution in a compact performance experience with methodology disclosure.
- Preserve the existing methodology panel in Settings and make metric explanations reachable from the new performance UI.
- Keep benchmark comparison unavailable until PT-07 supplies a validated historical total-return series in the same currency and date window.

## Boundaries

- The pure calculation contract and methodology from PR #359 remain authoritative.
- Do not complete performance integration by reading raw broker rows as a second transaction schema; use PT-02's accepted event/flow mapping.
- No silent change to Modified Dietz/XIRR definitions, UTC period bucket boundaries, ACT/365, precision, cashflow sign or no-double-count conventions.
- No implicit historical FX conversion.
- Missing valuation or event history remains unavailable/incomplete; do not backfill with current price or zero.
- Do not modify portfolio accounting records to make the return series reconcile.

## Acceptance criteria

- Actual transaction/cashflow records map deterministically to performance inputs.
- Portfolio period summaries reconcile opening value, closing value, external flows and attributed profit within documented tolerance.
- Deposits and withdrawals do not become investment profit.
- Fees, commissions, dividends and interest are included once under the published methodology.
- Performance labels show currency, period, as-of time and current/provisional/unavailable quality.
- Security/account attribution reconciles to portfolio totals where data coverage permits and marks unsupported coverage otherwise.

## Required tests and QA

Independent known-answer TWR/MWR fixtures from actual event shapes; irregular deposits/withdrawals; staged buys/sells; dividends/fees/interest; partial and reordered history; negative/zero equity; duplicate events; missing observations; currency mismatch; UTC/Armenia boundary dates; attribution tolerance. Vitest for adapters and UI/i18n parity. Browser validation in admin and read-only guest-compatible states, but do not claim independent guest tenancy before PT-05 cutover.


## Wave 3 implementation — performance integration

- [x] Add a bounded persisted daily valuation history (up to 1,095 UTC-day observations) with account currency, provider, observation/receipt time, quote quality and item buckets that reconcile to equity.
- [x] Capture observations through the existing portfolio-equity lifecycle for administrator sessions only; guest projections are not used for owner performance.
- [x] Require the signed-in account's completed Freedom cashflow-history baseline before enabling cash-flow-adjusted results. Earlier provisional valuation points are excluded from the calculation window.
- [x] Adapt PT-02 cash deposit/withdrawal journal events to external flows. Unknown adjustments, corrections and unsupported financial changes fail closed.
- [x] Produce linked Modified Dietz TWR, ACT/365 XIRR MWR, monthly series, explanatory income/cost totals and latest-period attribution using the existing pure calculation kernel.
- [x] Reject multi-currency histories until PT-07 historical FX provenance/conversion is implemented. Benchmark comparison remains unavailable until validated total-return history is provided.
- [x] Add the performance panel to the administrator Combined Portfolio desk with data-quality, as-of, methodology and limitation disclosures.
- [x] Add English/Russian UI copy and Vitest coverage for capture, bounds, flow classification, localization and panel placement.
- [ ] Authenticated live Freedom history/quote verification and broader currency/benchmark integration remain release gates/follow-up work.
