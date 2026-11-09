# PT-02 next-stage plan — journal parity, financial reversals and recovery

**Prepared:** 2026-11-09  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Existing charter:** [Wave 3 PT-02](../wave-3/workstreams/PT-02-transaction-integrity-completion.md)  
**Implementation target:** `dev` for client/domain; Worker/Durable Object changes remain direct-to-`main`.  
**Status:** Partial implementation delivered in this PR; broader PT-02 acceptance remains open.

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
- [x] Add Vitest cases for cash/debt reversal, linked immutable correction history, duplicate retries, conflicting reasons, insufficient remaining cash, unsupported trade reversal and journal coverage classification.

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
- [ ] Extend comparisons to canonical closed history, cost basis, lot identity, realized P&L and realized charges; these are not covered by the current replay projection.
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

**Client PR head:** `d30daead9ba818d633236bc4fdd59bb6d1ed0e49` (base `1044727bf3055303ed94a134ee3b8fbb758f12b3`).

- [x] [Pull Request CI #42560729066](https://github.com/armave/portfolio-terminal/actions/runs/42560729066) — TypeScript, all 2,053 Vitest tests (161 files), production build/bundle budget, dead-code validation and full/production dependency audits passed.
- [x] [Operations Browser Journey #42560729069](https://github.com/armave/portfolio-terminal/actions/runs/42560729069) — 2,053 tests, production build, browser journey, dead-code validation and dependency audits passed.
- [x] [Trade Lifecycle Browser Smoke #42560729274](https://github.com/armave/portfolio-terminal/actions/runs/42560729274) — 151 focused tests and production browser lifecycle journey passed.
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
