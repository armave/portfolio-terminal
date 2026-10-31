# Freedom TradeNet market-data integration

## Scope

This integration adds read-only Freedom TradeNet quote, news, and daily-history proxy actions. Quotes are tried before Yahoo, with the existing Yahoo/Finnhub/Twelve Data fallback path preserved. Company news tries Freedom first and falls back to the existing Finnhub news endpoint. Existing fundamentals, earnings, and analyst-target sections are unchanged.

## Required Cloudflare Worker secrets

Configure these in the Worker environment (never in Vite/browser variables):

- `FREEDOM_PUBLIC_KEY`
- `FREEDOM_PRIVATE_KEY`

The Worker still requires the existing `GATEWAY_SECRET` for all app requests. After adding secrets, use the existing read-only `freedom-test` action to confirm TradeNet authentication.

## Read-only actions

- `freedom-quote`: requests a quote for one symbol.
- `freedom-news`: requests company news for one symbol.
- `freedom-history`: requests daily historical data for one symbol.
- `freedom-market-depth`: opens a read-only TradeNet WebSocket subscription and returns the first full order-book snapshot for one symbol.

The browser cannot supply an arbitrary TradeNet command. The Worker chooses from a fixed allowlist and signs requests server-side. No order-placement command is exposed.

Symbols without an explicit exchange suffix are mapped to `.US`; symbols already containing a dot are passed through. Review this mapping for non-US instruments before relying on it.

## Validation status and limitations

The adapter normalizes common quote field names and tolerates several response envelopes. TradeNet response schemas and parameter names may differ by API version/account. Before enabling this in production, validate the exact quote/news/history command parameters and response fields against an authorized Freedom Broker Armenia account. If the quote payload cannot be normalized or the API call fails, the terminal falls back to existing quote providers. If Freedom news is unavailable or returns no recognized stories, the existing Finnhub news path is used.

The target-price, analyst-consensus, detailed fundamentals, and earnings-estimate integrations are intentionally unchanged; this change does not claim those fields are available through Tradernet.


## Market depth

The modal is available from a selected margin-position page and Balance holdings. The Worker authenticates the TradeNet Socket.IO session with the existing `FREEDOM_PUBLIC_KEY` and `FREEDOM_PRIVATE_KEY` using the API-key `getAuthInfo` challenge described in TradeNet's official SDK example. The private key and signature stay server-side. Demo or unverified account modes are rejected before order-book data is returned.

The app requests a fresh snapshot when the modal opens or the user presses Refresh. It displays the first full order-book frame, with bids and asks sorted best-price first. No order placement, cancellation, or other trading command is exposed. This is a snapshot, not a permanently connected streaming widget.
