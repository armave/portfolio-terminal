# Compare Exits UX contract

Compare Exits is a read-only two-period scenario calculator. It estimates the result of closing the selected open position at two user-entered future dates and prices. It does not place a broker order or mutate portfolio/accounting state.

## Result hierarchy

The comparison presents, in order:

1. Projected Cash / Debt Balance.
2. Gross Proceeds.
3. Buy Commission.
4. Sell Commission.
5. Estimated Margin Interest.
6. Total Fee Friction.
7. Net P&L.

The total fee-friction value remains the same accounting aggregate used by the scenario engine. The displayed components expose its existing inputs: the allocated acquisition commission, the selected sale commission, and allocated accrued/projected margin interest. Do not recompute or replace the domain formula to build the display breakdown.

Cost basis remains required for FIFO sale accounting and net P&L. It is omitted only as a redundant comparison row because it is identical across both periods. It is not removed from internal calculations or the portfolio data model.

## Signed account balance interpretation

Projected Cash / Debt Balance is the projected signed account cash/debt amount after hypothetical net sale proceeds and modeled financing. It is not portfolio equity.

- A value below zero is remaining margin debt and must be visually labelled as such.
- A value above zero is available cash balance.
- Zero means neither residual cash nor margin debt.
- Missing or malformed values remain unavailable; they are never presented as zero.

## Exit dates and best-period criterion

Both period cards and result headings show the exact local calendar date and assumed exit price. Relative labels such as “Today” and “In 6 months” remain useful input context, but are not a substitute for the date.

The BEST NET P&L marker means the period with the higher modeled Net P&L after commissions and financing. It does not mean highest proceeds, highest cash balance, minimum debt, or a guaranteed best investment outcome.

## Reference-price provenance

The Use reference action prefers the position's current selected quote. The UI shows the quote source, the freshness classification, and the provider observation time when one exists. Client receipt time is not presented as market observation time. Missing observation time remains explicitly unknown; stale, delayed, indicative/unknown, and unavailable states are not promoted to fresh.

When no usable quote exists, average entry may be used only if the tracked acquisition lots pass the shared sale-cost-basis validator and their total quantity reconciles to every open share. Invalid, partial, excess, or otherwise unreconciled lot coverage leaves the reference price unavailable. No partial-lot average is inferred.

## Responsive presentation and saved estimates

Desktop/tablet widths use the semantic comparison table. Narrow/mobile widths use equivalent per-period cards to avoid horizontal scrolling while preserving every metric, exact date, assumed price, and the balance/debt explanation.

Previously saved version-1 comparison results are normalized for the updated row label/order and continue to be readable. Historical saved estimates that predate the fee breakdown remain unchanged as historical evidence; missing component rows are not backfilled with zero or guessed amounts. Such results are identified as older estimates without a fee breakdown.

All added interface copy is localized in English and Russian. Scenario calculations remain deterministic, read-only, and owned by the existing scenario/domain calculation path.
