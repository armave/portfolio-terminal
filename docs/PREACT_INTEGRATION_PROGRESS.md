# Preact Integration — Progress Tracker

## Goal
Complete the remaining Preact integration without adding a second renderer or changing portfolio calculations, persistence formats, provider behavior, or the Worker boundary.

## Baseline audit
- [x] Audited the repository tree and runtime entry points via GitHub API.
- [x] Confirmed main already uses Preact 11, TypeScript, Vite's Preact preset, and a single root rendered by src/main.ts.
- [x] Confirmed app.ts remains active runtime orchestration; it must not be removed based on size or legacy shape alone.
- [x] Confirmed the UI has a typed in-process event channel (src/ui/uiEventBus.ts) and shared reactive state (src/ui/uiStateStore.ts).
- [x] Addressed the original integration gap: App consumes shared state directly, and component-crossing UI operations now use typed requests or Preact-owned rendering instead of mutating sibling DOM.

## This PR
- [x] Replace redundant local mirrors of values already provided by uiStateStore with direct shared-state hook usage in App; shared-state changes update the rendering component directly.
- [x] Keep event delivery for transient commands/requests (auth visibility, modal open, margin-intelligence request, startup state); remove redundant prop-bundle event subscriptions.
- [x] Preserve the single App root and component identity; financial calculations, provider behavior, and persisted schemas are unchanged by this migration.
- [x] Add regression coverage for typed transient event delivery, listener removal, payload-free events, command-prefill requests, and backup-import requests in `src/ui/uiEventBus.test.ts`.
- [x] Move command prefill from direct DOM mutation to a typed request handled by the Preact-owned `TradingConsole`.
- [x] Route scenario-comparison quick-action command prefill through the same typed request, preserving its cursor-at-end behavior.
- [x] Keep scenario-comparison focus trapping on component-owned refs instead of looking up its dialog controls globally.
- [x] Move the backup file input into `App`, the single Preact root owner; `SettingsDesk` no longer owns an input that sibling UI locates by id.
- [x] Source-level review confirms transient event subscriptions are removed on unmount and component props continue to come directly from `uiStateStore`.
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
- [ ] Run typecheck, tests, build, dead-code validation, and production dependency audit on the updated PR head.
