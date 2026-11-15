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

- **Combined Portfolio:** the board title shows only the portfolio name and position count; net return at targets appears once in the KPI strip, alongside portfolio-wide carry break-even, account equity, margin debt (with daily carry), and margin-risk status.
- **Single ticker:** one bordered, three-part header combines the symbol, share-count and daily-change pills with **Margin PT + net return at PT** and the separate **Analyst (Yahoo) target + upside**. The KPI strip contains portfolio-wide carry break-even, allocated equity, allocated margin debt (with daily carry), and margin-risk status.
- Supporting market valuation, invested basis, commissions, accrued margin interest, ticker quote provenance and volume remain in the detailed three-group summary below the KPI strip.

The Account Equity Health gauge and Market Tools are now siblings in one responsive row from 768px upward. They stack vertically below 768px. The same production-browser smoke checks both Combined and ticker header metric sets and verifies the row geometry at 390px, 768px, and 1440px.

## Market actions panel refinement

The visible **Market Tools** heading has been removed from the Account Equity Health / tools row. The panel retains a localized accessible name, while its scenario and research action buttons are horizontally centered within the panel. Browser smoke verifies the heading is absent, at least three action buttons are present and centered, and the row keeps its desktop/tablet side-by-side and mobile stacked behavior.

## Standardized role-aware workspace navigation

Existing destinations now share one icon, label, sizing and active-state system. Administrators retain Margin (Combined/ticker), Balance, Trades and Settings. Guests retain Balance, assigned Lots history and Settings only. Market status and KV sync remain separate status elements in a shared header status group. The 44px touch target, keyboard tab order, selected-state semantics, role permissions, ticker rail behavior and Balance equity badge are preserved.

On phones, fixed navigation destinations compact to icon-first controls with accessible names; ticker tabs retain their ticker labels. The administrator target is explicitly labelled **Margin PT** in the Margin ticker header. Guest Stocks does not expose PT or any margin target.

## Unified target-information subheader

The admin Margin ticker identity is the first segment inside the same bordered subheader as target information. It shows the ticker, a share-count pill, and the daily percentage move when quote data is available. Margin PT and net return at PT occupy the second segment; Yahoo analyst target and upside occupy the third. Desktop and tablet use one continuous, vertically divided three-column panel. On mobile the identity, Margin PT, and Analyst (Yahoo) segments stack into three rows with horizontal dividers. Combined Portfolio keeps its standalone title and has no per-ticker target section.

Guest Stocks keeps its ticker and daily-change row above a divided Current Market Value / Analyst (Yahoo) section; it never receives Margin PT, the margin target return, or margin-only data. Guest analyst consensus is loaded from the existing Yahoo deep-data transport for assigned stock tickers and its upside is calculated against the current share price.
