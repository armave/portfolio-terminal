# Request orchestration — R03 to R05

**Date:** 2026-11-13  
**Client target:** `dev`  
**Server / Worker changes:** none

## R03 — Startup and refresh priority

Startup continues to restore and validate identity before resolving the account role and hydrating the correct workspace. The existing encrypted admin workspace, guest projection, cloud revision, and history boundaries remain independent.

The initial live-price refresh remains best-effort background work so a slow market-data provider cannot hold the restored workspace behind the startup overlay. Its read-only transport requests now enter the shared scheduler at critical priority. Broker positions, active orders, private account-stream tickets, and quote-stream tickets also receive critical priority. Initial full execution-history backfills and scheduled broker catch-ups remain background reads. Trades/Cash Cushion desk refreshes and retries, plus Manual Sync history reads, carry interactive priority so active work is not queued behind deep-data reads.

For scheduled administrator refreshes, quote refresh and supplemental broker catch-up run as the two core branches. Closed History checkpointing now waits for both branches; workspace-state synchronization follows the history checkpoint. This prevents lower-priority persistence work from competing with still-running first-class quote or broker reads. Guest refresh remains snapshot/LOTS hydration followed by quotes for the resulting assignment set.

## R04 — Shared request lifecycle

A shared scheduler in `src/services/requestScheduler.ts` now coordinates selected read-only broker and market-data actions at the API transport boundary:

- Four requests may execute concurrently.
- Up to 128 additional requests may wait. When full, higher-priority work may displace the newest queued request at a lower priority; same-priority requests retain FIFO and are rejected rather than reordered.
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
| Interactive | Foreground Trades/Cash Cushion execution-history reads and retries, Manual Sync history catch-up, news, Stocktwits, market status, Market Depth ticket/data |
| Background | Initial/full execution-history backfill, scheduled execution-history catch-up, deep stock data, cashflows, historical market data, calendars and event feeds |

Ordinary background incremental execution-history reads may reuse a successful result for at most three seconds when the same account session generation and date cursor are unchanged. Only a successful read is remembered; failures are never cached. Foreground desk and Manual Sync reads bypass this reuse window. When a complete history baseline exists, a foreground desk read also uses a separate in-flight coalescing slot from a background incremental read, so it does not inherit a lower-priority request that is already queued. Initial full backfills remain coalesced across priorities. Concurrent provider pages merge by execution identity against the latest saved and in-memory history, preserving app-calculated fee allocations and newer live-order updates. The reuse guard stores only the last successful cursor/time and republishes the latest merged local execution snapshot; it does not retain or replace broker history.

Trades background activity indicators wait 400 ms before appearing and remain visible for at least 650 ms once shown. The accessible label follows the active phase (execution refresh, saved-history hydration, cashflow refresh, or fee recalculation). Cached/app-owned trade rows remain visible while those operations run.

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
