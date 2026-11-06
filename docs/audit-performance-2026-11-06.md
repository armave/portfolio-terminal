# Portfolio Terminal audit — 2026-11-06

**Repository:** `armave/portfolio-terminal`  
**Reviewed base:** `dev` at `48bdebd2c95daee3730e1232b3087a53e22a3ed4`  
**Scope:** client rendering cadence and portfolio margin-risk presentation; targeted code audit, not a full security assessment.

## Findings

### P1 — Margin trigger flags used collateral instead of total assets

`calculateMarginRiskMetrics` correctly calculated total assets as `positionValue + collateral` and required assets from the configured maintenance / stop-out ratios. However, the two trigger booleans compared only `collateral` with the required-asset values.

That made a portfolio with $1,100 in total assets and $500 in debt appear to have both a margin-call and stop-out trigger under a 10% maintenance / 0% stop-out configuration, even though its calculated equity ratio was approximately 54.5%. The trigger condition must use total assets and include equality at the configured threshold.

**Change:** compare total assets with the calculated required-asset values. Add regression cases for a healthy portfolio, maintenance-only pressure, threshold equality, and stop-out.

### P2 — Live quote events caused duplicate derived UI work

The TradeNet quote adapter applied every valid quote to the canonical in-memory store and immediately invoked the board-render callback. A stream burst could therefore repeat combined breakeven and board-title derivation several times before the browser painted a frame.

**Change:** keep every accepted quote update immediate, but coalesce the derived render callback to one execution per animation frame. Cancel any queued render when the quote runtime stops. This does not debounce or discard prices and does not change persistence or cloud-sync behavior.

## Preserved boundaries

- The canonical portfolio store remains the source of truth.
- Quote values and provenance are applied immediately; only derived rendering is coalesced.
- FIFO allocation, commissions, margin-interest accrual, rollover, debt settlement, broker transport, and order behavior are unchanged.
- No Worker, Durable Object, authorization, account-session, or persisted-schema changes.
- No user-facing text was added, so the English/Russian dictionaries are unchanged.

## Follow-up opportunities (not changed in this pass)

- Measure actual component render counts and quote-event rates in a production browser profile before introducing broader memoization.
- Revisit the current load-time-only quote fallback retry policy with explicit product requirements; its current one-attempt behavior is documented and tested, so changing it without a retry/backoff contract could increase provider traffic.
- Evaluate the separate IndexedDB portfolio-state branch only after it is rebased onto current `dev` and its recovery semantics are revalidated; it is substantially behind the current branch and should not be merged wholesale.
- Continue measuring the entry and lazy-chunk budgets after future feature additions.

## Validation checklist

- [ ] TypeScript typecheck on the exact PR head.
- [ ] Full Vitest suite, including margin-risk and frame-coalescing regression tests.
- [ ] Production build and code-splitting budget.
- [ ] Dead-code validation.
- [ ] Full and production dependency audits.
- [ ] Production-browser smoke at phone, tablet, and desktop widths.
- [ ] Confirm streamed quotes update immediately while at most one derived render is scheduled per animation frame.
- [ ] Confirm quote rendering cancels cleanly on logout / runtime stop.
- [ ] Manually inspect margin risk with values above, at, and below the configured threshold; confirm wording remains an estimate, not a broker liquidation signal.

The repository was inspected through its connected GitHub source interface in this audit session. No local dependency install, local test run, production browser session, or live authenticated TradeNet session is claimed; the exact-head CI and manual checks above remain the release evidence.
