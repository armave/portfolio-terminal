# Preact Integration — Progress Tracker

## Goal
Complete the remaining Preact integration without adding a second renderer or changing portfolio calculations, persistence formats, provider behavior, or the Worker boundary.

## Baseline audit
- [x] Audited the repository tree and runtime entry points via GitHub API.
- [x] Confirmed main already uses Preact 11, TypeScript, Vite's Preact preset, and a single root rendered by src/main.ts.
- [x] Confirmed app.ts remains active runtime orchestration; it must not be removed based on size or legacy shape alone.
- [x] Confirmed the UI has a typed in-process event channel (src/ui/uiEventBus.ts) and shared reactive state (src/ui/uiStateStore.ts).
- [x] Addressed the original integration gap: App consumes portfolio state directly, and component-crossing UI operations use typed requests or Preact-owned rendering instead of mutating sibling DOM.

## This PR
- [x] Replace redundant local mirrors of values already provided by uiStateStore with direct shared-state hook usage in App; shared-state changes update the rendering component directly.
- [x] Keep event delivery for transient commands/requests (auth visibility, modal open, margin-intelligence request, startup state); remove redundant prop-bundle event subscriptions.
- [x] Preserve the single App root and component identity; financial calculations, provider behavior, and persisted schemas are unchanged by this migration.
- [x] Add regression coverage for typed transient event delivery, listener removal, payload-free events, command-prefill requests, and backup-import requests in `src/ui/uiEventBus.test.ts`.
- [x] Move command prefill from direct DOM mutation to a typed request handled by the Preact-owned `TradingConsole`.
- [x] Route scenario-comparison quick-action command prefill through the same typed request, preserving its cursor-at-end behavior.
- [x] Keep scenario-comparison focus trapping on component-owned refs instead of looking up its dialog controls globally.
- [x] Move the backup file input into `App`, the single Preact root owner; `SettingsDesk` no longer owns an input that sibling UI locates by id.
- [x] Source-level review confirms transient event subscriptions are removed on unmount; the remaining shared UI store is limited to scalar runtime presentation state, not component prop bundles.
- [x] Move terminal log rows, scenario-report dialog, and error toasts into Preact renderers backed by an in-memory notification store; runtime notification functions now publish state instead of creating or replacing DOM nodes.
- [x] Typecheck, tests, production build, dead-code validation, and production dependency audit passed in both workflows on implementation head `2f01939d365af369c402d7c5810ccd13fbd32158`: [Validate](https://github.com/armave/portfolio-terminal/actions/runs/40700051081) and [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/40700050880). This tracker-only update should be checked against the live PR workflows before merge.

## Validation policy
Typecheck, tests, production build, dead-code validation, and production dependency security audit must pass on the exact final PR head before merge. Keep the PR draft for human review. A local clone could not be established in the current environment, so no local validation is claimed.


## Notification and component-boundary completion
- Terminal log messages, error toasts, and scenario-report display are held in an in-memory notification store and rendered through Preact components.
- Runtime notifications no longer call `document.createElement`, `innerHTML`, or append/replace child nodes.
- The command textarea is updated only by the `TradingConsole` that owns it; command prefill requests are typed.
- The backup file picker is owned by `App`, and both Settings and the empty-state shortcut request it through the typed event bus.
- The scenario comparison modal now uses component refs for its dialog and close button; focus trap and scroll locking remain lifecycle effects.


## Stocktwits feed follow-up
- [x] Keep excluding replies but stop filtering out standalone posts solely because they contain multiple cashtags or little commentary.
- [x] Display up to the ten newest standalone messages returned by the existing Stocktwits stream.
- [x] Add regression coverage proving ten posts are shown when available and replies remain excluded.
- [x] Typecheck, tests, production build, dead-code validation, and production dependency audit passed on Stocktwits implementation head `bb3e6fa9734c67e9ff7ae5af83e481bb6ee8c7ea`: [Validate](https://github.com/armave/portfolio-terminal/actions/runs/40701076600) and [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/40701076162).


## Workspace navigation ownership — 2026-10-30

- [x] Removed the two remaining application-runtime lookups of `#mainTerminalView` from `app.ts`. Cloud-state restore and initial startup now publish a typed `terminal:scroll-workspace` request instead of finding and scrolling a sibling DOM node.
- [x] The Preact-owned `App` holds a ref to its workspace `<main>`, subscribes to the typed request in its layout effect, and performs the smooth scroll against that owned element. The subscription is removed on unmount.
- [x] Added event-bus regression coverage for the payload-free workspace navigation request.
- [x] Migrate TradeNet account, executed-trade, active-order, request/error and tranche-classification messages away from untyped `window` CustomEvents into a typed in-process broker event channel.
- [x] Remove component prop mirrors from `uiStateStore` and stop `renderBoard.ts` from publishing component props; components now read canonical portfolio state through Preact hooks or consume typed action requests.
- [x] Keep browser/platform operations (visibility lifecycle, file downloads, autofill compatibility and element measurement/focus/scroll through component refs) in focused effects or infrastructure helpers; these are not reasons to introduce a second renderer.
- [x] Re-run typecheck, Vitest, production build, Knip and dependency audit on the final PR head. A local clone was attempted but this environment cannot resolve `github.com`; CI is the validation source for this pass.


## Broker event ownership — 2026-10-30
- [x] Replace TradeNet account, executions, active-order, fetch-request, fetch-error, and tranche-classification `window` CustomEvents with a typed in-process broker event channel.
- [x] Remove the `window.__tradenetAccountInfo` and `window.__tradenetExecutedTrades` caches; broker executions are read from the canonical portfolio store and refreshed through typed broker events.
- [x] Keep Freedom normalization, portfolio classification, fee preservation, active limit-sell target selection, persistence, and cloud synchronization behavior in their existing service/domain owners.
- [x] Add focused tests for broker payload delivery, multiple subscribers, unsubscribe behavior, and payload-free refresh requests.
- [x] Remove the remaining `uiStateStore` / `renderBoard.ts` prop-mirror boundary; data-driven views now subscribe to portfolio state directly, and transient actions use typed requests.
- [x] Audit TradeNet event producers/consumers; no `tradenet:*` browser custom-event contract remains in the migrated runtime path. Retain actual browser platform APIs only where they are the appropriate integration boundary.


## Active desk state ownership — 2026-10-30
- [x] Remove the duplicated active-desk state mirror from `uiStateStore`; the Preact app now subscribes directly to the portfolio store and applies the same pure `resolveActiveView` selector used by the presentation bridge.
- [x] Keep the view-fallback rule in one shared selector so stale/missing ticker views still resolve to `COMBINED`.
- [x] Migrate ticker navigation, console execution, market insights, external links, empty state, settings, cash cushion, summary metrics and projections to store-backed components or typed UI action requests.


## Summary metrics store ownership — 2026-10-30
- [x] Remove the full `BoardState` snapshot from `SummaryMetricsGridProps`; the Preact component now subscribes directly to the portfolio store.
- [x] Remove the Summary Metrics prop bundle; the component reads broker rules and portfolio data directly from the portfolio store.
- [x] Move projection calculation inputs into `src/domain/portfolioSelectors.ts`; the Preact table derives them from canonical portfolio state.
- [x] Move quote refresh interval subscription into the shared `useQuoteRefreshInterval` hook so Settings changes update both Summary Metrics and Cash Cushion.


## Preact prop-bridge completion — 2026-10-30
- [x] Remove the generic `UiPropStateMap`, its setter/listener machinery, and all `use*Props` / `set*PropsState` APIs from `uiStateStore`.
- [x] Remove child-view-model publishing from `renderBoard.ts`; it remains a board-summary orchestrator and pure domain-selector consumer, not a second renderer.
- [x] Move combined/single-position projection calculations and tranche entry-date resolution to `src/domain/portfolioSelectors.ts`, with regression tests for combined and single-position input derivation and earliest/legacy dates.
- [x] Make Settings, Ticker Tabs, Trading Console, Market Insights, External Links, Empty State, Cash Cushion, Summary Metrics, and Projections Preact-owned components that read canonical state directly.
- [x] Route navigation, command execution, backup import, Settings actions, quote refresh requests, and broker requests through typed event channels; keep financial logic and asynchronous service effects in their existing runtime/domain owners.
- [x] Share the live quote refresh interval through `useQuoteRefreshInterval`, which reads persisted configuration and subscribes to Settings changes.

## Final Preact boundary audit — 2026-10-30
- [x] Replace the synthetic `CustomEvent` façade in the in-process UI event bus with plain typed application messages; listener identity is now preserved independently in each event channel.
- [x] Add regression coverage for removing a shared callback from one channel without affecting another.
- [x] Replace tab-navigation sibling DOM queries/click synthesis with Preact-owned button refs, explicit view selection, and tested keyboard index resolution.
- [x] Replace AuthModal form queries and post-submit browser timeout focus with button refs and Preact effect-driven focus restoration.
- [x] Final PR-branch source scan finds no `CustomEvent` use, imperative HTML renderer APIs, generic component prop-state bridge, or component-level DOM query selectors.
- Remaining browser APIs are limited to application bootstrap/autofill configuration, visibility lifecycle, file download, element-owned text-area sizing, focus/keyboard/resize handling, and ref-based scrolling. These remain browser/platform responsibilities and do not create a second renderer.
