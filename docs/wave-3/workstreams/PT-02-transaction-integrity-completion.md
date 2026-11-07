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

## Downstream gates

- PT-04 may derive matching and discrepancy evidence from existing PT-02 events, but any correction must wait for accepted PT-02 correction/audit semantics.
- PT-05 may build tenant directory/read authorization in parallel, but must not enable independent tenant financial writes until PT-02 acceptance and PT-16 security/key review pass.
- PT-06 consumes only the accepted external-flow and transaction contract; it must not reinterpret raw broker events independently.
