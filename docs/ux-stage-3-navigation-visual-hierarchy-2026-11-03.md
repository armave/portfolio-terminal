# UI/UX Stage 3 — Navigation and Visual Hierarchy

**Status:** Implemented; exact-head CI and production-browser validation passed  
**Baseline:** `main` at `d7f565e194cdc31bf1937cac7b6e455cf4937bd7` (2026-11-03)  
**Working branch:** `ux/stage-3-navigation-visual-hierarchy-2026-11-03`

## Objective

Make workspace navigation easier to scan and use across desktop, tablet, and narrow mobile screens, while improving the hierarchy and readability of the financial summary. Implementation separates synchronization from destination navigation, gives long ticker lists an independent mobile scroll strip, makes role-specific destination order explicit and testable, and raises summary labels and values by one type step. Preserve the existing terminal aesthetic, information density, financial semantics, and English/Russian localization.

This is the UI/UX Stage 3 from the Portfolio Terminal audit roadmap. It is distinct from the repository's separate `feature/stage-3-atomic-persistence` workstream.

## Current baseline findings

- `src/App.tsx` renders `#tickerTabs` as a `role="group"` named "Workspace navigation" and places the `TickerTabs` output inside it.
- `TickerTabs` currently returns both the portfolio-sync action and workspace destination buttons. The sync action is therefore inside the group named as navigation; Stage 3 should separate the action from the destination group without changing its behavior.
- Destination controls use `aria-pressed` and custom ArrowLeft/ArrowRight/Home/End navigation through `src/ui/tabNavigation.ts`.
- `style.css` uses a single horizontally scrollable row above 768px and wraps all destinations at 768px and below. Labels become shorter at 480px and below. This behavior exists already; do not replace it with another pattern without browser evidence.
- The summary micro-layout in `src/components/SummaryMetricsGrid.tsx` uses 10px utility labels, 10px section headings, and compact numeric values. The smaller labels are the clearest current visual-hierarchy candidate.
- The cloud synchronization indicator is already alongside the workspace controls in the header. Do not duplicate or relocate this Stage 1 work.
- Existing Vitest coverage includes `tabNavigation.test.ts`, `mobileNavigationStyles.test.ts`, `fluidWorkspaceStyles.test.ts`, and accessibility wiring checks.
- `scripts/browser-smoke.mjs` already checks page geometry at 320, 360, 390, 768, 1024, and 1440px, checks visible controls for accessible names, and exercises keyboard navigation. Stage 3 should extend those journeys rather than introduce a second browser-test framework.

## Implementation scope

### 1. Navigation structure and density

- [x] Separate the portfolio sync action from the workspace-destination button group so the group contains only destinations.
- [x] Preserve all current destinations and permissions for administrator, guest, and signed-out states.
- [x] Review the current wrap-on-mobile behavior with empty, single-ticker, and many-ticker portfolios. Keep all destinations discoverable; avoid introducing hidden destinations or horizontal page overflow.
- [x] If many tickers create excessive header height, prototype a secondary ticker strip while keeping primary desk destinations immediately visible. Adopt it only if browser checks demonstrate a measurable improvement.
- [x] Preserve the current active-state styling, visible focus treatment, and ArrowLeft/ArrowRight/Home/End behavior. Verify index ordering for administrator and guest navigation lists.
- [x] Ensure focus moves the active destination into view when a scrollable navigation treatment is used.

### 2. Financial summary hierarchy

- [x] Establish a consistent type scale for summary section headings, metric labels, metric values, and tertiary quote metadata.
- [x] Raise the minimum readable size of key metric labels on narrow screens; avoid making every secondary detail equally prominent.
- [x] Reinforce the existing financial-summary groups with a clearer heading/label/value scale for position basis, market valuation, debt/carrying costs, and market tools.
- [x] Keep important values visually primary, right-aligned where appropriate, and rendered with tabular numerals.
- [x] Keep quote freshness, partial valuation, and missing-price states explicit. Never turn unavailable data into a numeric zero or imply a complete valuation when it is partial.
- [x] Preserve compact details such as timestamps and secondary source metadata where they remain legible and do not compete with the primary figures.

### 3. Localization and accessibility

- [x] Route any new visible copy, tooltip, title, and accessible name through the existing localization system.
- [x] Add English/Russian translation coverage for any new navigation labels or explanatory text.
- [x] Keep destination controls as native buttons with stable accessible names and selected-state semantics.
- [x] Test administrator and guest destination sequences and Russian translations; stress-test a large ticker count in the production browser.
- [x] Preserve the existing reduced-motion, high-contrast, and forced-colors support; Stage 3 does not introduce motion-dependent behavior.

## Validation plan

### Vitest

- [x] Extend navigation helper tests for the actual administrator/guest destination ordering and index mapping.
- [x] Update structural/accessibility wiring tests for the separated sync action and destination group.
- [x] Update responsive style tests only where behavior intentionally changes; avoid brittle assertions that merely duplicate CSS declarations.
- [x] Add localization assertions for every new English/Russian string.

### Production-browser smoke

- [x] Extend the existing mocked browser journey to cover empty, one-ticker, and many-ticker navigation states.
- [x] Check 320, 360, 390, 768, 1024, and 1440px for page-level overflow, clipped destinations, and header layout.
- [x] Verify every destination is reachable by pointer and keyboard; verify ArrowLeft/ArrowRight wrap and Home/End behavior.
- [x] Verify the sync action remains independently named, operable, and outside the destination group.
- [ ] Capture before/after screenshots at narrow mobile, tablet, and desktop widths for visual review.
- [x] Run the full required CI sequence: typecheck, Vitest, production build, browser smoke, dead-code validation, and dependency audits.

## Acceptance criteria

1. Workspace actions and workspace destinations have distinct, correct semantics.
2. Every permitted destination is visible or deliberately discoverable at all target widths; no document-level horizontal overflow or clipped controls.
3. Navigation behavior is correct for administrator and guest roles with zero, one, and many tickers.
4. Primary financial figures are easier to scan, supporting labels remain legible on mobile, and the interface retains its information-dense terminal character.
5. English and Russian UI text and accessible names remain correct.
6. No changes to financial calculations, quote ranking/freshness rules, persisted-data formats, broker/Worker APIs, or cloud synchronization behavior.
7. All required checks pass on the final PR head.

## Non-goals

- Reworking the cloud synchronization indicator (already in the header).
- A broad stylesheet rewrite or design-system migration; that belongs to a separate cleanup pass.
- Changing financial calculations, valuation semantics, broker behavior, or persistence.
- Adding a new UI framework, component library, or browser-test dependency.

## Delivery checklist

- [x] Re-audit current `main` before coding and inspect the final diff of each touched component.
- [x] Implement the related navigation and summary refinements together in one frontend PR.
- [x] Preserve English/Russian localization and add Vitest coverage.
- [x] Extend the existing Playwright smoke test with responsive geometry and long-ticker evidence.
- [ ] Capture before/after screenshots for a separate manual visual review.
- [x] Track each acceptance item in the PR description.
- [ ] Do not merge until the full validation suite passes on the final head.


## Responsive regression found during browser validation

The many-ticker Playwright scenario exposed a specificity collision: the generic `#tickerTabs > *` flex rule overrode the nested ticker strip's original class-only flex sizing. The strip now uses the more specific `#tickerTabs > .workspace-nav-ticker-list` selector on desktop and mobile, so its own bounded viewport wins while ticker buttons scroll inside it. The mobile style test asserts this selector specificity, and the browser smoke test verifies both strip overflow and document-level overflow.


## Final validation — 2026-11-03

Validated on exact PR head `78f1cce41a88917cc47a10e11f8d2fd4a778f977` in [CI run #2333](https://github.com/armave/portfolio-terminal/actions/runs/41703669740):

- [x] TypeScript typecheck.
- [x] Vitest — 114 test files passed.
- [x] Production build and the existing entry-bundle budget.
- [x] Production-browser smoke across 320, 360, 390, 768, 1024, and 1440px.
- [x] Long-ticker stress case at 360px: ticker strip scrolls independently, fixed destinations remain visible, and the document has no horizontal overflow.
- [x] Keyboard navigation, administrator/guest journeys, and sync-action separation.
- [x] Knip dead-code validation.
- [x] Full dependency audit (configured high-severity threshold passed; 4 low-severity advisories remain).
- [x] Production dependency audit (0 production vulnerabilities reported).

Manual before/after screenshots were not captured; the automated browser geometry and interaction checks passed.
