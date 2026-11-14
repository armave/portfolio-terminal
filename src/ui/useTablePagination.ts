import { useEffect, useState } from 'preact/hooks';

export const TABLE_PAGE_SIZE_OPTIONS = [5, 8, 10, 25, 50, 100] as const;
export type TablePageSize = typeof TABLE_PAGE_SIZE_OPTIONS[number];

const STORAGE_PREFIX = 'portfolio-table-page-size:v1:';

export function normalizeTablePageSize(value: unknown, fallback: TablePageSize = 10): TablePageSize {
  const parsed = Number(value);
  return TABLE_PAGE_SIZE_OPTIONS.includes(parsed as TablePageSize)
    ? parsed as TablePageSize
    : fallback;
}

export function getTablePaginationRange(totalItems: number, page: number, pageSize: number): {
  pageCount: number;
  page: number;
  start: number;
  end: number;
} {
  const total = Number.isFinite(totalItems) ? Math.max(0, Math.floor(totalItems)) : 0;
  const safePageSize = normalizeTablePageSize(pageSize);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(Number.isFinite(page) ? Math.floor(page) : 1, pageCount));
  return {
    pageCount,
    page: safePage,
    start: total === 0 ? 0 : (safePage - 1) * safePageSize + 1,
    end: Math.min(safePage * safePageSize, total)
  };
}

export function sliceTablePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const range = getTablePaginationRange(items.length, page, pageSize);
  return items.slice((range.page - 1) * normalizeTablePageSize(pageSize), range.page * normalizeTablePageSize(pageSize));
}

function storageKey(tableId: string): string {
  return STORAGE_PREFIX + encodeURIComponent(tableId.trim());
}

export function readTablePageSize(tableId: string, fallback: TablePageSize = 10): TablePageSize {
  if (!tableId.trim()) return fallback;
  try {
    if (typeof window === 'undefined') return fallback;
    return normalizeTablePageSize(window.localStorage.getItem(storageKey(tableId)), fallback);
  } catch {
    return fallback;
  }
}

export function writeTablePageSize(tableId: string, pageSize: TablePageSize): void {
  if (!tableId.trim()) return;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(tableId), String(pageSize));
  } catch {
    // Pagination remains usable when browser storage is disabled or full.
  }
}

/**
 * Independent, browser-persisted page-size preference for each logical table.
 * Only the page size is persisted; current page resets when its size changes
 * and clamps automatically when filtering or live updates reduce row count.
 */
export function useTablePagination(
  tableId: string,
  totalItems: number,
  defaultPageSize: TablePageSize = 10
) {
  const [pageSize, setPageSizeState] = useState<TablePageSize>(
    () => readTablePageSize(tableId, defaultPageSize)
  );
  const [page, setPage] = useState(1);
  const range = getTablePaginationRange(totalItems, page, pageSize);

  useEffect(() => {
    writeTablePageSize(tableId, pageSize);
  }, [tableId, pageSize]);

  useEffect(() => {
    if (page !== range.page) setPage(range.page);
  }, [page, range.page]);

  const setPageSize = (value: number) => {
    const next = normalizeTablePageSize(value, defaultPageSize);
    setPageSizeState(next);
    setPage(1);
  };

  return {
    page,
    currentPage: range.page,
    pageSize,
    pageCount: range.pageCount,
    start: range.start,
    end: range.end,
    setPage,
    setPageSize
  };
}
