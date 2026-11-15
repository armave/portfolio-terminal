# Standardize non-Margin page layout — 2026-11-15

## Scope

Standardize the page-level header and container treatment for Balance, guest Lots, Trades, and Settings. The existing Margin board (Combined Portfolio and ticker views), including its title, target panels, financial summary and supporting workspace, is explicitly excluded.

## Implementation

- Keep every desk under the same responsive `#mainTerminalView` application shell and shared workspace navigation.
- Add `DeskPageHeader` as the shared heading pattern for page title, optional description, and optional trailing status/count content.
- Use the outer workspace card as the single page container. Remove the extra inner card treatment from Trades and Lots and the redundant Settings wrapper card.
- Apply a shared min-width-safe page-container class to non-Margin desk roots.
- Preserve desk content, role permissions, active-view routing, lazy loading, data ownership, and internal table/card styling.

## Responsive and localization

- Let header copy and metadata wrap within the available width; move trailing metadata to its own row on narrow screens.
- Keep semantic `header` and `h1` markup and preserve accessible status labels.
- Reuse the existing Russian dictionary entries for updated page headings and descriptions through `translateText`; no duplicate dictionary keys are added. English remains the source copy.

## Validation

- [ ] TypeScript typecheck.
- [ ] Focused layout and localization Vitest coverage.
- [ ] Full Vitest suite.
- [ ] Production build.
- [ ] Dead-code validation and dependency audits.
- [ ] Production browser smoke across configured desktop, tablet, and mobile viewport widths.
- [ ] Manual visual comparison of Balance, Lots, Trades, and Settings; confirm Margin remains unchanged.
