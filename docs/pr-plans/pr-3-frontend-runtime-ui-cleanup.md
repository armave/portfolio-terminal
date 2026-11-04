# PR 3 — Frontend runtime, UI, localization, and accessibility cleanup

**Status:** Draft — implementation in progress. The first production change hardens shared nested-dialog scroll locking and adds Vitest regression coverage. The wider runtime/UI cleanup scope remains open.

## Implementation progress — 2026-11-04

- [x] Audited the existing shared modal focus manager and identified a nested-dialog scroll-lock lifecycle defect.
- [x] Added document-scoped, reference-counted scroll locking. Original body/document overflow styles and the initial page offset are restored only after the final active dialog releases its lock.
- [x] Bound key handling and active-element reads to the dialog's owning document.
- [x] Added Vitest regression coverage for lower-first and upper-first modal cleanup, idempotent release, preservation of original inline styles, and exactly-once final scroll restoration.
- [ ] Continue the remaining frontend runtime, component, localization, CSS, accessibility, and browser-validation audit.


**Proposed PR title:** `refactor(frontend): simplify runtime boundaries and strengthen UI consistency`

**Branch:** `refactor/frontend-runtime-ui-cleanup-2026-11`  
**Base:** `main` after PRs 1 and 2 are merged.  
**Dependencies:** PR 1 — financial-domain invariants; PR 2 — canonical store and persistence boundaries.  
**Priority:** Medium/high. This is the final client-side consolidation and regression pass.

## Goal

Complete a focused frontend maintainability pass across application orchestration, Preact components, client services, localization, styling, and accessibility. Preserve existing workflows, account-role boundaries, bundle budgets, and design language.

Do not repeat previously merged API/runtime extractions, lazy-loading work, browser journeys, or CSS Stage 4 consolidation.

## Scope

- `app.ts` and `src/App.tsx` for composition and UI wiring.
- `src/services/` only where a remaining client-side responsibility overlap is demonstrated.
- `src/components/` for component ownership, duplicated presentation, and accessibility.
- `src/ui/` for typed event/state wiring and UI performance.
- `src/services/i18n.ts` and `src/services/i18n-ru.ts` for localization integrity.
- `style.css` only for verified residual duplicate or contradictory rules.
- Existing component, service, UI, localization, and browser-smoke tests.
- Relevant frontend architecture and UX documentation.

Do not include `worker.js`, `state-store.js`, `src/services/freedomTradeNet.ts`, or `wrangler.jsonc` in this PR.

## Implementation checklist

- [ ] Trace remaining `app.ts` responsibilities and callers before extraction; retain `app.ts` as the runtime composition root.
- [ ] Extract only cohesive lifecycle/event groups with explicit typed dependencies, disposers, and tests.
- [ ] Preserve startup ordering, account-generation guards, role checks, request coalescing, and retry behavior.
- [ ] Preserve `src/services/api.ts` compatibility exports and centralized `proxyFetch(action, params, options)` handling; do not introduce a parallel HTTP client or bypass auth/session-aware caching.
- [ ] Review Preact components for duplicated business logic, redundant state mirrors, unnecessary subscriptions, lifecycle leaks, and sibling-owned DOM manipulation.
- [ ] Keep financial calculations in the domain layer and portfolio mutations in the canonical store.
- [ ] Use typed event channels (`uiEventBus` and `brokerEventBus`) rather than ad-hoc global custom events or mutable global caches.
- [ ] Review user-facing text for hardcoded strings and ensure supported English/Russian copy uses the existing i18n system.
- [ ] Verify interpolation, dynamic labels, errors, empty/loading states, dialog actions, and accessibility names in both languages.
- [ ] Inspect residual CSS for duplicate selectors, conflicting overrides, specificity problems, responsive overflow, and unnecessary animation.
- [ ] Preserve the already-consolidated root tokens and reduced-motion policy. Do not reimplement CSS Stage 4.
- [ ] Keep `startup-critical.css` separate unless a measured runtime/build issue justifies changing its role.
- [ ] Verify keyboard navigation, visible focus, dialog focus trapping/restoration, semantic table headers, narrow-screen table behavior, touch targets, and reduced motion.
- [ ] Preserve existing lazy-loaded desk/dialog chunks; avoid creating dynamic imports for modules already statically imported in the same entry graph.
- [ ] Keep existing bundle budgets; add assertions only when they encode a real architecture invariant.
- [ ] Expand production-browser coverage only for gaps found in this pass; reuse the existing Playwright harness and mocked Worker routes.
- [ ] Update architecture/refinement documentation to describe actual resulting boundaries and known limitations.

## Non-goals and guardrails

- No new UI framework, CSS framework, state library, or browser test stack.
- No redesign or indiscriminate CSS rewrite.
- No duplication of the merged CSS Stage 4 work.
- No parallel API transport, cloud sync, encryption, or broker runtime layer.
- No weakening of role permissions, auth headers, guest/admin isolation, or session-staleness checks.
- No financial formula or persisted-data format changes.
- No Cloudflare Worker or Durable Object changes.

## Acceptance criteria

- [ ] `app.ts` remains the composition root and extracted responsibilities have typed contracts and disposer coverage.
- [ ] API facade compatibility exports remain available and proxy traffic stays on the centralized request path.
- [ ] UI components do not duplicate financial calculations or own independent portfolio state.
- [ ] No memory, listener, or lifecycle leaks are introduced.
- [ ] New/modified user-facing copy is localized in English and Russian.
- [ ] Keyboard, focus, dialog, table, reduced-motion, and responsive behavior pass relevant tests.
- [ ] Existing lazy-loading behavior and JavaScript entry-bundle budgets remain intact.
- [ ] Full CI and relevant production-browser journeys pass on the exact PR head.
- [ ] Documentation reflects the resulting architecture and outstanding limitations.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
```

The existing PR CI also runs production browser smoke. Confirm the final workflow validates the exact PR head. Verify desktop, tablet, and phone viewports relevant to modified components. Do not claim a browser journey passed unless the actual workflow completed.

## Suggested commit sequence

```text
refactor(runtime): extract only verified frontend lifecycle boundaries
refactor(ui): remove duplicated component state and event wiring
fix(i18n): close verified English/Russian coverage gaps
refactor(styles): remove verified residual CSS conflicts
test(ui): cover accessibility and responsive regressions
docs: reconcile frontend architecture and cleanup tracker
```

## Dependency and merge protocol

PRs 1 and 2 must be merged first. Rebase this branch on the latest `main`, reconcile conflicts with the merged domain/store contracts, run the complete validation suite, and then request review/merge.

## Separate server lane

Cloudflare Worker and Durable Object changes are intentionally excluded. Under the repository's established deployment convention, demonstrated server-side changes are tested and committed directly to `main`, then verified through `.github/workflows/deploy-worker.yml`. Do not smuggle server changes into this frontend PR.
