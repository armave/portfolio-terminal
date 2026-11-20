# Wave 3 PT-04 — Full broker reconciliation and reviewed discrepancy workflows

**Tracking issue:** [#567 — Complete transaction-level broker reconciliation and discrepancy review](https://github.com/armave/portfolio-terminal/issues/567)  
**Completed narrow prerequisite:** [#537 — Keep unclassified broker cashflows out of adjustment matching](https://github.com/armave/portfolio-terminal/issues/537) is closed and covers only unknown-category exclusion.  
**Merged foundation:** PR #358  
**Dedicated branch:** feat/wave3-pt04-reconciliation-completion  
**Target:** dev client/domain PR; Worker-only changes follow the direct-to-main policy.

## Objective

Extend the merged read-only position-quantity comparison into a reproducible comparison of broker facts and app-owned accounting events. The user must understand why the broker and app differ, what evidence supports a discrepancy and what requires review.

## Scope

- Match normalized broker executions to PT-02 transaction/event records using stable provider IDs and documented fallback keys. When multiple fallback candidates are equally strong, preserve the ambiguity as provisional evidence; do not use journal recording order as execution identity.
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

## Cashflow classification hardening

Issue [#537](https://github.com/armave/portfolio-terminal/issues/537) tracks a fail-closed normalization rule for broker cashflows:

- Explicit dividend, interest/financing, fee/commission/tax, transfer, withdrawal/debit, deposit/funding/credit and adjustment/correction labels retain their typed mappings.
- Unknown or provider-specific labels are not coerced to `cash.adjustment`. They become provisional `cashflow_unclassified` evidence and are excluded from matching.
- An unknown row cannot be counted as a matched app balance adjustment, even when its amount, currency and timestamp happen to align.
- The comparison remains read-only. No cash, debt, position, fee, cost-basis or journal state is changed.

This is a classification-safety fix only; it does not change provider payload contracts, sign conventions for recognized deposits/withdrawals, or accounting calculations.

## Branch ownership

Own reconciliation matching, discrepancy taxonomy and review workflow only. Do not edit PT-02 event schema, PT-07 provider normalization or PT-05 authorization model without coordinating the contract owner.


## Cashflow match ambiguity and time qualification — implemented on 2026-11-18

The read-only cashflow matcher now requires a unique closest app-authored candidate before it can count a broker cashflow as matched or attach a specific mismatch. Equally close candidates are reported as provisional `cashflow_match_ambiguous` evidence with all candidate event IDs sorted; no candidate is consumed and later broker rows cannot claim an event already implicated in an ambiguity. The result is invariant to app-event and broker-row input order.

Currency-mismatch comparisons now require a non-null app amount and a timestamp difference within the configured maximum matching window. A missing amount is never substituted with zero; app cashflow rows without an amount make the comparison provisional rather than confirmed absent. Equal values on distant dates are not paired as a currency discrepancy. No FX conversion, balance adjustment, fee posting or other portfolio mutation is performed.


## Deterministic execution assignment and incomplete evidence — implementation slice

The one-to-one execution matcher now builds its candidate graph before consuming records. Equally strong broker rows competing for one app transaction, as well as equally strong app transactions for one broker row, remain provisional and are excluded from missing-record claims. Exact provider execution references take precedence over fallback candidates. Stable ID ordering is used for duplicate-revision handling and candidate presentation; the matcher does not use input-array order or journal `recordedAt` as execution identity.

A broker execution without a source timestamp cannot use ticker/side/quantity alone as fallback identity. A stable exact execution reference can still identify the pair, but missing price, currency, commission or source-time values are surfaced as an `execution_data_incomplete` finding. Missing values are not compared as zero. The discrepancy view lists the specific missing evidence in English and Russian.

Execution-currency differences are reported only when the stable provider fill reference proves the two records are the same execution. Cross-currency fallback candidates are not paired, and numeric execution-price comparisons run only when both records have the same known currency; no FX conversion is attempted.

The matcher remains deterministic and read-only. Ambiguous rows are not counted as confirmed missing records, and no portfolio position, FIFO lot, cash, debt, fee, cost basis or P&L value is changed. Authenticated TradeNet and multi-device acceptance remain separate manual gates.


## Absence-based finding qualification — implemented on 2026-11-20

Transaction-level reconciliation now gates each absence conclusion against the history required to support it:

- An execution or cashflow absence is reported only when both the broker feed and app journal coverage for that activity type are complete and usable.
- Partial, stale, unavailable, unclassifiable, or conflicting evidence on either side suppresses both directions of absence-based conclusions for that activity type; directly observed matched-pair discrepancies remain available as provisional evidence.
- Missing identity/comparison fields and conflicting broker revisions also disable absence conclusions for the affected history. The report remains visibly provisional and explains that absence-based findings are suppressed.
- Directly observed matched-pair discrepancies, duplicates, unclassified rows and ambiguity evidence remain visible with provisional confidence where appropriate.
- The change is deterministic and read-only. It does not modify PT-02 events, canonical positions, FIFO lots, balances, fees, debt, cost basis or realized P&L.

Vitest regressions cover all four directional gates, malformed broker rows, incomplete app evidence and preservation of observed provisional mismatches. This is CI-verifiable behavior; authenticated live-provider verification remains a separate manual gate.
