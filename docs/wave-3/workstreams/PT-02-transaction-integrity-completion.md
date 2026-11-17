# Wave 3 PT-02 — Complete transaction integrity, journal parity and recovery

**Tracking issue:** [#507 — remaining PT-02 transaction journal coverage, parity and recovery](https://github.com/armave/portfolio-terminal/issues/507) (replacement for deleted issue #330)  
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
| Manual cash/debt changes and rollover | `setCashBalance`, `setFreeCash`, `setMarginDebt`, `applyRollover` | Atomic cash, margin and interest events; rollover is timestamp-idempotent. App-owned rollover events carry both the debt delta and an explicit `realizedMarginChargeDelta` (including zero when capitalized), and shadow replay verifies `realizedMarginCharged` separately from debt |
| Cash-cushion holding add/sell/remove | `addCashHolding`, `sellCashHolding`, `removeCashStock` | Explicitly priced app additions create stable acquisition lots; sales use exact FIFO allocations and realized P&L only when app lots cover the full holding. Unpriced/broker-only quantities remain unmapped; removal remains a tracking correction without proceeds |
| Tranche removal and closed-history cleanup | `removeTranche`, `deleteClosedTrade`; generic `PortfolioStore.setState` rejects `closedTrades` | Explicit position/history correction evidence; cleanup does not reverse historical cash or realized P&L. Closed-history rows cannot be changed through an unaudited generic patch |
| Broker executions and cashflows | Imported broker history normalized by `appendBrokerHistoryAuditEvents` | Stable provider references and source/actor attribution; evidence only, not posted again to canonical cash, debt or positions |
| Closed History Sync fee enrichment | `app.ts` → `applyCashflowAllocationsToClosedTrades` → `PortfolioStore.commitClosedHistoryFeeSync` | Preserves source cashflow IDs/allocations and commits the closed-trade fee projection with an immutable linked `history.correction`; audit-only, with no cash, debt, position or realized-margin delta. Legacy/unlinked rows and incomplete source evidence fail closed |
| Generic portfolio snapshot writes | `PortfolioStore.setState`; explicit `importState`, `replaceWorkspace` and reset remain separate validated boundaries | Generic patches reject `closedTrades` and append-only journal fields; the raw updater is private, and rollback accepts only a snapshot reference previously committed by this store. Legacy/imported closed-history rows are retained as snapshot history, not converted into guessed `trade.sell` events |
| Imported cashflow categories | Dividend, deposit, withdrawal, transfer, fee/commission, margin interest and corporate-action/cash-in-lieu descriptions | Typed external-flow events retain signed source amount, currency and reference; no local cash delta, quantity, realized P&L or corporate-action basis adjustment is inferred |
| Generic import, broker refresh/reclassification or legacy direct state edits | Validated `importState` / `setState` normalization and canonical parity check | Append observed position, cash-holding, free-cash and debt deltas as `portfolio.reconciliation`; quantity-only cash changes remain incomplete in lot replay and never receive guessed buy/sell, proceeds, fees or cost basis |
| Quotes, target prices, active desk, pending confirmation, API keys and account credentials | Derived/display or configuration paths | Intentionally outside financial transaction journal |

The expanded regression fixtures assert broker cashflow classification for dividend, deposit, withdrawal, transfer, fee, margin interest and corporate action, and verify that those source facts do not double-post into canonical balances.

Manual free-cash, cash-balance and margin-debt setters (`setFreeCash`, `setCashBalance`, `setMarginDebt`) share the `updateFinancialMutation` commit boundary. Each derives a stable request fingerprint from the command and requested balance, records the caller-supplied idempotency key where present, and defaults actor/source to user/manual-cash-adjustment or user/manual-margin-adjustment. Effective and recorded timestamps are retained on the event. Identical-key retries return an idempotent success without publishing a second snapshot/event; conflicting reuse is rejected. The regression matrix now explicitly verifies these retry/conflict rules and proves that failure to persist any of the three commands preserves the prior in-memory snapshot, stored snapshot, journal and subscriber stream.
Direct snapshot edits are checked for reconciliation deltas across positions, cash-holding quantities, free cash, margin debt and the realized margin-charge total. App-owned rollover events distinguish interest capitalized into debt from charges recorded in `realizedMarginCharged`; older margin-interest events that lack that distinction remain incomplete in replay coverage.

**Closed History Sync fee-correction status — merged in PR #468:** app-side fallback fee revisions now retain exact source cashflow IDs and allocated amounts. A typed immutable `history.correction` is linked to the originating `trade.sell` event and records before/after margin fee, aggregate fees, known net P&L and source allocations. Subsequent revisions chain to their prior correction; unexpected before-state, competing revision heads, missing sources and legacy/unlinked rows fail closed. `PortfolioStore.commitClosedHistoryFeeSync` commits the history projection and journal evidence through one store boundary. These events are audit-only: they do not post cash, debt, positions, cost basis or realized-margin deltas. See implementation slice 3 for exact commit and CI evidence. This closes the earlier “future event contract” gap for supported linked closed-trade fee updates; it does not prove complete closed-trade P&L replay or authenticated broker correctness.

**Explicit limits:** broker corporate-action rows remain external evidence unless they meet the separate app-owned application contract. PR #506 supports verified forward/reverse splits for complete app-owned cash-holding lots only when stable lot identities, acquisition dates, exact quantity coverage, immutable buy/sale replay, quote ordering and any broker compatibility quantity all match. It records immutable per-lot before/after lineage and preserves total acquisition cost and buy commissions; later FIFO sales replay against the transformed lots. It does not enable aggregate-broker-to-lot synthesis or broker auto-posting. Mergers, spin-offs, cash-in-lieu, short holdings, mixed margin/cash ledgers, ambiguous/fractional entitlements and unsupported imported actions remain review-required. Closed-trade removal remains a history correction, not a reversal of the underlying position or cash transaction. Generic backup/cloud import reconciliation continues to use the system actor and `canonical-snapshot-reconciliation`; a general import actor/posting contract is not implemented. Generic trade/lot/corporate-action reversal is not supported until inverse lot, FIFO cost basis, commissions, cash/debt and realized-P&L semantics are specified and independently tested. Imported cashflows with unsupported or ambiguous descriptions remain source evidence rather than guessed local postings.

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

### Remaining PT-02 acceptance scope after implementation slice 1

At the time of slice 1, the lost-response retry gap was closed but the broader PT-02 acceptance remained open. Subsequent slices #402, #468, #486, #504 and #506 closed additional bounded parts of that scope. The remaining acceptance is now tracked in [issue #507](https://github.com/armave/portfolio-terminal/issues/507): complete the supported mutation inventory; prove or explicitly classify each path's atomicity and replay disposition; finish the applicable lifecycle, import/restore/reset and conflict regression matrix; define supported versus unsupported correction/reversal boundaries; and complete authenticated backup, TradeNet and real multi-device release rehearsals. The portfolio snapshot remains canonical; the journal is additive evidence/replay support and no ledger cutover is authorized.


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


## Implementation slice 3 — linked Closed History fee corrections

**Client PR:** [#468 — audit closed-history margin fee revisions](https://github.com/armave/portfolio-terminal/pull/468), merged into `dev` at `292cc59382f145db0821f0378140216571ee70a0`.
**Exact tested PR head:** `0d6d9fc66cbfcba3df50c16efc95ff81695c3d5e`.
**CI:** [Pull Request CI #4186](https://github.com/armave/portfolio-terminal/actions/runs/43629466718) and [Operations Browser Journey #1514](https://github.com/armave/portfolio-terminal/actions/runs/43629466802) passed on the exact tested head.

- [x] Preserve exact broker cashflow IDs and per-trade allocated amounts in app-owned closed-trade fee metadata.
- [x] Add a typed immutable `history.correction` payload linked to the original `trade.sell` event, capturing before/after margin fee, aggregate fees, known net P&L and source cashflow allocations.
- [x] Chain later fee revisions to the prior correction and reject forks or unexpected prior-state changes.
- [x] Keep corrections history-only: no cash, debt, position, cost-basis or realized-margin deltas.
- [x] Commit closed-trade fee updates and journal evidence through an explicit PortfolioStore commit boundary.
- [x] Fail closed for legacy/unlinked sale rows or missing source cashflows; retain prior fee projections and report a non-identifying sync warning.
- [x] Exact-head Vitest, typecheck, production build/bundle budget, Operations Browser Journey, dead-code validation and dependency audits passed in the linked CI runs.
- [ ] Authenticated live-account and multi-device backup/restore verification remains open; deterministic fixtures do not prove those manual paths.

The additive event schema remains version 1. Existing events without the optional structured payload remain readable; `PortfolioState.positions` remains canonical. This is a closed-history audit slice, not PT-02 completion or a ledger cutover.


## Background cloud conflict reconciliation — 2026-11-16

- On HTTP 409, the client makes one background read of the latest encrypted snapshot and compares it with the last accepted in-memory base and the latest local snapshot.
- Automatic field-level merging is restricted to the non-financial UI preferences `activeView`, `selectedTicker` and `autoRefreshInterval`. Every other field, including unknown future fields, is protected state.
- If only one side changed protected state, that complete protected projection is retained while independent UI preferences from the other side are applied. Identical protected outcomes are also accepted. If both devices changed protected state differently, the app leaves the conflict blocked and preserves local data for the existing backup/manual-recovery flow.
- Arrays are atomic and are never concatenated. The client does not merge transaction events, lots, closed trades, cashflows, broker snapshots, balances or financial fields independently. PT-02 journal coverage is not complete enough to claim transaction-level or exactly-once reconciliation.
- A newer remote-only protected snapshot can be accepted as a pull-only reconcile without an unnecessary POST. Otherwise the client makes at most one conditional write against the latest fetched ETag. The Worker's revision check remains authoritative.
- An HTTP 404 after a previously populated merge base is treated as a destructive reset, not an empty safe snapshot. A newer snapshot with legacy embedded broker executions or cashflows is left to the existing history migration flow; those rows are not silently stripped.
- The merge base is held in memory per authenticated credential only; no additional plaintext financial snapshot is persisted. If there is no accepted base, decryption/validation or PortfolioStore application fails, the current local state changes during asynchronous preparation, or the conditional retry loses a race, the conflict remains blocked and the existing recovery panel is used.
- Successful background reconciliation does not switch the user's desk, scroll the workspace, show a modal or success toast, or briefly flash a conflict indicator. The conflict state is surfaced only when safe background recovery cannot complete.
- [x] Exact implementation code head `3f44adc6794c7ed9deb81c6797e6c9ae7ff740a0` passed [Pull Request CI #4315](https://github.com/armave/portfolio-terminal/actions/runs/43792083104) and [Security & Workflow Validation #120](https://github.com/armave/portfolio-terminal/actions/runs/43792083132).
  - TypeScript validation and all 2,277 Vitest tests across 176 test files passed.
  - Vite development-server smoke, dead-code validation, full and production dependency audits, production build and bundle budget passed.
  - Production Browser Smoke, desktop/mobile performance baseline and Operations Browser Journey passed.
  - CodeQL, new-commit secret scan, actionlint and zizmor passed.
- [ ] Manual authenticated multi-device conflict/recovery verification remains open; deterministic fixtures do not prove live cross-device behavior.

## Cloud revision conflict recovery — 2026-11-16

- HTTP 409 is a distinct `conflict` state rather than a generic connectivity error.
- After 409 the client first attempts the bounded background reconciliation described above. A safe result clears the latch after the latest revision is accepted; otherwise subsequent stale writes remain blocked and the conflict is shown.
- The in-memory latch and merge base are scoped to the authenticated credential; a session/account switch does not inherit another session's local state. The Worker revision guard remains authoritative for the shared owner workspace.
- An authorized 404 establishes an empty baseline only when there was no previously populated base. A missing cloud record after a populated base requires explicit recovery.
- Settings retains the administrator-only recovery panel with JSON backup export and the confirmation-protected cloud pull action. The normal manual-sync control remains disabled while a conflict requires recovery.
- The confirmed Settings pull is an explicit same-workspace replacement: it validates the cloud snapshot, then replaces the local snapshot/journal through a dedicated store boundary after the backup warning. Ordinary startup/background pulls continue using journal-merging import semantics.
- The local store application is the pull commit boundary. The runtime does not persist the raw remote snapshot or accept its revision/clear the conflict latch until the application callback succeeds; a rejected journal import preserves local persistence and keeps the conflict blocked.
- A 404 establishes an empty baseline only when there is no previously accepted populated snapshot or positive cloud revision. A missing record after a populated baseline remains a recovery conflict; it is not silently treated as an empty portfolio.
- The header indicator and English/Russian copy distinguish revision conflicts from connectivity failures.
- Vitest and the Operations Browser Journey cover the conflict latch, background reconciliation, ambiguous/divergent financial changes, backup export and fallback recovery.
- Client-only change: no Worker, Durable Object, API, authorization, encryption, ETag or idempotency contract changes. Canonical snapshot and journal ownership remain unchanged.


## Implementation slice 4 — fee-correction restore integrity and scoped journal coverage

**Client PR:** [#504 — Harden closed-history fee restore integrity and expose journal coverage](https://github.com/armave/portfolio-terminal/pull/504), merged into `dev` at `c37f4bd2e258ae3b3de16d5a2683cdefb540503f`.
**Exact tested PR head:** `16d0eaa68923a8fcfc10e0ba38cd597111d13f6b` (the final PR head; earlier intermediate SHA `e681dba...` was not the final candidate).
**CI:** [Pull Request CI #4434](https://github.com/armave/portfolio-terminal/actions/runs/43902637772) and [Security & Workflow Validation #240](https://github.com/armave/portfolio-terminal/actions/runs/43902637803) passed on the final PR head. The advisory full-history secret audit was skipped; the new-commit scan passed.

**Scope:** Client/domain only; no Worker/server or accounting-formula changes.

- [x] Validate structured closed-history fee-correction events at the backup/cloud `importState` boundary after merging with already-committed local journal events.
- [x] Validate fee-correction lineage at explicit workspace replacement and the Closed History Sync commit boundary.
- [x] Require linked sale events, complete source cashflow references for active corrections, a single valid revision head, matching before/after revision snapshots and exactly one matching canonical closed-trade row after the latest reset; reject missing or ambiguous rows.
- [x] Preserve pre-reset fee corrections as immutable audit history across the explicit portfolio reset marker, validating their embedded allocation totals and revision lineage without requiring reset-cleared cashflow or closed-trade projections.
- [x] Reject duplicate journal event IDs whenever structured fee-correction history is present.
- [x] Require each structured fee-correction event to remain classified as audit-only by the existing replay-coverage contract; malformed, incomplete or unsupported linked corrections are rejected before the candidate snapshot is committed.
- [x] Preserve the existing append-only merge behavior and leave the previous in-memory state, persisted snapshot and subscribers unchanged when validation fails.
- [x] Display scoped journal replay coverage in Broker Reconciliation: replayable, evidence-only, audit-only and items-needing-review counts, plus a bounded list of issue reasons.
- [x] State the coverage boundary explicitly: active-position and cash-holding quantities, free cash, margin debt and realized margin charges only; no claim is made about complete lot cost-basis or closed-trade P&L reconstruction.
- [x] Add Vitest regression coverage for invalid revision links, missing source cashflows, coverage display wiring and English/Russian copy parity.

This slice does not alter accounting calculations, FIFO allocations, canonical snapshot ownership, generic reversal semantics, broker matching rules, cloud revision protocol or Worker contracts. Authenticated account and multi-device restore QA remains a manual release gate; deterministic CI fixtures do not replace that verification.


## Implementation slice 5 — verified cash-holding corporate-action lot conversion

**Client/domain PR:** [#506 — Support verified corporate-action splits for app-owned cash lots](https://github.com/armave/portfolio-terminal/pull/506), squash-merged into `dev` at `426c3568b308b23ee4a160fb2da91bd21eeff28f`.
**Exact tested PR head:** `fc3b42b082f699fe769431f24b440bda7e767ae4`.
**CI:** [Pull Request CI #4443](https://github.com/armave/portfolio-terminal/actions/runs/43912493765) and [Security & Workflow Validation #249](https://github.com/armave/portfolio-terminal/actions/runs/43912493947) passed on the exact PR head. The advisory full-history secret audit was skipped; the new-commit scan passed. A dedicated Trade Lifecycle Browser Smoke run was not present for this PR head.

**Scope:** Client/domain only; no Worker/server changes.

- [x] Add a deterministic cash-holding split helper that accepts only complete app-owned lots with unique stable identities, exact quantity coverage, valid acquisition dates/timestamps, positive cost prices and known non-negative buy commissions.
- [x] Require every lot to predate the action. Post-action-only lots are not re-adjusted; mixed/effective-date lots, fractional aggregate entitlements, missing lots and unverified/future quotes remain review-required.
- [x] Preserve total acquisition cost and each lot's buy commission while multiplying quantity and dividing unit cost. Quotes observed before the action are adjusted only as stale/partial; post-action observations remain unchanged.
- [x] Apply only when current cash-holding lots exactly match the immutable cash buy/sale journal replay and any broker cash compatibility row matches the same share quantity. Broker aggregates and average prices are never converted into synthetic lots.
- [x] Refuse mixed margin/cash ledgers and duplicate cash rows rather than partially adjusting a ticker.
- [x] Append a validated immutable corporate-action event with an explicit multiplier, cash-holding quantity delta and exact per-lot before/after lineage. The event schema rejects mismatched quantities, invalid dates, non-conserving lot conversions and cash/debt/P&L postings.
- [x] Extend shadow lot replay so later FIFO cash-holding sales use the post-split quantity and unit cost while pre-split sale allocations remain immutable.
- [x] Keep the legacy broker cash projection synchronized with the adjusted app-owned cash holding only when it is an exact share-count mirror.
- [x] Add Vitest coverage for forward/reverse split invariants, invalid/incomplete/mixed/post-action lots, quote ordering, journal validation, replay through a later FIFO sale, state persistence/idempotency and broker mirror mismatch.
- [x] Update the market-events action label and Russian localization.

This slice does not model dividends, mergers, spin-offs, cash-in-lieu, short holdings, mixed margin/cash splits, broker auto-posting, or settlement cash. Unresolved cases remain review-required and do not mutate quantities, cash or realized P&L. Authenticated TradeNet and backup/recovery QA remain release gates.


## Implementation slice 6 — generic closed-history state-write guard

**Scope:** Client store, Vitest regression coverage and this PT-02 contract only; no Worker/server/API or accounting-formula changes.

- Generic `PortfolioStore.setState` now rejects any update that owns the `closedTrades` property, including mixed updates that also contain otherwise valid fields. The guard runs before state normalization, persistence and subscriber notification.
- Audited `trade.sell` and `deleteClosedTrade` commands, the dedicated linked `commitClosedHistoryFeeSync` boundary, validated `importState` / `replaceWorkspace`, and explicit reset remain the supported history mutation boundaries.
- Imported or legacy closed-history rows remain snapshot history when no supported sale-event lineage exists; this guard does not synthesize historical sale events or change the canonical snapshot model.
- Vitest verifies both direct and mixed generic patches preserve the prior state reference, persisted snapshot and subscribers.

## Current PT-02 status — 2026-11-16

Merged client/domain slices now include linked Closed History fee corrections (#468), fee-correction restore integrity and scoped journal coverage (#504), verified app-owned cash-lot split/reverse-split conversion (#506), duplicate transaction-event identity rejection and import atomicity (#509–#510), audited Trades desk fee synchronization (#511), and the generic closed-history mutation guard (#512), alongside the earlier transaction, reversal, retry, lot-replay and cloud-conflict slices referenced above. The tracker for remaining acceptance is [#507](https://github.com/armave/portfolio-terminal/issues/507); the former broad issue #330 was deleted and is no longer a valid tracker.

### Exact-head evidence — 2026-11-16 follow-up slices

- **PR #509 — duplicate event identity validation:** merged at `13b4d3a8265b940fc9fffe2213af55d140a8d564`; exact tested head `b6e6295413afdbc73e97f302c98cb949693533dc`. [Pull Request CI #4448](https://github.com/armave/portfolio-terminal/actions/runs/43927479869) and [Security & Workflow Validation #254](https://github.com/armave/portfolio-terminal/actions/runs/43927479904) passed. The advisory full-history secret audit was skipped.
- **PR #510 — duplicate identity import atomicity tests:** merged at `03d7ad7ea280f2266ea30f8099e5d5f373aab0c1`; exact tested head `4272cd3602b74e002eb3468ec317ec663f52b2f0`. [Pull Request CI #4450](https://github.com/armave/portfolio-terminal/actions/runs/43928700548) and [Security & Workflow Validation #256](https://github.com/armave/portfolio-terminal/actions/runs/43928700815) passed. The advisory full-history secret audit was skipped.
- **PR #511 — Trades desk fee sync audit commit:** merged at `f5cff023276d4dfa777226f95f0245b64e1bca9a`; exact tested head `5b0b10e27726a12878d03931d15102fae9620992`. [Pull Request CI #4452](https://github.com/armave/portfolio-terminal/actions/runs/43931070919) and [Security & Workflow Validation #258](https://github.com/armave/portfolio-terminal/actions/runs/43931070705) passed. The advisory full-history secret audit was skipped.
- **PR #512 — generic closed-history mutation guard:** merged at `b42d87e1e2ce178e01eb4f649011d13ed0309db4`; exact tested head `603c5c3a9455d7eadc25d42c4ea662bad32629c4`. [Pull Request CI #4454](https://github.com/armave/portfolio-terminal/actions/runs/43933427892) and [Security & Workflow Validation #260](https://github.com/armave/portfolio-terminal/actions/runs/43933427797) passed. The advisory full-history secret audit was skipped.

All four CI/security pairs refer to the exact tested code-bearing PR heads. For PR #512, authenticated TradeNet, backup/restore and real multi-device checks remain manual gates and are not marked complete by automated browser tests.

Automated validations are recorded against each exact PR head above. The following remain manual release gates where applicable: authenticated TradeNet refresh and corporate-action compatibility, authenticated backup export/import and cloud restore across multiple devices, and keyboard-only/responsive accessibility review. These are not satisfied by deterministic CI and are not claimed complete. `PortfolioState.positions` remains canonical and no ledger cutover has been authorized.


## Implementation slice — read-only lot and closed-history parity (#518)

[PR #518](https://github.com/armave/portfolio-terminal/pull/518) was squash-merged into `dev` at [`92106bf431794bfcf9a8c980e11825b20c3b5ac9`](https://github.com/armave/portfolio-terminal/commit/92106bf431794bfcf9a8c980e11825b20c3b5ac9). Final reviewed/tested PR head: `91eb985c012f0bda4c816e514d89111d7607086f`.

- [x] Expose the existing FIFO lot and linked closed-trade replay parity as a separate read-only section in Trades reconciliation.
- [x] Pass canonical positions, cash-holding lots and closed history into the shadow verifier; keep `PortfolioState.positions` canonical and retain explicit incomplete/unsupported classifications.
- [x] Add English/Russian status, discrepancy and issue explanations with bounded visible finding lists.
- [x] [Pull Request CI #4468](https://github.com/armave/portfolio-terminal/actions/runs/44019388156) — passed: TypeScript, full Vitest/Worker suite, Vite smoke, dead-code/dependency audits, production build, production browser smoke/performance and Operations Browser Journey.
- [x] [Security & Workflow Validation #274](https://github.com/armave/portfolio-terminal/actions/runs/44019388061) — passed: workflow lint/security, new-commit secret scan and CodeQL; advisory full-history scan skipped.

This is parity visibility, not a ledger cutover or automatic correction. Authenticated TradeNet, backup/restore and real multi-device release checks remain manual gates.

## Completed follow-up — PR #520 cash/debt setter idempotency and atomicity

[PR #520](https://github.com/armave/portfolio-terminal/pull/520) was squash-merged into `dev` at [`b076ac194c30fae5c81ce05b0edc4d354fcbd2d5`](https://github.com/armave/portfolio-terminal/commit/b076ac194c30fae5c81ce05b0edc4d354fcbd2d5). Final tested PR head: `75558f00d43bad33173b1c3f9ae9a7e626ec0fa8`.

- [x] Verify identical-key retries and conflicting-key rejection for `setFreeCash`, `setCashBalance` and `setMarginDebt`.
- [x] Verify event actor/source/effective/recorded metadata on manual and AI-confirmed adjustment paths.
- [x] Verify failed persistence retains the prior in-memory snapshot, persisted state, event journal and subscribers.
- [x] [Pull Request CI #4476](https://github.com/armave/portfolio-terminal/actions/runs/44020795563) and [Security & Workflow Validation #282](https://github.com/armave/portfolio-terminal/actions/runs/44020795313) passed all blocking checks.

This slice added regression coverage only; accounting and runtime command behavior were unchanged.

## Validated follow-up — atomic backup import and journal-preserving restore (#523)

[PR #523](https://github.com/armave/portfolio-terminal/pull/523) routes JSON file restore through `PortfolioStore.importState()` exactly once. That existing store command validates the snapshot and append-only journal inputs, persists the resulting state atomically, and only then publishes it. The duplicate post-import `saveState` call and the compensating `importState(previousState)` path have been removed; cloud sync is requested only after the local commit succeeds.

- [x] Replace the two-phase helper with a single atomic commit callback; rejection or persistence failure does not attempt a second import or journal merge.
- [x] Add file-import wiring coverage proving the single local commit precedes cloud sync.
- [x] Add export/import/reload coverage for transaction events, linked closed history, cash-holding FIFO lots, sourced corporate-action events and market-history corrections.
- [x] Add persistence-failure coverage proving the active state reference, committed journal, persisted snapshot and subscribers remain unchanged.
- [x] Align fixtures with canonical snapshot/event parity so tests account for the store's explicit reconciliation events rather than treating them as unexpected loss.
- [x] Preserve the existing legacy-backup path and the append-only same-workspace restore semantics.
- [x] [Pull Request CI #4487](https://github.com/armave/portfolio-terminal/actions/runs/44023790629) — passed: typecheck, full Vitest/Worker suite, Vite smoke, dead-code validation, both dependency audits, production build, production browser smoke/performance and Operations Browser Journey.
- [x] [Financial Integrity Regression #5](https://github.com/armave/portfolio-terminal/actions/runs/44023790718) — passed: transactions, persistence and authorization regression suite.
- [x] [Security & Workflow Validation #293](https://github.com/armave/portfolio-terminal/actions/runs/44023790687) — passed: workflow lint/security, new-commit secret scan and CodeQL; advisory full-history secret audit skipped.

The CI results above were run against candidate head `212f477677fe75eff642cd85d0fbd64b9e7d69dc`; this documentation update will receive its own exact-head CI run. The automated tests prove local browser-storage commit and JSON round-trip behavior, not authenticated cloud restore or recovery on multiple real devices. Those manual release gates remain open.


## Read-only lot and closed-history parity visibility

The Trades broker-reconciliation panel now exposes the existing `verifyPortfolioTransactionLotParity` shadow comparison separately from transaction-journal quantity/cash/debt coverage. It receives the current canonical `positions`, cash-holding lots and `closedTrades`; it never writes to the store or changes financial calculations.

The report displays replayed open-lot and closed-sale counts, discrepancy counts, and bounded explanations for up to five lot/closed-trade differences and five incomplete or unsupported findings. A complete supported history with differences is shown as a difference state; incomplete and unsupported history are never presented as a match. Replay and canonical values are shown as read-only evidence.

This visibility does not upgrade legacy/unmapped lots to replayable records, infer acquisition cost from broker average prices, or claim that unsupported history has been reconciled. In particular, it remains a shadow comparison: `PortfolioState.positions` and the canonical closed-history snapshot remain authoritative. No automatic repair, posting, reversal, schema migration, Worker change or ledger cutover is introduced. The existing authenticated backup/restore, live TradeNet and real multi-device checks remain manual release gates.
