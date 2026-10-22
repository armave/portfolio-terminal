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

Implemented so far:
- Treats an updater that returns the exact current state object as an explicit no-op, avoiding persistence and subscriber notifications for rejected stale quotes.
- Routes cash-cushion holding additions/removals and AI-confirmed cash-holding sales through store-owned mutations.
- Routes AI-confirmed buys and margin-position sales through atomic store operations; the sale operation preserves the existing confirmed-action accounting path and commits position, debt, free cash, realized margin charges, and closed-trade history together.
- Routes AI target-price changes, explicit margin-debt changes, and view changes through the store.
- Makes a new buy execution price authoritative over an older quote and clears stale quote metadata.
- Restricts batch quote polling to normalized requested tickers and uses the shared `QuoteDetails` type instead of `any`.
- Keeps routine success/status feedback out of toast notifications while retaining actionable errors.

Regression tests cover stale-quote no-op behavior, quote-after-trade ordering, cash-holding mutations and sales, margin sale lifecycle, persistence, and unexpected symbols in provider batch responses.

Remaining work includes moving rollover/accounting and cloud-import transitions behind store-owned operations, reviewing the legacy runtime state bridge and duplicate sale paths, and completing the rendering/subscription and persistence/cloud-sync work packages. This is not yet a completed app-wide refactor; keep the PR in draft until the final head passes all merge gates and the remaining work is reviewed.
