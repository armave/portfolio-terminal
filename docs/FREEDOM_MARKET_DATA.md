# Freedom TradeNet market-data integration

## Scope

This integration adds read-only Freedom TradeNet quote, news, and daily-history proxy actions. Quotes are tried before Yahoo, with the existing Yahoo/Finnhub/Twelve Data fallback path preserved. Company news tries Freedom first and falls back to the existing Finnhub news endpoint. Existing fundamentals, earnings, and analyst-target sections are unchanged.

## Required Cloudflare Worker secrets

Configure these in the Worker environment (never in Vite/browser variables):

- `FREEDOM_PUBLIC_KEY`
- `FREEDOM_PRIVATE_KEY`
- `FREEDOM_LOGIN` and `FREEDOM_PASSWORD` (required only for the authenticated WebSocket diagnostic)

The Worker still requires the existing `GATEWAY_SECRET` for all app requests. After adding secrets, use the existing read-only `freedom-test` action to confirm TradeNet authentication.

## Authenticated WebSocket active-orders snapshots

The Worker exposes `?action=freedom-orders-stream` as an administrator-only, read-only active-orders snapshot action. It requires the Worker secrets `FREEDOM_LOGIN` and `FREEDOM_PASSWORD`, obtains a short-lived TradeNet SID, connects to `wss://wss.tradernet.com/` through Cloudflare's fetch-based WebSocket upgrade, and sends the read-only `orders` subscription. The SID is not persisted or returned. Once both `userData` and `orders` events arrive in a production session, the Worker returns the sanitized order list in the same envelope shape consumed by `normalizeFreedomActiveOrders`; the diagnostic metadata includes only the first ten rows with the order ID omitted. The app requests a fresh short-lived WebSocket snapshot on its existing active-order refresh cadence (currently 60 seconds), rather than keeping a permanent browser socket open. The REST `freedom-orders` action remains the fallback if login, handshake, or event delivery fails. This is a request-driven snapshot integration, not a continuous push stream. The allowlist contains order ID (for internal order identity), instrument, operation, type, limit price, original quantity, remaining quantity, and status; account identifiers, credentials, arbitrary payload fields, and the SID are never returned. The socket is closed after both events arrive or after an eight-second observation window. This endpoint does not restore Market Depth or expose order-placement commands.

## Additional authenticated event probes

The administrator-only `?action=freedom-event-stream&event=portfolio` and `event=markets` probes use the same short-lived production SID and WebSocket transport. They send the documented single-event subscriptions and wait for both `userData` and the requested event. The Worker returns a value-redacted schema sample: key names, record counts, primitive value types, and bounded nested shape descriptors (for example, `number`, `string`, `array`, `object`). All actual values are removed. Identity keys such as order/account IDs and login names are omitted from nested shape descriptors. It does not return account balances, holding quantities, tickers, market status values, session identifiers, credentials, or the SID. These probes are diagnostic only; they do not update portfolio state. The live payload schema must be confirmed before any additional event is applied to the app.

The tested `markets` event carries exchange-level status and schedule metadata; it is not a quote-price feed and does not replace `getStockQuotesJson` / `freedom-quote`. Keep per-symbol quote prices on the existing REST/provider path until a separate quote (`q`) WebSocket subscription has been tested and its symbol/price/timestamp contract verified.

## Portfolio WebSocket versus REST reconciliation

The administrator-only `?action=freedom-portfolio-snapshot` action obtains one authenticated production `portfolio` event, requires `loaded === true`, and returns only the same normalized USD account and position fields exposed by the existing `freedom-positions` REST action. Non-USD rows, broker IDs unrelated to the app's existing position contract, timestamps, session identifiers, credentials, and raw payload fields are omitted. The application now uses this authenticated WebSocket snapshot as the primary source for account balances and positions. The existing `freedom-positions` REST action (`getPositionJson`) is the automatic fallback when the socket is unavailable, times out, returns an incomplete/unloaded snapshot, or fails validation. Both sources pass through the same `normalizeFreedomPortfolio` contract. The admin Settings reconciliation check can still request both sources independently and compare field-level values with a 0.01 numeric tolerance; that comparison is read-only and never writes to the portfolio store or changes saved holdings.

## Read-only actions

- `freedom-trades` retrieves the full TradeNet execution history for FIFO matching when no local closed-trade cursor exists. On a warm cache, the Worker accepts only a validated `fromDate=YYYY-MM-DD` cursor and translates it to `getTradesHistory` `beginDate` at midnight, `endDate` at the current time, and `sort: 0`. The client merges the returned period into persisted executions so older opening buys remain available for FIFO matching. Without a cursor, the Worker requests `sort: 0` and omits `max`; the latest-first `sort: 1` mode defaults to 100 executions and can omit older opening buys.
- `freedom-cashflows` accepts the same validated `fromDate` cursor and translates it to the inclusive TradeNet `getUserCashFlows` filter `date eqormore YYYY-MM-DD`, sorted oldest-first. Cached cashflows are retained and merged with the returned period.
- The first sync after this incremental-sync rollout performs a one-time complete trades and cashflow baseline for each app account. Baseline markers are written only after the complete source rows have been persisted locally. This avoids treating a pre-feature partial cache as complete; subsequent refreshes use the latest closed-trade date.

- `freedom-quote`: requests a quote for one symbol.
- `freedom-news`: requests company news for one symbol.
- `freedom-history`: requests daily historical data for one symbol.

The browser cannot supply an arbitrary TradeNet command. The Worker chooses from a fixed allowlist and signs requests server-side. No order-placement command is exposed.

The quote action uses TradeNet's `getStockQuotesJson` command with a `tickers` array (a one-element array for a single-symbol request). For the API-key v2 route, the command is in the URL (`/api/getStockQuotesJson`), and the JSON body contains only the command parameters (for example, `{"tickers":["GOOGL.US"]}`), not the legacy `{cmd, params}` envelope. The Worker signs the exact serialized body followed by the current Unix timestamp, as described by the [TradeNet API-key documentation](https://tradernet.global/tradernet-api/auth-api?site_lang=en). TradeNet returns quote records in the `q` array (for example, `{"q":[{"c":"GOOGL.US","ltp":279.84}]}`). The response normalizer unwraps this envelope, including when nested under `data`, and reads `ltp` (last price), `pp` (previous close), `chg` (absolute change), and `pcp` (percent change). See the [TradeNet quote API documentation](https://fbis.tradernet.ae/tradernet-api/quotes-get?site_lang=en).

Symbols without an explicit exchange suffix are mapped to `.US`; symbols already containing a dot are passed through. Review this mapping for non-US instruments before relying on it.

## Validation status and limitations

The Worker regression test verifies the API-key v2 request URL, parameter-only JSON body, and HMAC signature; the frontend unit test covers the documented quote fields. The Worker deployment workflow also watches the shared TradeNet adapter file so changes to the imported signing/request helper are deployed. A successful response against the configured, authorized Freedom Broker Armenia account is still required to validate account entitlement and live symbol coverage. If Freedom quote retrieval fails, Yahoo remains a concurrent quote source and Finnhub/Twelve Data remain the fallback path. If Freedom news is unavailable or returns no recognized stories, the existing Finnhub news path is used.

The target-price, analyst-consensus, detailed fundamentals, and earnings-estimate integrations are intentionally unchanged; this change does not claim those fields are available through Tradernet.


## Balance snapshot synchronization

The Balance desk restores the last persisted portfolio snapshot immediately and keeps it visible while a fresh read-only `freedom-positions` request runs. The account request is always a full snapshot: it does not accept or send a date cursor, begin/end date, or other history filter. A successful TradeNet response is normalized and committed through the canonical portfolio store, which persists the account balance, classified holdings, broker snapshot and derived cash holdings locally and through the existing cloud-state sync path. Refresh failures mark the broker snapshot stale without clearing the last good values.

The Balance page does not wait for the separate execution-history request before rendering cached account holdings. It restores and merges the saved execution history with the current portfolio-store copy so the Active Tranches view does not lose older opening purchases if one source is incomplete. Background account/trade refresh activity is shown beside the Balance heading; a blocking loading view is used only when an administrator has no cached broker account snapshot yet. Guest Balance remains scoped to the guest portfolio projection and does not request account-wide broker data.
