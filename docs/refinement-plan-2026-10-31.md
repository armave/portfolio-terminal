# Repository refinement plan — 2026-10-31

**Repository:** `armave/portfolio-terminal`  
**Base branch:** `main`  
**Base commit:** `ec628bad58355ccd5eb0615afe42f01d6f9a2974`  
**Working branch:** `chore/refinement-audit-2026-10-31`  
**Scope:** architecture audit, safe legacy cleanup, reliability/performance roadmap, responsive UI/UX and integration review.

## Audit summary

The current application is a Preact 11 / TypeScript application with one Preact root. `src/main.ts` mounts `src/App.tsx`; the root `app.ts` remains active application orchestration. Portfolio state, domain calculations, provider access, local/cloud persistence, and the Cloudflare Worker/Durable Object have distinct responsibilities.

The root runtime and server files are large, but are still imported and exercised. They are not obsolete solely because of age or size. The same applies to the compatibility helpers in storage: reversible client-side secret encoding is intentionally disabled, with tests asserting the fail-closed behavior.

The latest `main` commit is `ec628bad`. The latest baseline `Validate` and GitHub Pages deployment workflows completed successfully. No open pull requests or issues were returned during the repository review.

A local clone was attempted, but this environment could not resolve `github.com`. Source inspection and Git branch operations therefore use the connected GitHub repository interface. No local typecheck, test, build, browser, or dependency-audit result is claimed.

## Prioritized plan

### P0 — Protect financial and persisted-data integrity

- Preserve `PortfolioState.positions` as the canonical active-position state; keep `holdings` a compatibility projection.
- Keep FIFO allocation, commission minimums, margin fees, cash/debt settlement, realized P/L, and closed-trade history covered by regression tests.
- Preserve local rollback, encrypted cloud history, cloud revision checks, guest-scoped projections, and backup compatibility.
- Keep active rollover accounting separate from the legacy cloud-import `processRollovers` path until timezone and historical rounding semantics are explicitly reconciled.
- Do not change financial formulas, broker order behavior, schemas, or server authorization as part of cosmetic cleanup.

### P1 — Broker refresh and asynchronous reliability

- Preserve in-flight request coalescing and request sequencing; a stale or failed provider response must not overwrite newer valid state.
- Keep broker-account snapshot freshness distinct from quote freshness.
- Preserve the separation between raw broker executions and app-owned closed trades, including persisted fee allocations.
- Improve visibility of loading, stale data, retry, and failure states without discarding saved data.
- Add focused tests before changing startup ordering or execution-history hydration; multiple desks currently consume the shared broker execution stream.

### P1 — Safe legacy cleanup and integration

- Remove only demonstrably empty/no-op code after checking all producers, consumers, tests, and compatibility contracts.
- Replace old event/prop bridges only when every call site has moved to the typed in-process event channels and Preact-owned state.
- Keep the single Preact root; browser APIs that operate on component-owned elements or trigger downloads remain valid platform responsibilities.
- Avoid deleting active runtime, Worker, Durable Object, or persisted compatibility code based on file size.

### P2 — Performance and architecture

- Reduce redundant provider requests only where request-count and lifecycle behavior can be verified.
- Prioritize shared boundary types for broker records, broker assumptions, and command/scenario inputs before broad refactors.
- Keep financial calculations pure and reuse existing domain helpers instead of duplicating formulas in UI/runtime code.
- Avoid blanket memoization, framework changes, or new dependencies without measured benefit.

### P2 — UI/UX, accessibility, and localization

- Keep the English/Russian localization dictionary authoritative for user-facing text and add translation tests for new copy.
- Continue improving semantic table headers, keyboard-operable horizontal scrolling, visible focus, dialog focus restoration, and touch-sized controls.
- Review mobile layouts, compact/empty states, loading skeletons, stale-data warnings, and actionable error/retry flows.
- Preserve reduced-motion support and avoid visual changes that obscure financial units, timestamps, data freshness, or risk disclosures.

### P3 — CI, deployment, and branch hygiene

- Require the exact final PR head to pass typecheck, Vitest, production build, Knip dead-code validation, and the production dependency audit.
- Keep the separate validation workflow names until branch-protection requirements are checked; overlapping workflows should not be consolidated blindly.
- Keep browser/client changes in a PR. Publish Worker/server-side changes through the designated `main` deployment path only when a demonstrated server-side fix is needed.

## Rebase and branch integration decision

The old `perf/onload-request-optimization` branch is 2 commits ahead and 509 commits behind current `main`, with merge base `a5f34d6950abd29299d2927b25fae91967a14c0d`. Its two unique commits touch `app.ts`, `src/App.tsx`, `MarketInsightsPanel.tsx`, and `TickerTab.tsx`.

That branch contains older `window` CustomEvent and component-prop bridge assumptions which no longer match the current typed event bus / store-owned Preact architecture. The Stocktwits lazy-load behavior from that work is already present on current `main`; active-order refresh is also already requested through the current typed broker event flow. Replaying the old branch wholesale or force-updating it would therefore add risk without a demonstrated benefit.

This refinement branch was created directly from current `main`. No old branch was rebased, force-pushed, or otherwise rewritten. Any remaining performance idea should be reimplemented against current interfaces with focused tests, rather than cherry-picked mechanically.

## Changes implemented in this branch

- [x] Remove an empty `finally { }` block in the executed-trades request path in `src/App.tsx`.
- [x] Re-indent the request body for readability while keeping success/error handling and the outer in-flight request cleanup intact.
- [x] Record the prioritized audit plan and branch-integration decision here.

The source change is deliberately behavior-preserving: request deduplication remains in place; the outer `finally` still clears the in-flight promise on both success and failure. No broker API, portfolio state, persisted format, financial calculation, localization string, or Worker behavior changed.

## Validation and release gate

The baseline `main` revision passed its latest GitHub Actions validation and deployment workflows. This new PR head must independently pass:

```sh
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm audit --omit=dev --audit-level=high
npm run build
```

CI on the exact PR head is authoritative because local network/DNS access prevented cloning the repository. Browser review remains necessary for responsive layouts and end-to-end loading/error/retry states; no browser run is claimed in this environment.

## Validation checkpoint — exact PR head `76c958985dd47cca8d3d088db42b7c1a2a9530cc`

- [x] **Validate** completed successfully: [GitHub Actions run 41193836971](https://github.com/armave/portfolio-terminal/actions/runs/41193836971).
- [x] **Pull Request CI** completed successfully: [GitHub Actions run 41193833900](https://github.com/armave/portfolio-terminal/actions/runs/41193833900).
- [x] Both workflows passed dependency installation, TypeScript typecheck, tests, production build, dead-code validation, and the production dependency audit.
- [ ] Complete manual browser/responsive UX review before marking the PR ready for review.

## Follow-up review checklist

- [ ] Review mobile cash/balance, margin, Closed History, guest LOTS, Settings, and news-dialog interactions.
- [ ] Verify stale broker-history errors keep saved records visible and retries remain available.
- [ ] Recheck Russian translations for any new or edited user-facing copy.
- [ ] Revisit P1 async request sequencing only with a reproducible issue and focused regression tests.

## Follow-on implementation — Margin Intelligence stale responses

A follow-up audit found that the invalid-ticker branch displayed an error without advancing the request generation. An earlier in-flight analysis could therefore finish later and replace the newer error state.

- [x] Add a small latest-request guard with explicit begin, current-request, and invalidation operations.
- [x] Advance the guard immediately when a Margin Intelligence event arrives, before validating its ticker.
- [x] Invalidate pending responses when the owning effect is cleaned up.
- [x] Add unit tests for out-of-order completion, a newer request rejected before async work, and effect cleanup.
- [x] Confirm typecheck, full tests, production build, dead-code validation, and production dependency audit on the exact PR head.
- [x] Both final-head workflows completed successfully: [Validate run 41195019092](https://github.com/armave/portfolio-terminal/actions/runs/41195019092) and [Pull Request CI run 41195019175](https://github.com/armave/portfolio-terminal/actions/runs/41195019175).

The change affects client-side request sequencing only. It does not change portfolio calculations, broker requests, stored digests, authorization, server code, or localization.

## Follow-on implementation — Margin Intelligence stale-data UX

A second issue in the same request lifecycle could show a previous ticker's analysis under a newly selected ticker, and a failed refresh cleared an already loaded digest from modal state.

- [x] Keep prior analysis, articles, sync time, and digest revision only when the request scope and ticker match.
- [x] Preserve matching cached content when a refresh fails so the modal can show the error alongside the last successful analysis.
- [x] Clear prior content when changing ticker or switching between position and portfolio review.
- [x] Add unit tests for ticker matching, scope matching, and portfolio-level state.
- [ ] Confirm all required CI checks on the final PR head.

The modal already supports displaying an error and existing analysis/source cards together; the fix restores that intended stale-data fallback without presenting content from a different request.

## Follow-on implementation — active-order refresh failure visibility

The broker event bus already defined `broker:active-orders-error`, and the request owner emitted it on API failures, but no application listener consumed it. Also, an empty restored Gateway Secret returned silently without an error event. Consequently, an admin could continue seeing locally retained position targets without a warning that active broker orders had not refreshed.

- [x] Report missing credentials, credential-restoration failures, and broker API failures through the same active-orders error event.
- [x] Keep a successful empty active-order list distinct from a failed refresh.
- [x] Show a localized warning and terminal log while leaving the last applied position targets untouched.
- [x] Suppress repeated warning toasts during consecutive failed polls; a successful refresh resets the warning latch.
- [x] Add unit coverage for missing credentials, storage/API rejection, successful empty responses, normalized success, and English/Russian warning copy.
- [ ] Confirm typecheck, full tests, production build, dead-code validation, and production dependency audit on the exact PR head.

No order is submitted or modified. The refresh path remains read-only; this change makes its failure state visible without clearing valid last-known targets.

## Follow-on implementation — account-scoped broker refreshes

The broker account, executions, and active-order promises were module-global, while the refresh effects were keyed only by role or mount. An administrator identity change could therefore reuse the prior account's in-flight promise; late account, trade, or order responses could also publish after the authenticated identity had changed. Re-login to the same identity could revive the same map key if request ownership were based on identity alone.

- [x] Add an identity-generation guard that invalidates work synchronously when `auth:user-changed` fires.
- [x] Key account, execution, and active-order in-flight requests by identity plus generation, so the new session can refresh independently.
- [x] Rebind account/execution listeners and refresh account, trade, and active-order snapshots on administrator identity changes, not only role changes.
- [x] Ignore stale successes and failures after identity changes; stop active-order requests after credential restoration if their session was superseded.
- [x] Test sign-out, role change, account switch, repeated identity notifications, and re-login generation/key uniqueness.
- [ ] Confirm exact-head typecheck, tests, production build, dead-code validation, and production dependency audit.

No financial calculations, persisted portfolio formats, credentials, or server authorization rules changed. The fix scopes existing read-only broker responses to the active UI session.
