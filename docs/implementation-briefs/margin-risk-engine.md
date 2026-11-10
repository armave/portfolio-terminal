# Implementation brief — Margin risk engine

**Parent contract:** `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
**Branch:** `impl/margin-risk-engine`  
**Target:** plan branch  
**Status:** partially implemented; calculation kernel and risk consumers exist, with source-provenance detail surfaced by the Stage 1 financial-integrity PR

## Mission

Make every margin-risk surface use the same transparent, timestamped inputs. The app must distinguish account equity from eligible collateral, buying power, margin debit and broker maintenance requirements.

## Required investigation

- Inventory every margin/equity calculation and consumer: summary cards, margin gauge, account overview, alerts, stress tools, portfolio risk, and AI context/prompts.
- Trace the origin and meaning of each field from Freedom/TradeNet and from user settings. Distinguish broker-reported data, local assumptions and estimates.
- Verify whether the broker exposes instrument-level initial/maintenance requirements, concentration add-ons, long/short rates, collateral eligibility or borrow data. Do not map undocumented fields such as margin/dpd/dps without validating the API contract.
- Identify fallback values that turn missing margin inputs into zero or an optimistic risk status.

## Implementation requirements

- Create a typed canonical risk input containing at minimum: gross long exposure, gross short exposure, cash by currency, signed account cash/balance, margin debit, total equity, eligible collateral, initial requirement, maintenance requirement, concentration add-ons, financing rate, borrow/availability cost where available, quote/FX timestamps and completeness/provenance.
- Keep market value, liability/exposure, sale proceeds, cash, debit and collateral separate. Do not double-subtract margin debt or assume all cash is eligible collateral.
- Separate annual financing interest from initial/maintenance margin requirements. User defaults are estimates, never broker facts.
- Use one pure calculation boundary for every consumer; remove duplicated formula paths. Return a typed status (complete, estimated, stale, incomplete/unavailable) and reason/provenance.
- Consume the position-exposure interface defined by PR #1 through a narrow adapter. Keep the PR independently buildable using contract fixtures; do not edit the position normalizer owned by PR #1.
- Add stress scenarios for adverse instrument and FX moves. Explain calculation assumptions and liquidation-buffer semantics; do not present a broker liquidation guarantee.
- Unknown requirements, stale prices, missing FX and conflicting inputs must never default to zero/healthy.

## Likely areas to inspect

- `src/domain/marginRisk.ts`, portfolio risk modules and their tests.
- `src/components/SummaryMetricsGrid.tsx`, margin gauge and other risk consumers.
- Broker assumptions/settings and AI risk context.
- Shared portfolio valuation only where an adapter is required; avoid changing position normalization.

## Stage 1 implementation note — 2026-11-11

- The pure `calculateMarginRiskSnapshot` kernel remains the calculation authority for the dashboard and Margin Intelligence context.
- The returned snapshot now preserves source observation time and quote/account freshness so downstream views do not have to reconstruct or guess provenance.
- Margin Risk Overview now exposes long/short exposure, cash, margin debit, eligible collateral with its source, initial/maintenance requirements and concentration add-on with provenance, total maintenance requirement, estimated financing costs, input freshness and source observation time.
- Missing broker requirements remain explicitly “Not reported”; cash-based eligible collateral continues to be labeled as a configured assumption.
- The current Freedom/TradeNet client snapshot still does not provide a verified eligible-collateral or margin-requirement field. This PR does not invent one or claim broker-confirmed maintenance/buying power.
- Remaining integration work: add a verified broker margin-requirement adapter only after its endpoint contract and field semantics are documented; centralize the assembly of account-risk inputs across consumers; complete authenticated live broker QA and cross-account/multi-currency wiring.

## Required tests

Golden cases: cash positive/negative, margin debit, long and short exposures, eligible/ineligible cash, collateral haircut, concentration, different maintenance/initial rates, multiple currencies, stale/missing quote, FX shock, missing broker requirement and no positions.

Property tests: debt is deducted once; unknown is not zero; increased adverse exposure does not improve risk buffer; identical input yields identical outputs. Verify summary/gauge/alerts all show the same numeric result and provenance.

## Acceptance checklist

- [ ] One canonical risk input and calculation boundary.
- [ ] Equity vs collateral vs buying power vs debit clearly separated.
- [ ] Broker-reported requirements distinguished from assumptions.
- [ ] Financing interest not used as maintenance margin.
- [ ] Long/short and FX stress tests with hand-calculated expectations.
- [ ] Stale/incomplete values visibly lower confidence or make output unavailable.
- [ ] All UI and AI consumers use the same model.
- [ ] Vitest, typecheck, lint, build, browser smoke and i18n checks pass.

## Explicit non-goals

Do not normalize broker positions (PR #1), deduplicate transaction revisions (PR #3), implement tenant authorization (PR #4), or build corporate-action ingestion (PR #5).