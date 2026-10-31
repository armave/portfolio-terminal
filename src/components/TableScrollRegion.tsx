import type { ComponentChildren } from 'preact';

interface TableScrollRegionProps {
  label: string;
  children: ComponentChildren;
  className?: string;
  focusClassName?: string;
  tabIndex?: 0 | -1;
}

/** A consistently named, keyboard-scrollable wrapper for wide data tables. */
export function TableScrollRegion({
  label,
  children,
  className = '',
  focusClassName = 'focus-visible:outline-cyan-500',
  tabIndex = 0
}: TableScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={tabIndex}
      class={`overflow-x-auto rounded-lg focus-visible:outline focus-visible:outline-2 ${focusClassName} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
