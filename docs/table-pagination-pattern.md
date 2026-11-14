# Shared Table Pagination

The app's data tables use a shared pagination preference and control layer while retaining table-specific markup, responsive layouts, row renderers, summaries, and scroll regions.

## Shared pieces

- `src/ui/useTablePagination.ts` owns page-size options, one-based range calculation, safe page clamping, data slicing, and browser persistence.
- `src/components/TablePagination.tsx` renders the compact row-range, page-size selector, and previous/next controls.
- `src/components/TableScrollRegion.tsx` remains the named, keyboard-scrollable horizontal table wrapper.

## Adding pagination to a table

1. Give the logical table a stable, unique ID. The ID is a preference key, not a DOM ID (for example, `settings-users`).
2. Call `useTablePagination(tableId, rowCount, defaultPageSize)` at the component's top level.
3. Slice the actual display rows with `sliceTablePage(rows, pagination.currentPage, pagination.pageSize)`.
4. Keep the table body ID stable and pass it as `controlsId` to `TablePagination`.
5. Render `TablePagination` below the table, supplying the returned page, range, and callbacks.

The supported page sizes are 10, 25, 50, and 100. The preference is stored per logical table in localStorage under the versioned `portfolio-table-page-size:v1:` prefix. Storage failures fall back safely to the default. Page position itself is not persisted; changing page size resets to page 1 and shrinking data clamps the current page.

## Table-specific row behavior

Paginate the rows users actually count:
- For grouped tables, slice data rows and reconstruct group headings within the page. Do not count headings as data rows or leave a heading stranded at the bottom of the previous page.
- For live order books, keep bids and asks as separate table IDs and calculate cumulative values across the complete side before slicing visible rows.
- Keep whole-table summaries and totals based on the full underlying data, not only the current page.
- For the projection table, which is nested inside an outer table body, render the pagination row with the same column span so the nested rows stay valid table markup.

Page-size controls are deliberately compact, have a minimum 28px control height, are keyboard accessible, and use the shared English/Russian translation keys.
