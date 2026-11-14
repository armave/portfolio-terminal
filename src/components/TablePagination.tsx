import { getAppLanguage, translateText } from '../services/i18n';
import { TABLE_PAGE_SIZE_OPTIONS } from '../ui/useTablePagination';

interface TablePaginationProps {
  tableLabel: string;
  page: number;
  pageCount: number;
  pageSize: number;
  start: number;
  end: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
  controlsId?: string;
}

/** Compact, shared pagination controls for data tables. */
export function TablePagination({
  tableLabel,
  page,
  pageCount,
  pageSize,
  start,
  end,
  total,
  onPageChange,
  onPageSizeChange,
  className = '',
  controlsId
}: TablePaginationProps) {
  if (total <= 0) return null;
  const language = getAppLanguage();
  const previousLabel = translateText('Previous page', language);
  const nextLabel = translateText('Next page', language);
  const pageLabel = translateText('Page {current} of {total}', language)
    .replace('{current}', String(page))
    .replace('{total}', String(pageCount));
  const rangeLabel = translateText('Rows {start}–{end} of {total}', language)
    .replace('{start}', String(start))
    .replace('{end}', String(end))
    .replace('{total}', String(total));
  const sizeLabel = translateText('Rows per page for {table}', language)
    .replace('{table}', tableLabel);

  return (
    <div
      class={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 px-1 py-2 text-[10px] text-slate-400 ${className}`.trim()}
      role="group"
      aria-label={tableLabel + ' pagination'}
      aria-controls={controlsId}
    >
      <span class="whitespace-nowrap tabular-nums" aria-live="polite">{rangeLabel}</span>
      <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        <label class="inline-flex items-center gap-1 whitespace-nowrap">
          <span>{translateText('Rows', language)}</span>
          <select
            aria-label={sizeLabel}
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number((event.currentTarget as HTMLSelectElement).value))}
            class="h-7 rounded border border-slate-700 bg-slate-950 px-1.5 text-[10px] font-semibold text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>{size}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label={previousLabel}
          class="inline-flex h-7 min-w-7 items-center justify-center rounded border border-slate-700 px-2 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
        >‹</button>
        <span class="min-w-[4.5rem] whitespace-nowrap text-center tabular-nums" aria-live="polite">{pageLabel}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          aria-label={nextLabel}
          class="inline-flex h-7 min-w-7 items-center justify-center rounded border border-slate-700 px-2 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
        >›</button>
      </div>
    </div>
  );
}
