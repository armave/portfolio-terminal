# Preact Integration — Progress Tracker

## Goal
Complete the remaining Preact integration without adding a second renderer or changing portfolio calculations, persistence formats, provider behavior, or the Worker boundary.

## Baseline audit
- [x] Audited the repository tree and runtime entry points via GitHub API.
- [x] Confirmed main already uses Preact 11, TypeScript, Vite's Preact preset, and a single root rendered by src/main.ts.
- [x] Confirmed app.ts remains active runtime orchestration; it must not be removed based on size or legacy shape alone.
- [x] Confirmed the UI has a typed in-process event channel (src/ui/uiEventBus.ts) and shared reactive state (src/ui/uiStateStore.ts).
- [x] Found the remaining integration gap: App.tsx mirrors shared hook values into local component state with effects, while renderBoard.ts still publishes prop bundles through shared state. Some UI requests still use a typed event channel.

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
- [ ] Verify typecheck, tests, production build, dead-code validation, and production dependency audit on the final PR head before merge.

## Validation policy
Typecheck, tests, production build, dead-code validation, and production dependency security audit must pass on the exact final PR head before merge. Keep the PR draft for human review. A local clone could not be established in the current environment, so no local validation is claimed.
