# REST and socket request audit — 2026-11-12

## Scope and method

Static call-path review of application startup, API transport, broker loaders, quote transport, and the Cloudflare Worker routes. This is a source audit, not a production network trace: request counts and latency have not been sampled from an authenticated live session.

## Startup request map

| Flow | Request / transport | When | Decision |
|---|---|---|---|
| Credential validation | `GET /api/auth/me` with the Gateway Secret | Startup / sign-in | Keep separate: it validates the credential and establishes identity. The auth runtime remembers the validated user for the subsequent `getCurrentUser()` read. |
| Auth fallback | `GET /api/auth/status` | Only when restored credentials are invalid or absent | Keep conditional; do not run alongside valid-session startup. |
| Admin workspace | `GET /api/state` | Admin startup | Keep separate from broker requests and history; it is an encrypted, revisioned shared-workspace record. |
| Guest workspace | `GET /api/guest-portfolio` | Guest startup / refresh | Keep guest-scoped and separate from admin state. |
| Private account feed | ticket request `freedom-account-stream-ticket`, then `WSS freedom-account-socket` | Admin account startup | Start this before the initial broker loaders. One socket carries both `portfolio` and `orders`. |
| Initial broker portfolio | `freedom-portfolio-snapshot` diagnostic, then `freedom-positions` fallback | Only when the private account stream is unavailable | Avoid when the persistent account stream is connected; preserve fallback on failure. |
| Initial broker orders | `freedom-orders-stream` diagnostic, then `freedom-orders` fallback | Only when the private account stream is unavailable | Avoid when the persistent account stream is connected; preserve fallback on failure. |
| Executed trade history | `freedom-trades` | Initial baseline or incremental history refresh | Keep the first full backfill when no complete local baseline exists. With a complete baseline and a connected account stream, use cached history and live order fills. |
| Live market quotes | one-use ticket + `WSS freedom-quote-socket` | Admin or guest tracked symbols | Ticket contract accepts at most 10 symbols. Split larger subscriptions into 10-symbol groups. |
| Initial quote snapshot | `GET action=quote&symbol=...` | While the live quote socket is opening / reconnecting | Keep as the bounded first-render fallback. Coalesce same-turn reads and split batches at the Worker’s 10-symbol limit. |

## Other request families

- `api.ts` coalesces identical in-flight market-data reads by action, normalized query parameters, method and credential scope. It does not retain a general second response cache; writes and cloud-state operations are not coalesced.
- Yahoo quote reads have an 8-second fresh cache, bounded 15-minute stale retention, retry-on-transient-failure, and per-symbol in-flight sharing. The queue now sends no more than 10 symbols per Worker request.
- Fallback quote providers are separate per-symbol requests, bounded by the quote refresh worker pool. The first quote snapshot is intentionally REST-backed while the persistent quote socket starts, so the app does not create an additional one-shot provider stream per ticker.
- Yahoo deep stock data, market news, Stocktwits, provider history, market events, and market calendar are feature-driven reads, not required startup prerequisites. Existing identical-read coalescing and feature-level caches remain in place.
- Market Depth is an on-demand admin flow: one ticker-bound ticket request followed by its own socket. It is not combined with the public quote stream or account stream because it has a different subscription and authorization scope.
- Cashflows and closed broker history are refreshed by supplemental/scheduled workflows. `/api/history` remains separate from `/api/state` because the records have independent encryption, revision, and recovery semantics.
- Cloud-state writes, guest snapshot publications, user mutations, and other POSTs are not folded into startup read batches.

## Changes in this pass

1. The App-owned administrator account stream is now started by the broker data runtime before its three startup loaders proceed. Concurrent loaders share one in-flight ticket/socket handshake and wait only a short startup grace period. A successful connection suppresses the redundant one-shot portfolio and active-orders diagnostics/REST reads; a slow or failed connection lets the existing REST fallback proceed while the socket reconnects in the background.
2. A connected socket no longer suppresses the first full executed-trade history backfill when the local history baseline is absent. This protects historical completeness; subsequent reads can use the established baseline and live order events.
3. Live quote subscriptions are partitioned into groups of at most 10 symbols, matching the ticket/Worker contract. Each group keeps its own reconnect lifecycle; the adapter reports connected only when all groups are connected.
4. Yahoo quote queue flushes are partitioned into 10-symbol Worker requests while preserving per-symbol cache, stale fallback, retry, and promise resolution behavior.

## Boundaries deliberately preserved

- No combined endpoint was added: auth, admin cloud state, guest projections, broker account data, and user-specific streams have different identity or authorization boundaries.
- State and history remain separate encrypted/revisioned records.
- The app keeps REST quote bootstrap when the quote socket is not ready.
- No Worker, Durable Object, persisted schema, financial calculation, or user-facing copy changed in this pass.
- Localization is unaffected because there are no new UI strings.

## Validation status

- [x] Regression tests added for shared account-stream startup, REST fallback on socket failure or startup-grace expiry, first-history backfill, large quote REST batches, and large quote socket subscriptions.
- [x] TypeScript typecheck.
- [x] Full Vitest and Worker suite: 2,085 tests passed across 164 test files.
- [x] Production build.
- [x] Dead-code validation.
- [x] Full dependency audit and production dependency audit.
- [x] Production-browser smoke journeys for responsive admin/guest desks, account switching, broker partial failure, cloud revision conflicts, backup flows, guest workspace isolation, account/Settings operations, language persistence, and refresh settings.
- [ ] Live authenticated TradeNet session verification.
- [ ] Before/after production request-count and latency comparison.

CI passed on the reviewed implementation. The browser journeys use deterministic Worker/broker fixtures and do not certify connectivity to a live TradeNet account. No production request-count or latency improvement is claimed without a real authenticated network trace.
