# PT-02 next-stage plan — journal parity, financial reversals and recovery

**Prepared:** 2026-11-09  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Existing charter:** [Wave 3 PT-02](../wave-3/workstreams/PT-02-transaction-integrity-completion.md)  
**Implementation target:** `dev` for client/domain; Worker/Durable Object changes remain direct-to-`main`.  
**Status:** Partial implementation delivered in slices 2 and 3; broader PT-02 acceptance remains open.

## Audit baseline

The additive transaction journal and local idempotency foundation are already merged. PR #382 also closed an important cloud-write retry gap: the client reuses the same body, `If-Match` revision and `Idempotency-Key` for a bounded retry, while the Durable Object stores bounded idempotency receipts atomically with encrypted records. Cloud journal restoration/parity fixtures are present.

This work must not reimplement those mechanisms or claim that all financial paths are replayable. The journal remains additive; `PortfolioState.positions` remains the canonical active-position state.

## Remaining risks to close

1. **Mutation coverage and audit semantics:** prove which supported actions produce complete events, with correct actor/source, effective/recorded time, currency, fees and signed deltas. Explicitly classify unsupported paths rather than silently omitting them.
2. **Financial reversals and corrections:** a history-row deletion or tranche tracking correction is not a financial reversal. Define confirmed reversal/correction commands that offset or supersede an original event without erasing its audit history.
3. **Corporate-action accounting:** provider evidence is not itself a posting. Define supported split/merger/spin-off/cash-in-lieu semantics and explicit reversal behavior before changing canonical quantities or cost basis.
4. **Replay and parity:** add a deterministic shadow verifier for the subset whose events contain sufficient information. Report unsupported/incomplete events as such; do not infer missing inputs or cut over the canonical store.
5. **Recovery and concurrency:** expand backup/import/reset/reload and multi-tab/cloud conflict tests. Keep server receipt idempotency distinct from application-level replay and financial-command idempotency.

## Delivered implementation in this PR

- [x] Add `PortfolioStore.reverseBalanceAdjustment` for explicit reversals of `cash.adjustment` and `margin.adjustment` events. It appends a linked `correction` event and never deletes or edits the original event.
- [x] Make balance reversals idempotent by original event and reason; a second reversal or conflicting reason is rejected.
- [x] Refuse unsupported trade/lot/closed-history/corporate-action reversals. Refuse a reversal when a later cash/debt movement means the inverse would create a negative free-cash or margin-debt balance.
- [x] Add `inspectPortfolioTransactionJournalReplayCoverage` to separate replayable app-owned deltas, evidence-only broker/import records, audit-only history corrections, incomplete events and unsupported/malformed schemas.
- [x] Add Vitest cases for cash/debt reversal, linked immutable correction history, duplicate retries, conflicting reasons, insufficient remaining cash, unsupported trade reversal, journal coverage classification and atomic persistence-failure rollback.
- [x] Make cash-holding buy/sell/adjustment events explicitly incomplete in stock-lot replay; the replay no longer reports complete while silently skipping cash-cushion lot activity. Cash-holding cost-basis replay remains unsupported until an explicit lot contract is implemented.

**Important scope limitation:** these reversals intentionally cover balance-only adjustments. They do not reverse stock buys/sells, acquisition lots, realized P&L, closed-trade records, tranche tracking edits or corporate actions. Those operations need richer event/cost-basis contracts and separate review before they can be safely reversed. The coverage report is scoped to the existing replay projection (position quantity, cash-holding quantity, free cash and margin debt); it does not claim to reconstruct cost basis, lot identity, realized P&L or realized charges.

## Implementation plan

### A. Complete the mutation inventory
- [x] Map each quantity, cash, debt, fee, realized-P&L and financial-history mutation to its store command, journal event or explicit incomplete/unsupported boundary.
- [ ] Cover user, AI-confirmed, import and broker-driven actions with explicit actor/source metadata.
- [x] Define typed evidence contracts for broker-imported deposits, withdrawals, transfers, dividends, fees/commissions, margin interest and corporate-action/cash-in-lieu descriptions; they remain evidence-only and do not post a second cash/debt/position delta.
- [x] Keep imported broker activity as source evidence until a reviewed command deliberately posts an app-owned financial mutation.
- [x] Document unsupported or not-yet-reconstructable paths, including direct closed-history fee recalculation, generic import attribution, manual external-cashflow posting and incomplete corporate-action lot replay.

### B. Add explicit correction/reversal semantics
- [x] Define immutable correction/reversal event relationships for cash/debt balance adjustments, with validation rules.
- [x] Require the original event reference, reason, actor and effective timestamp for balance-adjustment reversals.
- [x] Make balance-adjustment reversal commands idempotent and reject conflicting key reuse.
- [x] Prove supported cash/debt reversals restore the prior balances in hand-calculated fixtures.
- [x] Keep original and superseding events visible in history.
- [ ] Extend correction semantics to trades, acquisition lots, realized P&L and corporate actions only after exact inverse accounting is modeled.

### C. Verify journal-to-state parity
- [x] Add a read-only replay-coverage inspector for positions, cash-holding quantities, free cash, margin debt and realized margin charges; cost basis and closed-trade replay remain separate projections.
- [x] Classify app-owned state deltas, external broker/import evidence, audit-only history changes, incomplete events and unsupported/malformed schemas.
- [x] Add shadow replay and parity for stable acquisition lots, FIFO sale allocations, remaining buy fees, linked closed history and recorded realized P&L.
- [x] Extend shadow replay to app-recorded cash-holding acquisition lots, exact FIFO sales, realized P&L and remaining-lot parity. Broker-only averages and unpriced legacy additions remain unmapped.
- [x] Extend replay/parity to cumulative realized margin charges recorded by app-owned rollover events. Capitalized interest records an explicit zero realized-charge delta; legacy margin-interest events without the delta remain incomplete rather than inferring treatment.
- [ ] Extend replay to supported corporate-action lot adjustments; split quantity parity does not yet prove full acquisition-lot/cost-basis replay.
- [x] Add deterministic restore checks for export/import, encrypted cloud restore, reset and legacy snapshots.
- [ ] Keep canonical-state migration out of scope; any cutover requires a separate approved design, migration and rollback.

### D. Verify concurrency and retry boundaries
- [ ] Exercise same-tab, cross-tab and multi-device retries with stale/current revisions.
- [ ] Verify that an acknowledged server receipt is not mistaken for current state after a later revision supersedes it.
- [ ] Ensure a conflict preserves local work and provides a recoverable user path.
- [ ] Reuse the existing Worker receipt protocol; only propose a Worker change if a demonstrated gap remains, and deploy it separately to `main`.

## File ownership

Primary client/domain ownership:
- `src/types/portfolioTransaction.ts`
- `src/domain/portfolioTransactionJournal.ts`
- `src/store/portfolioStore.ts` and focused store tests
- `src/services/backupImport.ts`, cloud restore/retry services and their tests, only where a direct dependency is demonstrated
- `docs/wave-3/workstreams/PT-02-transaction-integrity-completion.md`

Avoid changing broker position normalization, margin formulas, reconciliation UI, provider ingestion or tenant authorization in this stream.

### Exact-head validation — implementation slice 2

**Implementation code head:** `a38a25c805cf39ca97ad2eb3a186e45d0d22533b` (PR base `1044727bf3055303ed94a134ee3b8fbb758f12b3`).

- [x] [Pull Request CI #42561609030](https://github.com/armave/portfolio-terminal/actions/runs/42561306230) — TypeScript, all 2,054 Vitest tests (161 files), production build/bundle budget, dead-code validation and full/production dependency audits passed.
- [x] [Operations Browser Journey #42561608991](https://github.com/armave/portfolio-terminal/actions/runs/42561306240) — 2,053 tests, production build, browser journey, dead-code validation and dependency audits passed.
- [x] [Trade Lifecycle Browser Smoke #42561608981](https://github.com/armave/portfolio-terminal/actions/runs/42561306491) — 151 focused tests and production browser lifecycle journey passed.
- [x] No Worker code or Worker deployment was changed by this client/domain slice.

No user-facing copy was added, so no localization catalog changes were needed. Authenticated live broker behavior and actual multi-device reversal workflows remain separate QA for the broader PT-02 acceptance scope.

## Required validation

- [x] Vitest fixtures for balance-adjustment reversal, coverage classification, event append and existing replay/parity paths.
- [x] Cash-holding lifecycle fixtures for multiple priced acquisitions, FIFO partial sale across lots, realized P&L, remaining-lot parity, unpriced additions, legacy broker averages and tracking-only removals.
- [x] Complete the source-reviewed mutation-path inventory; unresolved financial history and import paths are explicitly listed as incomplete/unsupported rather than treated as audited.
- [x] Characterize Closed History Sync fee enrichment, stable sale linkage and idempotent fee recalculation in focused Vitest coverage.
- [ ] Add immutable closed-history fee-allocation corrections only after source cashflow IDs and before/after P&L semantics can be replayed exactly.
- [ ] Buy → add → partial sale → full close → reversal lifecycle with fees, margin interest and debt-first settlement. Trade/lot reversal remains deliberately unsupported in this PR.
- [x] Classify broker-imported deposits/withdrawals/transfers, dividends, commissions, margin interest and corporate-action/cash-in-lieu as source evidence without duplicate local posting.
- [ ] Add app-owned external cashflow posting commands only after settlement, source, currency and correction semantics are separately specified.
- [x] Distinguish realized from capitalized rollover interest in journal replay, verify `realizedMarginCharged` parity, reconcile direct snapshot changes as explicit deltas, and reset the replayed charge total on a portfolio reset.
- [ ] Duplicate replay, same-key/different-body conflict, stale-revision retry, superseded acknowledgement and cross-tab conflict.
- [x] Backup/export/import, cloud restore, reset and legacy snapshot compatibility.

  Restore-path regression evidence:
  - `src/domain/portfolio.test.ts` preserves transaction events and linked closed-trade accounting through backup export/import, rejects malformed journal arrays and accepts legacy snapshots without journal fields.
  - `src/services/api.test.ts` round-trips the append-only journal through encrypted cloud snapshot restoration and verifies journal-to-snapshot parity.
  - `src/store/portfolioStore.test.ts` verifies older backup/cloud imports merge with local events, legacy imports cannot erase an existing journal, conflicting event IDs reject atomically, and reset retains the journal after reload.
  - `src/services/backupImport.test.ts` verifies malformed imports are rejected before replacement and failed persistence restores the previous snapshot.
- [x] `npm run typecheck`, `npm test`, `npm run validate:dead-code`, full dependency audits and `npm run build` on exact PR head `d30daead9ba818d633236bc4fdd59bb6d1ed0e49`.
- [ ] Update English/Russian strings and translation parity tests for any newly visible states.
- [x] Trade Lifecycle and Operations Browser Journeys pass on exact PR head `d30daead9ba818d633236bc4fdd59bb6d1ed0e49`.
- [ ] Authenticated live broker and actual multi-device QA are recorded separately; mocked fixtures do not satisfy these gates.

### Source-reviewed mutation ownership and explicit gaps — 2026-11-12

| Command or path | Journal/source treatment | Boundaries that remain |
|---|---|---|
| `buyStock` / compatibility `addTranche` | Atomic `trade.buy`; default actor `user`, source `manual`; stable lot ID, acquisition date, quantity, price, fees and settlement deltas | AI/import callers must pass an explicit transaction context; no broker execution is implied |
| `sellStock` / `sellMarginPosition` | Atomic `trade.sell`; manual path defaults to user/manual, confirmed AI path defaults to `ai`/`ai-confirmed`; FIFO allocations, fees, financing, settlement and linked closed-trade row are retained | Trade/lot reversal is unsupported until exact inverse cost basis, fees, financing and realized P&L are defined |
| `setFreeCash`, `setCashBalance`, `setMarginDebt` | Atomic `cash.adjustment` / `margin.adjustment`; default actor user and manual adjustment source | These are balance adjustments, not evidence of an external deposit, withdrawal or broker transfer |
| `applyRollover` | Atomic `margin.interest`; default actor system/source rollover; debt delta plus explicit `realizedMarginChargeDelta` (zero when capitalized) | Legacy events lacking that delta remain incomplete for realized-charge replay |
| `removeTranche` / `removeCashStock` | `position.adjustment` / `cash-holding.adjustment`; user tracking corrections | No sale proceeds, cash settlement, fee or realized P&L is inferred |
| `addCashHolding` / `addCashStock`; `sellCashHolding` | `cash-holding.buy` / `cash-holding.sell`; app-priced acquisitions retain lot identity and date; supported sales retain FIFO allocations and realized P&L | Unpriced additions and broker-only holdings remain unmapped/incomplete; partial lot coverage does not invent cost basis |
| `deleteClosedTrade` | `history.correction`; audit-only history cleanup | It does not reverse the underlying position, cash, debt or realized P&L |
| `reverseBalanceAdjustment` / `recordReconciliationReview` | Linked immutable `correction` for supported cash/debt adjustments; audit-only `portfolio.reconciliation` review event | Trade, lot, closed-history accounting and corporate-action reversal are unsupported |
| `applyCorporateActionSplit` / `recordCorporateActionEvidence` | Sourced corporate-action sidecar; an applied split also appends an idempotent `corporate-action` event with the position quantity delta | Review-required attempts do not mutate positions; split lot/cost-basis replay, cash-in-lieu, dividends, mergers and spin-offs are not fully posted/replayed |
| Broker history import | Stable-reference `broker.execution` and typed external cashflow evidence with actor broker/source attribution | Broker rows remain evidence-only; they are not posted again to local positions, cash or debt |
| Backup/cloud/import and generic direct snapshot patches | Validated append-only journal merge; observed supported position, cash-holding, free-cash, debt and realized-charge differences become system `portfolio.reconciliation` deltas | Generic snapshot import uses system/canonical-snapshot-reconciliation attribution rather than an `import` actor; no arbitrary imported execution is posted |
| Closed History Sync fee enrichment | Recalculates broker/app margin-fee allocations and updates `closedTrades` through the history sidecar | This closed-history fee/P&L rewrite has no dedicated immutable transaction correction event yet; it remains incomplete for full closed-history replay |
| `resetToBlankState` | `portfolio.reset`; clears portfolio-owned values while retaining the append-only journal | Reset is not an event-history truncation or canonical-ledger migration |

The application-owned aliases `addTranche` and `addCashStock` delegate to their journaled canonical commands. Quote, target-price, navigation, provider-credential and display-state updates are not financial transaction events. The source-reviewed command inventory does not authorize a general manual cashflow-posting API, a generic import actor contract, a silent broker writeback, or a canonical-ledger cutover.

### Closed-history fee-enrichment characterization — 2026-11-12

The source-reviewed `syncAdminClosedHistory` pipeline merges broker cashflow and execution sidecars, calculates financing-fee allocations, then updates the app-owned `closedTrades` snapshot independently from the transaction journal. This is historical fee/P&L metadata enrichment: it does not post cash, margin debt or position quantity.

The exact allocation boundary matters:

- `calculateFreedomMarginFeeAllocations` allocates financing cashflows to broker sell executions whenever broker execution rows are present. Its app-closed-trade allocation branch is used only when the broker execution collection is empty.
- The broker-execution path retains per-cashflow IDs in `brokerAllocations`. The app-closed-trade path currently returns only an aggregate amount per trade index; it discards the individual cashflow IDs and allocated amounts needed to source a future immutable event.
- `applyCashflowAllocationsToClosedTrades` removes the prior margin-fee component before applying the current aggregate. It uses `marginInterest || marginFee` as the previous fee, derives the commission base from `feesAndCommissions - previousMargin` when that aggregate exists (otherwise legacy commission aliases), and updates `feesAndCommissions`, `totalCommissions`, `marginInterest`, `marginFee` and known `netProfit` / `netRealizedGain`. Unknown net P&L remains unknown.
- App-generated closed-trade rows carry `id` and `transactionEventId`, which provide the stable history-row identity and link to the immutable `trade.sell` event. Legacy/unlinked rows cannot be assigned a sale event by ticker/date/quantity inference.
- Reapplying the same amount is a no-op; changed or removed source allocations are a replacement of the previous fee basis, not an additional fee posting.

The focused regression now verifies that fee recalculation preserves the closed-trade ID, originating sale-event link and unrelated metadata, and that repeating the same allocation retains object identity.

**Requirements before journaling this correction:** preserve each app allocation as a cashflow reference plus allocated amount; record the target closed-trade ID and `relatedEventId` to the originating sale; capture prior and resulting margin fee, aggregate fee and known net-P&L fields; and have shadow replay validate the recorded prior values before applying the replacement. Rows without stable links or known prior values must remain explicitly incomplete. This slice adds no correction event and does not claim closed-history replay parity.

## Exit criteria and merge gate

- [x] Every reviewed financial mutation path is journaled with its supported semantics or explicitly listed as incomplete/unsupported; do not imply unsupported paths are replay-complete.
- [x] Supported balance-adjustment reversals are immutable, reviewable, idempotent and balance-verified.
- [x] Replay coverage is explicit for the current quantity/cash/debt projection and fails closed on malformed/unknown events.
- [x] Replay of app-recorded cash-holding acquisition cost basis, FIFO sales, realized P&L and remaining-lot parity is covered by the follow-on cash-holding slice.
- [ ] Trade/lot/corporate-action reversals and full margin closed-history corrections remain open; realized margin charges outside recorded sale allocations now have an additive replay delta.
- Existing positions-as-canonical compatibility and cloud receipt behavior remain intact.
- No canonical-ledger cutover or new financial write path is enabled by this work alone.


## Implementation slice 3 — lot-aware trade journal and shadow parity

**Branch:** `feat/pt02-lot-aware-trade-journal-2026-11-09`  
**Target:** `dev`; client/domain only. No Worker or Cloudflare changes.

- [x] Preserve stable acquisition-lot IDs on new position tranches and their matching `trade.buy` events.
- [x] Persist the exact source acquisition date on new buy events; older stable-lot events without this new field remain readable but are marked incomplete for date parity.
- [x] Persist exact FIFO lot slices on `trade.sell` events, including quantity, acquisition price/date, allocated buy commission, sell commission, financing cost and realized-P&L contribution.
- [x] Validate stable sale slices for unique lot identity, positive amounts, sale-price consistency, exact quantity, gross proceeds, fees, financing and realized P&L totals.
- [x] Link each new closed-trade row to the immutable sale event that produced it, for both manual and AI-confirmed/terminal sales.
- [x] Add a read-only `replayPortfolioTransactionLots` projection and `verifyPortfolioTransactionLotParity` checker for stable margin-position lots and linked closed-sale history. `PortfolioState.positions` and `closedTrades` remain canonical.
- [x] Classify legacy lots without IDs, legacy sale events without allocations, unlinked legacy closed trades and quantity-changing paths without exact lot slices as incomplete. Do not synthesize lot IDs or infer acquisition cost basis.
- [x] Keep trade/lot reversals, tranche corrections, and corporate-action accounting outside this slice; unsupported corrections are not replayed as if they were safe.
- [x] Add Vitest fixtures for multi-buy FIFO sale spanning two lots, partial remainder, final close, commission and realized-P&L parity, malformed sale allocations, unknown lot references, duplicate lot IDs, legacy-unmapped allocations and unsupported quantity corrections.
- [x] Extend the production browser journey to assert stable lot IDs, a sale across two FIFO lots, exact remaining quantity, and closed-trade/event linkage; retain the previously merged PR #409 audit-review persistence journey.
- [ ] Complete authenticated live TradeNet validation, backup/cloud restore review and multi-device concurrency QA separately.

**Safety boundary:** this is a shadow replay and auditability improvement, not a canonical-ledger cutover. Legacy/mixed histories remain explicitly incomplete. Exact reversal of stock trades, fee/financing corrections and corporate actions requires a separately accepted accounting contract.

### Exact-head validation — implementation slice 3

**PR:** [#410 — lot-aware trade journal and shadow parity](https://github.com/armave/portfolio-terminal/pull/410)  
**Final tested head:** `5a1c714b8584a31838b402bd55cacd85d702840a`

- [x] [Pull Request CI #42584548202](https://github.com/armave/portfolio-terminal/actions/runs/42584548202) — typecheck, all 2,100 Vitest tests (164 files), production build and bundle budget (420,529 bytes / 128,998 bytes gzip), production browser smoke, desktop/mobile performance baseline, dead-code validation and full/production dependency audits passed.
- [x] [Operations Browser Journey #42584548162](https://github.com/armave/portfolio-terminal/actions/runs/42584548162) — unit/Worker tests, production account/Settings browser journey, dead-code validation and dependency audits passed.
- [x] [Trade Lifecycle Browser Smoke #42584548184](https://github.com/armave/portfolio-terminal/actions/runs/42584548184) — typecheck, focused trade-lifecycle tests, production build and Chromium journey passed, including stable lot identity, a six-share FIFO sale across two lots, remaining-lot and closed-trade/event linkage assertions, reload and PR #409 review-note persistence.
- [x] Manual source review of the new replay path: stable lot references, duplicate IDs, acquisition chronology, exact FIFO order, legacy-unmapped history, malformed/unsupported quantity changes and canonical open/closed parity fail closed without synthetic cost basis.
- [x] Add regression coverage rejecting a sale that skips an older open lot; preserve `incomplete` (not `unsupported`) classification when the referenced lot is absent from available history.
- [x] Confirm branch is based on current `dev` with zero commits behind; no Worker/Cloudflare code or deployment changed.

**Separate operational gates, not certified by mocked CI:** authenticated live TradeNet validation, backup/export/import and encrypted cloud restore rehearsal, and real cross-device concurrency/stale-revision QA remain open for broader PT-02 acceptance. This PR does not claim those gates are complete.


## Backup restore hardening — closed-history row validation — 2026-11-09

- [x] Validate every entry in a present `closedTrades` backup array as an object before normalization.
- [x] Reject mixed valid/invalid history arrays rather than silently filtering malformed rows and committing a partial restore.
- [x] Add a regression at the backup-import commit boundary proving malformed closed-history data is rejected before live state replacement or persistence.
- [x] Keep the change limited to backup validation: no transaction-event schema, canonical portfolio ownership, financial calculation, or localization key changes.
- [ ] Run exact-head typecheck, full Vitest, build/bundle, dead-code and dependency audits plus browser journeys.


### Cash-holding acquisition lots and FIFO replay — implementation slice 4

**Branch:** `feat/pt02-cash-holding-lot-accounting`  
**Target:** `dev`; client/domain only. No Worker or Cloudflare changes.

- [x] Add an optional, additive `CashStockLot` array to cash holdings; existing snapshots without the field remain valid.
- [x] Create stable acquisition lots only for app-recorded manual cash-holding additions with an explicit positive entry price and exact event date.
- [x] Keep unpriced additions as quantity-only events; do not infer cost from a quote.
- [x] Preserve app lots through Freedom portfolio classification and prefer a complete app-owned lot set over a broker-derived average price. If app lots cover only part of the holding, clear the aggregate average price rather than blend cost sources.
- [x] Extend event validation and replay coverage to cash-holding buy events with stable lot metadata and cash-holding sale events with exact stable FIFO allocations.
- [x] Reuse the existing FIFO sale allocator for cash-holding sales; persist sold lot slices, allocated buy/sell commissions, zero financing cost, realized P&L and remaining lots atomically with the sale.
- [x] Extend shadow replay and optional canonical parity to cash-holding open lots and sale outcomes.
- [x] Keep broker-only average prices, legacy/unpriced buys, imported quantity changes and tracking-only removals explicitly incomplete. No synthetic lot IDs or cost basis are created.
- [x] Add Vitest coverage for weighted average price, FIFO partial sale across multiple lots, realized P&L, event coverage, remaining lots after reload, Freedom refresh preservation and legacy broker-average safety.
- [x] Preserve existing cash/debt settlement and no-cash-settlement behavior for manual acquisition additions. No canonical-ledger cutover or broker writeback.

**Accounting boundaries:** manual cash-holding additions still do not debit free cash and do not claim a broker execution. The app records zero buy-side commission for this manual tracking command because it does not charge one. Cash-holding removals remain tracking corrections, not sales. Unpriced/broker-only holdings remain saleable for proceeds and debt-first cash settlement, but their sale events do not contain realized P&L or lot allocations unless the full app-recorded lot set covers the holding. Margin trade, cash-lot reversal and corporate-action reversal semantics remain separate open work.

**Manual validation still required:** authenticated Freedom/TradeNet activity comparison, backup/export/import and encrypted restore, and real multi-device concurrency. Automated fixtures do not certify live broker or cross-device behavior.

