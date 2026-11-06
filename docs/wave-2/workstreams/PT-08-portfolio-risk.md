# Wave 2 workstream PT-08 — Deterministic portfolio risk engine

**Umbrella:** Wave 2 — Portfolio Intelligence Foundations  
**Tracking issue:** [#336](https://github.com/armave/portfolio-terminal/issues/336)  
**Implementation PR:** [#361](https://github.com/armave/portfolio-terminal/pull/361)  
**Dedicated branch:** `feat/wave2-pt-08-portfolio-risk`  
**Base:** current `dev`

## Delivered pure calculation foundation

- Typed read-only position, cash/debt, quote-quality, broker-assumption and historical-price snapshots.
- Long/short gross and net exposure, equity, leverage, cash coverage and margin utilization; currency buckets remain separate and consolidated results fail closed without one common currency.
- Position, sector, asset-type, broker and account concentration by currency.
- Broker-assumption-driven maintenance/stop-out buffers and estimated daily/annual borrowing costs, with an explicit non-guarantee disclaimer.
- Annualized sample volatility, maximum drawdown, historical 5th-percentile one-day downside loss and timestamp-aligned Pearson correlation; minimum 20 valid return observations.
- Deterministic ticker shock scenarios with explainable drivers and no portfolio mutation.
- Stale/unknown timestamps remain provisional; incomplete or unpriced positions and invalid monetary inputs make the risk snapshot unavailable.

## Deliberate boundaries and follow-ups

- `PortfolioState.positions` remains the canonical active-position store. This engine accepts an immutable normalized snapshot; it does not replace persisted state or read storage/network/UI.
- No cross-currency arithmetic or implicit FX conversion.
- Broker margin values are estimates from supplied `BrokerAssumptions`, not broker liquidation or maintenance guarantees.
- No dashboard or alert persistence is introduced. PT-10 owns alert evaluation/storage and PT-13 owns role-aware dashboard surfaces.
- User-configured limits and per-position risk budgets remain deferred until policy semantics and owner permissions are specified; track them as follow-up work rather than guessing thresholds.
- Production/live broker validation is not claimed from mocked CI.

## Acceptance and validation

Vitest covers known-answer exposure/leverage/margin, concentration, long/short behavior, multi-currency rejection, stale/missing/incomplete data, historical volatility/drawdown/downside, correlation alignment, deterministic stress shocks and zero mutation. Run full typecheck, Vitest, dead-code validation, dependency audits and production build on the exact PR head before merging.
