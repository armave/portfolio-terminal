# UI/UX Stage 4 — Stylesheet Consolidation

**Status:** Implemented on a focused frontend branch; exact-head CI pending  
**Baseline:** `main` at `16e3ae5d69049fde37ee276471ee3f014b59b8b4` (2026-11-04)  
**Working branch:** `ux/stage-4-css-consolidation-2026-11-04`

## Objective

Reduce CSS override drift and repeated global policies without changing the terminal's visual language, breakpoints, component layouts, startup-critical styles, or application behavior.

## Audit findings

- `style.css` contains approximately 3,849 lines and is the only application stylesheet imported by `src/main.ts`.
- `startup-critical.css` is a separate 66-line critical-startup stylesheet inlined by the Vite build plugin; it remains separate.
- The application stylesheet had 16 repeated `@media (prefers-reduced-motion: reduce)` blocks.
- Base `:root` tokens were split across three non-media blocks; additional indented `:root` blocks are conditional high-contrast overrides.
- Two `prefers-contrast: more` blocks existed; the earlier token block was fully superseded by the later, more complete block.
- The mobile ticker header's flex shrink constraints were appended in a later duplicate 768px media block, while the workspace navigation already had a 768px section.
- Existing style regression tests are source-oriented Vitest tests; production-browser smoke remains the layout behavior gate.

## Implemented scope

- [x] Consolidate shared base control, layout, surface, and motion tokens into the first `:root` block.
- [x] Keep high-contrast-only values conditional and remove the earlier fully superseded high-contrast token block.
- [x] Consolidate 16 reduced-motion blocks into one global policy with the existing universal animation/transition/scroll suppression and explicit transform resets for animated workspace/modal elements.
- [x] Move the mobile header flex shrink constraints beside the existing workspace navigation 768px rules and remove the duplicate trailing `#tickerTabs` width override.
- [x] Update fluid-workspace and mobile-navigation tests for the consolidated token and breakpoint ownership.
- [x] Add stylesheet architecture tests to prevent repeated root-token and reduced-motion blocks from returning.
- [x] Leave `startup-critical.css`, component styling, responsive breakpoint values, financial calculations, localization copy, persisted formats, APIs, and Cloudflare Workers unchanged.

## Validation plan

- [ ] TypeScript typecheck.
- [ ] Full Vitest suite.
- [ ] Production build and unchanged entry bundle budget.
- [ ] Production-browser smoke at 320, 360, 390, 768, 1024, and 1440px.
- [ ] Knip dead-code validation.
- [ ] Full dependency audit.
- [ ] Production dependency audit.

## Non-goals

- No design-system migration or new CSS framework.
- No renaming of UI classes or component-level redesign.
- No changes to Tailwind/PostCSS configuration.
- No startup-critical CSS extraction or inlining changes.
- No changes to portfolio calculations, quote freshness, broker behavior, cloud sync, APIs, or Worker code.
