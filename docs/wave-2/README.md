# Wave 2 — Portfolio Intelligence Foundations

**Umbrella PR target:** `dev`  
**Umbrella branch:** `docs/wave-2-portfolio-intelligence-roadmap`  
**Parent product roadmap:** `docs/product-vision-roadmap.md`  
**Baseline:** Wave 1 release PR #353 merged to `main`; development baseline `c7ae6a6d808c7645a9686e32983f0209ec613f88`.

---

## Current delivery status — 2026-11-06

All five dedicated Wave 2 implementation PRs are merged to `dev`. Their exact merge commits and exact-head CI records are listed below.

| Stream | PR | Merge commit | Exact-head validation |
|---|---|---|---|
| PT-02 Transaction integrity | [#357 — merged](https://github.com/armave/portfolio-terminal/pull/357) | `75f57d8eb101dfd812c1fa61987521796aedd476` | [CI #42184026171](https://github.com/armave/portfolio-terminal/actions/runs/42184026171), [Operations #42184026019](https://github.com/armave/portfolio-terminal/actions/runs/42184026019), [Trade lifecycle #42184026176](https://github.com/armave/portfolio-terminal/actions/runs/42184026176) — passed |
| PT-04 Broker reconciliation | [#358 — merged](https://github.com/armave/portfolio-terminal/pull/358) | `484e2ffca7e429b429039d9453c6c41eb2bc4de5` | [CI #42189506408](https://github.com/armave/portfolio-terminal/actions/runs/42189506408), [Operations #42189506344](https://github.com/armave/portfolio-terminal/actions/runs/42189506344), [Trade lifecycle #42189506355](https://github.com/armave/portfolio-terminal/actions/runs/42189506355) — passed |
| PT-06 Performance calculation foundation | [#359 — merged](https://github.com/armave/portfolio-terminal/pull/359) | `473d86e3431b5be771f78eb45d7c0ee93c7475cc` | [CI #42191673513](https://github.com/armave/portfolio-terminal/actions/runs/42191673513), [Operations #42191673245](https://github.com/armave/portfolio-terminal/actions/runs/42191673245), [Trade lifecycle #42191673508](https://github.com/armave/portfolio-terminal/actions/runs/42191673508) — passed; 135 test files / 1,626 tests |
| PT-07 Market-data client foundation | [#360 — merged](https://github.com/armave/portfolio-terminal/pull/360) | `7f09dc5b2cdab4644c319755e07e8d0256058dce` | [CI #42195710523](https://github.com/armave/portfolio-terminal/actions/runs/42195710523), [Operations #42195710638](https://github.com/armave/portfolio-terminal/actions/runs/42195710638), [Trade lifecycle #42195710525](https://github.com/armave/portfolio-terminal/actions/runs/42195710525) — passed; 137 test files / 1,670 tests |
| PT-08 Deterministic risk calculation foundation | [#361 — merged](https://github.com/armave/portfolio-terminal/pull/361) | `5f2d89e6d9feacb6c3a4b3a27ee7419ff168eec2` | [CI #42201983374](https://github.com/armave/portfolio-terminal/actions/runs/42201983374), [Operations #42201983393](https://github.com/armave/portfolio-terminal/actions/runs/42201983393), [Trade lifecycle #42201983363](https://github.com/armave/portfolio-terminal/actions/runs/42201983363) — passed; 140 test files / 1,691 tests |

### Supporting Wave 2.5 transparency slice

[PR #364](https://github.com/armave/portfolio-terminal/pull/364) merged read-only methodology and data-quality explanations into Settings.

- Merge commit: `fd04acf01675fc76198e91bc680e74a90afa314c`.
- [CI #42200939882](https://github.com/armave/portfolio-terminal/actions/runs/42200939882), [Operations #42200939863](https://github.com/armave/portfolio-terminal/actions/runs/42200939863), and [Trade lifecycle #42200939773](https://github.com/armave/portfolio-terminal/actions/runs/42200939773): passed.
- Issue [#363](https://github.com/armave/portfolio-terminal/issues/363) is closed. Physical-device/screen-reader QA was not performed; the merged panel uses native keyboard-operable disclosure elements and visible focus styling.

### Explicit follow-ups

- [#334 — PT-06 integration and attribution follow-up](https://github.com/armave/portfolio-terminal/issues/334): transaction-flow mapping, persisted valuation history, source mapping, dashboard and reporting.
- [#365 — PT-07 provider/history/calendar/event follow-up](https://github.com/armave/portfolio-terminal/issues/365): alias lifecycle, provider health/resilience, additional history adapters, exchange calendars, event ingestion and authenticated live-provider QA.
- [#366 — PT-08 policy and presentation follow-up](https://github.com/armave/portfolio-terminal/issues/366): ownership-aware configurable limits, explicit position budget semantics, alerts and risk dashboards.

CI runs use deterministic fixtures. They do not certify authenticated production TradeNet/provider behavior.

## 1. Wave 2 objective

Wave 2 establishes the trustworthy portfolio data and calculation foundations needed for a complete investment-management platform. It moves from Wave 1's calculation contracts, broker adapter foundation, security architecture, and release checks into five coordinated capabilities:

1. Transaction integrity and auditable financial history.
2. Broker reconciliation and discrepancy workflows.
3. Portfolio performance and attribution.
4. Market and instrument data quality/provenance.
5. Deterministic portfolio risk analytics.

**Outcome:** portfolio state, broker facts, market observations, performance metrics, and risk metrics become traceable, reproducible, and safe inputs for later projections, monitoring, and AI.

Wave 2 does not deliver the entire product vision. Scenario projections (PT-09), alerts (PT-10), grounded/proactive AI (PT-11/PT-12), role-specific workspaces (PT-13), admin operations (PT-14), reporting (PT-15), and onboarding (PT-18) remain later waves.

## 2. Five dedicated streams

| Stream | Scope | Existing tracking issue | Dedicated PR |
|---|---|---:|---:|
| PT-02 | Transaction integrity, idempotency, audit history, recovery | [#330](https://github.com/armave/portfolio-terminal/issues/330) | [#357 — Merged](https://github.com/armave/portfolio-terminal/pull/357) |
| PT-04 | Broker reconciliation, discrepancy classification, provenance | [#332](https://github.com/armave/portfolio-terminal/issues/332) | [#358 — Merged](https://github.com/armave/portfolio-terminal/pull/358) |
| PT-06 | TWR/MWR calculation and attribution foundation; remaining transaction/history integration tracked separately | [#334](https://github.com/armave/portfolio-terminal/issues/334) | [#359 — Merged](https://github.com/armave/portfolio-terminal/pull/359) |
| PT-07 | Instrument identity, quote/history contracts, freshness, provider resilience, FX contract | [#335](https://github.com/armave/portfolio-terminal/issues/335) | [#360 — Merged](https://github.com/armave/portfolio-terminal/pull/360) |
| PT-08 | Deterministic exposure, concentration, margin, historical risk, correlation and stress foundation | [#336](https://github.com/armave/portfolio-terminal/issues/336) | [#361 — Merged](https://github.com/armave/portfolio-terminal/pull/361) |

Each stream used its dedicated branch and existing PR. All five implementation foundations are now merged after exact-head validation. Policy, integration, dashboard and provider follow-ups remain explicitly tracked; see the current delivery status above.

## 3. Branch map

All five branches were created independently from the same Wave 1 `dev` baseline, avoiding accidental dependency on another unfinished stream.

| Stream | Branch |
|---|---|
| PT-02 | `feat/wave2-pt-02-transaction-integrity` |
| PT-04 | `feat/wave2-pt-04-broker-reconciliation` |
| PT-06 | `feat/wave2-pt-06-performance-analytics` |
| PT-07 | `feat/wave2-pt-07-market-data-foundation` |
| PT-08 | `feat/wave2-pt-08-portfolio-risk` |

Workstream charters:
- [PT-02 transaction integrity](workstreams/PT-02-transaction-integrity.md)
- [PT-04 broker reconciliation](workstreams/PT-04-broker-reconciliation.md)
- [PT-06 performance analytics](workstreams/PT-06-performance-analytics.md)
- [PT-07 market data](workstreams/PT-07-market-data-foundation.md)
- [PT-08 portfolio risk](workstreams/PT-08-portfolio-risk.md)

## 4. Parallel execution model

The five chats can work concurrently, but not every integrated behavior can be merged in arbitrary order. Parallelism is achieved through ownership boundaries, published contracts, pure calculations, and synthetic fixtures.

### Work that can proceed immediately in parallel

- **PT-02:** own transaction/event schema, idempotency semantics, mutation atomicity, journal parity, and recovery tests.
- **PT-07:** independently own instrument identity and quote/history/FX provenance, provider resilience, cache behavior, and freshness tests.
- **PT-04:** implement read-only reconciliation comparison, discrepancy taxonomy, and matching fixtures. No writes or auto-corrections before PT-02's audit/idempotency contract is agreed.
- **PT-06:** implement pure TWR/MWR and attribution calculation kernels against self-contained input contracts and known-answer fixtures. Final transaction-flow integration waits for PT-02; market/FX integration waits for PT-07.
- **PT-08:** the typed risk snapshot and deterministic calculation kernel are merged against the PT-06/PT-07 contract foundations. Ownership-aware limits, policy budgets, alert persistence and dashboard integration remain follow-ups in #366 and downstream PT-10/PT-13.

### Contract ownership — avoid conflicting definitions

| Shared concept | Owner | Consumers |
|---|---|---|
| Transaction/event schema, event IDs, idempotency, mutation/reversal semantics | PT-02 | PT-04, PT-06, later PT-15 |
| Broker snapshot and discrepancy result | PT-04 (consume PT-03 normalized snapshot) | UI, later alerts |
| Return methodology, performance series, contribution/attribution | PT-06 | PT-08, later PT-09/PT-15 |
| Instrument identity, quote/history/FX provenance and freshness | PT-07 | PT-04, PT-06, PT-08 |
| Risk input snapshot, risk outputs, assumptions and limitations | PT-08 | later PT-10/PT-11/PT-13 |

Do not create parallel competing transaction, quote, return, or risk schemas. Agree the smallest stable interface early and keep changes additive/versioned.

## 5. Dependency-aware merge order and completed integration

The planned order was executed:

1. PT-02 and PT-07 upstream contracts were merged first (#357 then #360, with PT-04/#358 and PT-06/#359 foundations integrated between them).
2. PT-06's pure return/attribution calculation foundation and PT-04 reconciliation foundation were merged after their owned inputs were available.
3. PT-08's deterministic risk kernel was merged after PT-06 and PT-07. It carries contributor position IDs and source observation timestamps, fails closed on unsupported mixed-currency consolidation, and uses explicitly supplied broker assumptions.
4. Wave 2.5's explanatory Settings panel (#364) was merged independently without changing financial calculations.

All five core stream PRs and the supporting Wave 2.5 PR passed their exact-head workflows before merge. Remaining functional integration is tracked in #334, #365 and #366. Continue running full CI on current `dev` after future follow-up merges.

## 6. Non-negotiable financial and data safety constraints

- `PortfolioState.positions` remains the canonical active-position representation during Wave 2. Do not cut over to a new ledger as canonical in this wave.
- Transaction journal is initially append-only evidence and a verification/recovery mechanism; define migration and rollback before any future source-of-truth change.
- Do not silently change rounding, commissions, fees, margin accrual, rollover, date/time boundaries, or historical import semantics.
- A missing or malformed financial value must not become a plausible zero. A genuine numeric zero remains valid.
- Incomplete or stale broker snapshots must not overwrite the last accepted account state.
- Broker-reported positions/balances remain distinct from app-owned lots, cost basis, and cash accounting.
- Provider receipt timestamp is not necessarily market observation timestamp. Live, delayed, stale, indicative, cached, missing, and unknown must remain distinct states.
- Do not sum unlike currencies. Historical FX needs a pair/direction/source/timestamp/quality contract before cross-currency aggregation is enabled.
- Return and risk engines are deterministic, read-only, and independent of UI, network, storage, and AI.
- Scenario/stress results must disclose assumptions; they are not guarantees or broker liquidation promises.
- No reconciliation auto-writeback or AI-generated financial mutation without explicit user confirmation and an auditable command.

## 7. Testing and engineering standards

Every stream must include focused Vitest coverage and independent known-answer financial fixtures. Required repository checks must be run against the exact final candidate commit:

```sh
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:production
npm run build
```

Also required where relevant:
- Persistence failure, rollback, idempotency, conflict, retry, and reload/recovery tests.
- Malformed, partial, stale, out-of-order, delayed, and missing-provider-data tests.
- Timezone, date boundary, currency, and rounding boundary tests.
- English/Russian localization parity for every new visible string.
- Keyboard/accessibility and responsive-browser coverage for new user-facing surfaces.
- Exact-head GitHub Actions links and manual QA status in each PR.

Mocked tests do not prove authenticated live TradeNet behavior or a production provider session.

## 8. Repository workflow

- All five streams are frontend/domain/client PRs targeting `dev`.
- Each chat implements only its assigned branch and updates its existing draft PR; do not create duplicate branches or replacement PRs.
- Keep stream ownership boundaries. Coordinate shared interfaces in the PR discussion before changing another stream's owned contract.
- Keep each PR draft until its code, tests, acceptance criteria, and exact-head checks are complete.
- No automatic merges. Integrate in the dependency-aware order above.
- Worker/server-only changes must follow the repository rule and be committed/pushed directly to `main` for immediate deployment. Mixed features must split the server deployment slice from the client PR and record paired commits.
- Preserve English/Russian localization and the established Vitest/testing conventions.

## 9. Completion checklist

- [x] Wave 1 release PR #353 merged to `main`.
- [x] PT-01 and PT-03 Wave 1 implementation issues closed.
- [x] Five Wave 2 workstream branches created from the same `dev` baseline.
- [x] Five dedicated implementation PRs opened and scoped.
- [x] PT-02 transaction integrity foundation (#357) implemented, tested and merged.
- [x] PT-04 broker reconciliation foundation (#358) implemented, tested and merged.
- [x] PT-06 pure performance calculation foundation (#359) implemented, tested and merged.
- [x] PT-07 market-data/instrument client foundation (#360) implemented, tested and merged.
- [x] PT-08 deterministic risk calculation foundation (#361) implemented, tested and merged.
- [x] Supporting Wave 2.5 metric methodology/data transparency panel (#364) merged.
- [x] All core stream PRs reviewed and merged in dependency-aware order with exact-head CI evidence.
- [x] Parent product roadmap updated with merged SHAs, workflows and explicit follow-up links.
- [ ] Follow-up integration and policy work in #334, #365 and #366 remains open; this is not a claim that all later-wave product features are complete.

## 10. Definition of done

The Wave 2 calculation and data foundations have been delivered: transaction journal/audit primitives, broker discrepancy/reconciliation foundations, pure performance calculation kernels, market-data provenance/history contracts, and a deterministic read-only risk engine. Exact-head CI evidence is recorded above.

Full cash-flow/history integration, broader provider lifecycle, authenticated live-provider QA, configurable ownership-aware risk policies, alert persistence and risk dashboard surfaces remain separately tracked in #334, #365 and #366 and later PT-10/PT-13 work. Those limitations must not be silently represented as completed capabilities.

These foundations provide the reliable analytical base for Wave 3 projections, monitoring and grounded AI.
