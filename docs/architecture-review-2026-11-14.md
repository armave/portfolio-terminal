# Architecture review and focused refactor — 2026-11-14

**Repository:** `armave/portfolio-terminal`  
**Reviewed branch:** `dev`  
**Reviewed head:** `58f052cf9c7780d5a08cc9f5b04293322f47cb38`  
**Review method:** static source and documentation audit through the repository tree, architecture/workstream documents, service boundaries and CI definitions. This is not a production network trace or authenticated broker QA.

## Executive decision

Keep the application as a **modular monolith**. Preact, TypeScript and Vite remain a reasonable fit. The repository already has useful domain, store, provider, transport, feature and UI boundaries; a framework rewrite or microservice split would add migration risk without solving the most important unfinished data contracts.

## Crucial architecture findings

### P0 — financial tenant isolation is not implemented

The live ownership model remains one shared administrator workspace plus server-filtered, read-only guest projections. The tenant directory is metadata-only and reports `financialDataEnabled: false`. Tenant IDs are resource selectors, not authorization credentials. There is no tenant-owned financial Durable Object, per-tenant key hierarchy or completed legacy migration/rollback path.

**Decision:** do not describe the current app as independently isolated investor portfolios, enable tenant financial writes, or route positions/history/backups/streams through the metadata directory. PT-05 remains gated by PT-02 transaction/audit contracts, PT-16 key/security review, adversarial authorization tests and migration/rollback evidence.

### P1 — the transaction journal remains additive

`PortfolioState.positions` is still the canonical active-position state. The journal covers selected mutation paths, but the documented PT-02 scope still includes broader mutation inventory, replay/parity, idempotency, cross-tab/server revision semantics and backup/restore coverage.

**Decision:** preserve canonical snapshot ownership. Do not make the journal a sole source of truth or enable unsupported trade/lot/corporate-action reversals until replay parity and recovery are accepted.

### P1 — broker reconciliation needs auditable matching evidence

The current merged foundation includes aggregate-quantity comparison. Execution matching, partial/reordered/duplicate fills, cashflows, fees, prices/freshness and timestamp differences need deterministic evidence. The PT-04 contract keeps comparison read-only by default.

**Decision:** finish evidence-based read-only matching first. Any correction must require explicit review and a PT-02 audit-linked command; never auto-rewrite app-owned lots or cost basis from broker aggregate data.

### P1 — market-data lifecycle still constrains wider analytics

Typed quote/history provenance exists, but alias effective dates, broader provider health, additional historical coverage, expanded exchange calendars and typed income/corporate-action events remain documented work. FX aggregation and benchmark comparison require validated comparable history.

**Decision:** preserve instrument identity and data provenance; keep unsupported FX/benchmark output unavailable rather than synthesizing missing inputs.

### P1 — automated QA is not live broker evidence

CI provides typecheck, Vitest, production builds, dependency audits and deterministic browser journeys. The performance samples use controlled fixtures; static request audits are not production measurements. They do not verify authenticated TradeNet or live Market Depth behavior.

**Decision:** retain manual authenticated broker/provider QA and gather comparable performance observations before defining production SLOs.

## Implemented in this PR — transport boundary and deadline

The API facade contained direct `fetch` paths for Margin Intelligence digest reads/writes and Settings encryption-migration inventory/batches. Those paths bypassed the shared request-timeout helper. Server-owned shared cloud-key retrieval was also unbounded.

This PR:
- extracts the digest and migration request contract into `src/services/marginDigestTransportRuntime.ts`;
- retains the existing `api.ts` export names/signatures for all current callers;
- applies the existing 15-second request deadline while reading response bodies;
- applies the same deadline to shared cloud-key retrieval, preserving its cache-reset/retry behavior;
- adds focused Vitest tests for encrypted and legacy digest paths, optimistic revisions, migration validation, timeout cancellation and cloud-key retry.

No Worker/Durable Object code, endpoint, authorization header, payload shape, encryption format, revision rule, persisted portfolio schema, financial calculation or visible UI copy changes. The English/Russian localization surface is unchanged.

## Recommended next architecture sequence

1. Close PT-02 mutation inventory, replay/parity, idempotency, revision-conflict and backup/restore contracts.
2. Complete PT-04 read-only execution/cashflow/fee reconciliation; put writeback behind explicit PT-02 audited commands.
3. Complete PT-07 identity, provider health, history/calendar and corporate/income-event provenance.
4. Finish PT-06 integration only with complete sourced valuation, flow and currency inputs.
5. Return to PT-05 tenant authorization, isolated storage, per-tenant keys and migration/rollback only after PT-02/PT-16 gates.
6. Complete PT-17 comparable baseline and authenticated manual release evidence.

## Boundaries to retain

- `app.ts` stays the browser runtime composition root.
- `PortfolioStore` remains the only portfolio state owner.
- Financial calculations remain deterministic and isolated in `src/domain/`.
- Provider/network/browser-storage concerns remain in `src/services/`.
- Encrypted workspace state and cloud history remain separately revisioned records.
- Worker/DO-only changes remain a separate direct-to-`main` deployment lane.

## PR verification checklist

- [x] Preserve public Margin Intelligence API exports and behavior.
- [x] Keep encrypted writes, legacy-read compatibility and optimistic revision migration.
- [x] Bound digest reads, writes, inventory reads and migration batches.
- [x] Bound shared cloud-key retrieval and retain retry after failure.
- [x] Add focused Vitest coverage for the new service boundary and timeout lifecycle.
- [ ] Exact-head typecheck, full Vitest, production build, browser workflows, dead-code and dependency audits.
- [ ] Authenticated live broker/provider verification remains a separate manual gate.
