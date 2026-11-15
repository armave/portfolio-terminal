# Compact financial summary and guest card — 2026-11-15

## Scope

This is a presentation-only refinement of the existing administrator margin desk and guest Balance view. It does not change financial formulas, persisted data, quote sources, synchronization, account permissions, or Worker APIs.

## Administrator presentation

- The financial summary visually prioritizes market valuation, then shares/position targets and invested basis, then debt and carrying costs.
- The existing account or allocated-position Margin Health card remains intact and appears before secondary scenario and analysis tools.
- User-defined PT and net return at target are presented separately from the external analyst consensus.
- The break-even calculation remains portfolio-wide. Its label now states **Portfolio carry break-even** (BE), including while a single ticker is selected.
- The Combined Portfolio header suppresses the selected ticker's analyst consensus; the ticker-specific analyst target is explicitly labelled when a ticker view is active.
- Quote freshness, provider metadata, financing costs, margin-risk assumptions and disclosures remain available.

## Guest presentation

- The existing **MY STOCKS** heading is visible.
- The Balance navigation badge is unchanged. No additional assigned-portfolio market-value header or summary metric is introduced.
- Holding cards retain current market value, day move, quote metadata, shares, share price, average entry and unrealized P/L.
- A single holding is centered and width-limited on desktop; multiple holdings retain a responsive grid.
- Tranche details are collapsed by default and expand through a native disclosure control.

## Responsive and localization notes

- The three administrator summary groups collapse to two columns and then one column at narrow container widths.
- Existing focus, touch-target and reduced-motion behavior remains in place.
- New visible copy is added to the Russian translation map; English remains the source language.

## Validation

The associated PR tracks focused Vitest coverage for target-return labels, break-even scope, risk/tools ordering, guest card centering, collapsed tranche detail and Russian localization. Full CI and browser validation remain release checks.

## Follow-up from the original UI/UX Stage 3 PR

The original Stage 3 implementation was delivered in [PR #301](https://github.com/armave/portfolio-terminal/pull/301). Its implementation and automated responsive checks passed, but its plan left before/after visual captures outstanding.

PR #482 extends that work with a reproducible before/after visual-review artifact. CI builds the exact PR base and captures the same deterministic administrator Combined Portfolio, administrator ticker, and guest Balance journeys as the PR head, at mobile (390x844), tablet (768x1024), and desktop (1440x900) sizes. The artifact groups matching filenames under `before/` and `after/`.

The screenshots use synthetic mocked account/broker data from the production-browser smoke fixture. They are not evidence of live TradeNet or production account behavior. Human visual sign-off remains a manual pre-merge step.

## Administrator header implementation

The administrator board now has a distinct decision-KPI strip directly below the board title:

- **Combined Portfolio:** net return at targets, portfolio-wide carry break-even, account equity, margin debt (with daily carry), and margin-risk status.
- **Single ticker:** portfolio-wide carry break-even, allocated equity, allocated margin debt (with daily carry), and margin-risk status. Ticker PT and net target return remain in the board title and are not repeated in the KPI strip.
- Supporting market valuation, invested basis, commissions, accrued margin interest, ticker quote provenance and volume remain in the detailed three-group summary below the KPI strip.

The Account Equity Health gauge and Market Tools are now siblings in one responsive row from 768px upward. They stack vertically below 768px. The same production-browser smoke checks both Combined and ticker header metric sets and verifies the row geometry at 390px, 768px, and 1440px.

