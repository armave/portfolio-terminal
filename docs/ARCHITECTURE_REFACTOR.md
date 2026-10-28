# Portfolio Terminal Architecture Refactor

## Objective

Improve maintainability and state consistency without changing the application's financial meaning, existing user workflows, persisted data formats, or provider integrations. This document is the implementation contract for the architecture refactor; it does not authorize a financial formula change without a dedicated regression test.

## Current architecture

The app already separates several responsibilities:

- `src/domain/`: financial calculations, portfolio selectors, and trading calendars.
- `src/store/portfolioStore.ts`: canonical margin positions, cash holdings, mutations, and subscriber notifications.
- `src/services/`: persistence, quote polling/provider orchestration, and API access.
- `src/features/quotes/` and `src/features/ai/`: provider-specific and AI integration logic.
- `src/features/terminal/`: deterministic command dispatch and scenario evaluation.
- `src/components/`: presentation and user interaction.

Active margin positions in `PortfolioState.positions` are canonical. `holdings` is a compatibility projection and must not become an independent source of truth.

## Target boundaries

1. **Presentation:** render state and send typed user actions; do not mutate domain objects or manually manipulate the DOM.
2. **Application orchestration:** parse commands, validate intent, request confirmation where required, and call domain/store operations.
3. **Portfolio store:** own state transitions, normalization, notifications, and persistence scheduling.
4. **Domain:** deterministic financial calculations and invariants, independent of browser APIs and network calls.
5. **Infrastructure:** provider adapters, browser storage, encryption, and cloud synchronization.

Do not add a new framework or replace the existing Preact/TypeScript/Vite stack solely to implement these boundaries.

## Work packages and acceptance criteria

### 1. Baseline and regression fixtures

- Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run validate:dead-code`.
- Record pre-existing failures before changing behavior.
- Preserve regression fixtures for margin interest, commissions, rollover timing, position lifecycle, projections, and exit scenarios.

### 2. Canonical state and atomic mutations

- Keep one authoritative active-position map.
- Treat `holdings` as a derived compatibility projection.
- Route UI edits, terminal commands, AI-confirmed mutations, and imports through the store's validated operations.
- Ensure failed operations cannot leave partial balance, quantity, or tranche changes.
- Preserve closed-trade history when an active position is fully liquidated.

### 3. Financial domain invariants

- Keep financial calculations pure and deterministic.
- Validate quantities, prices, dates, and broker assumptions at boundaries.
- Preserve established rounding and commission rules.
- Keep hypothetical scenario calculations read-only.
- Add tests before changing any formula or financial behavior.

### 4. Quote pipeline and asynchronous race protection

- Normalize provider responses before applying them.
- Apply quote results against the latest state, never a stale captured state snapshot.
- Reject older requests and quotes that predate a more recent trade.
- Do not recreate a position that has been closed.
- A rejected/no-op quote must not trigger persistence or notify UI subscribers.
- Provider failure must not erase an already valid quote.

### 5. Rendering and subscriptions

- Use typed props and store callbacks instead of global functions or imperative DOM updates.
- Keep transient UI state separate from persisted portfolio data.
- Avoid remounting unrelated components for a single quote update.
- Preserve terminal focus, scroll position, and unsaved settings edits during background refreshes.
- Optimize based on observed update behavior rather than blanket memoization.

### 6. Persistence and cloud synchronization

- Validate imports before committing state.
- Preserve legacy snapshot migration and existing exports.
- Keep credentials and encryption material out of ordinary portfolio serialization.
- Preserve encrypted Gist payload compatibility and stale-revision conflict detection.
- Never silently discard local changes after a failed cloud write.
- Add tests for malformed imports, storage failures, reloads, and conflicts.

### 7. Terminal and settings

- Keep deterministic commands deterministic and AI-produced mutations behind explicit confirmation.
- Keep command parsing, validation, execution, and presentation separable.
- Keep scenario evaluation read-only and its financial disclosures intact.
- Keep settings conversion centralized and avoid resetting active edits on prop updates.
- Use short, actionable error notifications; do not toast routine successful operations.

### 8. Consolidation

- Remove superseded mutation paths only after all callers use the replacement.
- Remove dead code and duplicate helpers where behavior is demonstrably identical.
- Update architecture documentation to describe the actual final implementation.
- Avoid unrelated feature work and unnecessary dependency additions.

## Required regression scenarios

- Buy, partially sell, and fully liquidate a margin position.
- Confirm cash, debt, tranches, commissions, realized P&L, and closed history.
- Exercise rollover boundaries and missed rollover accrual.
- Resolve concurrent quote responses out of order.
- Reject a quote that started before the latest trade.
- Confirm a quote for a closed ticker cannot recreate that position.
- Change balance and broker assumptions and verify dependent projections.
- Export, reload, import, and restore a representative portfolio.
- Reject malformed imports without replacing valid state.
- Reject stale cloud writes without overwriting newer remote state.
- Exercise quote, buy, sell, and compare-exits terminal commands.
- Verify settings edits and terminal focus survive background refreshes.

## Merge gate

The final PR head must pass:

```sh
npm run typecheck
npm test
npm run build
npm run validate:dead-code
```

All checks must be run against the same final commit. Also review the final diff for unexpected financial behavior changes, duplicate execution paths, secrets, unrelated files, and compatibility regressions. If the refactor uncovers an unrelated defect, document it separately unless it blocks a required invariant.

## Implementation progress

The refactor is being delivered in small, regression-tested slices on one draft PR.

**Step 2 of 8 — Canonical state and atomic mutations: complete for the current migration slice.**

- Treats an updater that returns the exact current state object as an explicit no-op, avoiding persistence and subscriber notifications for rejected stale quotes.
- Routes cash-holding additions/removals, AI-confirmed cash sales, AI-confirmed margin sales, and AI-confirmed buys through store-owned operations.
- Commits sale accounting together: position quantities, debt, free cash, realized margin charges, and closed-trade history.
- Routes target-price changes, explicit margin-debt changes, rollover accounting/timestamps, startup snapshots, cloud pulls, backup imports, reset, view changes, and gateway-secret state updates through the store.
- Removes the `syncStore` whole-state import bridge; the runtime now receives store state through its subscription instead of repeatedly re-importing the entire snapshot.

**Step 3 of 8 — Financial domain invariants: complete for the current slice.**

- Added expected-value coverage for FIFO buy-commission allocation, sale proceeds/debt repayment, net realized P&L, invalid sale requests, and immutable prior snapshots.
- Kept the existing financial formulas unchanged; commission floating-point comparisons use a monetary tolerance.

**Step 4 of 8 — Quote pipeline and asynchronous race protection: complete for the current slice.**

- Makes a new buy execution price authoritative over older in-flight quotes and clears stale quote metadata.
- Restricts batch polling to normalized, deduplicated requested tickers and ignores unexpected provider symbols.
- Ensures failed batch and fallback providers do not overwrite a valid tracked quote.
- Guards quote change-percentage calculations against invalid previous-close values so they remain finite.
- Uses the shared `QuoteDetails` type rather than `any` in the batch polling callback contract.

Regression tests cover quote ordering, unexpected symbols, deduplicated inputs, provider failures, and finite quote percentages. The latest head passed typecheck, Vitest, production build, and dead-code diagnostics.

**Step 5 of 8 — Rendering and subscriptions: complete for the current slice.**

- Rendering helpers no longer mutate canonical portfolio state to repair an invalid active view or initialize cash state; the store normalizes unsupported views before rendering.
- Hidden desks skip derived-metric and market-insights refreshes.
- Settings form rendering is cached by broker-rule values, so quote refreshes do not rerender an unchanged settings form or discard unsaved edits; explicit restore-defaults still forces a render.
- The terminal and board continue to render into stable Preact roots, preserving component state across data updates.

The latest head passed typecheck, Vitest, production build, and dead-code diagnostics.

**Step 6 of 8 — Persistence and cloud-sync conflict scenarios: complete for the current slice.**

- Extracted backup replacement into a small transaction helper that restores the prior snapshot if persistence returns false or throws.
- Added tests for backup import success and rollback on both failure modes.
- Added coverage proving concurrent cloud pushes serialize and the next write uses the revision returned by the prior write.
- Retained existing coverage for cloud revision conflicts, failed local persistence, invalid/decryption-failed cloud payloads, and local/cloud migration boundaries.

The latest head passed typecheck, Vitest, production build, and dead-code diagnostics.

**Step 7 of 8 — Terminal and settings cleanup: complete for the current slice.**

- Removed the legacy `Object.assign(window, ...)` function registry and the matching service fallbacks that depended on it.
- Replaced Cash Desk balance/add-stock and ticker-tab refresh globals with typed callbacks passed through `renderBoard`.
- Removed obsolete global-only DOM helpers and imports.
- Kept settings render behavior behind a typed callback; unchanged settings rules do not trigger rerenders during quote refreshes, and restore-defaults still forces the expected update.

The latest head passed typecheck, Vitest, production build, and dead-code diagnostics.

**Step 8 of 8 — Consolidation and final audit (in progress).**

- Extracted a shared sale-commission helper and a shared debt-first proceeds-settlement helper.
- Consolidated regular terminal sales and AI-confirmed margin sales into one store-owned sale transaction. `sellMarginPosition` now validates AI-confirmed inputs and delegates to `sellStock`, passing the confirmed close timestamp while reusing the same FIFO tranche allocation, commission, margin-interest, debt/cash settlement, and closed-trade construction.
- Preserved safety checks for invalid quantities, attempts to sell more shares than are held, and closed-ticker behavior. Partial sales no longer carry a one-shot margin charge forward and count it again.
- Added parity coverage comparing terminal and AI-confirmed sales under the same position and broker assumptions, including remaining position, debt, cash, realized margin charges, commissions, and realized profit.
- The current code/test head passed all four merge gates: typecheck, Vitest, production build, and dead-code diagnostics.

**Known boundary kept separate:** the active runtime rollover uses the configured timezone and batch debt projection, while the legacy cloud-import `processRollovers` path uses the historical Asia/Yerevan boundary and per-cycle rounding. These are not assumed equivalent; combining them without a decision about the existing financial rounding contract could change persisted debt. Keep both paths covered independently rather than silently changing the formula during this refactor.

The remaining work is the final repository diff review and compatibility audit. Keep the PR in draft until the latest head passes the merge gates and the audit finds no unintended financial, persistence, quote, or UI regressions.


## Cleanup audit progress — 2026-10-28

**Status: in progress; keep the pull request in draft until all gates pass.**

- [x] Audited the current `main` tree, runtime entry points, package scripts, TypeScript inclusion, Knip configuration, and existing CI workflows through the repository API.
- [x] Confirmed `src/main.ts` imports the root `app.ts`, and `app.ts` mounts `src/App.tsx`; the root runtime is active and must not be deleted merely because it is large or legacy-shaped.
- [x] Removed the unused `onToggleMarketInsights` prop from `AppProps` and its sole call-site argument. The component did not consume the prop; market-insights events are wired through the existing application event flow.
- [x] Corrected the README architecture map to match the actual checked-in source tree and separate browser runtime from the Cloudflare Worker.
- [x] Ran the merge gates on PR head `7ae2b9ddb94059887f1851447cc73b3fd7edb124`: TypeScript typecheck passed, all 343 tests across 24 files passed, Knip dead-code validation passed, production dependency audit reported 0 vulnerabilities at the configured high threshold, and the production build completed.
- [x] Removed the confirmed orphaned `toggleMarketInsights()` wrapper identified by the first CI run (`TS6133`); no broader code was removed solely based on size or age.
- [ ] Review any future Knip/import-graph findings and investigate duplicate execution paths before further removals.
- [ ] Finish a deeper compatibility review of financial calculations, backup migration, encrypted cloud sync, Worker APIs, and deployment workflows.
- [ ] Review the final diff and latest CI results before marking the PR ready for review.

- [x] Investigated the first PR CI failure: TypeScript reported `app.ts(657,10): TS6133` for `toggleMarketInsights`, a now-unused wrapper left behind after removing the obsolete callback prop.
- [x] Removed the unused `toggleMarketInsights` function; the panel refresh path remains available through `syncMarketInsightsPanel`.

**Execution limitation:** a local `git clone` was attempted but the environment could not resolve `github.com`. Repository source was inspected through GitHub's repository API instead; no local test command is represented as having passed. CI results for the exact PR head are required before merge.


**CI result recorded 2026-10-28:** the PR head `7ae2b9ddb94059887f1851447cc73b3fd7edb124` passed both PR validation workflows. The Pull Request CI run completed typecheck, tests (343/343), Knip validation, production dependency audit, and production build successfully. This is a verified checkpoint; later commits must be revalidated independently.
