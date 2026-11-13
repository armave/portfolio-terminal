# Request orchestration — R03 to R05

**Date:** 2026-11-13  
**Client target:** `dev`  
**Server / Worker changes:** none

## R03 — Startup and refresh priority

Startup continues to restore and validate identity before resolving the account role and hydrating the correct workspace. The existing encrypted admin workspace, guest projection, cloud revision, and history boundaries remain independent.

The initial live-price refresh remains best-effort background work so a slow market-data provider cannot hold the restored workspace behind the startup overlay. Its read-only transport requests now enter the shared scheduler at critical priority. Broker positions, active orders, private account-stream tickets, and quote-stream tickets also receive critical priority.

For scheduled administrator refreshes, quote refresh and supplemental broker catch-up run as the two core branches. Closed History checkpointing now waits for both branches; workspace-state synchronization follows the history checkpoint. This prevents lower-priority persistence work from competing with still-running first-class quote or broker reads. Guest refresh remains snapshot/LOTS hydration followed by quotes for the resulting assignment set.

## R04 — Shared request lifecycle

A shared scheduler in `src/services/requestScheduler.ts` now coordinates selected read-only broker and market-data actions at the API transport boundary:

- Four requests may execute concurrently.
- Up to 128 additional requests may wait.
- Queued work is ordered `critical` → `interactive` → `background`, FIFO within each priority.
- External `AbortSignal` cancellation removes queued work or aborts active transport.
- Credentials are captured at dispatch time; a queued request cannot inherit a later session's active credential.
- Account identity changes cancel queued/in-flight API reads before role and workspace scope changes.
- `clearApiRequestCaches()` cancels scheduled work and clears in-flight read deduplication when the request context is reset.
- Existing same-request deduplication, closed-market successful-response gating, provider caches, retry/backoff and request timeouts remain the owners of those behaviors.

Priority classification:

| Priority | Request families |
|---|---|
| Critical | Initial quote reads, provider-quote fallback, broker positions/orders, account and quote stream tickets, broker snapshot/order fallback |
| Interactive | News, Stocktwits, market status, Market Depth ticket/data |
| Background | Deep stock data, execution-history backfill, cashflows, historical market data, calendars and event feeds |

Authentication, encrypted workspace state, guest workspace projections, cloud-history records, and all financial writes remain outside this scheduler. The scheduler does not merge endpoints or alter server authorization.

## R05 — Regression gates

Vitest covers queue ordering, FIFO behavior, concurrency limits, abort of queued and active work, queue overflow, cancellation on session reset, and continued scheduling after failures. API-level coverage verifies that a critical quote request moves ahead of a queued deep-data read. Auto-refresh coverage verifies that history and state checkpoints do not start before the core quote and broker branches finish.

## Validation and limits

Run the repository's merge gates on the exact PR head:

```sh
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
npm run ci:local
```

The scheduler is a client-side concurrency and priority control, not a production measurement. Request counts, queue wait, and authenticated live TradeNet behavior still require a real-session comparison before claiming a measured performance improvement.
