# Combined Margin workspace UX contract

The Combined Margin workspace presents current portfolio condition before hypothetical analysis.

## Portfolio Health Center

The administrator Combined workspace includes a compact Portfolio Health Center above the portfolio metrics. It reports TradeNet private account-stream readiness, quote freshness across tracked Margin and cash holdings, provider-confirmed REST execution-history refresh time, and encrypted cloud workspace status as separate source signals. A cached history snapshot is not presented as a provider-confirmed refresh; a live account stream requires validated portfolio and orders events; missing or stale quote evidence remains qualified.

The Review broker activity action opens the existing read-only reconciliation section in Trades. It does not resolve findings, write financial state or add a second reconciliation owner. See Portfolio Health Center UX for the source contracts.

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

Risk & financing remains visible. Performance history is collapsible in Combined and its preference is stored as an allowlisted device preference in the active account storage scope, outside financial portfolio state and cloud accounting. Projections and Market research remain visible in the workspace; Market Insights mounts for the active workspace so its News tab and ticker-scoped research are available without a disclosure action.

All new user-facing text is localized in English and Russian. The implementation does not change existing margin formulas, accounting semantics, permissions, broker API behavior or canonical PortfolioState.positions.


## Company news quantity

The Market Insights News tab defaults to showing 3 articles. Users can select a visible count from 3 through 10. This is a presentation-only limit applied to the loaded response; it does not change provider requests, cached data, or refresh behavior.
