# Wave 3 PT-07 — Complete instrument and market-data lifecycle

**Tracking issue:** #365 (follow-up to #335)  
**Merged client foundation:** PR #360  
**Dedicated branch:** feat/wave3-pt07-market-data-lifecycle  
**Target:** dev for client/domain; Worker-only changes deploy directly to main.

## Objective

Make instrument identity and provider data trustworthy across ticker changes, historical observations, multiple exchanges and relevant corporate/earnings/dividend events.

## Scope

- Maintain an auditable alias registry with effective dates for ticker rename, exchange migration, provider mapping and corporate-action identity. Historical records retain their original instrument identity and effective mapping.
- Extend provider health/resilience to Freedom one-shot WebSocket quotes and remaining research endpoints: bounded TTL, coalescing, timeout/cancellation, retry/backoff, last-known-good fallback and explicit provider-health state.
- Complete typed provider registration and add at least one additional historical-price adapter beside Freedom daily history.
- Expand exchange calendars/session handling beyond US equities with exchange-local timezone, holidays, early closes and interval-aware freshness.
- Ingest typed earnings and dividend events with source, published/observed timestamps, event date, currency/amount and quality metadata.
- Add provider health/source/freshness details where users need to interpret current prices, chart history and upcoming events.
- Perform authenticated live broker/provider QA in an authorized environment. Record outcomes and timestamps without credentials/session tokens.

## Boundaries

- The existing PT-07 instrument, quote/history and FX contracts are the base; extend additively.
- Do not silently rewrite historical tickers, positions or transaction events after an alias/corporate action.
- Do not enable portfolio FX aggregation without validated historical rates and a complete pair/direction/source/time/quality contract.
- Keep market provider data separate from app-owned accounting facts.
- Worker-only changes are separate direct-to-main deployment commits; client integration stays in the dev PR.

## Acceptance criteria

- Historical instrument identity can be resolved for an effective date without rewriting source transactions.
- Provider outages preserve last-known-good values within a documented bound and expose stale/unknown health.
- All history points/events expose instrument, exchange, currency, source, observation/receipt timestamps and quality or explicit unknown states.
- Exchange session calculations use the correct exchange timezone, holidays and early closes.
- Earnings/dividend events are typed and distinguish scheduled, reported, estimated and unknown dates/amounts.
- No provider failure or malformed response can overwrite newer accepted values.

## Required tests and QA

Alias effective-date/ticker-change fixtures; corporate-action continuity; provider timeout/cancellation/retry/coalescing/backoff/stale fallback; out-of-order responses; historical series validation; exchange timezone/holiday/early-close boundaries; interval freshness; event corrections/duplicates/currency/missing dates; i18n and browser freshness states. Authenticated live provider QA is a separate manual release gate.
