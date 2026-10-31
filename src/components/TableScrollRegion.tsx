import type { ComponentChildren } from 'preact';

interface TableScrollRegionProps {
  label: string;
  children: ComponentChildren;
  className?: string;
  focusClassName?: string;
}

/** A consistently named, keyboard-scrollable wrapper for wide data tables. */
export function TableScrollRegion({
  label,
  children,
  className = '',
  focusClassName = 'focus-visible:outline-cyan-500'
}: TableScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      class={`overflow-x-auto rounded-lg focus-visible:outline focus-visible:outline-2 ${focusClassName} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
