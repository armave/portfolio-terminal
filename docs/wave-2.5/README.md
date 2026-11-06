# Wave 2.5 — Portfolio methodology and data transparency

**Tracking issue:** [#363](https://github.com/armave/portfolio-terminal/issues/363)  
**Implementation PR:** Wave 2.5 metric transparency (targets `dev`)  
**Scope:** A read-only investor-education panel that can ship independently while PT-02/PT-04/PT-06/PT-07/PT-08 are implemented in parallel.

## Objective

Explain the financial figures the application already displays: what they mean, which current code paths and assumptions produce them, how quote/broker data quality affects interpretation, and which important capabilities are not yet supported.

This is a product transparency layer, not a new financial engine.

## User-facing contents

1. Portfolio value and equity — positive cash, negative signed balance/margin debt, holdings market value, and missing-price behavior.
2. Current/provisional/incomplete reliability — explain the exact precedence and why a recent receipt timestamp does not prove a fresh observation.
3. Unrealized P&L vs target projections — keep gross current P&L distinct from projected target outcomes and net realized results.
4. Trading commissions — explain the configured per-share + value-rate + minimum model and per-order rounding caveats.
5. Margin financing and risk — explain configured assumptions, daily compounding, 04:00 Asia/Yerevan rollover default, and why the risk gauges are not live broker indicators.
6. Broker/quote provenance — distinguish provider facts from app-owned accounting and source observation time from receipt time.
7. Current limitations — disclose that cross-currency valuation has no FX contract yet and full TWR/MWR is part of Wave 2 PT-06.

## Engineering boundaries

- No portfolio state, transaction, financial formula, broker adapter, reconciliation, market provider, FX, performance, or risk calculation changes.
- The component is read-only and mounted in Settings for admin and guest users.
- Definitions are sourced from PT-01's `docs/financial-calculation-contracts.md`, `src/domain/portfolioValuation.ts`, `src/domain/portfolio.ts`, and current quote provenance behavior.
- English and Russian translations are required.
- Tests cover content structure, Settings integration, key wording, and localization.
