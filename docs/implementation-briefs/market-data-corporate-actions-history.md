# Implementation brief — Market data, corporate actions & history reliability

Parent contract: `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
Branch: `impl/market-data-corporate-actions` · Target: `plan/portfolio-integrity-reliability-2026-11-08` · Status: implementation scaffold

## Mission
Make current risk and historical performance explainable when quotes are delayed/stale, FX is missing or revised, and instruments undergo corporate actions.

## Investigation
Inventory quote providers, quote/stream runtime, instrument mapping, quote timestamps, delay/session metadata, caching and provider failover. Trace FX sources, pair direction, cache lifetime, conversion timestamp, missing-rate fallback and displayed P&L currency. Identify whether corporate actions are explicit events or implicit patches. Trace historical valuation snapshots, performance reconstruction, backup/restore and multi-device conflict behavior.

## Requirements
- Define one market-data envelope: provider/source, instrument/security ID, currency, exchange, price type, quote/last-trade timestamp, received-at timestamp, session state, delay/freshness status and validity flags.
- Apply explicit stale thresholds and market-session semantics. Show delayed/stale/closed status and prevent stale data from masquerading as a live quote or silently driving a current risk alert.
- Define FX pair orientation, timestamp and provenance. Missing/stale FX must be visible; never use undocumented zero or silent stale fallback.
- Add auditable corporate-action events for supported splits/reverse splits, cash dividends/distributions, symbol changes, mergers and spin-offs. Represent events idempotently with source IDs/effective dates.
- Preserve quantity, cost basis, realized/unrealized P&L and cash distributions correctly. Corporate actions must not create unexplained investment profit/loss.
- Make history corrections and replay deterministic. Preserve original and corrected source evidence.
- Add data-health state to historical reports, risk context and portfolio summary where appropriate; keep user-visible copy localized.
- Exercise backup/restore and multi-device data ordering/conflicts for quote, FX and corporate-action history.

## Required tests
Fresh/delayed/stale quote; market closed; provider outage/failover; late/out-of-order quote; missing/stale FX; inverse pair; conversion rounding; forward/reverse split; cash dividend; symbol change; merger/spin-off mapping; unknown action; duplicate/replayed action; correction; historical report with gaps/backfilled prices; backup/restore and out-of-order device updates. Use hand-calculated invariants.

## Acceptance
- [ ] Quote and FX provenance/freshness retained end-to-end.
- [ ] Stale/delayed values are never presented as live.
- [ ] Missing FX or history gaps are visible and safe.
- [ ] Corporate actions are explicit, auditable and idempotent.
- [ ] Cost basis and cash distributions reconcile to golden fixtures.
- [ ] Historical performance discloses gaps and replays deterministically.
- [ ] Backup/restore and multi-device tests pass.
- [ ] Vitest, typecheck, lint, build, browser smoke and i18n checks pass.

## File boundaries
Own quote/provider runtime and metadata, FX helpers, corporate-action/history domain and tests. Do not edit broker execution matching (PR #3), short-position classification (PR #1), margin calculations (PR #2), or tenant authorization (PR #4).