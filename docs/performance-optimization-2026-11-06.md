# Performance optimization PR — 2026-11-06

## Scope
- [x] Coordinate administrator quote, supplemental broker/history, and cloud-state refresh so one state snapshot sync occurs after both branches finish.
- [x] Replace Market Insights' broad portfolio subscription with an identity-only ticker selector and equality function.
- [x] Add focused regression coverage for sync ordering/count and ticker-selector equality/fallback behavior.
- [x] Add authenticated synthetic-portfolio benchmark fixture: application bootstrap + Quick Buy local-only paper-trade seed, three cold desktop and three cold mobile samples; mocked Worker/broker responses are clearly labeled.
- [ ] Exact-head CI validation.

## Guardrails
- No financial formulas, persisted schemas, broker APIs, role boundaries, or Worker code changed.
- No English/Russian user-facing copy changed.
- Guest refresh flow unchanged.
- The existing unauthenticated shell benchmark remains clearly identified as unauthenticated.
