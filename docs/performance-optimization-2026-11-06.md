# Performance optimization PR — 2026-11-06

## Scope
- [x] Coordinate administrator quote, supplemental broker/history, and cloud-state refresh so one state snapshot sync occurs after both branches finish.
- [x] Replace Market Insights' broad portfolio subscription with an identity-only ticker selector and equality function.
- [x] Add focused regression coverage for sync ordering/count and ticker-selector equality/fallback behavior.
- [ ] Authenticated synthetic-portfolio benchmark. Deferred: a supported auth/seed fixture is not established; no authenticated dashboard performance claim is made.
- [ ] Exact-head CI validation.

## Guardrails
- No financial formulas, persisted schemas, broker APIs, role boundaries, or Worker code changed.
- No English/Russian user-facing copy changed.
- Guest refresh flow unchanged.
- The existing unauthenticated shell benchmark remains clearly identified as unauthenticated.
