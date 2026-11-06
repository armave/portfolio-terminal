# Wave 3 PT-06 — Integrate portfolio performance with real transactions and valuation history

**Tracking issue:** #334  
**Merged calculation foundation:** PR #359  
**Dedicated branch:** feat/wave3-pt06-performance-integration  
**Target:** dev

## Objective

Turn the pure PT-06 calculation kernel into actual portfolio performance intelligence by mapping canonical portfolio events, cashflows and sourced valuations into its typed inputs.

## Scope

- Map PT-02 transaction journal/source events into external contributions/withdrawals and documented income/cost adjustments.
- Define how buys, sells, internal transfers, dividends, commissions, fees and margin interest affect returns; avoid double-counting adjustments already reflected in equity or transaction flows.
- Build a valuation-history adapter with observation timestamp, receipt timestamp, provider, currency, completeness and quality.
- Integrate PT-04 discrepancy quality and PT-07 instrument/history provenance into the input quality contract.
- Add security/account-level mapping for attribution where underlying flows and beginning/ending values reconcile.
- Surface TWR, MWR, period returns, since-inception return, income/cost summaries and contribution in a compact performance experience with methodology disclosure.
- Preserve the existing methodology panel in Settings and make metric explanations reachable from the new performance UI.
- Keep benchmark comparison unavailable until PT-07 supplies a validated historical total-return series in the same currency and date window.

## Boundaries

- The pure calculation contract and methodology from PR #359 remain authoritative.
- No silent change to Modified Dietz/XIRR definitions, UTC period bucket boundaries, ACT/365, precision, cashflow sign or no-double-count conventions.
- No implicit historical FX conversion.
- Missing valuation or event history must remain unavailable/incomplete; do not backfill with current price or a zero.
- Do not modify portfolio accounting records to make the return series reconcile.

## Acceptance criteria

- Actual transaction/cashflow records map deterministically to performance inputs.
- Portfolio period summaries reconcile opening value, closing value, external flows and attributed profit within documented tolerance.
- Deposits and withdrawals do not become investment profit.
- Fees, commissions, dividends and interest are included once under the published methodology.
- Performance labels show currency, period, as-of time and current/provisional/unavailable quality.
- Security/account attribution reconciles to portfolio totals where data coverage permits and clearly marks unsupported coverage otherwise.

## Required tests and QA

Independent known-answer TWR/MWR fixtures sourced from actual event shapes; irregular deposits/withdrawals; staged buys/sells; dividends/fees/interest; partial and reordered history; negative/zero equity; duplicate events; missing observations; currency mismatch; UTC/Armenia boundary dates; attribution tolerance. Vitest for data adapters and UI/i18n parity. Browser validation in admin and read-only guest-compatible states, but do not claim independent guest tenancy before PT-05 cutover.
