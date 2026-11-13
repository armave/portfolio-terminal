# TradeNet account risk controls: implementation specification

## 1. Purpose

Complete the read-only Freedom TradeNet integration so broker-reported account margin, account limits, instrument trading limits, position metadata, and market-session data are first-class inputs to Portfolio Terminal risk and scenario calculations.

The primary product requirement is that broker constraints must affect the app's **Buy** and **Exit** scenario quantities. They must not be displayed as decorative account information while the calculator continues to propose quantities above broker capacity.

This is a read-only integration. It must not submit, amend, or cancel orders, transfer funds, or enable delegated-account trading.

## 2. Delivery boundaries

### App/client work in this PR (target: dev)

- Typed TradeNet transport and endpoint client support.
- Validated response contracts and normalization.
- Account margin and limit domain models.
- Buy/Exit scenario constraint engine and UI.
- Provider-driven market status/session data with a safe fallback.
- Position-sign and metadata preservation across client contracts.
- Localization, documentation, Vitest coverage, and regression safeguards.

### Worker/server work (deploy directly to main)

Per repository deployment policy, Cloudflare Worker and server-side changes are **not** to be merged through this PR. Track and deliver them as direct, reviewed commits to main, then validate the app PR against the deployed Worker contract.

Worker work includes response sanitization, endpoint proxy actions, provider event normalization, rate-limit/backoff behavior, and preserving the last known-good account snapshot. Keep server and client contract changes backward-compatible during rollout.

## 3. TradeNet API transport and endpoint coverage

Extend the existing read-only transport to cover:

- **getOPQ** — account summary, positions/cash, margin settings and account limits.
- **getTradingLimits** — instrument-level maximum buy/sell quantity.
- **getMarketStatus** — market status and published session schedule.
- Existing portfolio, executions/history, cash-flow, quote, news, HLOC, and order-notification reads.

Transport requirements:

1. Keep API-key credentials and all signing inside the Worker. Never expose the private key, account password, SID, or signature material to browser code, logs, analytics, or error messages.
2. Use the current API-key route convention, /api/{command}. Do not copy the legacy q={cmd,params} wrapper into the current API-key transport.
3. Support both HTTP methods with method-specific signing. Preserve the existing POST behavior (signature over the exact serialized JSON body plus timestamp). For GET, place documented parameters in the query string and sign the timestamp according to the current API-key documentation. Do not sign a reconstructed or differently serialized payload.
4. Send the documented X-NtApi-PublicKey, X-NtApi-Sig, and X-NtApi-Timestamp headers.
5. Validate command names against an explicit read-only allowlist. Do not add write commands.
6. Normalize transport errors into safe, typed failures: missing credentials, unauthorized, forbidden, rate-limited, timeout/network, malformed response, and provider error. Preserve HTTP status and a safe provider code where available; never echo secrets or full sensitive payloads.
7. Add command-aware retry/backoff for 429 and transient failures with bounded exponential delay and jitter. Do not blindly retry non-idempotent or write operations; this integration exposes reads only.
8. Keep request and response types independent of unverified response field names. A fixture captured from a real/sandbox account or a provider-supplied complete example is required before locking concrete getOPQ and getTradingLimits field mappings.

## 4. Response contracts and normalization

Treat external JSON as untrusted input. Parse into unknown, validate, and then normalize. Preserve the difference between:

- a reported numeric zero;
- a missing field;
- a null field;
- an invalid/non-finite number;
- a stale value;
- an unsupported value.

Never replace missing or malformed account quantities, balances, margin values, or limits with zero. Zero is a real broker value, not a fallback for “unknown”.

Create normalized, source-aware contracts for:

### Account summary (getOPQ)

Represent, when actually present in a verified fixture:

- account identity/type and base currency;
- cash and available funds by currency;
- equity/net liquidation value;
- initial and maintenance margin requirements;
- available margin / buying power;
- account-level trade limits and any provider-reported risk settings;
- provider observation time, local receipt time, freshness, and source provenance.

Every optional monetary value must be nullable/unknown rather than fabricated. Preserve original currency and avoid mixing amounts across currencies without a verified FX conversion path.

### Instrument trading limits (getTradingLimits)

Represent, when actually present in a verified fixture:

- instrument identity and broker instrument identifier;
- maximum buy quantity;
- maximum sell quantity;
- quantity unit/lot convention if supplied;
- currency, provider timestamp, and freshness;
- the raw provider reason/status for a limit where safe and useful.

Do not assume field names, whether quantities are shares or lots, or whether a limit is inclusive of existing positions until confirmed by documentation or a sanitized response fixture.

### Provenance and freshness

All normalized broker controls must carry their source and observation time. Use the repository's established freshness conventions where present. A missing timestamp must not be presented as freshly verified. UI must distinguish current, stale, unavailable, and malformed broker data.

## 5. Applying broker limits to Buy and Exit scenarios

This is the primary acceptance area.

### Buy scenario

The scenario engine must calculate an effective maximum buy quantity that cannot exceed any applicable constraint:

- broker account-level capacity from getOPQ (including available funds/margin only when its semantics are verified);
- broker instrument-level maximum buy quantity from getTradingLimits;
- local buying-power, concentration, risk, price, lot-size, and other existing app constraints.

Conceptually, the effective buy quantity is the lot-rounded minimum of all applicable verified caps. A broker constraint may reduce the local result but must never increase it. Convert account-level monetary capacity into quantity only with a valid price, currency/FX conversion, lot size, and commission assumptions; otherwise expose the unresolved constraint instead of guessing.

The scenario must show:
- requested/input quantity;
- app-computed local maximum;
- broker account-level capacity (where available);
- broker instrument-level buy capacity (where available);
- final effective maximum;
- which constraint is binding and why;
- provider source and freshness.

The calculator must prevent a proposed Buy quantity from exceeding the effective cap and explain the cap inline.

### Exit scenario

For a supported long position, the effective Exit quantity must not exceed:

- the actual verified sellable long position quantity;
- broker sell-side capacity for the instrument, when available and confirmed to apply to the requested close-out;
- any existing local scenario/risk constraint.

A full close-out must not be presented as executable if the verified broker sell capacity is lower than the held quantity. The user must see the maximum supported exit quantity and the remaining quantity that cannot currently be represented as sellable.

Do not interpret sell capacity as permission to create a short position. Do not allow a long Exit scenario to cross through zero into a short. If the account contains a short position, keep short exposure explicit and do not route it through the long Exit path; short opening/covering remains unsupported until separately specified and tested.

### Missing, stale, or contradictory limits

- Never silently treat unknown broker limits as unlimited.
- Never silently replace unknown limits with zero.
- Show an “unverified / unavailable” state and why the broker constraint could not be confirmed.
- Keep local theoretical capacity separate from broker-confirmed capacity.
- Apply the app's existing conservative/fail-closed scenario behavior where a broker limit is required but unavailable.
- When provider values conflict, retain each source, choose the safer effective cap, and surface the conflict for diagnostics.
- Limits are estimates, not reservations or guarantees of execution. Account for active orders, price movement, commissions, and the provider's stated semantics where available.

No scenario change may activate actual order placement. The existing readOnly=true and orderPlacement=false guarantees remain in force.

## 6. Margin-risk integration

Integrate verified broker-reported requirements into the existing margin-risk model instead of displaying them beside an unrelated estimate.

- Feed broker-reported initial and maintenance requirements into the existing BrokerReportedMarginRequirements contract.
- Use broker-reported eligible collateral / available margin only when the endpoint's semantics and currencies are verified.
- Prefer current, verified broker values over configured assumptions.
- Retain configured assumptions only as explicit fallback inputs with their existing provenance label; do not present defaults as live Freedom account settings.
- Keep missing broker values as null/unknown. Do not translate missing maintenance margin, collateral, or margin add-ons into zero.
- Preserve currency, observation time, data quality, and source.
- Ensure incomplete position data makes risk quality incomplete/provisional rather than producing a falsely healthy result.
- Avoid double-counting margin requirements already included in account-level broker totals.

The portfolio stream documentation identifies optional position fields go (margin requirement) and vm (variation margin for derivatives). Preserve and map these only according to verified provider semantics; do not sum them again if getOPQ already contains the same aggregate.

## 7. Position quantity sign and metadata integrity

The available implementation brief identifies pos[].q as the quantity field, but the evidence currently checked into this project does not verify that a negative q value alone establishes short direction. Do not convert this uncertainty into a long or short classification:

- Preserve the signed quantity exactly; never take its absolute value or coerce a negative value to zero.
- A negative q without an explicit, recognized side/direction value remains direction "unknown" and emits the negative-quantity sign diagnostic.
- A recognized explicit long/short side may be retained as side evidence, but unsupported short valuation, P&L, borrow, and margin treatment must remain explicit.
- Never feed unknown-direction or short exposure into long market value or long exposure.
- Do not infer long/short direction from t or k.
- Preserve documented metadata when present: instr_id, issue_nb, t, k, go, and vm, in addition to existing identifiers and prices.
- Distinguish a legitimate empty positions array from a missing/malformed positions array.

Server sanitizers must not convert missing or invalid q into zero. Reject malformed snapshots (or preserve the last known-good snapshot according to the established store contract) and emit a safe diagnostic. A valid empty positions array must still be accepted as an actual empty account snapshot.

## 8. Market status and session handling

Make provider market status and schedule data the primary source when present.

- Support getMarketStatus as a REST snapshot and retain the existing markets WebSocket event as an update source.
- Preserve market identity and documented fields such as n, n2, s, o, c, dt, plus provider server time t where provided.
- Normalize venue, status, open/close values, documented time offset, provider observation time, local receipt time, and source.
- Verify the units and semantics of o, c, and dt from fixtures before formatting or applying them. Do not assume a timestamp is epoch seconds, local time, or a particular timezone without evidence.
- Keep market-specific sessions separate where the provider exposes multiple venues. Do not pick a venue solely because it appears first in an event payload.
- Use provider schedule/status to drive pre-market, regular, after-hours, and closed display when those phases can be derived reliably.
- Retain the existing calendar/session implementation only as a clearly labeled fallback when provider status/schedule is absent or stale. Never let a hard-coded calendar silently override current provider data.
- Show source, last-updated time, and stale/unavailable state. Handle holidays, exceptional sessions, DST, and multiple venues without assuming a fixed US session schedule.
- Admin and guest views must consume the same normalized market-session service.

## 9. Worker, cache, and data reliability work (direct-to-main checklist)

Deliver the following server changes directly to main:

- Add bounded, read-only Worker proxy actions for getOPQ, getTradingLimits, and getMarketStatus.
- Extend the event/portfolio sanitizer allowlist to preserve validated margin and instrument metadata.
- Stop converting absent/invalid position quantity to zero.
- Validate account and positions envelope shapes before replacing cached snapshots.
- Preserve the last known-good snapshot on malformed payloads or transient provider errors.
- Keep legitimate empty portfolio snapshots valid.
- Preserve provider timestamps and distinguish event receive time from provider event time.
- Add per-command throttling/backoff for 429/transient failures and protect against request fan-out.
- Reconcile SID/session cache duration with the current authentication contract and rememberMe behavior; avoid assuming a short cache TTL is required or that a remembered SID is valid indefinitely.
- Keep logs scrubbed and account identifiers minimized.
- Maintain compatibility with existing Worker actions while the dev client branch is under review.

Record the deployed Worker contract/commit in this PR before marking endpoint integration complete.

## 10. UI, accessibility, and localization

- Surface account-reported margin, buying power, and limits in the existing account/margin area with explicit currency and source.
- In Buy and Exit scenario panels show both local theoretical and broker-constrained maxima, the binding constraint, freshness, and a concise reason.
- Distinguish zero, unknown, unavailable, stale, and malformed states.
- Ensure the display explains that a broker limit is a capacity estimate, not a reserved amount or promise of execution.
- Add clear short-position indication without misrepresenting the position as long.
- Update market status/session labels to show provider venue and last update where appropriate.
- Preserve responsive/mobile behavior and existing cross-device UI conventions.
- Add all strings to the existing localization system (at minimum English and Russian locales currently used by the app); no new hard-coded UI copy.
- Check accessible names, keyboard navigation, focus states, and non-color-only status indicators.

## 11. Tests and validation

Add or update Vitest coverage for:

### Transport and API contracts
- POST body serialization/signature remains byte-for-byte stable.
- GET query construction and timestamp-only signature follow current API-key documentation.
- Allowlisted commands only; no write methods.
- 401/403, 429, timeout, invalid JSON, partial payload, and transient failure behavior.
- Sanitized representative getOPQ, getTradingLimits, and getMarketStatus fixtures. Do not check in personal account identifiers or secrets.

### Domain and scenario rules
- Buy cap is the minimum applicable broker and local constraint.
- Account notional capacity converts to quantity only with valid price/currency/lot data.
- Per-instrument max buy binds correctly.
- Exit cannot exceed verified held long quantity or applicable broker sell capacity.
- Exit cannot cross through zero or create a short.
- Partial exit, full close-out, zero limit, missing limit, stale limit, and conflicting limit.
- Unknown remains distinct from zero.
- Local theoretical capacity cannot override a lower broker capacity.
- Short quantity remains signed and never inflates long exposure.
- Broker margin is authoritative when verified; configured assumptions remain visibly identified as fallbacks.
- No double counting of account and position margin fields.

### Market and resilience
- Provider status/schedule supersedes the calendar fallback.
- Fallback is clearly marked when provider data is missing/stale.
- Multiple venues, pre-market/regular/after-hours/closed, holidays, exceptional hours, and DST.
- Missing provider timestamps and malformed schedule values.
- Malformed portfolio snapshots do not erase last known-good state; valid empty snapshots do.
- Rate limits and transient errors do not cause request storms.

### App regression
- English and Russian i18n coverage for every new state.
- Mobile and desktop scenario behavior.
- Admin and guest market status parity.
- Read-only invariants remain enforced.
- Existing portfolio, trade history, cashflow, quote, news, and chart behavior remains intact.

Run the targeted Vitest suites and the full repository test suite. Record exact commands and results in the PR. Do not mark tests complete until they have actually run.

## 12. Acceptance criteria

This work is complete only when all are true:

1. A verified getOPQ response drives the broker account-summary/margin model without guessed fields or silent zero defaults.
2. A verified getTradingLimits response constrains instrument Buy and Exit scenario quantities.
3. The effective Buy quantity never exceeds the minimum applicable verified broker and local capacity.
4. The effective long Exit quantity never exceeds the verified position and applicable broker sell capacity, and cannot cross zero.
5. Unknown/stale limits are visible and never treated as unlimited or as a confirmed zero.
6. Broker margin requirements supersede local configured assumptions when verified; assumptions remain explicitly labeled otherwise.
7. Signed portfolio quantity is preserved; direction is classified only from verified sign semantics or an explicit recognized side field. Unknown-direction exposure is not treated as long, and unsupported short valuation/P&L is not fabricated.
8. Market-session status uses current provider data when available and labels calendar fallback.
9. Malformed snapshots cannot erase last known-good data.
10. Worker/server changes are deployed to main separately and their contract is documented here.
11. English/Russian localization is complete and responsive views remain usable.
12. Targeted and full Vitest suites pass; no regression in read-only guarantees.

## 13. Known evidence gaps (must be closed, not guessed)

The official endpoint catalogue confirms the purpose of `getOPQ` (account positions, cash, margin settings and limits) and `getTradingLimits` (maximum buy and sell quantity for an instrument). It warns that the returned trading limits are estimates, not reserved capacity. The material inspected so far does not establish the exact `getTradingLimits` request parameter names or concrete response keys, nor does it establish the units/currency for every `getOPQ` margin and buying-power value.

The existing authenticated portfolio fixture establishes the `q` quantity field but does not establish that a negative `q` alone proves a short. Preserve the signed value and keep direction unknown unless explicit recognized side evidence or a verified provider convention is available.

Before final field mapping, obtain a sanitized representative response or a complete authoritative schema for `getOPQ` and `getTradingLimits`. Redact account/login identifiers and credentials. Keep reported zero distinct from missing/null/malformed values. Do not infer shares-versus-lots, currencies, inclusive/exclusive semantics, or request parameter names.

For market schedules, the Worker now preserves `n`, `n2`, `s`, `o`, `c`, `dt` and event time `t`. Their exact timestamp/offset units remain unverified. The frontend therefore displays raw bounded schedule details and does not parse them into UTC or use them for countdown arithmetic until the field semantics are verified.

## 14. Implementation status (updated 2026-11-13)

### Implemented
- Pure broker Buy/Exit quantity-cap resolver and Vitest coverage for current/stale/unavailable/malformed/zero limits, local/account/instrument cap intersection, lot rounding, and long Exit no-cross-through-zero.
- Buy More and Exit calculator entry points accept optional normalized broker limits and fail closed when supplied limits are stale/unavailable/malformed. **Live broker limit hydration into the production panels remains outstanding** because the raw endpoint schemas are not verified.
- Position normalization preserves signed quantity and documented `instr_id`, `issue_nb`, `t`, `k`, `go`, and `vm`. A negative `q` without an explicit recognized side remains direction `unknown` with `negative_quantity_sign_unverified`; `t` and `k` are not direction fields.
- REST and persistent account-stream Worker sanitizers validate complete `acc`/`pos` snapshots, reject malformed quantities/tickers rather than changing them to zero, preserve documented metadata, retain last-known-good snapshots for invalid stream payloads, and accept legitimate empty arrays.
- Worker market selector preserves selected-market `n`, `n2`, `s`, `o`, `c`, `dt` and event time `t`; it returns `MIXED` if separate Nasdaq and NYSE states disagree instead of silently choosing one venue.
- Client market contract and badge preserve/display schedule fields and per-exchange states. A fresh provider phase is authoritative; the New York calendar is fallback only when provider status is missing, stale, or implausibly future-dated. Single-market countdown is suppressed for `MIXED` or a fresh provider/calendar disagreement.
- Schedule values are shown as received in the diagnostic tooltip. Their exact units/timezone semantics are not verified, so they are not parsed into UTC timestamps or used for countdown arithmetic.
- Russian localization covers implemented mixed-exchange, position-integrity, and broker-limit diagnostic states.

### Worker/server deployment (direct to main)
- Portfolio snapshot validation, market schedule propagation, and mixed-venue state are deployed on `main` commit `e43e19e7b7ec8b236d3be27cf7ccaf2c77b49978`.
- [Cloudflare Worker deployment](https://github.com/armave/portfolio-terminal/actions/runs/43415601965) passed dependency audit, Worker tests, and pinned Wrangler deployment.
- [Main Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/43415601669) and [main Operations Browser Journey](https://github.com/armave/portfolio-terminal/actions/runs/43415601603) also passed on that commit.

### Exact-head PR validation
- Current PR head `716c17c83dee8ebac4df57e69c6f18b9148990b2` passed TypeScript, full Vitest, production build, production browser smoke, desktop/mobile performance baseline, dead-code validation, full dependency audit, and production dependency audit: [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/43416213739).
- The same PR head passed typecheck, unit and Worker tests, production build, account/Settings browser journey, performance upload, dead-code validation, and both dependency audits: [Operations Browser Journey](https://github.com/armave/portfolio-terminal/actions/runs/43416213670).

### Outstanding — intentionally not marked complete
- Exact `getTradingLimits` request method/parameters and response fields remain outside this PR; no experimental probe or guessed parameter is shipped.
- Verified `getOPQ` response mapping for cash, currency, initial/maintenance margin, collateral, and account-level capacity.
- Store/UI hydration so live, verified broker account and instrument limits materially constrain Buy More and Exit scenario quantities. The cap policy is implemented, but live enforcement in production panels is not complete.
- Conversion of account-level notional capacity into quantity only after currency, price, lot and commission semantics are verified.
- Parsing `o`, `c`, and `dt` into precise exchange timestamps only after their units/timezone semantics are verified.
- Bounded 429/transient backoff, SID/rememberMe cache reconciliation, and authenticated live TradeNet account verification.

Keep the PR in draft until live, verified account/instrument limits drive Buy/Exit scenario quantities and the remaining acceptance criteria pass.

## 15. Reference material

- TradeNet asset-manager use case and endpoint catalogue: https://freedombroker.global/tradernet-api/use-case-assets-managers?site_lang=en
- Existing market-data integration notes: docs/FREEDOM_MARKET_DATA.md
- Existing margin model: src/domain/marginRisk.ts
- Existing Freedom transport: src/services/freedomTradeNet.ts
- Existing account normalization: src/services/freedomAccountContracts.ts
- Existing market-session fallback: src/services/marketSession.ts
- Existing Worker sanitizers and routing: worker.js, state-store.js


## 18. TradeNet API documentation review (2026-11-13)

This section separates facts stated in the public TradeNet documentation from contracts that still require an endpoint-specific fixture. References inspected:

- [API key authentication](https://tradernet.global/tradernet-api/auth-api?site_lang=en)
- [API FAQ (2026)](https://trade.tfos.com/tradernet-api/faq?site_lang=en)
- [Asset-manager use case (2026-11)](https://freedombroker.global/tradernet-api/use-case-assets-managers?site_lang=en)
- [getOPQ method page](https://tradernet.com/tradernet-api/auth-get-opq?site_lang=en)
- [getTradingLimits method page](https://tradernet.com/tradernet-api/get-trading-limits?site_lang=en)
- [Portfolio response schema](https://tradernet.com/tradernet-api/portfolio-get-changes?site_lang=en)
- [Securities directory](https://tradernet.com/tradernet-api/securities?site_lang=en)

### 18.1 API-key transport and signing

The API-key reference specifies:

- REST URL: `https://tradernet.com/api/{command}`, with the method name in the path.
- A public/private key pair; the private key is used locally for signing and is never transmitted.
- HMAC-SHA256 using the private key and a fresh Unix timestamp in seconds.
- POST/PUT: JSON parameters in the request body; signature input is the exact serialized JSON body concatenated with the timestamp.
- GET: parameters in the query string; signature input is the timestamp only.
- Required headers: `X-NtApi-PublicKey`, `X-NtApi-Sig`, and `X-NtApi-Timestamp`. The timestamp header must match the timestamp used to calculate the signature.
- Responses are JSON; the API-key reference describes an `error` response key for failures.

The current Worker helper `src/services/freedomTradeNet.ts` uses the documented command URL, POST JSON body, body-plus-timestamp HMAC-SHA256, and all three headers. Its generic API-key transport is therefore consistent with the published POST signing example. This does not prove that POST is the correct method for every individual command: the method-specific `getTradingLimits` page must determine that command's HTTP method and parameters.

The 2026 FAQ explicitly says API-key calls through `/api/v2` are deprecated and directs integrations to the current `/api/{command}` format. Do not replace the current Worker URL with the legacy V2 `{cmd, params}` envelope on the basis of old API V2 method pages.

### 18.2 Permissions, account addressing, and limits

The 2026 asset-manager guide states that `getOPQ`, `getPositionJson`, and `getTradingLimits` are available at every listed account-access level, including `view`. Trade permission is required for order-submission methods, not for these three read methods.

For a manager accessing a client's account, exactly one of `client_trader_systems_id` (alias `ctsi`), `client_auth_login`, or `client_user_id` is added to address that client. Without one of these, the request applies to the API-key owner's own account. The server checks the granted access on every request. These client-account selectors are not automatically required for the current user's own account.

The guide describes `getTradingLimits` as the maximum buy and maximum sell quantity for an instrument before placing an order. It explicitly warns that the values are estimates, do not reserve capacity, and must be considered alongside active orders, price movement and commissions. They must not be represented as execution guarantees.

The FAQ states that rate limits vary by team/key; HTTP 429 means the limit was exceeded and requests should be retried after a pause. The FAQ does not publish a universal requests-per-minute value. The securities-directory endpoint separately documents a 10-requests-per-minute limit; do not apply that number to every API method.

### 18.3 Portfolio field semantics documented by TradeNet

The public `getPositionJson` portfolio page defines the following fields. This is the documented portfolio schema; it is not a substitute for the separate `getOPQ` response contract.

| Field | Documented meaning | Integration implication |
|---|---|---|
| `acc[].curr` | Account currency | Preserve currency with every funds value. |
| `acc[].currval` | Account-currency exchange rate | Preserve separately; do not assume it is USD or an FX rate to a specific base without account context. |
| `acc[].s` | Available funds | Do not relabel as total cash, equity, net liquidation value, or margin buying power. |
| `pos[].acc_pos_id` | Unique open-position ID in Tradernet | Position identity, not instrument identity. |
| `pos[].i` | Open-position ticker | Human-facing ticker/position key. |
| `pos[].q` | Number of securities in the position | The page's example is positive; it does not define the meaning of a negative sign. Continue preserving signed values without inferring short direction from sign alone. |
| `pos[].curr` | Open-position currency | Keep position currency distinct from account currency. |
| `pos[].currval` | Account-currency exchange rate | Preserve separately from the position's native amount. |
| `pos[].fv` | Coefficient to calculate initial margin | Preserve as a coefficient; do not treat it as a monetary amount. |
| `pos[].go` | Initial margin per position | A documented per-position margin field; confirm units/currency and aggregation before using it in portfolio margin totals. |
| `pos[].vm` | Variable margin of a position | Preserve as a distinct margin field; do not conflate with initial margin or cash. |
| `pos[].mkt_price` | Open-position market value (documentation label) | Retain the provider field name and avoid assuming it is a per-share quote without validating sample behavior. |
| `pos[].market_value` | Asset value | Keep distinct from `mkt_price`. |

This documentation gives stronger semantics for the position-level `go` and `vm` fields than the earlier field inventory alone. The application already preserves those fields on normalized positions. Before using them in aggregate margin calculations, verify whether the values are native-currency or account-currency amounts and whether they duplicate figures already included in `getOPQ` totals.

The portfolio page is expressly an API V2 example. Reuse its documented response-field meanings cautiously, but do not copy its legacy request envelope into the current API-key transport.

### 18.4 Instrument identifiers and lot/quote fields

The securities directory defines:

- `instr_id`: instrument ID in the Tradernet trading system.
- `ticker`: internal ticker in the Tradernet system.
- `code_nm` / `exchange_ticker`: exchange ticker/code.
- `issue_nb`: ISIN / issue number.
- `mkt_id`: market ID in Tradernet.
- `lot_size_q`: lot size in the securities record.
- Quote `n`: serial quote number; it is not the same identifier as `instr_id`.
- Quote `x_lot`: minimum lot size.
- Quote `x_min` and `x_max`: minimum and maximum values for a period, not `getTradingLimits` buy/sell capacity.
- `istrade` / `x_istrade`: trading-availability indicators; `x_short`: whether shorting is available.

Consequently, retain the existing rule that OPQ position `instr_id` is not interchangeable with quote `n`. Also do not reinterpret `lot_size_q` or `x_lot` as the maximum quantity allowed by `getTradingLimits`, and do not use `x_min` / `x_max` as order-side capacity.

### 18.5 Market schedule

The 2026 FAQ says market opening/closing times should be obtained from the market-status method rather than hardcoded. The times vary by venue, holidays and daylight-saving changes; market status can be subscribed to for changes. The available documentation reviewed here does not establish the exact units/timezone of the OPQ/market schedule fields `o`, `c`, and `dt`. Continue preserving them raw and do not derive UTC timestamps or countdowns until those field semantics are verified.

### 18.6 Exact getTradingLimits contract remains unresolved

The current 2026 use-case guide links `getTradingLimits` to the method page slug `get-trading-limits` and confirms the method's purpose (maximum buy and sell quantity per instrument). However, the endpoint-specific page body exposing its HTTP method, required parameter names/types, response field names, units, and lot semantics was not retrievable from the public documentation index during this review. The asset-manager guide explicitly delegates method parameters and responses to the linked pages; its summary is not a substitute for those details.

The authenticated diagnostics recorded in sections 17 and the repeat-probe confirmation still show the candidate request key `instrument_id` returning HTTP 400, “Incorrect request parameters.” That error does not identify whether the name, value, HTTP method, account selector, or another required field is wrong. It is not evidence for any particular replacement key.

Therefore:

- Do not switch to `ticker`, `instr_id`, `code_nm`, `id`, `nt_ticker`, or another guessed parameter.
- Do not assume the method is POST solely because other API-key methods use POST; check the method's own HTTP method declaration.
- Do not map assumed response names such as `buy` / `sell` into production limits without a documented or authenticated fixture.
- Keep the diagnostic read-only and admin-only. Keep broker limits unavailable/unverified in Buy More and Exit until an authoritative method contract or successful sanitized live response is available.
- If the broker account is being accessed through an asset-manager key, verify the account selector and granted client-access scope separately; for the current user's own account, omit client-account selectors.

The generic API-key signer and current endpoint path match the published API-key POST specification. The repeated HTTP 400 should not be “fixed” by changing HMAC construction or blindly reverting to API V2; resolve the command-specific request contract first.
