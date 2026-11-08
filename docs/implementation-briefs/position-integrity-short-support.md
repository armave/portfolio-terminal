# Implementation brief — Position integrity & short lifecycle

**Parent contract:** `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
**Branch:** `impl/position-integrity-short-support`  
**Target:** plan branch  
**Status:** implementation scaffold

## Mission

Make every broker-reported position either correctly represented and valued or visibly unsupported. No short position, invalid quantity, or unknown instrument state may silently disappear.

## Required investigation

1. Trace the complete position lifecycle from Freedom/TradeNet payloads through adapter, normalization, domain types, store, selectors, valuation, P&L, persistence, backup/restore, exports and UI.
2. Identify each broker field's documented and observed meaning. Obtain anonymized fixtures from authenticated account responses for long, short, partial close, cover, fractional and zero-quantity cases. Record observed sign conventions and source/version.
3. Identify all filters that drop non-positive quantities, unsupported sides or unknown instrument types. For each, decide whether it is valid filtering or silent data loss.
4. Document current assumptions before changing them. Do not infer `SELL_SHORT` or `BUY_TO_COVER` semantics from an enum name alone.

## Implementation requirements

- Define one canonical position direction (`long` or `short`) and quantity contract. Prefer explicit direction plus a non-negative absolute quantity; derive signed quantity at calculation boundaries only if that best fits the existing domain model. Explain the selected invariant and convert only at broker boundaries.
- Preserve raw broker side, raw quantity, broker instrument/security identifier and source metadata for audit/reconciliation.
- Keep order side, execution side and current position direction distinct. Map open long, add long, reduce/close long, open short, add short, cover/reduce short and full close without collapsing them into generic buy/sell.
- Calculate long asset value and short liability/exposure correctly. Do not treat short-sale proceeds as equivalent to free cash. Preserve average cost, realized P&L and unrealized P&L directionally.
- Make unsupported/malformed position data explicit in portfolio state and UI. A failed normalization must not quietly become an empty holding or zero exposure.
- Preserve semantics through persistence, cloud sync, backup/restore, selectors, portfolio grouping and exports.
- Avoid edits to the margin-risk calculation/UI owned by the margin workstream. Publish a narrow typed position-exposure adapter that PR #2 can consume.

## Likely areas to inspect

- Freedom/TradeNet position adapters and `src/domain/freedomPortfolio.ts`.
- Portfolio and position types, valuation helpers, selectors and store normalization.
- Broker fixtures/tests and portfolio summary rendering.
- Backup/restore and sync serialization.

Discover exact owners before editing; this list is an investigation map, not permission to duplicate another workstream's files.

## Required tests

- Opening/add/reduce/close long and short.
- Short cover; partial fill; multiple lots; fractional share.
- Broker negative quantity vs separate side field vs `SELL_SHORT`/cover action.
- Zero, malformed, missing or unsupported quantity/side/instrument.
- Missing/stale price and currency mismatch.
- Restart/reload, cloud sync, backup/restore and export preserve direction.
- Hand-calculated market value, cash, liability, average cost and realized/unrealized P&L.
- Existing long-only behavior remains stable.

## Acceptance checklist

- [ ] Anonymized real broker fixtures and field semantics documented.
- [ ] No unsupported position silently disappears.
- [ ] Canonical direction/quantity invariant documented and enforced.
- [ ] Short lifecycle correctly valued or explicitly marked unsupported pending broker evidence.
- [ ] Persistence, sync, restore, selectors and exports preserve position direction.
- [ ] Vitest regression and golden calculations pass.
- [ ] Typecheck, lint, build, browser smoke and i18n checks pass.
- [ ] PR description lists any broker assumptions that still require manual verification.

## Explicit non-goals

Do not implement broker maintenance margin/collateral policy (PR #2), execution deduplication/revision matching (PR #3), corporate actions (PR #5), or Worker authorization (PR #4). Coordinate any necessary interface change through the shared plan.