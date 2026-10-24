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

The browser cannot supply an arbitrary TradeNet command. The Worker chooses from a fixed allowlist and signs requests server-side. No order-placement command is exposed.

Symbols without an explicit exchange suffix are mapped to `.US`; symbols already containing a dot are passed through. Review this mapping for non-US instruments before relying on it.

## Validation status and limitations

The adapter normalizes common quote field names and tolerates several response envelopes. TradeNet response schemas and parameter names may differ by API version/account. Before enabling this in production, validate the exact quote/news/history command parameters and response fields against an authorized Freedom Broker Armenia account. If the quote payload cannot be normalized or the API call fails, the terminal falls back to existing quote providers. If Freedom news is unavailable or returns no recognized stories, the existing Finnhub news path is used.

The target-price, analyst-consensus, detailed fundamentals, and earnings-estimate integrations are intentionally unchanged; this change does not claim those fields are available through Tradernet.
