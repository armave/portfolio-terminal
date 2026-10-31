import type { ComponentChildren } from 'preact';

interface TableScrollRegionProps {
  label: string;
  children: ComponentChildren;
  className?: string;
}

/** A consistently named, keyboard-scrollable wrapper for wide data tables. */
export function TableScrollRegion({ label, children, className = '' }: TableScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      class={`overflow-x-auto rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
