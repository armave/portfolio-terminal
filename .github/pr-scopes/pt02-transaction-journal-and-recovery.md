# PT-02 — Transaction journal and recovery

> **Status: draft scope charter only.** This file reserves the grouped PR scope before implementation. It is not implementation, test, or production evidence. Remove or replace it with the real implementation record before marking this PR ready or mergeable.

## Issues in this PR

- #507 — Complete transaction journal coverage, parity and recovery gates
- #554 — Rehearse authenticated backup, cloud restore and multi-device recovery

## Intended outcome

Complete the transaction-integrity and recovery acceptance as one coherent workstream. Preserve the existing canonical snapshot model and make recovery/replay behavior demonstrably safe rather than introducing a ledger cutover.

## Scope

1. Complete the mutation-path/event coverage inventory for positions, cash and cash holdings, free cash, debt, fees, realized P&L, closed history, and imports. Verify journal replay/parity and recovery outcomes for supported paths.
2. Extend deterministic regression/failure-injection coverage for duplicates, replay, partial/incomplete inputs, invalid revisions, interrupted persistence, and recovery while preserving last-known-good state.
3. Rehearse backup export/import, authenticated cloud restore, workspace/account switching, stale-revision conflict handling, and multi-device conflict/recovery in an isolated test workspace.
4. Verify snapshot, journal, closed-history, FIFO, cash, debt, and revision parity using sanitized evidence. Financial conflicts must not be silently merged or overwritten.

## Non-negotiable invariants

- `PortfolioState.positions` remains canonical; do not change financial formulas, rounding, or persisted accounting semantics in this scope.
- Missing, stale, malformed, partial, or unavailable financial values must not become zero or be treated as current.
- Preserve account scoping, revision checks, atomic persistence, admin/guest permissions, and last-known-good recovery.
- Use only isolated/non-sensitive test data for destructive restore/replacement rehearsals.

## Acceptance evidence required before ready

- Caller/mutation-path matrix linked to tests.
- Exact-head journal replay, financial regression, storage/recovery, and permission test results.
- Sanitized restore/recovery run record with revisions/checksums and explicit conflict outcomes.
- Any manual or physical multi-device step clearly marked complete or outstanding; mocks alone do not satisfy it.

## Out of scope

Ledger/snapshot replacement, automatic broker posting, inferred transaction events, or silent changes to FIFO, cash, debt, fees, cost basis, or P&L.
