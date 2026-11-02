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
- [x] Consolidated into the final cross-device responsive and accessibility release gate below.

## Follow-up review checklist

- [x] Consolidated the screen-by-screen review into the final cross-device responsive and accessibility release gate below.
- [x] Verify stale broker-history errors keep saved records visible and retries remain available. `CashCushionDesk` now restores the last in-memory/saved snapshot, preserves it on refresh failure, and offers an accessible retry; reducer tests cover saved fallback, stale/error, refresh and recovery transitions.
- [x] Recheck Russian translations for new/edited Cash & Balance copy. The stale-history warning, first-load error, refreshing label and retry/aria-label reuse existing Russian dictionary entries.
- [x] Revisit P1 async request sequencing only with a reproducible issue and focused regression tests. The guest-directory request could clear known guest allocations on a transient failure; this is now covered by a retained-state reducer and retry tests.

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
- [x] Exact-head Validate and Pull Request CI passed on `632406b46273581f56059c70651a5111a458bdf4`: Validate run 41205417977 and Pull Request CI run 41205417990 both passed typecheck, tests, production build, dead-code validation and production dependency audit.

The modal already supports displaying an error and existing analysis/source cards together; the fix restores that intended stale-data fallback without presenting content from a different request.

## Follow-on implementation — active-order refresh failure visibility

The broker event bus already defined `broker:active-orders-error`, and the request owner emitted it on API failures, but no application listener consumed it. Also, an empty restored Gateway Secret returned silently without an error event. Consequently, an admin could continue seeing locally retained position targets without a warning that active broker orders had not refreshed.

- [x] Report missing credentials, credential-restoration failures, and broker API failures through the same active-orders error event.
- [x] Keep a successful empty active-order list distinct from a failed refresh.
- [x] Show a localized warning and terminal log while leaving the last applied position targets untouched.
- [x] Suppress repeated warning toasts during consecutive failed polls; a successful refresh resets the warning latch.
- [x] Add unit coverage for missing credentials, storage/API rejection, successful empty responses, normalized success, and English/Russian warning copy.
- [x] Exact-head `c5e63b9` passed typecheck, full tests, production build, dead-code validation, and production dependency audit.
- [x] Both workflows passed: [Validate run 41197047442](https://github.com/armave/portfolio-terminal/actions/runs/41197047442) and [Pull Request CI run 41197047437](https://github.com/armave/portfolio-terminal/actions/runs/41197047437).

No order is submitted or modified. The refresh path remains read-only; this change makes its failure state visible without clearing valid last-known targets.

## Follow-on implementation — account-scoped broker refreshes

The broker account, executions, and active-order promises were module-global, while the refresh effects were keyed only by role or mount. An administrator identity change could therefore reuse the prior account's in-flight promise; late account, trade, or order responses could also publish after the authenticated identity had changed. Re-login to the same identity could revive the same map key if request ownership were based on identity alone.

- [x] Add an identity-generation guard that invalidates work synchronously when `auth:user-changed` fires.
- [x] Key account, execution, and active-order in-flight requests by identity plus generation, so the new session can refresh independently.
- [x] Rebind account/execution listeners and refresh account, trade, and active-order snapshots on administrator identity changes, not only role changes.
- [x] Ignore stale successes and failures after identity changes; stop active-order requests after credential restoration if their session was superseded.
- [x] Test sign-out, role change, account switch, repeated identity notifications, and re-login generation/key uniqueness.
- [x] Confirm exact-head typecheck, tests, production build, dead-code validation, and production dependency audit on `2d9487c`.
- [x] Both final-head workflows passed: [Validate run 41195574570](https://github.com/armave/portfolio-terminal/actions/runs/41195574570) and [Pull Request CI run 41195574577](https://github.com/armave/portfolio-terminal/actions/runs/41195574577).

No financial calculations, persisted portfolio formats, credentials, or server authorization rules changed. The fix scopes existing read-only broker responses to the active UI session.

## Follow-on implementation — accessible Settings navigation label

The workspace navigation rendered the Settings destination as a gear emoji only. Unlike the quote-refresh button, it had no explicit accessible name or tooltip, leaving its purpose dependent on emoji pronunciation and visual context.

- [x] Add a translated `aria-label` and `title` to the Settings navigation control.
- [x] Mark the decorative gear emoji as hidden from assistive technology.
- [x] Add a Russian translation and verify Preact applies it to both accessible attributes.
- [x] Confirm exact-head typecheck, full tests, production build, dead-code validation, and production dependency audit on `2f4c91b`.
- [x] Both final-head workflows passed: [Validate run 41195907301](https://github.com/armave/portfolio-terminal/actions/runs/41195907301) and [Pull Request CI run 41195907313](https://github.com/armave/portfolio-terminal/actions/runs/41195907313).

This is a presentation/accessibility-only change. Navigation state, keyboard behavior, permissions, and portfolio data are unchanged.

## Follow-on implementation — keyboard-accessible guest assignment history

The guest LOTS history table used a horizontally scrollable wrapper, but that wrapper was not keyboard-focusable or named as a region. Closed History already provides a focusable, labelled scroll region for its wide table; guest history should offer the same access pattern.

- [x] Expose the guest assignment table scroller as a labelled region.
- [x] Make the horizontal scroller keyboard-focusable with `tabindex={0}`.
- [x] Add visible focus styling consistent with the existing indigo section theme.
- [x] Add Russian localization for the region name and a regression test for the accessible Preact attributes.
- [x] Confirm exact-head typecheck, full tests, production build, dead-code validation, and production dependency audit on `578527e`.
- [x] Both workflows passed: [Pull Request CI run 41196224211](https://github.com/armave/portfolio-terminal/actions/runs/41196224211) and [Validate run 41196224268](https://github.com/armave/portfolio-terminal/actions/runs/41196224268).

This is an accessibility/localization-only change. Table contents, filters, assignment records, financial data, and persistence are unchanged.

## Follow-on implementation — standardized accessible table scroll regions

The UI audit found three additional wide tables whose scroll containers were not keyboard-focusable or named: cash-funded stock holdings, active tranches with guest assignments, and the admin user-management table. Guest assignment history and Closed History had already received one-off wrappers. These patterns are now consolidated so the five data-table regions share keyboard access and visible focus without erasing their existing responsive CSS behavior.

- [x] Add a reusable `TableScrollRegion` with a programmatic region name, `tabIndex={0}`, horizontal scrolling, and a visible focus outline.
- [x] Migrate cash holdings, active tranches, guest assignment history, Closed History, and admin user management to the shared component.
- [x] Add visually hidden table captions to cash holdings, active tranches, guest assignment history, and user management; retain the existing detailed Closed History caption.
- [x] Add English/Russian accessible names and translation regression coverage.
- [x] Preserve the cash/tranche/guest/settings `table-scroll-wrapper` CSS hooks, including mobile layout behavior; keep Closed History's existing wrapper styling distinct.
- [x] Keep the collapsible active-tranches region out of the tab order while closed, with focused regression coverage.
- [x] Exact-head `d0cc136` passed typecheck, full tests, production build, dead-code validation, and production dependency audit.
- [x] Both workflows passed: [Validate run 41197123973](https://github.com/armave/portfolio-terminal/actions/runs/41197123973) and [Pull Request CI run 41197123995](https://github.com/armave/portfolio-terminal/actions/runs/41197123995).

This is a presentation/accessibility/localization-only change. Table data, order and assignment actions, portfolio calculations, broker requests, permissions, and persistence remain unchanged. Browser/mobile visual verification remains outstanding.

## Follow-on implementation — shared modal focus management

A modal accessibility audit found inconsistent keyboard focus behavior across the four modal flows. Scenario Comparison and Scenario Report each maintained their own focus trap and restoration code; Authentication focused its name input but allowed Tab focus to escape and did not restore focus; Margin Intelligence handled Escape and scroll locking but did not establish initial focus, trap Tab navigation, or restore focus. Independent implementations also used slightly different focusable-element selectors.

- [x] Add a shared focus-management hook for initial focus, Tab/Shift+Tab containment, Escape callbacks, body-scroll locking, and focus restoration.
- [x] Exclude disabled, hidden, inert, `aria-hidden`, negative-tabindex, and visually unrendered controls from modal tab order.
- [x] Apply the shared behavior to Authentication, Margin Intelligence, Scenario Comparison, and Scenario Report.
- [x] Preserve the authentication modal's mandatory sign-in behavior (Escape does not dismiss it) and preserve the scenario modal exit transitions.
- [x] Add unit coverage for forward/reverse wrapping, outside-focus recovery, no-focusable-control fallback, hidden controls, and non-Tab keys.
- [x] Exact-head `6cecf2f` passed typecheck, full tests, production build, dead-code validation, and production dependency audit.
- [x] Both workflows passed: [Validate run 41198028237](https://github.com/armave/portfolio-terminal/actions/runs/41198028237) and [Pull Request CI run 41198028274](https://github.com/armave/portfolio-terminal/actions/runs/41198028274).

No authentication API calls, portfolio state, broker behavior, scenario calculations, or server authorization behavior changed. Browser and assistive-technology verification remains outstanding.

## Follow-on implementation — roadmap execution PR (2026-10-31)

**Working branch:** `chore/roadmap-implementation-2026-10-31`  
**Base:** `main` at `c60ee2ee115f754a86212c656423c0bea2b76eb7`

- [x] Optimize `buildHoldingsProjection`: build one normalized ticker-to-legacy-metadata index instead of rescanning the entire legacy holdings array for each canonical position.
- [x] Preserve compatibility semantics by retaining the first legacy row matching each normalized ticker.
- [x] Add regression coverage for whitespace/case normalization, duplicate legacy rows, and derived canonical fields.
- [x] Correct the Gateway/cloud-sync documentation: general Worker POST bodies are limited to 20 MB, authentication JSON bodies to 8 KB, and Durable Object cloud-state writes to 20 MB. Existing ticker and Gemini limits remain documented separately.
- [x] Exact-head `79fbb47dba5d174a234cd473950403386ae434bb` passed typecheck, full Vitest suite, dead-code validation, production dependency audit, and production build in both [Validate run 41201346038](https://github.com/armave/portfolio-terminal/actions/runs/41201346038) and [Pull Request CI run 41201346026](https://github.com/armave/portfolio-terminal/actions/runs/41201346026).
- [x] Consolidated into the final cross-device responsive and accessibility release gate below; no financial formulas, persisted schemas, broker order behavior or authorization rules were changed.

### Implementation notes

The compatibility projection is derived from canonical `PortfolioState.positions`; this change only reduces lookup work from O(P × H) to O(P + H), where P is the number of canonical positions and H is the number of legacy holdings. It does not change position quantities, tranches, targets, quote values, or retained user metadata.

## Follow-on implementation — indexed legacy cloud migration (2026-10-31)

- [x] Replace the per-holding scan of the full local closed-trade history with one latest-close index keyed by normalized ticker.
- [x] Preserve the legacy date-field precedence (`closedAt`, `exitDate`, `sellDate`, `date`), invalid-date fallback, and strict "rebuy must be later than latest close" rule.
- [x] Add regression coverage for multiple exits, case/whitespace-normalized tickers, and a legacy rebuy occurring after the latest close.
- [x] Exact-head `79fbb47dba5d174a234cd473950403386ae434bb` passed typecheck, full tests, dead-code validation, production dependency audit, and production build in both [Validate run 41201346038](https://github.com/armave/portfolio-terminal/actions/runs/41201346038) and [Pull Request CI run 41201346026](https://github.com/armave/portfolio-terminal/actions/runs/41201346026).
- [x] Keep financial calculations, saved data formats, and cloud authorization unchanged; the complete-history change only changes the read-only history request and the Cash & Balance follow-up only changes in-memory view state.

This reduces the closed-history lookup work from O(H × C) to O(H + C), where H is the number of legacy holdings and C is the number of local closed trades. Legacy tranche-date inspection remains proportional to the tranche count. Together with the earlier indexed compatibility projection, both read-only legacy migration lookups now build their indexes once per normalization pass.

## Follow-on implementation — Preact runtime store subscription snapshots (2026-10-31)

- [x] Apply immediate current-snapshot delivery to AI status, breakeven text, cloud status, cloud-sync status, and board-title subscriptions.
- [x] Keep the existing analyst-consensus snapshot behavior consistent with those stores.
- [x] Add regression coverage for subscribing after a value has already been published, subsequent updates, and listener cleanup.
- [x] Exact-head `79fbb47dba5d174a234cd473950403386ae434bb` passed typecheck, full tests, dead-code validation, production dependency audit, and production build in both [Validate run 41201346038](https://github.com/armave/portfolio-terminal/actions/runs/41201346038) and [Pull Request CI run 41201346026](https://github.com/armave/portfolio-terminal/actions/runs/41201346026).

The hooks register subscribers in effects. Immediate snapshot delivery on subscription closes the render-to-effect timing window in which a runtime update could otherwise be missed and leave a component displaying stale presentation state until a later update. This is presentation-state synchronization only; canonical portfolio data and persisted state are unchanged.


## Follow-on implementation — TradeNet quote 404 correction (2026-10-31)

- [x] Replace the incorrect `getQuotes` request with the documented `getStockQuotesJson` command and a `tickers` array for one-symbol quote requests.
- [x] Keep the Worker-side API-key signing flow and fixed read-only command allowlist; no browser-supplied TradeNet commands or trading actions are introduced.
- [x] Publish the Worker route change and server request typing directly to `main` in commits `598cc0617bf3101885d190158bdbd1c951a89fd8` and `c595607f2962a117ca5ffb5feda5e64dd6a92a47`.
- [x] Add a Worker integration-contract test on `main` in `4d2a6e42d3d3ce21ac645a78517bd671987a5e5f`, asserting the upstream path and exact request body.
- [x] Add frontend normalization support and regression coverage for the documented `ltp`, `pp`, `chg`, `pcp`, and `ltt` fields.
- [x] Merge the published `main` commits into this roadmap branch without dropping prior roadmap changes.
- [x] User confirmed the live authorized TradeNet quote and Terminal Quote action in the browser after deployment (2026-10-31).
- [x] Exact-head CI passed on `e9b30db165b7807c0134bf7d5ae50d62913d5f99`: [Validate run 41202393721](https://github.com/armave/portfolio-terminal/actions/runs/41202393721) and [Pull Request CI run 41202393803](https://github.com/armave/portfolio-terminal/actions/runs/41202393803) both passed install, typecheck, full tests, dead-code validation, production dependency audit, and build.

The screenshot showed the Worker returning HTTP 404 from the Freedom quote path after the Terminal requested `GOOGL.US`; the Yahoo quote path still returned a price. The failure was caused by the TradeNet command/parameter mismatch, not by the Terminal command parser. The correction preserves concurrent Yahoo lookup and the existing Finnhub/Twelve Data fallback, and does not change portfolio accounting, quote ordering, broker orders, persisted state, or authorization.


## Follow-on implementation — TradeNet API-key v2 HTTP 400 correction (2026-10-31)

- [x] Change the signed API-key POST body from the legacy `{ cmd, params }` envelope to the method parameters alone; the command remains fixed in `/api/{command}`.
- [x] Sign the exact serialized parameters body concatenated with the current Unix timestamp, matching the official API-key v2 rules.
- [x] Update Worker contract tests for `getStockQuotesJson`, `getNotifyOrderJson`, and `getUserCashFlows`; assert the quote request HMAC as well as its URL and parameters.
- [x] Update the Worker deployment path filter to include `src/services/freedomTradeNet.ts`, the shared adapter imported by `worker.js`.
- [x] Publish the corrected helper and Worker tests directly to `main`; corrected Worker deployment passed [run 41202950522](https://github.com/armave/portfolio-terminal/actions/runs/41202950522).
- [x] User confirmed a live authorized quote request in the app after the API-key v2 body correction (2026-10-31).


## Follow-on implementation — TradeNet quote response envelope (2026-10-31)

- [x] Add support for the documented TradeNet `q` array of quote records, including `data.q` wrappers.
- [x] Keep compatibility with the existing `quotes`, `quote`, and other known response envelopes.
- [x] Add regression tests for top-level `q` and nested `data.q`, using the documented quote fields `ltp`, `pp`, `chg`, and `pcp`.
- [x] Update the Worker integration fixture to return the documented `q` envelope rather than a synthetic `quotes` envelope.
- [x] Exact-head PR CI passed: [Validate run 41203373484](https://github.com/armave/portfolio-terminal/actions/runs/41203373484) and [Pull Request CI run 41203373440](https://github.com/armave/portfolio-terminal/actions/runs/41203373440).
- [x] User confirmed a live quote from the authorized broker account and the Terminal Quote action (2026-10-31).

The latest screenshot no longer showed an HTTP error. The Worker returned a successful payload, but the frontend parser did not inspect the `q` property, so it treated the response as an unsupported quote. TradeNet's published quote example uses a `q` array containing records with `c`, `ltp`, `pp`, `chg`, and `pcp`; the parser now unwraps that array before normalizing the record.


## Follow-on implementation — typed broker execution metrics boundary (2026-10-31)

- [x] Replace the unrestricted `Record<string, any>` execution input with an allowlisted `BrokerExecutionMetricInput` interface.
- [x] Preserve supported broker and legacy fields (`ticker`, `side`, `quantity`, `shares`, `executedAt`, `date`, `commission`, and commission-currency aliases) without assuming their runtime values are already valid.
- [x] Keep input values as `unknown` until the existing normalization/parsing steps validate them.
- [x] Make the calculation generic over the original execution object type so result-map keys remain the same object references.
- [x] Add coverage for numeric-string/legacy aliases and for malformed quantities/dates.
- [x] Both exact-head workflows passed on `353e12d86069ee473d75a8b110c953e6e7ce7e1b`: [Validate run 41203926396](https://github.com/armave/portfolio-terminal/actions/runs/41203926396) and [Pull Request CI run 41203926480](https://github.com/armave/portfolio-terminal/actions/runs/41203926480) both passed typecheck, all tests, production build, dead-code validation, and production dependency audit.

This is a boundary-typing and test-coverage change only. The FIFO matching order, tolerance, commission-cent allocation, holding-period calculation, and incomplete-history behavior remain unchanged.


## Follow-on implementation — typed TradeNet execution response normalization (2026-10-31)

- [x] Change `normalizeFreedomTrades` to accept `unknown` instead of `any`.
- [x] Narrow the supported response envelopes, trade collections, and individual rows before reading broker fields.
- [x] Preserve stable fallback IDs and existing TradeNet aliases for ticker, side, quantity, price, commission, and fees.
- [x] Normalize numeric execution timestamps to the declared string output type and keep `raw` constrained to a record.
- [x] Add regression coverage for null/primitive/malformed envelopes and numeric timestamps.
- [x] Exact-head validation and PR CI passed on `8ddb729785a4d4e5b49b11161e2792c51af24e7b`: [Validate run 41204009743](https://github.com/armave/portfolio-terminal/actions/runs/41204009743) and [Pull Request CI run 41204009739](https://github.com/armave/portfolio-terminal/actions/runs/41204009739).

This extends the P2 typed-boundary work to the untrusted API edge. It does not change the normalized `FreedomExecutedTrade` field set, saved history schema, FIFO allocation, commissions, P/L, or account authorization.


## Follow-on implementation — complete TradeNet execution history for FIFO calculations (2026-10-31)

- [x] Trace the missing Trades metrics to a server request bounded to the latest 100 TradeNet executions (`max: 100`, `sort: 1`).
- [x] Change the read-only Worker request to `getTradesHistory` with `sort: 0` and no `max`, matching TradeNet's documented full-history mode.
- [x] Add a Worker integration test asserting the request body contains `{ sort: 0 }` and no `max`, and that older opening buys are returned with recent sells.
- [x] Update Trades/history comments and the market-data integration notes to record the full-history requirement for FIFO duration and buy-commission matching.
- [x] User confirmed the complete-history Trades recalculation issue was resolved after deployment (2026-10-31).
- [x] Exact-head Validate and Pull Request CI passed on the full-history follow-up before later Cash & Balance work; latest exact-head checks are recorded in the Cash & Balance stale-history section below.

The screenshot showed sell rows with known selling fees but missing holding duration/net P&L. `ClosedHistoryDesk` computes buy commission and holding duration by FIFO-matching sells against opening buys. The Worker had been requesting only the latest 100 executions, which can exclude older opening lots. TradeNet's `getTradesHistory` documentation states that `sort=0` with `max` omitted returns the full history count; this request now removes the artificial latest-100 cap. Financial formulas and persisted schemas are unchanged.

Source: [TradeNet — Retrieving trades history](https://tradernet.com/tradernet-api/get-trades-history?site_lang=en).



## Follow-on implementation — Cash & Balance stale broker-history UX (2026-10-31)

- [x] Restore account-authorized broker executions from the current portfolio snapshot first, then the separately persisted closed-history snapshot when in-memory history is empty.
- [x] Preserve the last good execution rows when a broker refresh fails; transition the view to a stale state instead of clearing the execution list.
- [x] Expose a localized stale-data warning with a keyboard-focusable Retry control; retain the current rows while retrying and clear the warning only after a successful response.
- [x] Show an actionable first-load error and Retry control when no usable snapshot exists.
- [x] Keep guest views isolated from account-wide history: do not restore administrator saved history or subscribe to account-wide broker execution events when a guest user ID is present.
- [x] Add reducer tests for saved-history fallback, current-snapshot precedence, stale retention, empty first-load failure, retry recovery and non-requesting guest state.
- [x] Reuse existing Russian translations for all warning, loading, retry and accessible-label strings; no untranslated user-facing copy was introduced.
- [x] Exact-head CI passed on `632406b46273581f56059c70651a5111a458bdf4`: [Validate run 41205417977](https://github.com/armave/portfolio-terminal/actions/runs/41205417977) and [Pull Request CI run 41205417990](https://github.com/armave/portfolio-terminal/actions/runs/41205417990).
- [x] User verified the Cash & Balance stale-history warning/retry and guest-directory retry behavior in the browser (2026-10-31).

The previous Cash & Balance error listener cleared `executedTrades` on `broker:executed-trades-error`, which could make active tranches disappear despite a usable saved snapshot. The new reducer keeps the latest available records and changes only the status. The UI distinguishes loading, refreshing, stale-with-data and error-without-data. This is presentation/state handling only; it does not modify broker execution records, portfolio calculations, saved schemas or guest authorization.



## Follow-on implementation — first-load Balance hydration race (2026-10-31)

- [x] Fix `usePortfolio()` subscription semantics by registering the store listener and then immediately replaying the latest portfolio snapshot.
- [x] Preserve subsequent live store updates and clean up the listener on unmount.
- [x] Reconcile the latest portfolio store's `brokerExecutedTrades` into Cash & Balance's local execution-history reducer after its subscription is installed.
- [x] Cover immediate snapshot delivery, subsequent updates and unsubscribe behavior in `portfolioStore.test.ts`.
- [x] Exact-head CI passed; user confirmed the first-load Balance issue is resolved in the browser.

The screenshots show that the initial Balance mount displayed one unassigned GOOGL holding and zero active tranches, while navigating away and returning showed the correct AR/SU split and seven active tranches. The store hook previously read the current state during render but only subscribed later in `useEffect`; a broker/account hydration update between those phases could be missed. Returning to Balance mounted a new consumer against the already-updated store and therefore appeared to fix itself. The hook now subscribes first and replays the current state, closing that render-to-effect gap for all portfolio consumers. Cash & Balance also reconciles the canonical execution snapshot into its local reducer so it cannot remain on an obsolete first-render copy. No broker data, allocation rules, financial calculations or persisted schemas were changed.


## Guest directory refresh resilience

- [x] Keep the last successful guest list while a refresh is running or fails.
- [x] Distinguish first-load errors from stale data and provide a retry action.
- [x] Ignore late responses from older requests or an unmounted desk using a request generation guard.
- [x] Add reducer tests for loading, stale retention, first-load failure and recovery.
- [x] Add Russian translations for the new retry and warning copy.
- [x] Exact-head Validate and Pull Request CI passed on `fc6d8bd58e24532e61379c20524302217490e964`: [Validate run 41206865670](https://github.com/armave/portfolio-terminal/actions/runs/41206865670) and [Pull Request CI run 41206850371](https://github.com/armave/portfolio-terminal/actions/runs/41206850371). Browser verification of stale-directory retry remains open.

The previous guest directory error handler cleared the guest list on request failure and offered no retry. The new state reducer preserves known users and therefore preserves their existing active-tranche assignments during temporary directory outages. It does not modify saved assignments, tranche quantities, or guest permissions.


## Manual validation update — broker/guest retry flows (2026-10-31)

- [x] User confirmed the Cash & Balance stale-history warning and retry behavior in a real browser.
- [x] User confirmed the guest-directory retry behavior in a real browser.
- [x] First-load Balance hydration behavior confirmed resolved by the user.
- [x] Trades calculation recovery confirmed resolved by the user.
- [x] Live TradeNet Quote confirmed working by the user.
- [ ] Complete broader cross-device responsive and assistive-technology QA for Cash/Balance, Margin, Closed History, Guest LOTS, Settings and News, including keyboard navigation, visible focus, dialog focus handling and small-screen table interactions.

Only the broader UX/accessibility sign-off remains as a manual release gate; the automated code-quality checks are green on the current PR head.

## Stage 10 — responsive and accessibility QA implementation (2026-11-01)

- [x] Standardize the News article and Market Depth dialogs on the shared focus manager: initial focus, forward/reverse Tab containment, Escape, body-scroll locking, and focus restoration to the invoking control.
- [x] Prefer the invoking trigger for focus restoration when it remains connected; safely fall back to the previously active element when it does not.
- [x] Convert Market Depth bid/ask levels into semantic tables with captions and scoped column headers while retaining the read-only order-book presentation.
- [x] Make the Margin projection table a named, keyboard-focusable horizontal scroll region while preserving its existing DOM id and CSS hooks.
- [x] Add explicit column-header scope to Cash & Balance, Guest LOTS, Closed History, and Settings tables.
- [x] Add accessible names to the Settings new-user name and password fields using existing English/Russian dictionary entries.
- [x] Add regression coverage for focus restoration and the Stage 10 modal/table/form accessibility wiring.
- [x] Complete real-browser responsive checks for Cash/Balance, Margin, Closed History, Guest LOTS, Settings, and News on phone, tablet, and desktop viewports (user confirmed complete, 2026-11-01).
- [x] Complete manual keyboard-only and assistive-technology review, including focus order, visible focus, dialogs, table scrolling, and screen-reader table navigation (user confirmed complete, 2026-11-01).

The implementation is client-side presentation and accessibility work only. It does not change portfolio calculations, broker requests or orders, account permissions, persisted data formats, Worker routes, or server authorization. User confirmed the real-browser cross-device, keyboard-only, and assistive-technology release checks complete on 2026-11-01.

## Stage 11 — Market Insights request lifecycle and ticker navigation (2026-11-01)

**Finding**

The Market Insights section was keyed by the active portfolio view. Switching between ticker tabs remounted the panel, resetting the selected insight tab and the Stocktwits opt-in state. Since the panel's News effect ran on mount regardless of the selected insight tab, navigating ticker-to-ticker while viewing Fundamentals, Earnings, or Analysts could trigger an unnecessary News request for each newly mounted panel.

**Implementation**

- [x] Keep the Market Insights panel mounted across ticker-view changes by removing its active-view-specific key; keep the trading console's existing key unchanged.
- [x] Add a pure request policy: News is requested only while the News tab is selected; Yahoo deep data is requested only for Fundamentals, Earnings, or Analysts; Stocktwits remains gated by explicit user opt-in.
- [x] Preserve the selected insight tab and the Stocktwits opt-in preference while switching between ticker tabs.
- [x] Keep the first Stocktwits opt-in on the normal cache path; only subsequent explicit Refresh clicks bypass the cache.
- [x] Scope displayed News, Stocktwits, and Yahoo deep-data results/status to the current ticker so late or retained data from another ticker is not shown under the selected symbol.
- [x] Abort and invalidate prior Yahoo deep-data work when the selected ticker changes or the user leaves the deep-data tabs; share one in-flight payload across Fundamentals, Earnings, and Analysts.
- [x] Retain the existing provider-service caches, TTLs, request coalescing, subscriber-scoped cancellation, forced-refresh semantics, and closed-market request gate; no duplicate cache or networking layer was added.
- [x] Add tests for request-policy decisions, per-symbol News request counts/cache reuse, panel mount stability, request gating, ticker-scoped rendering, cancellation, and Stocktwits opt-in versus explicit refresh.

**Scope**

Client-side request lifecycle and presentation state only. No provider endpoints, Worker routes, broker requests/orders, portfolio accounting, financial calculations, persisted schemas, authorization, or dependencies changed. The old `perf/onload-request-optimization` branch was not rebased or cherry-picked: it is 2 commits ahead and 646 behind current `main`, and its changes target obsolete window-event/prop bridge assumptions. The useful current-scope behavior was implemented against the present typed Preact architecture instead.

**Release validation**

- [ ] Exact-PR-head GitHub Actions: typecheck, Vitest, production build, dead-code validation, and production dependency audit.
- [ ] Browser network-panel verification that switching ticker tabs while on Fundamentals/Earnings/Analysts does not request News, while the selected deep-data request remains scoped to the new ticker.
- [ ] Verify News/Stocktwits opt-in, cached revisit, explicit refresh, and rapid ticker switching with delayed responses in a real browser.

No live browser network trace or manual request-count measurement is claimed by this implementation. Automated request-count/policy regression tests are included; the browser network review remains a separate release check.


## Stage 12 — Market Depth snapshot recovery (2026-11-02)

**Finding**

The Market Depth modal cleared its last successful order-book snapshot whenever it opened or refreshed. A transient TradeNet failure therefore removed the last usable book and replaced it with an error, even when the failed request was only a refresh of already displayed data.

**Implementation**

- [x] Retain the last successfully normalized order-book snapshot when a refresh fails.
- [x] Scope a retained snapshot to its normalized ticker so data from a previous ticker is never rendered under a new symbol.
- [x] Show a clear refreshing status while keeping a same-ticker snapshot visible.
- [x] Show a stale-data warning on refresh failure and keep the header retry action available.
- [x] Make a failed first load actionable by changing the header control to Retry.
- [x] Add regression wiring and English/Russian localization tests.

**Scope**

Client-side Market Depth presentation and localization only. No broker order behavior, API/Worker route, financial calculation, account permission, provider contract, or persisted schema changes.

**Validation**

- [x] Implementation head `c626475e7c50fc0ed6dbfedc01ca43ee562c5826` passed both [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/41388314307) and [Validate](https://github.com/armave/portfolio-terminal/actions/runs/41388314318): typecheck, full tests, production build, dead-code validation, and dependency security audit.
- [ ] Browser verification of successful initial load, refresh failure with a retained snapshot, retry recovery, and ticker changes.
