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
- [ ] Confirm typecheck, full tests, production build, dead-code validation, and production dependency audit on the exact PR head.

The change affects client-side request sequencing only. It does not change portfolio calculations, broker requests, stored digests, authorization, server code, or localization.
