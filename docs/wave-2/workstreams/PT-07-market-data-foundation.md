# Wave 2 workstream PT-07 — Market and instrument data foundation

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#335](https://github.com/armave/portfolio-terminal/issues/335)  
**Implementation PR:** Draft branch is open for parallel implementation; upgrade this PR as code and tests land.  
**Dedicated branch:** `feat/wave2-pt-07-market-data-foundation`  
**Base:** `dev`, currently `c7ae6a6d808c7645a9686e32983f0209ec613f88`

## Objective

Create a consistent, provenance-aware market-data boundary across quote, history, and future research providers.

## Dependencies

PT-01 source/freshness contracts (merged), PT-03 provider adapter patterns (merged).

## Scope

- [ ] Define normalized instrument identity: canonical instrument ID, provider symbols, exchange, asset type, quote/base currency, and symbol alias/change handling.
- [ ] Normalize quote and historical price responses with provider, observedAt, receivedAt, session, delay class, currency, quality, and error metadata.
- [ ] Distinguish live, delayed, stale, indicative, cached, missing, and unavailable data; do not infer live status from receipt time.
- [ ] Implement bounded TTL caching, request coalescing, timeout/cancellation, retry/backoff, provider health, and last-known-good behavior.
- [ ] Define quote/history provider interfaces and compatibility adapters around existing sources; avoid a wholesale provider migration.
- [ ] Define an explicit FX-rate contract with pair, direction, source, observedAt, receivedAt, session, and rate quality; do not enable portfolio FX aggregation until validated historical FX semantics are established.
- [ ] Keep market news, earnings/dividend calendars, fundamentals, and analyst data behind distinct typed capabilities instead of one unstructured payload.
- [ ] Expose freshness/source indicators in market and portfolio UI where data is shown.

## Acceptance criteria

- [ ] All quote/history values expose source and freshness metadata or an explicit unknown state.
- [ ] Out-of-order, stale, delayed, or failed provider responses cannot overwrite a newer valid observation.
- [ ] Provider outages retain last-known-good values while rendering them as stale.
- [ ] Instrument identity handles exchange-qualified symbols, aliases, currency, and unsupported instruments safely.
- [ ] FX rates cannot be applied with reversed pair/direction, mismatched timestamps, or unknown quality.
- [ ] Existing quote providers continue to function through compatibility adapters until consumers migrate.

## Required validation

Provider contract tests for malformed/out-of-order/missing observations, timestamps, timezone/session calendar, TTL and cache invalidation, request coalescing, abort/retry/backoff, stale fallback, symbol mapping, FX pair direction, and provider outage. Browser and i18n coverage for freshness states.

## Parallel ownership and integration rules

PT-07 owns instrument and market-data/FX provenance contracts, provider orchestration, and freshness UI. PT-06 and PT-08 consume its types; do not import provider implementations directly into their calculations.

## Repository-wide rules

- Preserve the established financial calculation contracts and current persisted-data compatibility.
- Do not silently change rounding, currency, rollover, margin, cash-flow, or P&L semantics.
- Keep deterministic calculations independent of UI, network, browser storage, and AI.
- Keep English/Russian localization complete; add translation parity tests for all new user-facing strings.
- Add Vitest coverage for every meaningful behavior change and independent known-answer fixtures for financial math.
- Do not claim live broker or production validation based on mocked fixtures.
- Frontend/client PRs target `dev`; Worker/server-only changes follow the direct-to-`main` deployment rule. Split mixed work rather than violating the deployment policy.
- Do not merge automatically. Update the issue and Wave 2 umbrella roadmap with exact tested SHA, CI evidence, manual QA status, and remaining work.
