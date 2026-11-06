# Wave 3 current-state audit — 2026-11-06

**Repository:** armave/portfolio-terminal  
**Audited branch:** dev  
**Audited head:** 09b62aaefce8eb283294d6de7b5aab50dc7c9d1b  
**Audit basis:** repository source, Wave 2/Wave 2.5 documentation, product roadmap and open roadmap issue charters.

---

## 1. Executive assessment

The repository has a meaningful financial calculation and provider foundation. It now has a Preact/TypeScript/Vite client, Cloudflare Worker and Durable Object cloud-state boundary, canonical portfolio store, broker adapters, a transaction journal foundation, quote/history provenance contracts, pure performance and risk calculation kernels, methodology transparency in Settings, and exact-head browser/CI workflows.

The main weakness is the gap between foundations and complete, integrated financial workflows:

- PT-02 is not finished. The merged journal/idempotency slice covers supported mutation paths, but issue #330 remains open for broader mutation inventory, corporate actions/imported executions, replay/parity, cross-tab/server conflict semantics and backup/recovery.
- PT-04 remains primarily aggregate position-quantity reconciliation. Execution, cashflow, fee, price and timing matching remains open.
- PT-06 contains pure return and attribution functions, but actual transaction/flow mapping, sourced valuation history, account/security attribution and dashboard integration remain open.
- PT-07 has normalized quote/history contracts and bounded behavior, but alias lifecycle, broader provider health, additional history coverage, global exchange calendars, typed earnings/dividend events and authenticated live QA remain open.
- PT-05 has a proposed tenant architecture, not tenant runtime or independent portfolios. Its issue explicitly states PT-05B still requires completion of PT-02 transaction/audit ownership and mutation contracts.
- PT-08 has a pure risk engine, but owner-scoped limits/budgets and alert/dashboard integration remain deferred.
- Existing scenario comparison modals serve narrow terminal workflows; a whole-portfolio projection engine should wait until transaction, market-data and performance inputs are integrated.

Wave 3 therefore prioritizes PT-02, PT-04, PT-05, PT-06 and PT-07. Projections are deliberately deferred rather than presented over incomplete inputs.

## 2. Confirmed implementation baseline

### Runtime and architecture

- Preact 11, TypeScript and Vite client with Vitest.
- app.ts remains the runtime composition root; service and domain boundaries are extracted incrementally.
- Cloudflare Worker and Durable Object provide authenticated cloud-state, account and guest projection endpoints.
- The repository uses a modular-monolith approach; a rewrite or premature microservice split is not justified by current evidence.

### Portfolio and financial state

- PortfolioState.positions remains canonical active-position state; holdings is a compatibility projection.
- PT-02 PR #357 added a versioned transaction event schema, journal append/merge helpers and idempotency for selected mutation paths.
- Issue #330 remains open. Its documented remaining work includes dividends/fees/deposits/withdrawals/transfers/corporate actions/imported executions, transaction replay/parity, cross-tab/server revision conflict semantics and backup/restore validation.
- PT-04 PR #358 added read-only comparison of broker aggregate quantities against app margin positions plus cash-backed holdings, with conservative incomplete/stale/unknown handling.
- Issue #332 remains open for full execution, fee, cashflow, price and timestamp comparison and reviewed resolution.
- PR #368 changed routine admin history sync to persist only compact portfolio state locally before checkpointing the complete history to the separate encrypted cloud-history store; it avoids repeated quota-heavy local sidecar rewrites without truncating the history.
- No wholesale canonical-ledger cutover is approved.

### Performance and risk

- src/domain/portfolioPerformance.ts contains deterministic linked Modified Dietz return, ACT/365 XIRR, period buckets, generic item attribution and adjustment summaries. It needs sourced valuation and flow inputs and fails closed on incomplete inputs or mixed currency.
- src/domain/portfolioRisk.ts contains deterministic exposure, concentration, leverage, margin estimates, historical volatility/drawdown/downside, correlation and ticker-shock calculations. It rejects unsupported mixed-currency consolidation and labels margin outputs as estimates.
- Both kernels are read-only and separate from UI, network and persistence.
- PT-06 production mapping and UI and PT-08 configurable policies remain incomplete.

### Market data

- Instrument and quote/history contracts carry source, exchange/currency and observation/receipt metadata.
- Yahoo batching/cache and Freedom REST retry/cancellation have bounded behavior.
- FX pair/direction/provenance contracts exist, but portfolio-wide FX conversion is not enabled.
- Alias lifecycle, broader provider health, second historical provider, exchange calendars and typed earnings/dividend events remain PT-07 follow-up scope.

### User and ownership model

- Current account roles are admin and guest.
- Admin accounts share one owner workspace.
- Guests receive server-filtered, encrypted, read-only projections and assignment history.
- The server blocks guest access to owner workspace, closed history, encryption key and write APIs.
- PT-05 architecture defines tenant/workspace/portfolio ownership vocabulary and a proposed separate tenant Durable Object topology, but it is design only.
- PT-05 issue #333 explicitly marks the transaction/audit ownership contract in PT-02 issue #330 as a prerequisite. Independent editable tenant portfolios are not enabled.
- PT-16 shared digest encryption is partial; per-tenant keys and complete key rotation/recovery are not implemented.

### Existing scenario experience

- ScenarioComparisonModal.tsx and ScenarioReportModal.tsx are existing presentation components.
- src/features/terminal/scenarioContracts.ts defines terminal scenario payloads.
- These serve narrow hypothetical trade/exit comparison flows. They are not evidence of a reusable whole-portfolio projection engine covering multi-period equity, deposits/withdrawals, fees/dividends, financing and scenario ranges.

### Reliability

- Exact-head Pull Request CI, Operations Browser Journey and Trade Lifecycle Browser Smoke are configured.
- PR #377 added a deterministic authenticated synthetic-portfolio performance fixture with mocked Worker/broker data and three cold samples for desktop/mobile. It is a CI trend sample, not live broker verification or a statistically stable SLO baseline.
- PT-17 still requires at least 10 comparable observations, representative large-portfolio/slow-network samples, privacy-reviewed production telemetry, authenticated TradeNet/Market Depth QA and branch-protection enforcement.
- Recent merged PRs #367/#368 addressed Settings Device Check and local history quota reliability; #377 reduced duplicate syncs and Market Insights re-renders.

## 3. Why these five streams

| Chosen stream | Remaining gap | Why it belongs in Wave 3 |
|---|---|---|
| PT-02 (#330) | Journal and idempotency are partial; mutation coverage, parity and recovery remain open | Foundational prerequisite for safe reconciliation corrections, performance flows and tenant-owned writes |
| PT-04 (#332) | Full execution/cashflow/fee/price/timing matching is not delivered | Broker reliability requires more than aggregate quantities |
| PT-05 (#333) | Tenant architecture exists but runtime authorization/key/storage isolation do not | Multiple investor/manager workspaces require a real server ownership model |
| PT-06 (#334) | Performance kernel is not wired to real journal and valuation history | Turns calculation foundations into actual portfolio intelligence |
| PT-07 (#365) | Provider identity/lifecycle/history/calendar/event extensions remain deferred | Reliable performance and future projections need trustworthy historical inputs |

## 4. Why projections are deferred

PT-09 is an important product goal, but its own issue depends on PT-02, PT-06, PT-07 and PT-08. PT-06 and PT-07 integration is not complete; PT-02 is still open; and PT-05 is required before user-owned saved scenarios can be safely scoped. Building a full projection surface in this wave would either use incomplete input contracts or create throwaway adapters.

PT-09 moves to the next wave, where it can consume reconciled transaction history, integrated performance, market-data provenance and the PT-08 risk kernel. PT-10 alerts and later AI/reporting work follow the same dependency logic.

## 5. Evidence limitations

This audit reads current repository source and roadmap issue descriptions. It does not assert authenticated production TradeNet, provider-wide endpoint, multi-device/distributed transaction, physical-device accessibility or tenant migration validation. Those gaps remain release gates in the workstream charters.
