# Wave 3 PT-04 — Full broker reconciliation and reviewed discrepancy workflows

**Tracking issue:** [#688 — PT-04 transaction-level broker reconciliation and discrepancy review](https://github.com/armave/portfolio-terminal/issues/688) (replacement for deleted tracker #567).
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


## Linked balance-adjustment reversals in cashflow reconciliation — 2026-11-23

PT-02 supports a narrow, immutable reversal for app-authored `cash.adjustment` events: the correction event references the original event and records inverse cash/debt deltas. The transaction-level matcher previously considered the original adjustment as an ordinary app cashflow but ignored its linked `correction` event. When broker history exposed both the original and reversal—or only a netted representation—this could produce a false matched cashflow or an absence claim against one side.

The matcher now detects non-broker-authored `correction` events linked to an app-authored `cash.adjustment`. It keeps the original and all linked corrections visible as one provisional `cashflow_unclassified` evidence item, excludes every event in that group from ordinary matching, and suppresses app/broker cashflow absence claims for the affected history. The app cashflow count includes the excluded original and correction records so source counts remain explicit. It does not infer that the broker has a corresponding row, calculate an effective net movement, validate an accounting write, or apply a correction.

The behavior is deterministic under reversed app-event and broker-row input order. Regressions cover an inverse correction and a linked correction whose amount is inconsistent; both remain provisional and cannot generate a false missing-record conclusion. English/Russian UI copy is covered. This remains read-only; no PT-02 schema, canonical portfolio snapshot, cash/debt balance, fee, cost basis or P&L value is modified.


## Ambiguous margin-adjustment labels remain unclassified — 2026-11-23

Both the broker audit-event importer and PT-04 cashflow matcher previously used any label containing `margin` as evidence of `margin.interest`. A provider row explicitly labelled `Margin Adjustment` does not establish that the amount is an interest charge, nor does it specify a signed change to margin debt. Treating it as interest could create a false cashflow match and incorrect fee/interest attribution.

The importer and reconciliation matcher now detect explicit margin-adjustment labels before the broad margin-interest rule and leave those rows unclassified. The importer creates no typed journal event for the row; the normalized source cashflow remains available in the history sidecar so PT-04 can show a provisional `cashflow_unclassified` finding and suppress absence-based conclusions. Ordinary `Margin Fee` and `Margin Interest` labels retain their current `margin.interest` handling.

No debt delta, interest amount, sign or accounting category is inferred. No PT-02 event, canonical position, cash/debt balance, fee allocation or P&L value is changed.


## Margin-interest classification requires an explicit label — 2026-11-23

The audit importer and PT-04 matcher no longer interpret a bare provider label containing `margin` as proof of interest. Only explicit interest/financing/borrow-fee wording or a `Margin Fee` label is classified as `margin.interest`. Margin-only labels such as `Margin Call` and `Margin Charge` remain in the source history and are surfaced as provisional unclassified cashflow evidence; the importer does not create a typed journal event for them.

This rule preserves existing `Margin Fee` and `Margin Interest` behavior while avoiding false interest matches against maintenance calls, debt movements or other margin-account activities. No signed debt movement or interest amount is inferred. Cash/debt, fee allocations, PT-02 events, canonical positions and P&L are unchanged.


## Cashflow matches require known currencies on both sides — 2026-11-23

The transaction-level cashflow matcher previously allowed a candidate when either the broker or app currency was absent, as long as type, absolute amount and time were compatible. A missing currency is not evidence that two amounts share a denomination. All same-currency paths (exact match, direction discrepancy, type discrepancy and amount discrepancy) now require both currency codes to be present and equal after normalization. Known unequal currencies remain a currency-mismatch finding without FX conversion.

Rows with a missing broker currency remain in the normalized source count but are excluded from pairing; app events with a missing currency are likewise unmatchable. The report is provisional and both directions of absence claims are suppressed for incomplete currency evidence. A focused warning and Russian translation make the broker-side limitation visible. This is read-only and does not change a cashflow amount, currency, balance, fee allocation or P&L.


## Cashflow matches require a verifiable broker timestamp — 2026-11-23

A normalized broker cashflow without a usable date was previously assigned a zero time delta by substituting the app event's timestamp. That made a timestamp-free broker row eligible for exact, direction, classification, amount or currency pairing based on the app time. The matcher now excludes such broker rows from all candidate paths unless the broker timestamp is present. The row remains in the normalized source count, the report is provisional, and both directions of absence-based conclusions are suppressed. An explicit English/Russian warning explains why the row was not paired.

This is distinct from date-only observations: a parseable provider date remains usable for the existing timing window. No date is synthesized, and no cashflow, balance or accounting value is changed.


## Broker source-row count semantics — 2026-11-23

The reconciliation headline counts now report the number of broker execution and cashflow rows supplied to the comparison, before normalization, classification, duplicate suppression or conflict exclusion. Unclassifiable and malformed rows therefore remain represented in the source counts while their provisional findings explain why they were not eligible for matching. Repeated rows with the same provider ID remain visible in the count and produce duplicate/conflicting-revision findings. The matched counts continue to count only usable records successfully paired by the deterministic matcher. No source row is converted to a financial value, and no portfolio state is changed.


## Read-only discrepancy review and resolution proposals — implementation slice

Every supported broker activity finding carries a localized `Suggested review` note and a distinct `Resolution proposal (read-only)` in the discrepancy card. The proposal states the evidence gate and safe next step for duplicates, conflicting revisions, ambiguous matches, missing/unclassified source rows, execution quantity/price/fee/currency/timing differences, and cashflow identity/direction/amount/currency/type differences.

These are decision aids, not executable corrections. They never select a source record, alter confidence, create or modify a journal event, change a position/lot/balance/fee/cost basis/P&L, or call a financial store mutation. Missing or ambiguous evidence remains provisional. A human may proceed only through a separately supported, explicit PT-02 command after source identity, data completeness and operation semantics are verified; the proposal itself performs no writeback.

The existing `Review item` control remains a separate audit-only note. Recording a review note does not resolve the finding and does not authorize writeback. English/Russian translation parity is tested for all supported activity finding types. Live provider verification and any future writeback contract remain separate acceptance gates.
