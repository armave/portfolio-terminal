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
- [x] Replace redundant local mirrors of values already provided by uiStateStore with direct shared-state hook usage in App; shared-state changes now update the rendering component directly, without an intermediate mirrored useState/effect.
- [x] Keep event delivery for transient commands/requests (auth visibility, modal open, margin-intelligence request, startup state); removed the redundant prop-bundle event subscriptions from App.
- [x] Preserve the single App root and component identity; financial calculations, provider behavior, and persisted schemas were not changed.
- [ ] Add focused regression tests for the remaining shared-state/event lifecycle boundary; no test file exists yet for these modules.
- [x] Run typecheck, tests, production build, dead-code validation, and production dependency audit in the Validate workflow on final PR head `7d202733007e203908df6c18e9a7d204a878efca`.
- [x] Source-level review confirms removed prop-event listeners were duplicate deliveries of state already published through uiStateStore; transient event subscriptions remain and clean up on unmount.
- [ ] Update this progress tracker and PR body from the exact latest CI result (pending PR CI).

## Validation policy
Validation results (2026-10-28): [Validate workflow](https://github.com/armave/portfolio-terminal/actions/runs/40696258518) passed typecheck, tests, production build, dead-code validation, and production dependency audit on exact head `7d202733007e203908df6c18e9a7d204a878efca`. [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/40696258484) also completed typecheck, tests, dead-code validation, production dependency audit, and production build successfully on that exact head. Keep the PR draft for review of the migration boundary; no local validation is claimed.
