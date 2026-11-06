# Wave 3 current-state audit — 2026-11-06

**Repository:** armave/portfolio-terminal  
**Audited branch:** dev  
**Audited head:** 09b62aaefce8eb283294d6de7b5aab50dc7c9d1b  
**Audit basis:** repository source, Wave 2/Wave 2.5 documentation, product roadmap and open roadmap issue charters.

---

## 1. Executive assessment

The repository has moved beyond a basic holdings dashboard. It now has a Preact/TypeScript/Vite client, a Cloudflare Worker and Durable Object cloud-state boundary, a canonical portfolio store, broker adapters, a transaction journal foundation, quote/history provenance contracts, pure performance and risk calculation kernels, methodology transparency in Settings, and exact-head browser/CI workflows.

The main weakness is the gap between calculation primitives and a complete, integrated investor workflow:

- Broker reconciliation is still primarily an account-position quantity comparison; the broader transaction, fee, cashflow, price and timing matching scope remains open.
- The performance engine accepts typed valuation and flow inputs, but the actual transaction and valuation history adapters, security/account mapping, dashboard and persistence integration remain open.
- The market-data foundation has normalized identity, quote/history contracts and bounded resilience, but alias lifecycle, broader provider-health policy, another historical provider, global exchange calendars, event ingestion and authenticated live QA remain open.
- Risk calculations are implemented as a pure engine, but ownership-aware policies, position budgets, alert lifecycle and user-facing integration remain open.
- Scenario comparison modals and terminal scenario contracts already exist for specific hypothetical trade workflows; they are not evidence of a complete portfolio-wide, multi-horizon projection engine.
- The current authorization model is one shared administrator workspace plus restricted read-only guest projections, not independent tenant-owned portfolios.

This is why Wave 3 prioritizes the missing integrations and ownership boundaries rather than another set of summary panels.

## 2. Confirmed implementation baseline

### Runtime and architecture

- Preact 11, TypeScript and Vite client with Vitest.
- app.ts remains the runtime composition root; services and domain modules are being extracted incrementally.
- Cloudflare Worker and Durable Object provide authenticated cloud-state, account, and guest projection endpoints.
- The repository deliberately follows a modular-monolith approach; a rewrite or premature microservice split is not justified by the current evidence.

### Portfolio and financial state

- PortfolioState.positions remains the canonical active-position state; holdings is a compatibility projection.
- PT-02 transaction-journal and mutation-integrity foundations are merged.
- PT-04's merged foundation compares broker aggregate quantities against app margin positions plus cash-backed holdings, with conservative partial/stale/unknown handling.
- Large closed-history data is separately cached. PR #368 changed routine admin history sync to persist only the compact portfolio state locally before checkpointing full history to the separate encrypted cloud-history store, avoiding repeated quota-heavy sidecar writes.
- No wholesale canonical-ledger cutover is approved.

### Performance and risk

- src/domain/portfolioPerformance.ts contains deterministic linked Modified Dietz return, ACT/365 XIRR, period buckets, generic item attribution and adjustment summaries. It requires typed valuation/flow inputs and fails closed on incomplete inputs or mixed currency.
- src/domain/portfolioRisk.ts contains deterministic exposure, concentration, leverage, margin estimates, historical volatility/drawdown/downside, correlation and ticker-shock calculations. It rejects unsupported mixed-currency consolidation and labels margin outputs as estimates.
- These kernels are read-only and separate from UI, network and persistence.
- PT-06 production mapping and UI and PT-08 configurable limits/policy/presentation are not completed.

### Market data

- Instrument and quote/history contracts carry source, exchange/currency and observation/receipt metadata.
- Yahoo batching/cache and Freedom REST retry/cancellation have bounded behavior.
- FX pair/direction/provenance contracts exist, but no portfolio-wide FX conversion is enabled.
- Broader provider health, a second historical provider, alias lifecycle, more exchange calendars and typed earnings/dividend events remain PT-07 follow-up scope.

### User and ownership model

- Current roles are admin and guest.
- Admin accounts share one owner workspace.
- Guests receive server-filtered, encrypted, read-only projections and assignment history.
- The server blocks guest access to the owner workspace, closed history, encryption key and write APIs.
- PT-05 architecture defines tenant/workspace/portfolio ownership vocabulary and proposes a separate tenant Durable Object topology, but it is design only. Independent editable tenant portfolios are not enabled.
- PT-16's shared workspace digest encryption is partial; per-tenant keys and complete key rotation/recovery are not implemented.

### Existing scenario experience

- ScenarioComparisonModal.tsx and ScenarioReportModal.tsx are existing presentation components.
- src/features/terminal/scenarioContracts.ts defines the terminal scenario payload.
- These serve existing hypothetical trade/exit comparison flows. The repository does not yet show a separately owned, reusable portfolio projection domain engine covering multi-period portfolio equity, deposits/withdrawals, fees/dividends, financing and scenario ranges.

### Reliability

- Exact-head Pull Request CI, Operations Browser Journey and Trade Lifecycle Browser Smoke are configured.
- PR #377 added a deterministic authenticated synthetic-portfolio performance fixture with mocked Worker/broker data and three cold samples for desktop/mobile. It is a useful CI trend sample, not live broker verification or a statistically stable SLO baseline.
- PT-17 still requires at least 10 comparable observations, representative larger portfolios/slow networks, privacy-reviewed production telemetry, authenticated TradeNet/Market Depth QA and branch-protection enforcement.
- Recent merged PRs #367/#368 addressed Settings Device Check and local history quota reliability; #377 reduced duplicate syncs and Market Insights re-renders.

## 3. Why these five streams

| Chosen stream | Evidence of remaining gap | Why it belongs in Wave 3 |
|---|---|---|
| PT-04 (#332) | Reconciliation issue still lists balances, executions, cashflows, prices, fees and timestamps beyond quantity matching | Users need a reliable explanation of broker-vs-app differences before relying on performance or projections |
| PT-05 (#333) | Architecture specifies the future ownership model but implementation remains gated | Multiple investors/managers/guests require server-enforced portfolio ownership before user-scoped products |
| PT-06 (#334) | Pure performance math is merged; source-event mapping, valuation history, attribution and surfaces remain open | Turns calculations into actual portfolio intelligence |
| PT-07 (#365) | Provider lifecycle, aliases, historical coverage, exchange semantics, events and live QA are deferred | Projections/performance are only as trustworthy as the historical inputs and provenance |
| PT-09 (#337) | Existing terminal scenario views are narrow; a reusable whole-portfolio projection engine is still roadmap work | Delivers the core forward-looking product outcome using PT-06/PT-07/PT-08 contracts |

## 4. Deliberate sequencing decisions

- PT-05 is included now because PT-10 alerts, PT-13 role-specific workspaces, PT-14 administration and PT-15 sharing all depend on real ownership scopes. The architecture milestone alone is not enough.
- PT-04 and PT-06 consume PT-02 transaction contracts; they must not create parallel transaction schemas.
- PT-07 owns provider/instrument/freshness/FX contracts. PT-04 and PT-06 consume them rather than calling providers directly.
- PT-09 begins with pure read-only calculation against immutable snapshots. UI integration follows PT-06/PT-07 data adapters.
- PT-08's risk kernel is already merged; its policy/position-budget follow-up (#366) is deferred until ownership and alert policy can be specified correctly.
- PT-10 alerts (#338), PT-11/PT-12 AI, PT-13 role views, and PT-15 reports are deferred until the portfolio/security/data contracts are stable.

## 5. Evidence limitations

This audit reads the current repository and issue/roadmap documentation. It does not assert that authenticated production TradeNet, production exchange calendars, all provider endpoints, physical-device accessibility, or tenant migration have been validated. Those gaps are called out in the workstream acceptance criteria and release gates.
