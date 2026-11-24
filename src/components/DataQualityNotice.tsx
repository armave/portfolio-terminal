import type { ComponentChildren, JSX } from 'preact';

export type DataQualityStatus =
  | 'current'
  | 'provisional'
  | 'incomplete'
  | 'unavailable'
  | 'stale'
  | 'cached'
  | 'error'
  | 'conflict';

export interface DataQualityNoticeProps {
  title: string;
  status: DataQualityStatus;
  /** Already-localized by the owning feature so domain wording remains authoritative. */
  statusLabel: string;
  children?: ComponentChildren;
  className?: string;
}

const STATUS_CLASSES: Record<DataQualityStatus, string> = {
  current: 'data-quality-notice--current border-emerald-900/50',
  provisional: 'data-quality-notice--provisional border-amber-900/60',
  incomplete: 'data-quality-notice--incomplete border-rose-900/50',
  unavailable: 'data-quality-notice--unavailable border-rose-900/50',
  stale: 'data-quality-notice--stale border-amber-900/60',
  cached: 'data-quality-notice--cached border-slate-700',
  error: 'data-quality-notice--error border-rose-900/60',
  conflict: 'data-quality-notice--conflict border-rose-900/60'
};

/**
 * Shared presentation for caller-classified financial/data quality.
 * It deliberately does not infer freshness, normalize values or turn missing data into zero.
 */
export function DataQualityNotice({
  title,
  status,
  statusLabel,
  children,
  className = ''
}: DataQualityNoticeProps): JSX.Element {
  return (
    <section
      class={`data-quality-notice rounded-lg border bg-slate-950/30 px-3 py-2 ${STATUS_CLASSES[status]} ${className}`.trim()}
      role="group"
      aria-label={title}
      data-quality-status={status}
    >
      <div class="data-quality-notice__heading portfolio-data-quality-summary__heading flex flex-wrap items-center justify-between gap-2">
        <span>{title}</span>
        <strong data-valuation-quality={statusLabel} data-quality-status-label={status}>
          {statusLabel}
        </strong>
      </div>
      {children}
    </section>
  );
}
