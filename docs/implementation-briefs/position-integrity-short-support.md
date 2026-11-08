# Implementation brief — Position integrity & short lifecycle

**Parent contract:** `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
**Branch:** `impl/position-integrity-short-support`  
**Target:** plan branch  
**Status:** fail-closed long-only integrity guard ready for integration; full short support deferred pending broker semantics

## Mission

Make every broker-reported position either correctly represented and valued or visibly unsupported. No short position, invalid quantity, or unknown instrument state may silently disappear.

## Delivered scope — fail-closed guard, not short accounting

The implementation now provides a conservative integrity boundary for the existing long-only ledger:

- Negative quantities, explicit/unrecognized position sides, malformed rows and executions without usable identifiers are retained as reviewable integrity findings. They are not normalized into ordinary long holdings.
- TradeNet numeric fields are decoded only according to their documented field contracts: order field `oper` uses 1=Buy, 2=Buy on Margin, 3=Sell, 4=Sell Short; trade-history field `type` uses 1=Buy and 2=Sell. Numeric values in undocumented `operation` or generic `side` aliases remain unknown.
- Any recognized short-sale or buy-to-cover history for a supplied execution history remains an integrity finding, including a fully covered short lifecycle and activity for a ticker no longer open. This prevents a long-only ledger from silently discarding realized short accounting.
- A snapshot with integrity findings does not replace the last accepted app balance or broker cash balances. Margin-risk valuation is marked incomplete; performance capture and guest portfolio publication are blocked; admins see a localized review warning.
- Position evidence is preserved through the existing local state and backup import/restore paths. No short liability, proceeds, average cost, realized P&L or unrealized P&L is calculated.

This is a completed safety guard for the current long-only accounting model. It does **not** implement short positions or establish TradeNet's position-side/sign semantics. A follow-up short-accounting workstream must wait for authoritative broker semantics and must not infer `t` or `k`.



## Required investigation

1. Trace the complete position lifecycle from Freedom/TradeNet payloads through adapter, normalization, domain types, store, selectors, valuation, P&L, persistence, backup/restore, exports and UI.
2. Identify each broker field's documented and observed meaning. Obtain anonymized fixtures from authenticated account responses for long, short, partial close, cover, fractional and zero-quantity cases. Record observed sign conventions and source/version.
3. Identify all filters that drop non-positive quantities, unsupported sides or unknown instrument types. For each, decide whether it is valid filtering or silent data loss.
4. Document current assumptions before changing them. Do not infer `SELL_SHORT` or `BUY_TO_COVER` semantics from an enum name alone.

## Authenticated TradeNet position fixture — 2026-11-08

An administrator supplied one fresh REST `getPositionJson` snapshot from the real account. The shared copy contained one open USD equity row. For privacy, account-specific ticker, position quantity, prices, balances, identifiers and issuer details are not reproduced in this public repository.

Observed schema facts:

- The row supplied a positive numeric `q` and no `side`, `direction`, `position_side` or equivalent explicit direction field.
- It included `t` and `k` numeric values, plus `fv`, `go`, `scheme_calc`, `bal_price_a`, `open_bal`, `mkt_price`, `market_value`, `profit_close`, `profit_price`, `acc_pos_id` and `instr_id`.
- The account owner confirmed they have never opened a short position; therefore this specific observed row is a long position with positive quantity.
- In this sample, quantity multiplied by `bal_price_a` matched `open_bal` to the reported precision. This is an observed arithmetic relationship, not a universal contract guarantee.
- The published [TradeNet portfolio schema](https://github.com/tradernet/tn.api) defines `q` as quantity, `t` as security type and `k` as security kind; it does not define either field as a long/short direction. The [getTradesHistory reference](https://tradernet.com/tradernet-api/get-trades-history?site_lang=en) separately defines trade-history `type` as 1=Buy and 2=Sell. The portfolio row's `acc_pos_id` identifies an open position. The sample's `bal_price_a`/`open_bal` arithmetic is recorded only as an observation.
- Consequently, this fixture validates retention of the raw `t`/`k` values and the existing positive-quantity long-only compatibility path. It does **not** establish short-side encoding, signed-quantity behavior for shorts, or the long/short meaning of the position row. No numeric code is mapped.

An anonymized synthetic adapter regression test mirrors the field shape and checks that `t` and `k` survive in `raw` without being interpreted as direction. The user's actual account values remain outside the repository.

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

- [x] Unsupported/malformed broker position rows and unknown direction evidence remain visible rather than silently applied.
- [x] TradeNet's documented numeric `oper` and trade-history `type` fields are handled separately; undocumented numeric aliases are not guessed.
- [x] Short-sale and cover history, including completed short lifecycles, remains explicitly unsupported in the long-only ledger.
- [x] Unresolved position/execution data retains previous tracked and broker-balance values; margin-risk valuation, performance capture and guest publication are gated.
- [x] Raw position evidence and integrity findings survive local state normalization and backup import/restore.
- [x] Vitest regression coverage, English/Russian warning localization and adapter-fixture coverage are included.
- [x] Exact-head CI and browser journey pass for the final PR head.
- [ ] Broker-confirmed current-position short-side/sign semantics; no test short trade is required.
- [ ] Canonical direction-aware position contract and short liability/proceeds/average-cost/realized/unrealized P&L calculations.
- [ ] Final cloud-sync and export validation for a canonical long/short direction contract.
- [ ] Manual authenticated verification of short behavior against authoritative provider documentation/support.

## Explicit non-goals

Do not implement broker maintenance margin/collateral policy (PR #2), execution deduplication/revision matching (PR #3), corporate actions (PR #5), or Worker authorization (PR #4). Coordinate any necessary interface change through the shared plan.
