# Architecture refinement implementation — 2026-11-02

**Repository:** `armave/portfolio-terminal`  
**Base:** `main` at `106dac5a414d6c6b8dbc6c2572ca0c93567d6534`  
**Implementation branch:** `refactor/architecture-refinements-2026-11-02`

## Scope and guardrails

This change is a behavior-preserving architecture slice. It does not change financial formulas, FIFO allocation, commissions, margin interest, rollover semantics, broker endpoints, authorization, cloud encryption, revision handling, or persisted portfolio formats.

## Completed in this PR

- [x] Make the live application state contract unambiguous: `src/types/portfolio.ts` owns the current `PortfolioState`; the older financial-domain snapshot type is explicitly named `LegacyPortfolioState`.
- [x] Add `createBlankPortfolioState()` as a complete typed factory for the current store contract.
- [x] Use the canonical factory for store initialization and reset. Reset explicitly preserves broker assumptions, provider keys, the signed-in session value, and the role-specific refresh preference.
- [x] Use typed canonical state in `app.ts` instead of an `any` variable and replace legacy blank-state imports with the canonical factory.
- [x] When clearing a workspace for session changes, clear portfolio-owned fields while retaining the existing device/account configuration.
- [x] Extract legacy holding and cloud-holding migration helpers into `src/store/portfolioMigrations.ts`; re-export the same functions from `portfolioStore.ts` so existing call sites and tests keep their import path.
- [x] Extract portfolio snapshot, selector, active-desk subscription adapters, and their Preact hook adapters into `src/store/portfolioSubscriptions.ts`; retain the existing `portfolioStore.ts` exports as compatibility wrappers.
- [x] Add focused Vitest coverage for immediate replay, changed-selection notifications, active-desk updates, and unsubscribe behavior.
- [x] Extract portfolio navigation and explicit live-quote refresh event bindings from `app.ts` into `src/services/portfolioNavigationRuntime.ts`, with account-role lookup at event time and disposable listeners.
- [x] Add focused tests for navigation permission changes, quote-refresh completion, and listener cleanup.
- [x] Extract the 714-entry Russian static-copy dictionary into `src/services/i18n-ru.ts`; retain the existing `translateText`, language state, and dynamic-translation API.
- [x] Add a production-build browser smoke test at 1440px, 768px, and 390px. The test stubs Worker auth status, verifies the Preact root mounts, and fails on uncaught page errors.
- [x] Run the browser smoke test from the existing Validate workflow without adding a permanent application dependency or changing the lockfile.

## Validation

The runtime-extraction code was validated on PR head `ab7887c78b3661995d289ac64c4a7f2fa608bd5c` by both GitHub Actions workflows:

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] `npm test` — **955 tests across 84 files passed**
- [x] `npm run validate:dead-code`
- [x] `npm run audit:dependencies` — passed at the configured high-severity threshold
- [x] `npm run audit:production` — **0 production vulnerabilities**
- [x] `npm run build`
- [x] Playwright production browser smoke at 1440px, 768px, and 390px

Actions evidence:
- [Validate run 41410697344](https://github.com/armave/portfolio-terminal/actions/runs/41410697344)
- [Pull Request CI run 41410697361](https://github.com/armave/portfolio-terminal/actions/runs/41410697361)

The CI-only browser runner is installed ephemerally. The repository manifest and lockfile are unchanged by that installation. The full dependency tree still has 9 low/moderate advisories (2 low, 7 moderate); these remain disclosed, not marked fixed.

The repository could not be cloned locally in this environment. All validation results above are from GitHub Actions, not local execution. This validation note itself is documentation-only; Actions will rerun on the updated PR head.

## Deliberate boundaries

The following larger boundaries remain coupled to shared session/cache/revision state and are not mechanically split in this slice:

- `app.ts` remains the runtime composition root. Broker, guest-sync, quote polling, command, and startup lifecycles share account-generation guards and request queues; extraction requires explicit typed dependency contracts and focused parity tests.
- `src/services/api.ts` remains the compatibility facade for cloud encryption/revisions, account-session validation, broker proxying, and guest publication. Provider-specific implementations already have dedicated modules. Further splitting must preserve shared secret resolution, session-bound caches, request coalescing, and cloud-write serialization.
- `PortfolioStore` remains the single state owner. This PR extracts migration/default-state responsibilities without introducing secondary stores or changing transaction semantics.
- The browser smoke test validates production mounting at three viewport sizes. Full authenticated user journeys (broker refresh, backup import/reset, cloud conflict handling, and guest/admin session switching) remain additional browser-test coverage rather than implied by this smoke check.

These boundaries are intentionally recorded so future refactors are driven by testable seams rather than file size alone.
