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

The quote action uses TradeNet's `getStockQuotesJson` command with a `tickers` array (a one-element array for a single-symbol request). For the API-key v2 route, the command is in the URL (`/api/getStockQuotesJson`), and the JSON body contains only the command parameters (for example, `{"tickers":["GOOGL.US"]}`), not the legacy `{cmd, params}` envelope. The Worker signs the exact serialized body followed by the current Unix timestamp, as described by the [TradeNet API-key documentation](https://tradernet.global/tradernet-api/auth-api?site_lang=en). TradeNet returns quote records in the `q` array (for example, `{"q":[{"c":"GOOGL.US","ltp":279.84}]}`). The response normalizer unwraps this envelope, including when nested under `data`, and reads `ltp` (last price), `pp` (previous close), `chg` (absolute change), and `pcp` (percent change). See the [TradeNet quote API documentation](https://fbis.tradernet.ae/tradernet-api/quotes-get?site_lang=en).

Symbols without an explicit exchange suffix are mapped to `.US`; symbols already containing a dot are passed through. Review this mapping for non-US instruments before relying on it.

## Validation status and limitations

The Worker regression test verifies the API-key v2 request URL, parameter-only JSON body, and HMAC signature; the frontend unit test covers the documented quote fields. The Worker deployment workflow also watches the shared TradeNet adapter file so changes to the imported signing/request helper are deployed. A successful response against the configured, authorized Freedom Broker Armenia account is still required to validate account entitlement and live symbol coverage. If Freedom quote retrieval fails, Yahoo remains a concurrent quote source and Finnhub/Twelve Data remain the fallback path. If Freedom news is unavailable or returns no recognized stories, the existing Finnhub news path is used.

The target-price, analyst-consensus, detailed fundamentals, and earnings-estimate integrations are intentionally unchanged; this change does not claim those fields are available through Tradernet.


## Market depth

The modal is available from a selected margin-position page and Balance holdings. The Worker authenticates the TradeNet Socket.IO session with the existing `FREEDOM_PUBLIC_KEY` and `FREEDOM_PRIVATE_KEY` using the API-key `getAuthInfo` challenge described in TradeNet's official SDK example. The private key and signature stay server-side. Demo or unverified account modes are rejected before order-book data is returned.

The app requests a fresh snapshot when the modal opens or the user presses Refresh. It displays the first full order-book frame, with bids and asks sorted best-price first. No order placement, cancellation, or other trading command is exposed. This is a snapshot, not a permanently connected streaming widget.


## Market-depth diagnostics

The read-only `freedom-market-depth` response now includes a `diagnostics` object on success and failure. It records whether the production WebSocket opened, whether the `orderBook` subscription was sent, whether a matching `b` snapshot confirmed it, the initial `userData` production/demo status, received event names, observed order-book tickers, close code, and elapsed time. Cloudflare Worker logs emit the same structured diagnostics. Raw packets, SID values, and account/login identifiers are never included. It also subscribes to read-only quotes for the same ticker and records `q` events. If quotes arrive but no `b` event does, the ticker is recognized and the remaining issue is specific to market depth (for example feed availability or account entitlement). If neither arrives, investigate ticker recognition or upstream subscription handling.

The production WebSocket uses the documented `[event, data]` protocol at `wss://wss.tradernet.com/`. TradeNet's Node.js client sends `["orderBook", [ticker]]` and listens for event `b`; its order-book payload identifies the instrument with `i`. See the [TradeNet WebSocket documentation](https://rc.tradernet.com/tradernet-api/websocket?site_lang=en) and the [official Tradernet WebSocket client](https://github.com/tradernet-api/tn-ws-nodejs).
