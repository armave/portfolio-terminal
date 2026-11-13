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

The current official endpoint catalogue confirms the purpose of getOPQ (account positions, cash, margin settings and limits) and getTradingLimits (maximum buy and sell quantity for an instrument). It also warns that trading limits are estimates rather than reserved capacity. The material inspected so far does not provide enough retr## 14. Implementation status (updated 2026-11-13)

### Implemented and validated on the current PR head
- Pure broker Buy/Exit cap resolver and Vitest coverage. Buy More and Exit calculator entry points accept normalized broker limits and conservatively block when broker constraints are not verified. **Live Buy/Exit UI/store hydration remains outstanding**; production scenario panels do not yet consume live broker limits.
- Position normalization preserves signed quantity and the documented `instr_id`, `issue_nb`, `t`, `k`, `go`, and `vm` metadata. A negative `q` without an explicit recognized side stays direction `unknown` and produces `negative_quantity_sign_unverified`; `t` and `k` are not used to infer direction.
- Russian copy added for short-position and broker-limit diagnostic states.
- Worker REST and persistent account-stream portfolio sanitizers validate complete account/position snapshots, reject malformed signed quantities/tickers rather than converting them to zero, preserve allowlisted metadata, and accept valid empty snapshots.
- Worker exposes a fixed, read-only `freedom-opq` action for `getOPQ`. Its response is bounded and credential-redacted, and the app exposes it as an admin-only raw diagnostic. **This is not yet a typed margin/account-limit mapping** and does not enable scenario enforcement.
- Worker tests cover OPQ proxy behavior/redaction, signed quantity preservation, metadata allowlisting, incomplete/malformed snapshots, and valid empty snapshots.
- The broker-limit policy unit tests cover current/stale/unavailable/malformed limits, account/instrument/local cap intersection, lot rounding, zero limits, and long-exit no-cross-through-zero behavior.

### Worker deployment and validation
- Latest Worker deployment is on `main` commit `2a086805bbd9891391586df1a36961034dfac01c`: [Deploy Cloudflare Worker run](https://github.com/armave/portfolio-terminal/actions/runs/43401341771). Dependency audit, Worker tests, and pinned Wrangler deployment all passed.
- The deployed Worker includes the fixed `freedom-opq` GET-only app action, which invokes the fixed server-side `getOPQ` command; the browser cannot select arbitrary TradeNet commands. The action remains admin-restricted.

### Exact-head PR validation
- On PR head `43390c3b4705f310cd2da8939dad7c17c29aad71`, [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/43402302255) passed typecheck, full Vitest, production build, production-browser smoke test, desktop/mobile performance baseline capture, dead-code validation, and dependency audits.
- On the same PR head, [Operations Browser Journey](https://github.com/armave/portfolio-terminal/actions/runs/43402302229) passed typecheck, unit and Worker tests, production build, account/Settings browser journey, performance baseline capture, dead-code validation, and dependency audits.

### Outstanding — intentionally not marked complete
- Exact `getTradingLimits` request method/parameters and response fields, verified fixture, Worker route, client transport, and typed normalizer.
- Verified `getOPQ` field mapping for cash, currency, margin, collateral, and account-level limits; current app support is diagnostic/raw only.
- Live Buy/Exit store and UI hydration so broker limits materially constrain the scenario quantities shown to users.
- Provider-driven `getMarketStatus` schedule integration and explicit fallback provenance.
- Bounded 429/transient backoff and SID/rememberMe cache reconciliation.
- Authenticated live TradeNet account verification. No live account payload has been captured or mapped in this PR.

Keep this PR in draft until the verified provider contract is available and live Buy/Exit hydration and enforcement are complete.
  
res/schema, normalized account/instrument limits, and Buy/Exit UI/store hydration.
- Broker-reported account margin integration into the existing `BrokerReportedMarginRequirements` model.
- Full provider-driven market session schedule ingestion (`o`, `c`, `dt`, provider time) and client-side schedule authority.
- Rate-limit/backoff and session-cache improvements.
- Authenticated live TradeNet verification.

The current documentation confirms endpoint purpose but does not establish enough concrete `getOPQ` / `getTradingLimits` response field mappings. Obtain a sanitized response or complete authoritative schema before implementing raw field mappings; do not guess.

## 15. Reference material

- TradeNet asset-manager use case and endpoint catalogue: https://freedombroker.global/tradernet-api/use-case-assets-managers?site_lang=en
- Existing market-data integration notes: docs/FREEDOM_MARKET_DATA.md
- Existing margin model: src/domain/marginRisk.ts
- Existing Freedom transport: src/services/freedomTradeNet.ts
- Existing account normalization: src/services/freedomAccountContracts.ts
- Existing market-session fallback: src/services/marketSession.ts
- Existing Worker sanitizers and routing: worker.js, state-store.js
