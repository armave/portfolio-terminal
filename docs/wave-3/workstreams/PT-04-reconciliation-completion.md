# Wave 3 PT-04 — Full broker reconciliation and reviewed discrepancy workflows

**Tracking issue:** #332  
**Merged foundation:** PR #358  
**Dedicated branch:** feat/wave3-pt04-reconciliation-completion  
**Target:** dev client/domain PR; Worker-only changes follow the direct-to-main policy.

## Objective

Extend the merged read-only position-quantity comparison into a reproducible comparison of broker facts and app-owned accounting events. The user must understand why the broker and app differ, what evidence supports a discrepancy and what requires review.

## Scope

- Match normalized broker executions to PT-02 transaction/event records using stable provider IDs and documented fallback keys.
- Detect duplicate, missing, reordered, partially filled, reversed/corrected and timing-shifted executions without double-counting.
- Compare cashflows, dividends, commissions, margin-interest allocations and relevant fees where source contracts support value and currency.
- Compare price/freshness and timestamp differences using PT-07 provider observation and receipt metadata.
- Classify differences as timing, missing transaction, duplicate, fee/currency, price/freshness, unsupported broker data or unresolved.
- Provide drill-down evidence with source, observation time, receipt time, amount/quantity, currency, provider ID and matching confidence.
- Produce resolution proposals. Any writeback to app-owned financial state requires explicit user review and an auditable PT-02 command/event; no silent auto-correction.
- Preserve last-known-good broker records when refreshes fail or return incomplete data.

## Boundaries

- Consume the completed PT-02 transaction/journal/correction semantics and PT-03 broker-adapter contracts; do not redefine either.
- Consume PT-07 source/freshness and historical FX contracts; do not call provider APIs from the comparison engine.
- Keep reconciliation deterministic and read-only by default.
- Do not infer a missing fee as zero or coerce currency/amounts without evidence.
- The recently removed portfolio-desk reconciliation card must not be reintroduced as a large status panel. The Device Check in Settings remains separate. This stream owns reconciliation logic and a compact, task-focused discrepancy workflow only when it materially helps resolve a real difference.

## Acceptance criteria

- Duplicate and reordered events cannot produce duplicate transactions or false missing-record findings.
- Each discrepancy is reproducible from a stable input snapshot and includes its matching evidence.
- Partial/stale/unavailable snapshots suppress absence-based conclusions and remain visibly qualified.
- Every resolution that changes portfolio-owned data requires explicit confirmation and records an audit-linked event.
- App-owned lots/cost basis remain independent of broker aggregate position quantities.
- No position, trade, cashflow, fee or balance is mutated during a comparison.

## Required tests and QA

Vitest known-answer fixtures for exact-ID match, fallback match, duplicates, partial fills, reordered/out-of-order events, reversals, fee mismatch, cashflow mismatch, currency mismatch, stale/missing observation timestamps, incomplete history and retry behavior. Test explicit correction authorization and audit event. English/Russian discrepancy copy tests. Browser journey for viewing a discrepancy and declining/confirming a proposed action. Authenticated live TradeNet verification is a separate manual gate.

## Branch ownership

Own reconciliation matching, discrepancy taxonomy and review workflow only. Do not edit PT-02 event schema, PT-07 provider normalization or PT-05 authorization model without coordinating the contract owner.
