# Wave 3 — Trusted Multi-Portfolio Intelligence and Forward Projections

**Status:** Prepared for parallel implementation  
**Umbrella PR target:** dev  
**Umbrella branch:** docs/wave-3-trusted-portfolio-intelligence  
**Base commit:** 09b62aaefce8eb283294d6de7b5aab50dc7c9d1b (dev, 2026-11-06)  
**Parent:** docs/product-vision-roadmap.md  
**Current-state audit:** current-state-audit.md

---

## 1. Wave objective

Wave 3 closes the gaps between the calculation foundations merged in Wave 2 and a trustworthy, forward-looking investment-management product.

The outcome is not another dashboard layer. It is a portfolio platform that can:

- Compare broker-reported facts with app-owned transaction, lot, fee and cashflow records.
- Safely support independently owned portfolios without treating the current admin/guest projection model as tenant isolation.
- Calculate portfolio performance from real valuation and transaction history rather than test-only input contracts.
- Explain the quality, source, identity and freshness of market observations across instruments and exchanges.
- Model reproducible future portfolio paths with fees, cashflows, financing and risk assumptions, without changing the real portfolio.

**Wave 3 success means the app can explain both what happened and what could happen, with ownership, provenance and calculation limitations visible.**

## 2. Baseline confirmed on dev

The Wave 2 foundation PRs are merged:

| Foundation | Delivery |
|---|---|
| PT-02 transaction integrity | PR #357 merged |
| PT-04 position reconciliation foundation | PR #358 merged; execution/fee/cashflow reconciliation remains open |
| PT-06 performance calculation kernel | PR #359 merged; actual history/valuation integration remains open |
| PT-07 market-data contracts and client foundation | PR #360 merged; provider lifecycle/history/calendar/event extensions remain open |
| PT-08 deterministic risk calculation kernel | PR #361 merged; policy limits and presentation remain open |
| Methodology transparency | PR #364 merged to Settings |
| Device Check | PR #367 merged to Settings; reconciliation card is not part of the portfolio desk |
| Local history quota reliability | PR #368 merged; routine history sync no longer rewrites the full local history sidecar |
| Refresh/render efficiency | PR #377 merged |

There were no open pull requests at the time of this audit. The current dev head includes the latest performance optimization merge.

The relevant remaining implementation work is tracked in existing issues: #332 (PT-04), #333 (PT-05), #334 (PT-06), #365 (PT-07 follow-up), and #337 (PT-09). This Wave reuses these issues rather than creating duplicate roadmap issues.

See current-state-audit.md for the code-level observations and limitations that informed this selection.

## 3. Five dedicated implementation streams

All five implementation branches have been created from the same dev baseline above. Do not create empty placeholder PRs. Each implementation chat should work only on its assigned branch and open one focused PR targeting dev when there is an actual implementation diff.

| Stream | Existing issue | Dedicated branch | Primary outcome |
|---|---:|---|---|
| PT-04 — Reconciliation completion | #332 | feat/wave3-pt04-reconciliation-completion | Compare executions, cashflows, fees, prices and timing; explain discrepancies safely |
| PT-05 — Multi-portfolio ownership | #333 | feat/wave3-pt05-portfolio-tenancy | Server-authoritative tenant/portfolio isolation and safe migration |
| PT-06 — Performance integration | #334 | feat/wave3-pt06-performance-integration | Wire deterministic TWR/MWR and attribution to actual portfolio history |
| PT-07 — Market-data lifecycle | #365 | feat/wave3-pt07-market-data-lifecycle | Complete aliases, provider resilience, historical data, calendars and events |
| PT-09 — Scenario projections | #337 | feat/wave3-pt09-scenario-projections | Deterministic, read-only multi-horizon portfolio projections |

Each chat owns its branch. Do not edit another stream's owned contract without coordinating in the umbrella PR first.

## 4. Parallel execution and dependency gates

The branches share one baseline so the five streams can start concurrently, but their integration is not an arbitrary merge race.

### Work that can begin immediately

- PT-04 can implement execution/fee/cashflow matching against the merged PT-02 journal and publish the exact matching contract it needs from PT-07.
- PT-05 can implement the tenant runtime/server authorization and migration gates independently of the financial calculation work.
- PT-06 can implement adapters from actual transaction and valuation records to the merged pure performance kernel using stable PT-02 contracts and synthetic known-answer fixtures.
- PT-07 can implement additive instrument/provider/history/calendar/event contracts and provider lifecycle without changing performance or risk formulas.
- PT-09 can build a pure scenario calculation core against immutable typed inputs and synthetic fixtures. Final UI wiring must consume the integrated PT-06/PT-07 inputs and the existing PT-08 risk kernel.

### Dependency-aware integration order

1. PT-07 publishes additive instrument, history, FX-provenance and freshness contracts. PT-04 and PT-06 consume those contracts; neither duplicates provider normalization.
2. PT-05 passes the security and migration gates before any independently editable tenant portfolio, tenant-scoped write, share grant or user-owned alert is enabled.
3. PT-04 consumes PT-02 transaction IDs/idempotency/audit semantics and PT-07 data provenance. Its default reconciliation is read-only; corrections require explicit review and an audit-linked command.
4. PT-06 wires PT-02 transaction flows, PT-04 discrepancy quality and PT-07 valuation/history data into the pure calculation kernel. It does not invent missing observations or silently convert currency.
5. PT-09 consumes the integrated performance inputs, PT-07 price paths and existing PT-08 risk calculations. Its calculations remain separate from actual portfolio state.

### Merge gates

- PT-07 contracts should be reviewed early so PT-04/PT-06 do not invent competing source/freshness schemas.
- PT-05 must not enable independent tenant writes until key ownership/rotation/recovery, server object-level authorization, migration/rollback and adversarial isolation tests pass.
- PT-04 must not silently update app-owned lots or cost basis from aggregate broker quantities.
- PT-06 must not present provisional or incomplete performance as current/verified.
- PT-09 must prove zero mutation of live portfolio state and reproducibility from saved scenario inputs.
- If a downstream stream finishes its isolated calculation kernel first, it may be merged only if the published interface is additive and does not claim the full integrated feature is complete.

## 5. Contract ownership

| Contract | Owner | Consumers / constraints |
|---|---|---|
| Transaction event IDs, idempotency, reversal and mutation semantics | PT-02 (merged foundation) | PT-04 and PT-06 consume; do not redefine |
| Broker execution and account snapshot normalization | PT-03 / broker adapters (merged) | PT-04 consumes normalized source records |
| Discrepancy types, matching evidence and resolution proposal | PT-04 | PT-06 consumes data-quality status; PT-10 later consumes events |
| Tenant/workspace/portfolio identity, membership and grants | PT-05 | Every future user-owned setting, alert, scenario and report must use server-resolved scope |
| Return methodology, valuation series and attribution | PT-06 | PT-09/PT-15 consume; formulas remain pure |
| Instrument identity, provider observation, receipt time, exchange, currency, quality and freshness | PT-07 | PT-04/PT-06/PT-08/PT-09 consume |
| Scenario input, result and assumption contract | PT-09 | Later reports and grounded AI consume |
| Risk calculation snapshot and outputs | PT-08 (merged foundation) | PT-09 consumes; #366 policy limits remain separate |

No client-supplied tenant, workspace, portfolio or account ID is evidence of authorization.

## 6. Explicitly deferred to later waves

These scopes remain open and are deliberately not bundled into Wave 3:

- PT-08 policy limits and position budgets (#366): ownership, budget semantics, alert lifecycle and role presentation need the PT-05/PT-10/PT-13 contracts.
- PT-10 rules-based monitoring and notification delivery (#338): alert scope and routing require tenant ownership, stable market freshness and risk/scenario outputs.
- PT-11 grounded AI (#339) and PT-12 proactive AI (#340): wait for deterministic portfolio data, scenarios and alert events.
- PT-13 role-based investor/trader/manager/guest experiences (#341): wait for PT-05 plus performance, risk, scenario and alerts.
- PT-14 platform administration (#342): separate platform-vs-tenant administrative boundary.
- PT-15 reporting/exports/benchmarks (#343): consumes PT-05, PT-06, PT-08 and PT-09; benchmark/report presentation should follow integrated financial series.
- PT-16 security/privacy (#344) and PT-17 reliability/observability (#345) remain continuous release gates. Wave 3 must not enable new telemetry or tenant key behavior without their review.
- PT-18 onboarding/education (#346): update after the new role, performance and projection workflows stabilize.

## 7. Non-negotiable safety rules

- Preserve PortfolioState.positions as the canonical active-position representation unless a separate, versioned ledger migration is approved.
- Preserve existing persisted data and legacy account migration behavior.
- Do not silently change commission, fee, margin-interest, rollover, currency, rounding or return methodology.
- Never treat missing, stale, delayed, indicative, unknown or incomplete data as zero or as a current observation.
- Never combine currencies without a validated historical FX pair/direction/source/timestamp/quality contract.
- Keep deterministic finance calculations independent of UI, network, browser storage and AI.
- Never let broker aggregate quantities silently rewrite app-owned lots or cost basis.
- No autonomous order submission or financial mutation; scenario and reconciliation outputs are read-only until a validated, explicit, auditable user command is confirmed.
- No client-only authorization. Worker/DO authorization is authoritative.
- No sensitive portfolio values, user identifiers, credentials or raw provider payloads in logs or telemetry.

## 8. Engineering and release requirements

Every implementation PR must:

- Target dev for client/domain changes and update only its assigned branch.
- Add Vitest unit/regression tests and independent known-answer financial fixtures.
- Preserve English/Russian localization and translation-parity tests for every user-visible string.
- Cover responsive and keyboard-accessible UI states where UI is added.
- Record exact tested commit SHA and links to Pull Request CI, Operations Browser Journey and Trade Lifecycle Browser Smoke.
- Distinguish deterministic mock/test evidence from authenticated live TradeNet/provider QA.
- Keep the exact PR head as the tested candidate; do not mark a check complete based on an earlier SHA.
- Include manual QA and rollback notes in the PR description.

**Worker/Cloudflare/server-only changes follow the repository deployment rule:** commit/push those server-only slices directly to main. Mixed streams must split the server deployment slice from the dev client/domain PR and document the paired SHAs and deployment ordering. A server-only change must be additive/backward-compatible where possible and cannot activate a new client-dependent endpoint before the paired client is ready.

## 9. Definition of done

Wave 3 is complete only when:

- Broker vs app discrepancies across executions, cashflows, fees and price/freshness are reproducible and reviewable.
- The tenant/portfolio boundary is server-enforced, keys have an approved lifecycle, and the current admin/guest workspace migrates and rolls back without data leakage or loss.
- Actual portfolio events and valuation history feed performance outputs that reconcile to source records with explicit quality states.
- Market-data identity and provider lifecycle are traceable across supported instruments, histories, exchanges and events.
- Scenario projections are reproducible, clearly assumption-labelled and cannot mutate live portfolio state.
- All exact-head CI and required manual release gates are recorded; no feature is described as live-verified based on mocks.

Until each stream reaches its own acceptance criteria, Wave 3 remains in progress even if the umbrella PR is merged.
