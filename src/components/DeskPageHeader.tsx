import type { ComponentChildren } from 'preact';

export interface DeskPageHeaderProps {
  title: ComponentChildren;
  description?: ComponentChildren;
  trailing?: ComponentChildren;
  titleId?: string;
}

/** Consistent page-level heading for non-Margin workspace desks. */
export function DeskPageHeader({ title, description, trailing, titleId }: DeskPageHeaderProps) {
  return (
    <header class="desk-page-header md:text-left text-center">
      <div class="desk-page-header__copy">
        <h1 id={titleId} class="desk-page-header__title md:justify-start justify-center">{title}</h1>
        {description != null && <p class="desk-page-header__description md:justify-start justify-center">{description}</p>}
      </div>
      {trailing != null && <div class="desk-page-header__trailing">{trailing}</div>}
    </header>
  );
}
