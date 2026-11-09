# PT-02 next-stage plan — journal parity, financial reversals and recovery

**Prepared:** 2026-11-09  
**Tracking issue:** [#330](https://github.com/armave/portfolio-terminal/issues/330)  
**Existing charter:** [Wave 3 PT-02](../wave-3/workstreams/PT-02-transaction-integrity-completion.md)  
**Implementation target:** `dev` for client/domain; Worker/Durable Object changes remain direct-to-`main`.  
**Status:** Plan for implementation review; no application behavior changes in this plan PR.

## Audit baseline

The additive transaction journal and local idempotency foundation are already merged. PR #382 also closed an important cloud-write retry gap: the client reuses the same body, `If-Match` revision and `Idempotency-Key` for a bounded retry, while the Durable Object stores bounded idempotency receipts atomically with encrypted records. Cloud journal restoration/parity fixtures are present.

This work must not reimplement those mechanisms or claim that all financial paths are replayable. The journal remains additive; `PortfolioState.positions` remains the canonical active-position state.

## Remaining risks to close

1. **Mutation coverage and audit semantics:** prove which supported actions produce complete events, with correct actor/source, effective/recorded time, currency, fees and signed deltas. Explicitly classify unsupported paths rather than silently omitting them.
2. **Financial reversals and corrections:** a history-row deletion or tranche tracking correction is not a financial reversal. Define confirmed reversal/correction commands that offset or supersede an original event without erasing its audit history.
3. **Corporate-action accounting:** provider evidence is not itself a posting. Define supported split/merger/spin-off/cash-in-lieu semantics and explicit reversal behavior before changing canonical quantities or cost basis.
4. **Replay and parity:** add a deterministic shadow verifier for the subset whose events contain sufficient information. Report unsupported/incomplete events as such; do not infer missing inputs or cut over the canonical store.
5. **Recovery and concurrency:** expand backup/import/reset/reload and multi-tab/cloud conflict tests. Keep server receipt idempotency distinct from application-level replay and financial-command idempotency.

## Implementation plan

### A. Complete the mutation inventory
- [ ] Map every quantity, cash, debt, fee, realized-P&L and financial-history mutation to its store command and journal event.
- [ ] Cover user, AI-confirmed, import and broker-driven actions with explicit actor/source metadata.
- [ ] Add event contracts for supported deposits, withdrawals, transfers, dividends, fees, financing adjustments and corporate-action postings.
- [ ] Keep imported broker activity as source evidence until a reviewed command deliberately posts an app-owned financial mutation.
- [ ] Document unsupported or not-yet-reconstructable paths.

### B. Add explicit correction/reversal semantics
- [ ] Define immutable correction/reversal event relationships and validation rules.
- [ ] Require the original event reference, reason, actor and effective timestamp.
- [ ] Make correction commands idempotent and reject conflicting key reuse.
- [ ] Prove a reversal restores the expected position/cash/debt/fee/P&L state in hand-calculated fixtures.
- [ ] Keep original and superseding events visible in history.

### C. Verify journal-to-state parity
- [ ] Implement a read-only replay/verification path for fully supported event types.
- [ ] Compare replay output with canonical `positions`, cash, margin debt, cash holdings and closed history.
- [ ] Return explicit mismatch, incomplete and unsupported classifications with event references.
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

## Required validation

- [ ] Vitest fixtures for every supported mutation, event append, replay and parity path.
- [ ] Buy → add → partial sale → full close → reversal lifecycle with fees, margin interest and debt-first settlement.
- [ ] Deposits/withdrawals/transfers, dividends, commissions, financing, corporate actions and corrections.
- [ ] Duplicate replay, same-key/different-body conflict, stale-revision retry, superseded acknowledgement and cross-tab conflict.
- [ ] Backup/export/import, cloud restore, reset and legacy snapshot compatibility.
- [ ] `npm run typecheck`, `npm test`, `npm run validate:dead-code`, dependency audits and `npm run build` on the exact PR head.
- [ ] Update English/Russian strings and translation parity tests for any newly visible states.
- [ ] Trade Lifecycle and Operations Browser Journeys pass on the exact PR head.
- [ ] Authenticated live broker and actual multi-device QA are recorded separately; mocked fixtures do not satisfy these gates.

## Exit criteria and merge gate

- Every supported financial mutation is either journaled with complete semantics or explicitly listed as unsupported.
- Reversals/corrections are immutable, reviewable, idempotent and balance-verified.
- Replay/parity checks cover only the explicitly supported subset and fail closed on unknowns.
- Existing positions-as-canonical compatibility and cloud receipt behavior remain intact.
- No canonical-ledger cutover or new financial write path is enabled by this work alone.
