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
| Tranche removal and closed-history cleanup | Public store API boundaries `removeTranche` and `deleteClosedTrade`; exact-symbol search found no current production app/component invocation | `position.adjustment` and `history.correction`; default actor user, sources `manual-position-correction` and `closed-history-maintenance` | Uses `updateFinancialMutation`; closed-trade deletion gets a stable default key when the row has an ID. Failed persistence leaves snapshot and journal unchanged | Tranche removal records quantity/tracking correction only; it does not invent sale proceeds, reverse cash, cost basis or P&L, so lot replay remains incomplete. Closed-history deletion is audit-only and does not reverse the underlying trade |
| Broker executions and cashflows | Imported broker history normalized by `appendBrokerHistoryAuditEvents` | Stable provider references and source/actor attribution; evidence only, not posted again to canonical cash, debt or positions |
| Unknown broker cashflows | Source cashflow history and PT-04 reconciliation | Provider-specific or unsupported labels remain unclassified source evidence; they are not appended as `cash.adjustment`. Only explicitly recognized adjustment/correction labels receive that type. No amount is posted or matched from an unknown label. |
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

## Completed follow-up — atomic backup import and journal-preserving restore (#523)

[PR #523](https://github.com/armave/portfolio-terminal/pull/523) was squash-merged into `dev` at [`599e3d476bb2fba9e445ca775c44dc46a1a425bc`](https://github.com/armave/portfolio-terminal/commit/599e3d476bb2fba9e445ca775c44dc46a1a425bc). Final tested PR head: `a4bd4f5e1afa7fa0e3957357e2837bb593147363`.

- [x] Route JSON restore through one `PortfolioStore.importState()` commit and request cloud sync only after local success.
- [x] Cover transaction, linked closed-history, cash-holding FIFO, corporate-action and market-correction data through export/import/reload.
- [x] Prove persistence failure preserves the prior active snapshot, journal, persisted record and subscribers.
- [x] [Pull Request CI #4489](https://github.com/armave/portfolio-terminal/actions/runs/44024116292), [Financial Integrity Regression #6](https://github.com/armave/portfolio-terminal/actions/runs/44024116448) and [Security & Workflow Validation #294](https://github.com/armave/portfolio-terminal/actions/runs/44024116254) passed all blocking checks.

Authenticated cloud restore, account-scope switching and real multi-device recovery remain manual release gates; deterministic JSON/local-storage tests do not certify those scenarios.

## Completed follow-up — safe cloud conflict pull recovery (#522)

[PR #522](https://github.com/armave/portfolio-terminal/commit/34710d117ff36927a3e343d58e4abb4b45c19169) is now part of `dev`. The runtime preserves local state when applying a pulled cloud snapshot fails, requires explicit same-workspace replacement intent for confirmed recovery, and treats a missing cloud record after an accepted revision as a conflict. The associated runtime tests prove that rejected pulls keep the conflict latched and do not authorize stale retries or silently adopt a missing remote record.

## Completed follow-up — protected cloud financial-array conflict coverage (#526)

[PR #526](https://github.com/armave/portfolio-terminal/pull/526) was squash-merged into `dev` at [`9d26ad422d5712262a24049d92c4d1836c84e75b`](https://github.com/armave/portfolio-terminal/commit/9d26ad422d5712262a24049d92c4d1836c84e75b). Final tested PR head: `be6a05fd80e7d717d042c4e7d50930f12d176717`.

- [x] Cover eight protected groups: transaction events, corporate-action events, market-history corrections, closed trades, broker executions, cashflows, position/FIFO tranches and cash-holding/FIFO lots.
- [x] Divergent protected financial projections block reconciliation; arrays are not appended or merged.
- [x] Identical protected outcomes are preserved once while disjoint allowlisted navigation preferences can still merge.
- [x] [Pull Request CI #4500](https://github.com/armave/portfolio-terminal/actions/runs/44026131349) and [Security & Workflow Validation #305](https://github.com/armave/portfolio-terminal/actions/runs/44026131395) passed all blocking checks.

The regression suite proves the deterministic three-way reconciler contract. It does not certify simultaneous real-device recovery.

## Completed follow-up — concurrent same-key cloud idempotency replay (#527)

[PR #527](https://github.com/armave/portfolio-terminal/pull/527) was squash-merged into `dev` at [`6ce2d5e8ca476e720ec91f1fc9b0152024943234`](https://github.com/armave/portfolio-terminal/commit/6ce2d5e8ca476e720ec91f1fc9b0152024943234). Final tested PR head: `250e90b7fa4d81c9a786827a4c9b634200ba2892`.

- [x] Race two identical cloud state writes with the same expected revision, idempotency key and request fingerprint.
- [x] Assert both responses succeed at revision 1, with exactly one idempotency-replay response.
- [x] Assert one receipt and one stored encrypted snapshot; receipt storage does not include encrypted payload content.
- [x] [Pull Request CI #4502](https://github.com/armave/portfolio-terminal/actions/runs/44027294517), [Financial Integrity Regression #15](https://github.com/armave/portfolio-terminal/actions/runs/44027294484) and [Security & Workflow Validation #308](https://github.com/armave/portfolio-terminal/actions/runs/44027294429) passed all blocking checks.

The test verifies request deduplication within the Worker receipt retention window (100 receipts per record, seven days). It does not claim global/unbounded exactly-once delivery or real browser/device recovery.

## Completed — unsupported financial reversal boundary coverage

The supported inverse contract remains deliberately narrow: `reverseBalanceAdjustment` accepts only manual `cash.adjustment` and `margin.adjustment` events, with an exact linked correction and safe non-negative resulting balances. Trade buys/sales, cash-holding buy/sale/removal, position-lot tracking corrections, closed-history corrections, corporate actions, margin interest, external flows and generic audit/reset events remain unsupported for reversal. The new table-driven store regression verifies that each unsupported event type is rejected without changing the active snapshot, persisted snapshot, journal or subscribers. This is contract coverage only; it does not add an inverse operation or reinterpret financial history.


## Completed — authenticated public Worker cloud-snapshot protocol regressions

Test-only main commits `493c7dcc`, `b5fa5878` and corrected follow-up `f240547d` extend the cloud snapshot and digest tests through the public `worker.fetch` authentication/routing boundary, backed by isolated Durable Object fixtures.

- [x] Unauthenticated requests are rejected before Durable Object session lookup; authenticated guest requests cannot write shared cloud snapshots.
- [x] Encrypted snapshot writes preserve ETag/revision; an identical idempotent retry returns the original committed revision without a second snapshot write.
- [x] Reusing an idempotency key with a different request fingerprint is rejected with `409`.
- [x] A stale `If-Match` revision is rejected with `409`.
- [x] A delayed retry whose original receipt has since been superseded is rejected with `409` and identifies the current revision rather than restoring the older snapshot.
- [x] The committed encrypted snapshot is returned by the authenticated read route; idempotency receipts retain only the request fingerprint/key/revision metadata, not the encrypted payload.
- [x] [Pull Request CI #4594](https://github.com/armave/portfolio-terminal/actions/runs/44112353610), [Financial Integrity Regression #35](https://github.com/armave/portfolio-terminal/actions/runs/44112353832), [Security & Workflow Validation #400](https://github.com/armave/portfolio-terminal/actions/runs/44112353689), and [GitHub Pages #1103](https://github.com/armave/portfolio-terminal/actions/runs/44112353564) passed on exact main head `f240547dc5098c8d9f7c36396e1dc9a938831490`.

This is deterministic public Worker-boundary coverage with a test session and Durable Object fixture. It does **not** replace authenticated production requests, restore rehearsal against a real account, or simultaneous recovery across physical devices. No Worker runtime behavior changed in these test-only commits.

## Read-only lot and closed-history parity visibility

The Trades broker-reconciliation panel now exposes the existing `verifyPortfolioTransactionLotParity` shadow comparison separately from transaction-journal quantity/cash/debt coverage. It receives the current canonical `positions`, cash-holding lots and `closedTrades`; it never writes to the store or changes financial calculations.

The report displays replayed open-lot and closed-sale counts, discrepancy counts, and bounded explanations for up to five lot/closed-trade differences and five incomplete or unsupported findings. A complete supported history with differences is shown as a difference state; incomplete and unsupported history are never presented as a match. Replay and canonical values are shown as read-only evidence.

This visibility does not upgrade legacy/unmapped lots to replayable records, infer acquisition cost from broker average prices, or claim that unsupported history has been reconciled. In particular, it remains a shadow comparison: `PortfolioState.positions` and the canonical closed-history snapshot remain authoritative. No automatic repair, posting, reversal, schema migration, Worker change or ledger cutover is introduced. The existing authenticated backup/restore, live TradeNet and real multi-device checks remain manual release gates.

## Caller and atomicity inventory follow-up — 2026-11-17

This supplements the command-level coverage table above with the current store boundary, event metadata, retry behavior and replay disposition. It does not claim authenticated broker QA or real-device recovery is complete.

| Command / update path | Observed caller or entry path | Event and actor/source | Retry and persistence boundary | Replay disposition / explicit limit |
|---|---|---|---|---|
| Margin buy and add-tranche | Public store command `PortfolioStore.buyStock`; `addTranche` is a compatibility wrapper. Exact-symbol repository search found no current production app/component caller; command coverage is at the store API/test boundary | `trade.buy`; default actor `user`, source `manual`; event carries a stable lot ID, purchase date, commission and balance deltas | Command fingerprint is always derived; a caller idempotency key is honored when supplied. State and event are appended inside `updateFinancialMutation` and persisted before subscribers are notified | Quantity replay is supported. FIFO cost-basis replay requires stable lot identity, acquisition date, positive price and commission evidence; legacy/unmapped lots remain incomplete |
| Margin sale and AI-confirmed sale | Public store commands `sellStock` and compatibility entry `sellMarginPosition` share `applyMarginSale`. Exact-symbol repository search found no current production app/component caller; command coverage is at the store API/test boundary | `trade.sell`; defaults to user/manual or AI/ai-confirmed actor/source when invoked; the AI source label is not proof of an active AI caller. Event carries exact sale settlement and FIFO allocations when available | Fingerprint is derived; caller key is used when provided. State, closed-trade projection and sale event share the financial mutation commit boundary; failed persistence does not publish | Exact stable-lot allocations are replayable. Legacy/unmapped allocation slices remain incomplete; no cost basis or realized P&L is synthesized for missing slices |
| Cash-holding acquisition, sale and tracking removal | Public store commands `addCashHolding` (`addCashStock` compatibility wrapper), `sellCashHolding`, and `removeCashStock`. Exact-symbol repository search found no current production app/component caller; command coverage is at the store API/test boundary | `cash-holding.buy`, `cash-holding.sell`, `cash-holding.adjustment`; default actor user and source `manual-cash-holding` / `manual-cash-holding-correction` | State and event use `updateFinancialMutation`. Buy/sale fingerprints are derived; stable retry identity is only portfolio-wide where the caller supplies an idempotency key (the event ID is separately generated) | Explicitly priced app-owned additions create exact lots; unpriced additions create no synthetic lot. Sales replay only with complete exact FIFO allocations. Removal is a tracking correction without proceeds or realized P&L and remains lot-replay incomplete |
| Free-cash, account cash and margin-debt setters | Public store API boundaries `setFreeCash`, `setCashBalance`, `setMarginDebt`; exact-symbol search found no current production app/component invocation, so these are covered by store-level command tests rather than a claimed wired UI flow | `cash.adjustment` / `margin.adjustment`; default actor user, source `manual-cash-adjustment` or `manual-margin-adjustment` | Fingerprint is derived from command and requested balance; caller key is optional. Atomic financial mutation commit; identical-key retries are no-ops and conflicting reuse is rejected | Explicit signed cash/debt deltas are replayable; no transaction is inferred from a missing balance |
| Automatic margin rollover | `app.ts` `applyOvernightRollover` calls `applyRollover`; zero-debt elapsed cycles only update the rollover timestamp | `margin.interest`; default actor system, source rollover | Default idempotency key is `rollover:<timestamp>`; retry with same timestamp and facts is idempotent, different facts conflict. Debt, realized-charge delta and timestamp commit together | Replayable only when both `marginDebtDelta` and `realizedMarginChargeDelta` are present. Older events missing the distinction remain incomplete |
| Tranche removal and closed-history cleanup | Public store API boundaries `removeTranche` and `deleteClosedTrade`; exact-symbol search found no current production app/component invocation | `position.adjustment` and `history.correction`; default actor user, sources `manual-position-correction` and `closed-history-maintenance` | Uses `updateFinancialMutation`; closed-trade deletion gets a stable default key when the row has an ID. Failed persistence leaves snapshot and journal unchanged | Tranche removal records quantity/tracking correction only; it does not invent sale proceeds, reverse cash, cost basis or P&L, so lot replay remains incomplete. Closed-history deletion is audit-only and does not reverse the underlying trade |
| Balance-adjustment reversal and review note | `CashCushionDesk` invokes `reverseBalanceAdjustment`; `ClosedHistoryDesk` invokes `recordReconciliationReview` | Reversal: `correction`; review: `portfolio.reconciliation`. Both default to user actor and explicit source metadata | Reversal is keyed by original event ID and allows only safe inverse cash/debt adjustments. Review key is finding-scoped and fingerprinted. Both persist before notification | Balance-only reversal is replayable only when it exactly links to and inverts a supported cash/debt adjustment. Review note is audit-only. Trade/lot/corporate-action reversals remain unsupported |
| Corporate-action evidence and split application | `MarketInsightsPanel` records provider evidence and, after explicit confirmation, calls `applyCorporateActionSplit` | Evidence is held in the separate corporate-action journal as `review_required`; an applied split also appends `corporate-action` with user actor, source corporate-action and source-ID idempotency key | Split application validates freshness, broker integrity, all affected app-owned lots and immutable source identity before one store update. Repeated source ID with unchanged facts is idempotent; conflicting facts are rejected | Exact supported split/reverse-split lot conversions are replayable. Dividends, mergers, spin-offs, cash-in-lieu and unsupported/fractional cases remain review-required evidence only |
| Broker execution and cashflow refresh | `app.ts` broker event handlers and `ClosedHistoryDesk` refresh/hydration persist normalized provider history | `broker.execution` and typed external cashflow events; imported source/actor/provider reference is retained | Broker source rows are merged/deduplicated in the snapshot/history path; they are not app-owned commands and do not double-post cash, debt or positions | Evidence-only. Unknown cashflow categories remain unclassified. A broker aggregate never authorizes synthetic buys/sells, FIFO lots, fees or realized P&L |
| Broker account refresh and active-tranche reclassification | `app.ts` handles `broker:account-info`, `broker:executed-trades` and `broker:set-active-tranche-type`; each routes resulting snapshot changes through `PortfolioStore.setState` | Quantity/free-cash/debt differences are system `portfolio.reconciliation` events with observed signed deltas; same-quantity lot/commission detail is handled by the new detail-only event described below | Generic snapshot candidate and any generated reconciliation event are saved before publication. A failed local write leaves the previous snapshot and journal active | Quantity/balance deltas may be replayable. Same-quantity lot, commission and broker-fee changes are explicitly incomplete unless a typed source-backed transaction exists |
| Closed History Sync open-fee allocation | `app.ts` fee-allocation pipeline calls `commitClosedHistoryFeeSync`; the linked closed-trade correction builder owns closed-row fee revisions | Closed-row revision uses linked `history.correction` audit evidence. Open-position fee-allocation projection now also receives a separate detail-only `portfolio.reconciliation` event when changed without an app-owned posting command | Closed projection and journal are first committed to the store; the caller's compact local snapshot save and in-memory rollback remain the enclosing persistence/recovery boundary. Failure does not leave a published candidate as the active final state | Linked closed-row fee corrections are audit-only and do not change cash/debt/positions. Open broker-fee allocations remain incomplete shadow evidence; they are not recast as app-paid fees or modeled margin interest |
| Backup/import and workspace/cloud replacement | `importState` for same-workspace backup/cloud merge; `replaceFromConfirmedCloudPull` for explicit confirmed same-workspace replacement; `replaceWorkspace` for authenticated scope switch | Imported transaction/corporate-action/history-correction journals are validated and merged or explicitly replaced at their owning boundary; normalization adds only observed quantity/balance reconciliation where needed | Validation and the state update occur before publication; invalid shape, duplicate/conflicting event history or invalid linked fee audit is rejected without changing the prior committed snapshot. Workspace replacement is a distinct authorization/session-scope operation | Imported broker rows remain evidence-only. Unsupported or missing acquisition history is not converted into trade events; the read-only lot parity report remains incomplete where exact source-backed lot events are unavailable. Cross-workspace replacement is not compared to the outgoing account as if it were a financial mutation |

### Same-quantity accounting-detail reconciliation — implemented in this slice

The prior normalization parity check records active-position quantity, cash-holding quantity, free-cash, margin-debt and realized-margin-charge deltas. It cannot detect a same-quantity change to tranche identity/prices/dates/buy commission, the position's aggregate buy commission, modeled margin charge, open broker-fee allocations, or cash-holding acquisition lots/average cost.

The store now detects these changes at the generic `setState` snapshot boundary, the `commitClosedHistoryFeeSync` open-position fee-projection boundary, same-workspace `importState` backup/merge restore, and explicitly confirmed same-workspace cloud replacement. Detail-only evidence is suppressed only when a newly added same-ledger source command (or reset marker) is present and complete ticker-scoped lot replay verifies the resulting canonical lot quantities, acquisition prices/dates, buy commissions, linked sale rows and (for cash holdings) weighted average cost. A same-ticker event alone is insufficient, and an old transaction that happens to match a rewritten snapshot is not a new explanation: simultaneous prior-lot rewrites, unlinked adjustments, unsupported actions, and incomplete legacy history remain visible as incomplete detail-only events. Authenticated `replaceWorkspace` account-scope switching is deliberately excluded: its outgoing and incoming workspaces are different portfolios and must not be compared as one financial history. It appends a system `portfolio.reconciliation` event in the same candidate snapshot:

- `canonical-snapshot-detail-reconciliation` for generic direct snapshot writes, including broker snapshot/reclassification writes.
- `closed-history-sync-detail-reconciliation` for open-position broker-fee allocations changed during Closed History Sync.

These detail-only events carry the ticker and changed categories, but deliberately carry **no** invented quantity, cash, commission posting, cost basis or P&L delta. The replay inspector classifies them as **incomplete**, not replayable and not audit-only. `PortfolioState.positions` and the existing cash-holding snapshot remain canonical. Quote/current-price/target-price updates are excluded. Supported buy/sell/corporate-action commands retain their typed events; their code paths do not pass through this generic detail-audit hook.

Failure-injection tests prove that a failed snapshot write preserves the prior in-memory object, persisted snapshot, event journal and subscriber stream. Tests also prove same-quantity position and cash-holding detail changes are visible as incomplete evidence across generic snapshots, backup import and confirmed cloud pull; a newly added typed buy suppresses redundant detail evidence only when replay fully matches the candidate snapshot; old transactions cannot suppress a new mutation merely because they happen to match the rewritten snapshot; co-imported unexplained rewrites of an existing lot and cash average cost remain visible; open broker-fee allocation changes are separately recorded; and quote/target-only refreshes do not create accounting audit events.

This closes the previously unrecorded **direct snapshot accounting-detail observation** gap. It does not add generic trade/lot reversals, infer provider event semantics, make open broker fees app-owned postings, complete every historical replay, or authorize a ledger cutover.

### Reset failure rollback regression — merged into dev

The authenticated admin reset entry is app.ts resetToBlankState (guarded by requireAdmin); it delegates to PortfolioStore.resetToBlankState. The failure-injection regression verifies a rejected local snapshot write returns false and retains the same in-memory snapshot, positions, append-only transaction journal, persisted snapshot and selected device desk, with no subscriber notification. This is test-only coverage of the existing rollback contract: [PR #563](https://github.com/armave/portfolio-terminal/pull/563), tested head `fda5fbacee149d821a2945fa1677be9c8a3afc89`, merged to dev at `9d43d34a162b048a264566b86a56a696b0eea0c8`. Exact-head CI: [Pull Request CI #44121640819](https://github.com/armave/portfolio-terminal/actions/runs/44121640819), [Financial Integrity Regression #44121641039](https://github.com/armave/portfolio-terminal/actions/runs/44121641039), [Security & Workflow Validation #44121641371](https://github.com/armave/portfolio-terminal/actions/runs/44121641371).

The command rows above distinguish public store methods from production wiring: exact-symbol repository searches found no current app/component invocation of buyStock, addTranche, sellStock, sellMarginPosition, addCashHolding, addCashStock, sellCashHolding, removeCashStock, setFreeCash, setCashBalance, setMarginDebt, removeTranche or deleteClosedTrade. Those APIs have store-level tests and journal behavior, but their availability does not establish a live UI/AI call path. In contrast, the matrix records direct production callers for app rollover, admin reset, balance-adjustment reversal, reconciliation review, confirmed corporate-action split, broker history/account refresh, Closed History Sync, backup import, same-workspace cloud replacement and authenticated workspace switching. This caller inventory is based on repository symbol searches at the reviewed feature head; any later wiring must update this matrix and add caller-level coverage.

## Recorded-time collision regression — 2026-11-17

The import regression suite now pins the deterministic tie behavior when distinct journal events share a recordedAt millisecond. mergePortfolioTransactionEvents uses stable sorting: the already-committed local sequence is retained first, followed by same-time incoming events in their supplied order. Re-importing the same rows remains idempotent and produces the same replay.

This is a deterministic merge rule, **not proof of real cross-device chronology**. recordedAt collisions do not contain enough information to establish which independent device committed first; the merge must not infer a missing order from event IDs or business effectiveAt. Any reconciliation decision that depends on the relative order of colliding events remains review-required until stronger source ordering evidence is available. Authenticated multi-device recovery remains a separate manual gate under [#554](https://github.com/armave/portfolio-terminal/issues/554).
