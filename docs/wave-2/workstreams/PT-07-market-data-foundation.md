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
- [x] Normalize quote and historical price responses with provider, observedAt, receivedAt, session, delay class, currency, quality, and error metadata (unknown session/freshness is explicit for historical series).
- [x] Distinguish live, delayed, stale, indicative, cached, missing, and unavailable data; do not infer live status from receipt time.
- [ ] Implement bounded TTL caching, request coalescing, timeout/cancellation, retry/backoff, provider health, and last-known-good behavior.
- [ ] Define quote/history provider interfaces and compatibility adapters around existing sources; avoid a wholesale provider migration.
- [x] Define an explicit FX-rate contract with pair, direction, source, observedAt, receivedAt, session, and rate quality; do not enable portfolio FX aggregation until validated historical FX semantics are established.
- [ ] Keep market news, earnings/dividend calendars, fundamentals, and analyst data behind distinct typed capabilities instead of one unstructured payload.
- [x] Expose freshness/source indicators in market and portfolio UI where data is shown.

## Acceptance criteria

- [x] All quote/history values expose source and freshness metadata or an explicit unknown state.
- [ ] Out-of-order, stale, delayed, or failed provider responses cannot overwrite a newer valid observation.
- [ ] Provider outages retain last-known-good values while rendering them as stale.
- [ ] Instrument identity handles exchange-qualified symbols, aliases, currency, and unsupported instruments safely.
- [ ] FX rates cannot be applied with reversed pair/direction, mismatched timestamps, or unknown quality.
- [x] Existing quote providers continue to function through compatibility adapters until consumers migrate.

## Implementation status (2026-11-06)

**Implemented in this PR**
- Canonical instrument identity normalization, safe exchange-suffix parsing, provider-symbol/alias fields, explicit asset/currency classification, and malformed-input handling.
- Quote provenance normalization for Yahoo, Freedom TradeNet, and fallback providers; source observation time remains separate from client receipt time.
- Historical-price normalization with sorted/deduplicated timestamps, bounded OHLCV points, provider/instrument/receipt metadata, and explicit unknown session/freshness where the history source does not establish them.
- Explicit BASE_TO_QUOTE FX contract and a strict conversion-usability predicate. No FX provider or portfolio FX aggregation is enabled.
- Yahoo quote batching/coalescing, bounded TTL and stale retention, transient retry/backoff, timeout/abort, last-known-good fallback, and cache-state disclosure.
- Quote freshness/source UI and English/Russian translations with Vitest parity coverage.
- Existing portfolio-store request ordering and source-timestamp guards remain in place; this PR does not replace the persisted quote contract.

**Remaining / partial**
- Instrument alias lifecycle and symbol-change resolution are represented in the contract but do not yet have a maintained alias registry or corporate-action mapping.
- Provider resilience is implemented for Yahoo batch and Finnhub/Twelve Data fallback requests; authenticated Freedom REST/WebSocket paths and other research endpoints do not yet share the full retry/cache policy.
- Quote/history adapter interfaces are defined and the existing quote path is normalized compatibly; a complete provider registry and a second history adapter are not part of this slice.
- Historical exchange calendars/timezones, session-aware market-age policy, and provider health dashboards remain follow-up work.
- News, fundamentals, analyst, and calendar capabilities remain separate existing services; this PR does not implement new earnings/dividend calendar ingestion.
- Manual authenticated-broker QA has not been performed. CI uses fixtures/mocks and does not certify live broker or production behavior.

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
