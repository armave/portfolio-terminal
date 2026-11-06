# Wave 2 workstream PT-06 — Performance and attribution engine

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#334](https://github.com/armave/portfolio-terminal/issues/334)  
**Implementation PR:** Draft branch is open for parallel implementation; upgrade this PR as code and tests land.  
**Dedicated branch:** `feat/wave2-pt-06-performance-analytics`  
**Base:** `dev`, currently `c7ae6a6d808c7645a9686e32983f0209ec613f88`

## Objective

Deliver deterministic, explainable portfolio return and performance attribution that handles external cash flows and does not fabricate missing history.

## Dependencies

PT-01 calculation contracts (merged), PT-02 transaction/cash-flow contract (parallel design; integration gate before final wiring), PT-03/04 reconciled account/flow data where available, PT-07 FX/market data contract for multi-currency support.

## Scope

- [ ] Specify time-weighted return (TWR) and money-weighted return (MWR/IRR) conventions, flow timing, period boundaries, day-count, fees, dividends, tax fields if supported, and rounding.
- [ ] Define the supported data sufficiency rules: missing historical valuations, unknown flow dates, partial broker snapshots, and stale prices must produce explicit unavailable/provisional results.
- [ ] Implement pure calculation services for portfolio/account/security performance with no UI, network, browser storage, or AI dependencies.
- [ ] Add daily/monthly/yearly/since-inception series and contribution/attribution by security and account.
- [ ] Implement benchmark comparisons only with aligned date windows, currencies, trading calendars, and explicitly identified benchmark sources.
- [ ] Define base-currency and FX handling as a gated interface; do not sum unlike currencies or silently use current FX for historical performance.
- [ ] Add UI surfaces for headline return, cash-flow adjusted performance, contribution, and methodology explanations after the pure calculation contract is stable.
- [ ] Document compatibility against existing dashboard P&L and historical views; do not silently redefine current unrealized P&L.

## Acceptance criteria

- [ ] All metrics have documented definitions, formulas, assumptions, required input fields, and edge-case behavior.
- [ ] External deposits/withdrawals do not distort TWR; MWR handles dated external flows according to the selected convention.
- [ ] Fees/dividends and income treatment are explicit and reconcile to transaction records.
- [ ] Portfolio and position attribution sums to the documented portfolio result within defined tolerance.
- [ ] Missing history, stale prices, partial account data, and unavailable FX produce visible limitations rather than fabricated numbers.
- [ ] New analytics do not mutate portfolio state or alter existing accounting fields.

## Required validation

Independent known-answer datasets for TWR/MWR, irregular cash-flow dates, deposits/withdrawals, fees, dividends, partial history, negative/zero values, timezone/period boundaries, benchmark alignment, multi-currency unavailable states, and attribution sum checks. English/Russian metric explanations and Vitest locale-key parity.

## Parallel ownership and integration rules

PT-06 owns methodology, pure performance calculation contracts, and presentation of performance metrics. PT-02 owns the source transaction schema. PT-07 owns instrument/price/FX-provider provenance. Begin with isolated fixtures and publish input interfaces; final wiring follows those contracts.

## Repository-wide rules

- Preserve the established financial calculation contracts and current persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Keep English/Russian localization complete; add translation parity tests for all new user-facing strings.
- Add Vitest coverage for every meaningful behavior change and independent known-answer fixtures for financial math.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PRs target `dev`; Worker/server-only changes follow the direct-to-`main` deployment rule. Split mixed work rather than violating the deployment policy.
- Do not merge automatically. Update the issue and Wave 2 umbrella roadmap with exact tested SHA, CI evidence, manual QA status, and remaining work.
