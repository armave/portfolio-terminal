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

- [x] Specify TWR/MWR conventions, cash-flow timing, period boundaries, ACT/365 day-count, income/cost treatment, and no-rounding calculation policy in `docs/wave-2/performance-methodology.md`.
- [x] Define and implement calculation-level data-quality rules: fewer than two valuations, duplicate/invalid timestamps, incomplete inputs, missing/invalid flows, and currency mismatches are unavailable; provisional inputs remain visibly provisional.
- [x] Implement pure deterministic calculation services with no UI, network, browser storage, or AI dependencies in `src/domain/portfolioPerformance.ts`.
- [x] Add UTC daily/monthly/yearly linked return buckets, since-inception return, and generic keyed period attribution with reconciliation in `src/domain/portfolioPerformance.ts`. Security/account mapping awaits PT-02/PT-07 integration.
- [x] Add a pure benchmark comparison contract requiring a dividend-reinvested total-return index, exact opening/closing timestamp alignment, and matching currency; no interpolation or implicit FX.
- [x] Reject mixed-currency calculations until the PT-07 historical FX provenance contract is integrated; no implicit conversion is performed.
- [ ] Add UI surfaces for headline return, cash-flow adjusted performance, contribution, and methodology explanations after PT-02/PT-07 input integration.
- [x] Keep the new engine isolated from existing dashboard P&L and persisted portfolio fields; no existing accounting formula or state was changed.

## Acceptance criteria

- [x] Calculation-kernel metrics have documented definitions, formulas, assumptions, required input fields, and edge-case behavior.
- [x] External deposits/withdrawals are excluded from investment profit using linked Modified Dietz weights; MWR converts contributions/withdrawals to investor cash flows and solves XIRR under a unique-sign-change rule.
- [ ] Fee/dividend/commission/interest summary and no-double-count treatment are implemented; reconciliation to PT-02 transaction events remains pending.
- [x] Generic keyed item attribution must reconcile opening/closing values, item flows, and profit to portfolio Modified Dietz return within the configured tolerance.
- [x] Incomplete observations/flows return unavailable; provisional inputs produce provisional results; mixed currencies are rejected. Runtime mapping from PT-04/PT-07 quality metadata remains pending.
- [x] New calculation functions are pure and do not mutate portfolio state or accounting fields.

## Required validation

Independent known-answer datasets for TWR/MWR, irregular cash-flow dates, deposits/withdrawals, fees, dividends, partial history, zero/negative equity (including losses beyond 100% for a leveraged portfolio), timezone/period boundaries, total-return benchmark alignment, multi-currency unavailable states, and attribution sum checks. English/Russian metric explanations and Vitest locale-key parity.

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


## Initial implementation progress — Wave 2.3

The first PT-06 calculation slice is implemented on this branch:

- `src/domain/portfolioPerformance.ts` — pure calculation contracts and services.
- `src/domain/portfolioPerformance.test.ts` — independent known-answer and failure-mode fixtures.
- `docs/wave-2/performance-methodology.md` — method, data, timing, currency, and income/cost conventions.

Implemented:
- Linked Modified Dietz period returns (explicitly identified as an approximation where pre/post-flow valuations are unavailable).
- ACT/365 XIRR with a bracketed solver; series with multiple sign changes are returned as unavailable rather than selecting an arbitrary root.
- UTC daily/monthly/yearly bucketed return series and since-inception return.
- Generic keyed period attribution with opening/closing value, flow, and profit reconciliation.
- Separate dividend/fee/commission/interest summary that is explanatory only and must not be counted twice in returns.
- Current/provisional/incomplete data-quality propagation and rejection of mixed-currency inputs.
- Independent fixtures for cash-flow timing, withdrawals, linked periods, XIRR, ambiguous cash flows, attribution reconciliation, and income/cost totals.

Not yet integrated (intentionally waits for other parallel Wave 2 streams):
- PT-02 transaction/cash-flow event mapping and actual portfolio history adapters.
- PT-07 instrument/history/FX provenance and historical currency conversion.
- PT-04 reconciliation quality mapping and account snapshot ingestion.
- Security/account-level attribution wiring from actual position and cash records.
- Benchmark comparison, dashboard UI, and persisted/reporting integration.

This is a calculation foundation, not yet a user-facing performance dashboard. The PR remains Draft until the upstream contracts are stable, integration is complete, and exact-head CI passes.
