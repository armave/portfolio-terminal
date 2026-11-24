import type { JSX } from 'preact';

type OperationActivityTone = 'cyan' | 'purple' | 'neutral';
type OperationActivitySize = 'compact' | 'inline';

export interface OperationActivityIndicatorProps {
  /** Caller-owned presentation state; this component never starts or tracks work. */
  visible: boolean;
  label: string;
  ariaLabel?: string;
  tone?: OperationActivityTone;
  size?: OperationActivitySize;
  showLabel?: boolean;
  announce?: boolean;
  className?: string;
}

const TONE_CLASSES: Record<OperationActivityTone, string> = {
  cyan: 'text-cyan-300',
  purple: 'text-purple-300',
  neutral: 'text-slate-300'
};

const SIZE_CLASSES: Record<OperationActivitySize, string> = {
  compact: 'h-2.5 w-2.5 border-[1.5px]',
  inline: 'h-4 w-4 border-2'
};

/**
 * Shared, accessible rendering for an operation that is already in progress.
 * The caller owns the operation state and any delayed/minimum visibility policy.
 */
export function OperationActivityIndicator({
  visible,
  label,
  ariaLabel,
  tone = 'cyan',
  size = 'inline',
  showLabel = true,
  announce = true,
  className = ''
}: OperationActivityIndicatorProps): JSX.Element | null {
  if (!visible) return null;

  const accessibleLabel = ariaLabel || label;
  return (
    <span
      class={`operation-activity-indicator inline-flex min-w-0 items-center gap-1.5 ${TONE_CLASSES[tone]} ${className}`.trim()}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-busy={announce ? 'true' : undefined}
      aria-label={announce ? accessibleLabel : undefined}
      aria-hidden={announce ? undefined : 'true'}
      title={accessibleLabel}
      data-operation-activity={tone}
    >
      <span
        class={`operation-activity-indicator__spinner inline-block flex-none animate-spin rounded-full border-current border-r-transparent motion-reduce:animate-none ${SIZE_CLASSES[size]}`}
        aria-hidden="true"
      />
      {showLabel && <span class="truncate">{label}</span>}
    </span>
  );
}
