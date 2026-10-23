# Portfolio Terminal — Risk-Control Implementation Roadmap

**Status:** Phase 0 baseline verification in progress  
**Baseline branch:** `main`  
**Baseline commit:** `0e867fce8ed11ddaeffd608d5a3c82963aa2fae0`  
**Tracking issue:** https://github.com/armave/portfolio-terminal/issues/102

## Objective

Improve portfolio risk visibility and margin-safety workflows across mobile and desktop while preserving the existing financial domain behavior, persisted formats, broker/provider integrations, and canonical portfolio state.

## Existing capabilities to preserve

- Margin positions, purchase tranches, cash holdings, debt, commissions, interest, breakeven, and stop-out estimates.
- Closed-trade history and hypothetical exit scenarios.
- Multiple market-data providers and quote provenance/freshness metadata.
- Local persistence, JSON backup/import, and encrypted GitHub Gist synchronization with revision checks.
- Preact/TypeScript/Vite application and existing PWA configuration.
- Canonical active positions in `PortfolioState.positions`; `holdings` remains a compatibility projection.

## Phase 0 — Verify baseline (P0, in progress)

- [ ] Run `npm ci` on the baseline commit.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run validate:dead-code`.
- [ ] Record results against the same commit.
- [ ] Review existing financial validation, risk/stop-out definitions, quote freshness, backup rollback, and cloud conflict handling.

**Gate:** All checks pass, or reproducible pre-existing failures are documented. No feature work should alter financial formulas during this phase.

## Phase 1 — Shared risk/data-quality snapshot (P0)

Create a read-only, deterministic risk-analysis contract consumed by both interfaces. Expose equity, exposure, cash, debt, financing estimates, configured risk thresholds, quote provenance, and input validity only where definitions and source data support them.

Acceptance:
- Same inputs produce the same output.
- Unknown or stale inputs never silently appear normal/current.
- Existing financial outputs match regression fixtures.
- Metric definitions and assumptions are documented.
- Risk estimates are clearly distinguished from verified broker account measurements.

## Phase 2 — Mobile risk dashboard (P0)

Build a compact mobile-first dashboard on the existing PWA foundation: portfolio summary, margin buffer/status, position cards, quote age, sync status, and safe quick actions. Keep the desktop terminal for dense analysis.

Acceptance:
- Core workflows work at 320, 375, and 430 px widths without horizontal scrolling.
- Mobile and desktop use the same domain calculations and store.
- Failed validation does not mutate state.
- Cached data is visibly dated and never represented as current.
- Supported mobile browsers are tested for install, reload, offline view, and update behavior.

## Phase 3 — Risk alerts (P0)

Add deterministic in-app alerts for configured risk thresholds, price levels, financing limits, and stale data. Use stable identifiers, acknowledgement, deduplication, and explicit re-arm behavior. Consider server-side scheduled evaluation and push delivery only after the alert engine is validated.

Acceptance:
- Threshold, recovery, deduplication, and failure behavior are tested.
- Alerts do not imply that a broker liquidation occurred or that an order was executed.
- Missing/stale inputs suppress unsupported conclusions and surface data-quality warnings.

## Phase 4 — Desktop stress tests and scenario workbench (P1)

Support user-defined price shocks, portfolio shocks, financing-rate changes, and holding horizons. Compare modeled equity, P&L, debt, carrying costs, and configured thresholds, using existing financial functions wherever applicable.

Acceptance:
- Scenario runs never mutate active portfolio state.
- Results are deterministic and assumptions are visible.
- Equivalent exit scenarios match existing terminal calculations.
- Invalid inputs and incomplete data are explicitly handled.

## Phase 5 — Transaction audit and reconciliation (P1)

Extend auditability and add preview-first CSV reconciliation for one documented broker statement format. Validate and deduplicate records before applying an atomic batch.

Acceptance:
- Preview does not mutate the portfolio.
- Failed imports leave state unchanged.
- Imported records can be reconciled to source statements.
- Corrections and imports remain auditable and recoverable.

## Phase 6 — Advanced desktop analytics (P2)

Consider concentration/exposure analytics, trading journal, historical performance, saved workspaces, and additional import formats after core risk and reliability milestones.

Acceptance:
- Data provenance and metric definitions are documented.
- Missing classifications/history are not fabricated.
- Optional integrations can fail without disabling core calculations.

## Architecture and safety constraints

1. Keep the existing Preact, TypeScript, and Vite stack.
2. Keep financial calculations pure and deterministic in the domain layer.
3. Route all portfolio mutations through validated store operations.
4. Do not duplicate financial formulas in UI components.
5. Keep AI-proposed mutations behind explicit confirmation and deterministic validation.
6. Preserve commission allocation, rounding, rollover semantics, and persisted-data compatibility.
7. Preserve quote race protection, failed-provider fallback behavior, and cloud revision checks.
8. Keep the active runtime rollover path and legacy import rollover path separate until a dedicated decision and regression coverage authorize any behavior change.
9. Do not deploy or merge feature work until the relevant release gates pass.

## Validation commands

```sh
npm run typecheck
npm test
npm run build
npm run validate:dead-code
```

Run all checks against the same final commit for each release. Add domain, integration, and end-to-end coverage for the feature being changed.
