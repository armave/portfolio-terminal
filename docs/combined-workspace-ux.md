# Combined Margin workspace UX contract

The Combined Margin workspace presents current portfolio condition before hypothetical analysis.

## Headline and scenarios

The headline KPI order is account equity, Margin position market value, gross unrealized P&L, margin debt and margin risk. Net return at targets and the post-sale balance-floor horizon remain in Scenario outlook. Gross unrealized P&L is not net of commissions, financing, taxes or future sale costs.

## Position comparison

Portfolio positions compares ticker, shares, average entry, last price, market value, gross unrealized P&L, return, Margin weight and target price. Ticker, market value, gross P&L, return and Margin weight can be sorted. Selecting a ticker navigates to its existing Margin page.

Margin weight is calculated only when every displayed open position has a usable market value. It is the share of tracked Margin-position market value, not total account holdings or broker buying power. Missing quotes or incomplete open-lot cost basis remain unavailable, not zero. Desktop/tablet uses a keyboard-scrollable table with a sticky ticker column; mobile uses labelled position cards.

## Risk data quality

The Combined page shows Current, Provisional estimate, Incomplete or Unavailable status, affected Margin quote tickers, stale/delayed/unknown quote counts and a direct Balance destination when cash holdings are unpriced. Existing Margin Risk Overview assumptions and source attribution remain authoritative; configured collateral is not presented as broker-confirmed.

## Research context

Market Insights has a separate research ticker selector in Combined view. It uses the existing selectedTicker preference and does not change the active Combined desk. Company research remains ticker-scoped; AI Portfolio Review remains portfolio-wide.

## Progressive disclosure

Risk & financing remains visible. Performance, Projections and Market research are collapsible in Combined. First-use state is collapsed; the choices persist as allowlisted device preferences in the active account storage scope, outside financial portfolio state and cloud accounting. Heavy Performance and Market research panels mount only after first expansion. Single-ticker projection and research behavior remains expanded and unchanged.

All new user-facing text is localized in English and Russian. The implementation does not change existing margin formulas, accounting semantics, permissions, broker API behavior or canonical PortfolioState.positions.
