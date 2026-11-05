# PR 7 — Client-side broker reconciliation and data-quality states

**Status:** Draft implementation scaffold. This branch currently contains the scoped implementation plan only; client reconciliation changes and regression tests are pending.

**Proposed PR title:** `fix(broker): harden client reconciliation for partial and stale snapshots`

**Branch:** `fix/broker-client-reconciliation-2026-11-05`  
**Base:** `main`  
**Priority:** High  
**Dependency:** None. PRs 5–7 are independent workstreams.

## Goal

Make the browser-side portfolio and execution-history experience robust when broker REST snapshots and authenticated account streams arrive late, out of order, incomplete, duplicated, or during an account/session change. Preserve last-known-good information without presenting it as current, and never treat a missing or partial provider payload as a confirmed empty account/history.

This PR is a client-side follow-up to the typed Freedom reconciliation work already merged in PR #300. It does not reimplement broker type contracts or alter financial accounting.

## Evidence and current boundary

The repository already has dedicated balance-sync, execution-history, trade-history, broker-stream, and request-runtime modules with regression coverage for many core cases. This PR must first map that existing coverage and add only demonstrated missing scenarios; do not rewrite working modules or duplicate tests.

Existing areas to review include:

- `src/domain/balanceSyncState.ts`
- `src/domain/brokerExecutionHistoryState.ts`
- `src/domain/tradeHistorySync.ts`
- `src/services/portfolioBrokerDataRuntime.ts`
- `src/services/portfolioBrokerRefreshRuntime.ts`
- `src/services/portfolioBrokerRequestRuntime.ts`
- `src/services/freedomAccountStreamAppRuntime.ts`
- `src/services/freedomAccountStreamRuntime.ts`
- `src/components/ClosedHistoryDesk.tsx` and `src/components/QuoteProvenance.tsx` only when a client-visible data-quality state requires a direct adjustment.

## Scope and explicit server boundary

Client-side state, browser request/stream orchestration, UI presentation, and their direct tests only.

**Do not modify** `worker.js`, `state-store.js`, `wrangler.jsonc`, or the shared server-imported modules `src/services/freedomTradeNet.ts` and `src/services/freedomMarketDepth.js`. The Worker imports the latter shared modules directly; any server-side change must use the repository's direct-to-main Worker deployment workflow, not this frontend PR.

Do not modify local persistence or cloud revision/encryption modules. Do not change margin, commission, FIFO, sale, or other financial formulas.

## Implementation checklist

- [ ] Map current REST snapshot, authenticated stream, execution-history, cashflow, and account-switch flows; record the existing tests before adding new ones.
- [ ] Define the distinction between authoritative empty, complete, partial, unavailable, stale, and malformed responses for each client data contract.
- [ ] Ensure missing fields in a partial response cannot erase valid cached holdings, balances, orders, executions, or completeness markers.
- [ ] Ensure a confirmed empty response is accepted as empty only when the provider contract says the response is authoritative and complete.
- [ ] Keep TradeNet trade-history and cashflow-history completeness independent; a partial response must not mark either baseline complete.
- [ ] Verify execution deduplication across REST history, active-order fills, and live stream events; prefer stable provider execution IDs and characterize any fallback identity.
- [ ] Prove that an older REST snapshot cannot overwrite a newer live event, including equal timestamps, missing provider timestamps, and reconnect races.
- [ ] Prove that requests and stream events from a previous account/session cannot publish or persist after logout, account switching, guest/admin changes, or session expiry.
- [ ] Verify reconnect/retry behavior is bounded, ticket/session-scoped, and does not create duplicate subscriptions or refresh storms.
- [ ] Preserve the last-known-good data on transient failures while visibly marking it stale/provisional; clear it only on an authoritative replacement or explicit account reset.
- [ ] Ensure quote and account freshness labels reflect provider timestamps and actual payload receipt; never synthesize a provider update timestamp.
- [ ] Add table-driven Vitest cases for missing, null, malformed, duplicated, out-of-order, partial, empty, stale, and account-switched payloads.
- [ ] Add/extend browser smoke journeys for partial provider failure, stale-state recovery, account switching, and guest isolation.
- [ ] Localize any new user-visible status or error copy in English and Russian.
- [ ] Update the refinement tracker with scenarios covered and any provider behaviors that remain unverified.

## Non-goals and guardrails

- No broker order placement or execution capability.
- No changes to Worker routes, Durable Object state, broker credentials, TradeNet upstream transports, or Wrangler bindings.
- No edits to the shared Worker-imported market-depth/TradeNet modules listed above.
- No changes to portfolio state persistence, cloud encryption, or revision coordination.
- No financial calculation, fee allocation, FIFO, margin, or realized-P/L semantic change.
- Do not interpret undocumented provider behavior by guesswork; use sanitized fixtures and label unresolved external contracts.

## Acceptance criteria

- [ ] Partial, empty, stale, failed, and malformed provider responses are distinguishable in client state.
- [ ] Incomplete payloads cannot silently erase last-known-good data or mark a history baseline complete.
- [ ] REST and stream execution records are idempotently reconciled without duplicate fills.
- [ ] Late responses/events from a prior account/session cannot affect the current workspace.
- [ ] Stale retained data is visibly identified and is never represented as live/current.
- [ ] Guest/admin boundaries remain intact.
- [ ] New visible strings have English/Russian parity.
- [ ] No Worker/shared-server files, persistence contracts, or financial formulas change.
- [ ] TypeScript, full Vitest, dead-code validation, audits, production build, and relevant browser smoke tests pass on the exact PR head.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
```

Run the existing Chromium production-browser smoke suite and add deterministic mocked broker scenarios. Verify the exact PR head in GitHub Actions. Real-account provider behavior must be recorded as manual/unverified unless it is actually exercised with authorized credentials.
