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

**Important scope limitation:** these reversals intentionally cover balance-only adjustments. They do not reverse stock buys/sells, acquisition lots, realized P&L, closed-trade records, tranche tracking edits or corporate actions. Those operations need richer event/cost-basis contracts and separate review before they can be safely reversed. The coverage report is scoped to the existing replay projection (position quantity, cash-holding quantity, free cash and margin debt); it does not claim to reconstruct cost basis, lot identity, realized P&L or realized charges.

## Implementation plan

### A. Complete the mutation inventory
- [ ] Map every quantity, cash, debt, fee, realized-P&L and financial-history mutation to its store command and journal event.
- [ ] Cover user, AI-confirmed, import and broker-driven actions with explicit actor/source metadata.
- [ ] Add event contracts for supported deposits, withdrawals, transfers, dividends, fees, financing adjustments and corporate-action postings.
- [ ] Keep imported broker activity as source evidence until a reviewed command deliberately posts an app-owned financial mutation.
- [ ] Document unsupported or not-yet-reconstructable paths.

### B. Add explicit correction/reversal semantics
- [x] Define immutable correction/reversal event relationships for cash/debt balance adjustments, with validation rules.
- [x] Require the original event reference, reason, actor and effective timestamp for balance-adjustment reversals.
- [x] Make balance-adjustment reversal commands idempotent and reject conflicting key reuse.
- [x] Prove supported cash/debt reversals restore the prior balances in hand-calculated fixtures.
- [x] Keep original and superseding events visible in history.
- [ ] Extend correction semantics to trades, acquisition lots, realized P&L and corporate actions only after exact inverse accounting is modeled.

### C. Verify journal-to-state parity
- [x] Add a read-only replay-coverage inspector for the existing positions/cash-holdings/free-cash/margin-debt projection.
- [x] Classify app-owned state deltas, external broker/import evidence, audit-only history changes, incomplete events and unsupported/malformed schemas.
- [x] Add shadow replay and parity for stable acquisition lots, FIFO sale allocations, remaining buy fees, linked closed history and recorded realized P&L.
- [ ] Extend the replay contract to cash-holding acquisition lots, realized charges outside recorded sale allocations and supported corporate-action lot adjustments.
- [ ] Add deterministic restore checks for export/import, encrypted cloud restore, reset and legacy snapshots.
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
- [ ] Complete the remaining mutation inventory and add any missing event/replay fixtures discovered by that review.
- [ ] Buy → add → partial sale → full close → reversal lifecycle with fees, margin interest and debt-first settlement. Trade/lot reversal remains deliberately unsupported in this PR.
- [ ] Deposits/withdrawals/transfers, dividends, commissions, financing, corporate actions and corrections.
- [ ] Duplicate replay, same-key/different-body conflict, stale-revision retry, superseded acknowledgement and cross-tab conflict.
- [ ] Backup/export/import, cloud restore, reset and legacy snapshot compatibility.
- [x] `npm run typecheck`, `npm test`, `npm run validate:dead-code`, full dependency audits and `npm run build` on exact PR head `d30daead9ba818d633236bc4fdd59bb6d1ed0e49`.
- [ ] Update English/Russian strings and translation parity tests for any newly visible states.
- [x] Trade Lifecycle and Operations Browser Journeys pass on exact PR head `d30daead9ba818d633236bc4fdd59bb6d1ed0e49`.
- [ ] Authenticated live broker and actual multi-device QA are recorded separately; mocked fixtures do not satisfy these gates.

## Exit criteria and merge gate

- [ ] Every supported financial mutation is either journaled with complete semantics or explicitly listed as unsupported.
- [x] Supported balance-adjustment reversals are immutable, reviewable, idempotent and balance-verified.
- [x] Replay coverage is explicit for the current quantity/cash/debt projection and fails closed on malformed/unknown events.
- [ ] Trade/lot/corporate-action reversals and replay of cost basis, closed history, realized P&L and realized charges remain open.
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
