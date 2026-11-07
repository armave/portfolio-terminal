# Wave 3 — Transaction Trust, Multi-Portfolio Ownership and Integrated Intelligence

**Status:** Prepared for parallel implementation  
**Umbrella PR target:** dev  
**Umbrella branch:** docs/wave-3-trusted-portfolio-intelligence  
**Implementation baseline:** d2263a3c0e83a525009af70069bca91ad03fc70e (dev, after Wave 3 umbrella merge)  
**Parent:** docs/product-vision-roadmap.md  
**Current-state audit:** current-state-audit.md

---

## 1. Wave objective

Wave 3 closes the correctness, ownership and data-integration gaps that must be solved before Portfolio Terminal can safely become a multi-user investment-management platform.

The outcome is a system that can:

- Record and verify supported financial mutations with complete audit/recovery semantics.
- Compare broker facts to app-owned transactions, cashflows, fees, lots and prices.
- Securely separate tenant/workspace/portfolio ownership at the server and storage boundaries.
- Calculate portfolio performance from real source events and sourced valuation history.
- Explain market instruments, provider observations, historical series, exchange sessions and events with dependable provenance.

**Wave 3 prioritizes the trusted data and ownership substrate. It deliberately does not rush into projections, alert routing or AI before those inputs and permissions are complete.**

## 2. Baseline confirmed on dev

The Wave 2 foundation PRs are merged:

| Foundation | Delivery |
|---|---|
| PT-02 transaction integrity | PR #357 merged; mutation/audit acceptance remains incomplete |
| PT-04 position reconciliation | PR #358 merged; execution/fee/cashflow reconciliation remains open |
| PT-06 performance calculations | PR #359 merged; actual history/valuation integration remains open |
| PT-07 market-data client foundation | PR #360 merged; provider lifecycle/history/calendar/event extensions remain open |
| PT-08 deterministic risk calculations | PR #361 merged; policy limits/presentation remain open |
| Methodology transparency | PR #364 merged to Settings |
| Device Check | PR #367 merged to Settings; the old reconciliation card was removed from the portfolio desk |
| Local history quota reliability | PR #368 merged; routine history sync no longer rewrites the full local history sidecar |
| Refresh/render efficiency | PR #377 merged |

There were no open implementation PRs at the time of the audit. The current dev head includes the latest performance optimization.

The important tracking issues for Wave 3 are existing issues #330, #332, #333, #334 and #365. The merged foundation PRs do not mean those broader issue acceptance criteria are complete.

See current-state-audit.md for code-level observations and limitations.

## 3. Five dedicated implementation streams

All five branches have been created from the same dev baseline above. Do not create empty placeholder PRs. Each stream opens its focused PR when there is an implementation diff ready for review.

| Stream | Existing issue | Dedicated branch | Primary outcome |
|---|---:|---|---|
| PT-02 — Transaction integrity completion | #330 | feat/wave3-pt02-transaction-integrity-completion | Complete journal coverage, replay/parity, idempotency boundaries and recovery |
| PT-04 — Reconciliation completion | #332 | feat/wave3-pt04-reconciliation-completion | Match executions, cashflows, fees, prices and timestamps with reviewable evidence |
| PT-05 — Multi-portfolio ownership | #333 | feat/wave3-pt05-portfolio-tenancy | Implement server-authoritative tenant/portfolio isolation and safe migration |
| PT-06 — Performance integration | #334 | feat/wave3-pt06-performance-integration | Wire deterministic TWR/MWR and attribution to actual source events/valuations |
| PT-07 — Market-data lifecycle | #365 | feat/wave3-pt07-market-data-lifecycle | Complete aliases, provider resilience, additional history, calendars and typed events |

Detailed charters are in docs/wave-3/workstreams/. Stream 1 has begun: cloud snapshot retry idempotency is deployed from main commit [c6201c5](https://github.com/armave/portfolio-terminal/commit/c6201c528977bd2dd2bf9fe2ef05fb28dbec9772); the paired client retry change is under review in its focused PT-02 implementation PR.

## 4. Why PT-02 is explicitly included

PT-02 PR #357 delivered an additive journal foundation and idempotency for supported mutation paths, but issue #330 remains open. The issue explicitly lists incomplete mutation coverage, replay/parity, cross-tab/server revision semantics and backup/recovery work.

This is a real dependency, not documentation overhead: PT-05's own issue says its runtime implementation still requires the PT-02 transaction/audit ownership and mutation contracts. The tenancy stream must not enable independent financial writes until those contracts are accepted.

Likewise, PT-04's reviewed discrepancy resolution and PT-06's external flow mapping must consume one stable transaction/event contract. Wave 3 therefore closes PT-02 before declaring tenant financial writes, reconciliation corrections or complete performance integration ready.

## 5. Parallel execution and dependency gates

The branches share one baseline so work can begin concurrently, but implementation and merge order must respect the contracts.

### Work that can begin immediately

- **PT-02:** inventory all financial mutation paths, fill journal coverage gaps and define the smallest versioned replay/parity and recovery contract. Preserve positions as canonical.
- **PT-04:** build read-only matchers for broker executions, cashflows, fees and source metadata using the already merged transaction and adapter foundations. Resolution writeback remains gated on PT-02.
- **PT-05:** implement tenant directory/authorization design and isolated server-side proof slices. No independent financial write or live cutover before PT-02 and PT-16 gates pass.
- **PT-06:** build source adapters and known-answer fixtures for the performance kernel against existing PT-02 and PT-07 contracts. Final return integration waits for accepted transaction and market-history coverage.
- **PT-07:** implement additive instrument/history/provider/calendar/event contracts without changing financial formulas.

### Dependency-aware merge order

1. PT-02 and PT-07 publish stable event/provenance contracts early. They can work in parallel because they own different domains.
2. PT-05 may implement tenant directory and read authorization in isolated stages, but tenant-owned financial writes remain disabled until PT-02 acceptance, PT-16 key/security review, adversarial isolation tests and migration/rollback gates pass.
3. PT-04 consumes PT-02 event IDs/idempotency/correction semantics and PT-07 provenance. It remains read-only by default; corrections are explicit, confirmed and audit-linked.
4. PT-06 maps actual PT-02 transactions/flows, PT-04 quality and PT-07 valuation/history data to the existing pure performance kernel.
5. Each stream completes its isolated tests and exact-head CI. Do not integrate a downstream surface by treating missing upstream data as zero or current.

### Merge gates

- PT-02 must prove journal/persistence parity for supported financial mutations and document unsupported paths before PT-05 enables financial writes.
- PT-05 must not trust client-supplied tenant/workspace/portfolio IDs; key lifecycle, migration, rollback and server-side object checks are mandatory.
- PT-04 must not silently rewrite app-owned lots or cost basis from aggregate broker quantities.
- PT-06 must not present provisional or incomplete return/attribution as verified.
- PT-07 must not silently rewrite historical identities or imply global live freshness from an unknown observation.
- Worker/server-only slices follow the direct-to-main deployment policy; client/API contract work targets dev.

## 6. Contract ownership

| Contract | Owner | Consumers / constraints |
|---|---|---|
| Transaction event IDs, idempotency, reversals/corrections, mutation parity and audit semantics | PT-02 | PT-04 and PT-06 consume; PT-05 financial writes are gated by it |
| Broker execution and account snapshot normalization | PT-03 / broker adapters (merged) | PT-04 consumes normalized source records |
| Discrepancy types, matching evidence and reviewed resolution proposal | PT-04 | PT-06 consumes quality status; PT-10 later consumes events |
| Tenant/workspace/portfolio identity, membership and grants | PT-05 | Every future user-owned setting, alert, scenario and report must use server-resolved scope |
| Return methodology, valuation series and attribution | PT-06 | PT-09/PT-15 later consume; formulas remain pure |
| Instrument identity, provider observation, receipt time, exchange, currency, quality and freshness | PT-07 | PT-04/PT-06/PT-08/PT-09 consume |
| Risk calculation snapshot and outputs | PT-08 (merged foundation) | Later risk policies and projections consume it |

No competing transaction, return, provider or risk schemas should be introduced.

## 7. Deliberately deferred to the next wave

These depend on the contracts Wave 3 is intended to complete:

- PT-09 scenario modeling/projections (#337): requires complete transaction/flow history, integrated performance, market-data history and the PT-08 risk engine. It belongs in the following wave, not as a UI over incomplete inputs.
- PT-08 risk limits and position budgets (#366): ownership, budget semantics, alert lifecycle and role presentation need PT-05/PT-10/PT-13 contracts.
- PT-10 rules-based monitoring/notification (#338): requires real ownership scopes and stable market/risk events.
- PT-11 grounded AI (#339) and PT-12 proactive AI (#340): wait for trusted data, projections and alert events.
- PT-13 role-specific workspaces (#341) and PT-14 platform administration (#342): wait for PT-05 and later analytics/alert capabilities.
- PT-15 reporting/exports/benchmarks (#343): consumes PT-05, PT-06, PT-08 and PT-09.
- PT-16 security/privacy (#344) and PT-17 reliability/observability (#345) remain continuous release gates.
- PT-18 onboarding/education (#346): update alongside stable user workflows and metric contracts.

## 8. Non-negotiable safety rules

- Preserve PortfolioState.positions as the canonical active-position representation unless a separate, versioned ledger migration is approved.
- Preserve persisted data and legacy account migration behavior.
- Do not silently change commission, fee, margin-interest, rollover, currency, rounding or return methodology.
- Never treat missing, stale, delayed, indicative, unknown or incomplete data as zero or as a current observation.
- Never combine currencies without a validated historical FX pair/direction/source/timestamp/quality contract.
- Keep deterministic finance calculations independent of UI, network, browser storage and AI.
- Never let broker aggregate quantities silently rewrite app-owned lots or cost basis.
- No autonomous order submission or silent financial mutation; any correction requires explicit user confirmation and an auditable event.
- No client-only authorization. Worker/DO authorization is authoritative.
- No sensitive portfolio values, user identifiers, credentials or raw provider payloads in logs or telemetry.

## 9. Engineering and release requirements

Every implementation PR must:

- Target dev for client/domain changes and update only its assigned branch.
- Add Vitest unit/regression tests and independent known-answer financial fixtures.
- Preserve English/Russian localization and translation-parity tests for every new user-visible string.
- Cover responsive and keyboard-accessible UI states where UI is added.
- Record exact tested commit SHA and links to Pull Request CI, Operations Browser Journey and Trade Lifecycle Browser Smoke.
- Distinguish deterministic mock/test evidence from authenticated live TradeNet/provider QA.
- Keep the exact PR head as the tested candidate.
- Include manual QA and rollback notes in the PR description.

**Worker/Cloudflare/server-only changes follow the repository deployment rule:** commit/push those server-only slices directly to main. Mixed streams split and document paired server/client SHAs and deployment ordering. Do not activate a new client-dependent endpoint before the paired server route and authorization checks are deployed and verified.

## 10. Definition of done

Wave 3 is complete only when:

- Supported financial mutations have journal/audit coverage and verified replay/parity/recovery semantics.
- Broker-vs-app discrepancies across executions, cashflows, fees and price/timing are reproducible and reviewable.
- Tenant/portfolio ownership is server-enforced, key lifecycle is approved, and legacy admin/guest data migrates and rolls back without data loss or leakage.
- Actual portfolio events and sourced valuation history feed performance outputs that reconcile to source records with explicit quality states.
- Market-data identity/provider lifecycle is traceable across supported instruments, histories, exchanges and events.
- All exact-head CI and required manual release gates are recorded.

Wave 3 intentionally leaves forward projections, alerts and AI for the next wave, after these foundations are complete.
