# Wave 3 PT-02 — Complete transaction integrity, journal parity and recovery

**Tracking issue:** #330  
**Merged foundation:** PR #357  
**Dedicated branch:** feat/wave3-pt02-transaction-integrity-completion  
**Target:** dev for client/domain; Worker/server-only work follows the direct-to-main deployment policy.

## Objective

Complete the additive transaction journal foundation so supported financial mutations are traceable, idempotent, recoverable and verifiably consistent with canonical portfolio state. Do not replace PortfolioState.positions as canonical in this stream.

## Scope

- Finish the mutation-path inventory and identify all paths that change quantities, cash, debt, fees, realized P&L or history.
- Add event coverage for external contributions/withdrawals/transfers, dividends, fees/commissions, margin-interest adjustments, corporate actions and imported broker executions where the source contract supports them.
- Define stable event identity, correction/reversal semantics, source/actor, effective/recorded timestamps and canonical request fingerprints.
- Add replay/parity checks that compare journal-supported events with canonical positions, cash, debt and closed history without silently replacing canonical state.
- Extend idempotency beyond local snapshot retries to the relevant cross-tab/cloud revision boundaries; explicitly state limits where distributed exactly-once cannot be guaranteed.
- Validate cloud restoration, backup export/import, reset and legacy migration with journal integrity.
- Document the exact supported mutation set and remaining unsupported cases.

## Boundaries

- This stream owns transaction event semantics, mutation ownership and journal parity. PT-04 and PT-06 consume the contract.
- Keep PortfolioState.positions canonical. Any future ledger source-of-truth cutover is a separate gated product decision with versioned migration/rollback.
- Do not alter accounting formulas, FIFO cost basis, commissions, margin-interest allocation, rollover timezone or rounding without a separately approved calculation contract.
- A transaction event must not claim broker confirmation unless the event source supports it.
- Do not imply global exactly-once semantics where the current persistence/cloud protocol cannot prove them.

## Acceptance criteria

- All supported financial mutation paths are inventoried and have documented event/actor/source semantics.
- Mutation persistence is atomic: failed journal/state writes leave the prior committed state intact.
- Duplicate retries do not double-apply supported quantities, cashflows, fees or P&L; conflicting idempotency-key reuse is rejected.
- Replay/parity checks detect missing, duplicate, reordered and conflicting events against canonical state.
- Backup/import/cloud restore preserves journal compatibility and rejects conflicting or malformed event histories before commit.
- Unsupported mutation paths are explicit and cannot silently appear audited.

## Required tests and QA

Vitest lifecycle fixtures: buy/add/partial sell/full close; cash/debt settlement; deposits/withdrawals/transfers; dividends/fees/interest; rollover; cash-holding operations; corporate-action adjustment; imported broker executions; duplicates/conflicts; journal replay after reload; failed persistence rollback; cross-tab and cloud revision conflict; backup/export/import/reset round trips. Exact-head CI and manual review of mutation inventory are required.

## Client entry bundle guard

The production minified entry bundle is capped at **575,000 bytes**. The separate gzip ceiling remains **165,000 bytes** so the raw-size headroom does not relax the compressed-transfer constraint. The latest completed production build before the 575,000-byte limit update measured 358,436 bytes / 112,388 bytes gzip. The 575,000-byte raw limit is intentionally a hard ceiling, not a target; the 165,000-byte gzip ceiling remains the tighter transfer guard. Exact-head CI re-measures both values on every PR update.

## Mutation-path inventory — current audited coverage

The current client store audit distinguishes app-owned financial commands from broker facts, derived display changes and raw snapshot replacement:

| Mutation / data path | Current boundary | Journal and parity treatment |
|---|---|---|
| Manual and AI-confirmed buys, partial/full margin sales | `PortfolioStore.buyStock` / `sellMarginPosition`; same FIFO, commission and settlement path | Atomic `trade.buy` / `trade.sell` event in the same snapshot; command fingerprint and caller idempotency key where supplied |
| Manual cash/debt changes and rollover | `setCashBalance`, `setFreeCash`, `setMarginDebt`, `applyRollover` | Atomic cash, margin and interest events; rollover is timestamp-idempotent |
| Cash-cushion holding add/sell/remove | `addCashHolding`, `sellCashHolding`, `removeCashStock` | Explicitly priced app additions create stable acquisition lots; sales use exact FIFO allocations and realized P&L only when app lots cover the full holding. Unpriced/broker-only quantities remain unmapped; removal remains a tracking correction without proceeds |
| Tranche removal and closed-history cleanup | `removeTranche`, `deleteClosedTrade` | Explicit position/history correction evidence; cleanup does not reverse historical cash or realized P&L |
| Broker executions and cashflows | Imported broker history normalized by `appendBrokerHistoryAuditEvents` | Stable provider references and source/actor attribution; evidence only, not posted again to canonical cash, debt or positions |
| Imported cashflow categories | Dividend, deposit, withdrawal, transfer, fee/commission, margin interest and corporate-action/cash-in-lieu descriptions | Typed external-flow events retain signed source amount, currency and reference; no local cash delta, quantity, realized P&L or corporate-action basis adjustment is inferred |
| Generic import, broker refresh/reclassification or legacy direct state edits | Validated `importState` / `setState` normalization and canonical parity check | Append observed position, cash-holding, free-cash and debt deltas as `portfolio.reconciliation`; quantity-only cash changes remain incomplete in lot replay and never receive guessed buy/sell, proceeds, fees or cost basis |
| Quotes, target prices, active desk, pending confirmation, API keys and account credentials | Derived/display or configuration paths | Intentionally outside financial transaction journal |

The expanded regression fixtures assert broker cashflow classification for dividend, deposit, withdrawal, transfer, fee, margin interest and corporate action, and verify that those source facts do not double-post into canonical balances. Direct snapshot edits are checked for reconciliation deltas across positions, cash-holding quantities, free cash and margin debt.

**Explicit limits:** broker corporate-action rows remain external evidence only. This implementation does not apply split ratios, merger consideration, spin-off cost-basis allocations, tax treatment or cash-in-lieu settlement to canonical holdings. Closed-trade removal is a history correction, not a reversal of the underlying position or cash transaction. No generic financial reversal command is claimed until its lot, cash, debt, fee and realized-P&L effects are specified and independently tested. Imported cashflows with unsupported or ambiguous descriptions remain generic `cash.adjustment` evidence rather than guessed classifications.

## Cash-holding lot replay follow-on — 2026-11-11

App-recorded cash-holding purchases with an explicit positive entry price now receive stable lot IDs and acquisition dates. Supported cash-holding sales consume those lots in FIFO order, persist exact allocation slices and realized P&L, and retain remaining lots in the canonical holding snapshot. Broker aggregates, unpriced adds, partial lot coverage, direct import/reconciliation deltas and remove-from-tracking commands remain incomplete rather than inventing acquisition history. The portfolio snapshot remains canonical; this is a shadow replay and parity extension, not a ledger cutover.

## Proposed reversible migration sequence — design only, no cutover approval

The current snapshot remains authoritative. This plan describes the minimum gates for a future canonical-ledger decision; none of these stages automatically changes read ownership.

1. **Freeze the current snapshot contract.** Keep `PortfolioState.positions`, `cashCushion`, `balance` and `closedTrades` as the authoritative snapshot fields. Keep the existing event `schemaVersion` as the per-event format version. A future snapshot-envelope version must be introduced separately and must not be inferred from an event's version.
2. **Capture a recoverable baseline.** Before any migration, create and verify a backup that contains both the full canonical snapshot and the append-only `transactionEvents` array. Record the snapshot version, journal event version range, counts and canonical parity result. Preserve an untouched pre-migration backup.
3. **Complete write coverage before replay can own anything.** Each supported financial command must append its state delta and event in one persistence boundary, with stable actor/source, effective/recorded timestamps and idempotency semantics. Broker source facts remain evidence-only unless a separately approved reconciliation contract explicitly posts them. Unknown/unsupported corporate actions and unexplained direct edits block migration readiness; they must not be assigned guessed trade types.
4. **Run shadow replay and parity.** Rebuild quantities, cash and debt into a separate comparison object while the canonical snapshot remains live. Compare position quantities, cash-holding quantities, free cash and margin debt with documented tolerances. Investigate every discrepancy and verify backup export/import, encrypted cloud pull, reset markers and reload before proceeding. Shadow replay must not publish or persist replacement canonical state.
5. **Introduce a reversible, versioned read gate.** Only after complete event coverage and signed acceptance evidence may a separately reviewed release add a versioned read-mode flag. Default and rollback mode remain snapshot-authoritative. Any ledger-derived projection is read-only during the canary and must be compared against the snapshot on every supported financial mutation.
6. **Require an explicit cutover decision.** A later PR must include migration tooling, schema-version compatibility rules, legacy-client behavior, cross-device concurrency tests, restore rehearsal, performance evidence and owner approval. It must not be bundled into this integrity PR or silently activated by a successful deploy.

**Rollback rules:** switch the read gate back to snapshot-authoritative mode; keep the append-only journal and reconciliation evidence intact; restore the pre-migration snapshot only through the validated backup boundary; never truncate, rewrite or discard events to make replay match. If an event schema is unknown to the running client, reject/restrict the incompatible import or preserve the source backup rather than silently dropping unknown history. Re-run parity after rollback and retain both pre- and post-migration artifacts for diagnosis.

**Status:** proposed operating plan only. PT-02 remains in the additive phase, and this document does not authorize a canonical-ledger cutover.

## Downstream gates

- PT-04 may derive matching and discrepancy evidence from existing PT-02 events, but any correction must wait for accepted PT-02 correction/audit semantics.
- PT-05 may build tenant directory/read authorization in parallel, but must not enable independent tenant financial writes until PT-02 acceptance and PT-16 security/key review pass.
- PT-06 consumes only the accepted external-flow and transaction contract; it must not reinterpret raw broker events independently.


## Implementation slice 1 — cloud write retry integrity

**Client branch:** `feat/wave3-pt02-transaction-integrity-completion`  
**Server deployment commit on `main`:** [`c6201c528977`](https://github.com/armave/portfolio-terminal/commit/c6201c528977bd2dd2bf9fe2ef05fb28dbec9772)

- [x] Add optional server-side idempotency receipts to encrypted `/api/state`, `/api/history`, and keyed cloud-record writes. The receipt stores only a digest of the exact JSON request envelope, its committed revision and an expiry — not a second copy of the portfolio or ciphertext.
- [x] Persist the cloud record and receipt in the same Durable Object storage transaction.
- [x] Bound receipt storage to 100 entries per record with a seven-day expiry.
- [x] Reject reuse of a key with a different request fingerprint.
- [x] Return a replay acknowledgement only when the original commit is still the latest record revision. If a later device has superseded it, return a revision conflict so an old retry cannot be mistaken for a current snapshot.
- [x] Add one client retry for ambiguous network failures and transient 5xx responses, reusing the same body, `If-Match` and `Idempotency-Key`; never retry 4xx conflicts or a stale account session.
- [x] Add Worker regression fixtures for duplicate commit, conflicting key reuse, superseded retry, invalid keys and legacy clients without the optional header.
- [x] Add client Vitest coverage for retry identity on portfolio and closed-history writes.
- [x] Validate exact-head PR CI and direct-to-main Worker deployment status.
- [ ] Complete authenticated live-account/manual device QA; deterministic fixtures are not a substitute.
 
### Exact-head validation — implementation slice 1

**Client PR head:** `a0097bf7d4a10265e3bb3d5bd5849282d6a042cb` (base `d2263a3c0e83a525009af70069bca91ad03fc70e`).

- [x] [Pull Request CI #42343665738](https://github.com/armave/portfolio-terminal/actions/runs/42343665738) — TypeScript, Vitest and production build/bundle budget passed.
- [x] [Operations Browser Journey #42343665762](https://github.com/armave/portfolio-terminal/actions/runs/42343665762) — passed.
- [x] [Trade Lifecycle Browser Smoke #42343665739](https://github.com/armave/portfolio-terminal/actions/runs/42343665739) — passed.
- [x] [Cloudflare Worker deployment #42343731837](https://github.com/armave/portfolio-terminal/actions/runs/42343731837) — Worker tests, dependency audit and Wrangler deployment passed on main commit `8b38957059b996338ccd85970ad962906537536d`. The deployed main history includes the server idempotency implementation from `c6201c528977bd2dd2bf9fe2ef05fb28dbec9772`.

The Worker deployment workflow required a test-fixture isolation correction for a concurrent Finnhub partial-feed test. No financial or market-data runtime behavior was changed by that fixture correction. Deterministic CI is not authenticated live account or multi-device QA.

### Remaining PT-02 acceptance scope

This implementation slice closes the lost-response retry gap; it does **not** close PT-02. Still required: end-to-end inventory of every financial mutation call path, explicit correction/reversal semantics and unsupported-path handling, full lifecycle/backup-import/restore/reload parity, cross-tab conflict UX under real multi-device use, and a reviewed versioned migration/rollback procedure. The event journal and `PortfolioState.positions` remain additive/canonical respectively.


## Implementation slice 2 — auditable balance reversals and replay coverage

**Client PR:** [#402 — PT-02 auditable balance reversals and replay coverage](https://github.com/armave/portfolio-terminal/pull/402)  
**Implementation code head:** `a38a25c805cf39ca97ad2eb3a186e45d0d22533b`  
**Target:** `dev`; no Worker/server changes in this slice.

- [x] Add atomic `PortfolioStore.reverseBalanceAdjustment` for manual `cash.adjustment` and `margin.adjustment` events only.
- [x] Append an immutable `correction` event linked to the original, with reason, actor/source and exact inverse deltas; preserve the original event.
- [x] Make retries idempotent and reject a conflicting second reversal.
- [x] Prove a failed snapshot commit leaves balances, journal and subscribers unchanged.
- [x] Refuse a reversal that would make free cash or margin debt negative after subsequent movements.
- [x] Explicitly reject trade, lot, closed-history and corporate-action reversals until inverse cost-basis and realized-P&L contracts exist.
- [x] Add a journal replay-coverage report distinguishing app-owned replay deltas, broker/import evidence-only rows, history audit-only events, incomplete events and unsupported/malformed schemas.
- [x] Require a correction to reference an existing cash/debt adjustment and carry its exact inverse deltas before calling it replayable.
- [x] Validate TypeScript, 2,054 Vitest tests, production build/bundle budget, dead-code validation, dependency audits, Operations Browser Journey and Trade Lifecycle Browser Smoke. Exact runs: [CI](https://github.com/armave/portfolio-terminal/actions/runs/42561609030), [Operations](https://github.com/armave/portfolio-terminal/actions/runs/42561608991), [Trade Lifecycle](https://github.com/armave/portfolio-terminal/actions/runs/42561608981).

**Not closed by this slice:** trade/lot/corporate-action reversal, cost-basis and closed-history replay, full mutation inventory, backup/cloud restore and cross-device/manual broker QA. The portfolio snapshot remains canonical and the additive journal remains evidence/replay support; no ledger cutover is authorized.
