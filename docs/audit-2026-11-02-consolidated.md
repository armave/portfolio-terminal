# Consolidated repository audit — 2026-11-02

**Repository:** `armave/portfolio-terminal`  
**Base branch:** `main`  
**Base commit:** `4b8787f4d75d335ae5a120a15fccf2e12e750dcd`  
**Implementation branch:** `audit/consolidated-quality-performance-2026-11-02`

## Executive status

The critical account/session-integrity and Market Insights/Market Depth behavior described by the audit roadmap was already implemented and merged into `main` before this pass. This PR does not duplicate those fixes. It closes the remaining automated audit gaps by adding real on-demand UI chunks, removing an ineffective dynamic import, splitting production from all-dependency security auditing, and reconciling the refinement checklist.

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| P0 — financial/account session integrity | Implemented on main | PRs #230–#235: guest session isolation, stale cloud read/write guards, cash/balance isolation, closed-history sync guards, session-bound reset |
| P1 — broker refresh recovery | Implemented on main | PR #236: retryable Trades cashflow refresh |
| P1 — Market Insights lifecycle | Implemented on main | Existing request policy, ticker scoping, opt-in Stocktwits, cancellation/cache behavior, and PR #237 deep-data retry |
| P1 — Market Depth/News safety | Implemented on main | PR #238 snapshot recovery; PR #239 localization; PR #240 ticker-scoped article dialog |
| P2 — dependency posture | Audited and made explicit in CI | Full audit records the dev-tooling advisories; new production-only audit checks runtime dependencies independently |
| P2 — bundle performance | Implemented in this PR | Lazy chunks for rarely used desks/dialogs; removal of redundant API dynamic import; source-level regression coverage |
| P3 — accessibility/localization | Automated coverage complete for implemented changes | Stage 10 user-confirmed browser QA; Market Depth English/Russian component wiring covered; remaining targeted browser checks stay open |
| P3 — release verification | Pending real browser | DevTools request tracing, Market Depth recovery, News dialog focus restoration, and lazy-load smoke test |

## Main-branch validation before this PR

On commit `4b8787f4d75d335ae5a120a15fccf2e12e750dcd`:

- Validate: [run 41390006428](https://github.com/armave/portfolio-terminal/actions/runs/41390006428) — success.
- Pull Request CI: [run 41390006478](https://github.com/armave/portfolio-terminal/actions/runs/41390006478) — success.
- GitHub Pages deployment: [run 41390006605](https://github.com/armave/portfolio-terminal/actions/runs/41390006605) — success.
- Vitest: 74 test files and 896 tests passed.
- Typecheck, production build, dead-code validation, and the full dependency audit threshold passed.

These results establish the base-branch state only. The PR-head runs are the gate for the changes in this document.

## Dependency/security findings

The full `npm ci` / `npm audit` output reported 9 advisories: 2 low and 7 moderate. The vulnerable dependency paths reported by npm are in the development/build toolchain and include:

- `deepmerge` through `@rollup/plugin-node-resolve` / `workbox-build`
- `glob` and its `minimatch` dependency
- `minimatch` through `filelist` / `jake` / `ejs`
- `@trickfilm400/rollup-plugin-off-main-thread`

The current audit command is `npm audit --audit-level=high`; therefore a successful job does not assert that all low/moderate advisories are fixed. The affected lockfile entries are marked development dependencies. This PR adds `npm audit --omit=dev --audit-level=high` as a separate CI check in Pull Request CI, Validate, and Pages build workflows, making the runtime dependency surface independently visible.

No lockfile update is included. A transitive remediation must be generated with npm, reviewed, then validated with a clean install, full tests, production build, and PWA generation. Applying a blanket lockfile edit without running those checks would be less safe than recording the remaining dev-tooling advisory debt.

## Performance findings and changes

The main-branch build before this PR reported:

- JavaScript entry chunk: 603.27 kB minified / 184.51 kB gzip.
- Vite warning: `src/services/api.ts` was both dynamically and statically imported, so the dynamic import could not create a separate chunk.
- The application statically imported desks and modal components that are not needed on the initial screen.

This PR:

- Lazy-loads Cash & Balance, Guest LOTS, Closed History, Settings, and Market Insights.
- Lazy-loads Scenario Comparison, Scenario Report, and Margin Intelligence dialogs.
- Uses existing `DeskLoading` presentation as the deferred-desk fallback.
- Imports `logoutAccount` from the already-loaded API module rather than dynamically importing the same module again.
- Adds `src/ui/appCodeSplitting.test.ts` to protect the lazy-loading wiring and prevent reintroducing the ineffective duplicate import.

On PR #241 implementation head `85ccdbf020d13109cf67908d7ec705a0cebfbe3c`, the production entry chunk measured **481.00 kB minified / 153.71 kB gzip**, down from the 603.27 kB / 184.51 kB baseline (about 20.3% smaller minified). Desks and modal modules emitted separate chunks (Closed History 34.99 kB, Cash & Balance 27.94 kB, Market Insights 19.28 kB, Settings 17.02 kB, Guest LOTS 8.58 kB, modal-only chunks 5.18–6.75 kB). No chunk exceeded Vite's 500 kB warning threshold, and the previous API dynamic/static import warning was absent. The build completed successfully.

## Environment and validation limits

A local clone attempt failed because the environment could not resolve `github.com`. Repository review and edits therefore used the connected GitHub repository API. No local npm install, local test/build run, or real-browser inspection is claimed. GitHub Actions on the exact PR head provides executable validation; browser-only release checks remain explicitly open in `docs/refinement-plan-2026-10-31.md`.


## PR #241 exact-head validation

On implementation head `85ccdbf020d13109cf67908d7ec705a0cebfbe3c`:

- [Validate run 41391151619](https://github.com/armave/portfolio-terminal/actions/runs/41391151619) — success.
- [Pull Request CI run 41391151624](https://github.com/armave/portfolio-terminal/actions/runs/41391151624) — success.
- TypeScript passed; **75 test files / 899 tests passed**; dead-code validation passed; production build passed.
- Full dependency audit passed its configured high-severity threshold and continued to report the known 9 advisories (2 low / 7 moderate) in development tooling.
- The new production-only audit reported **0 vulnerabilities**.
- The production entry chunk measured 481.00 kB minified / 153.71 kB gzip; lazy desk/modal chunks were emitted separately, with no 500 kB chunk warning and no redundant API dynamic/static import warning.

The two workflows ran against the PR implementation head. Subsequent documentation-only edits are recorded in the same PR; final PR status checks should be read from the PR page.
