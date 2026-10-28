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
- [ ] Replace redundant local mirrors of values already provided by uiStateStore with direct shared-state hook usage where safe.
- [ ] Keep event delivery for transient commands/requests, and keep state publication only for values that genuinely cross the runtime/UI boundary.
- [ ] Preserve stable component roots and stateful forms; avoid changes to financial calculations and persisted schemas.
- [ ] Add focused tests for any new shared-state behavior or event lifecycle behavior.
- [ ] Run typecheck, tests, production build, dead-code validation, and production dependency audit in GitHub Actions on the final PR head.
- [ ] Review the final diff for duplicate subscriptions, stale callbacks, unintended UI remounts, and runtime compatibility.
- [ ] Update this progress tracker and PR body from the exact latest CI result.

## Validation policy
No test or build pass is claimed from the repository API inspection. GitHub Actions on the final PR head is the authoritative validation. Keep the PR draft until all checks pass.
