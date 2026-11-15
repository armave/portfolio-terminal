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
    <header class="desk-page-header">
      <div class="desk-page-header__copy">
        <h1 id={titleId} class="desk-page-header__title">{title}</h1>
        {description != null && <p class="desk-page-header__description">{description}</p>}
      </div>
      {trailing != null && <div class="desk-page-header__trailing">{trailing}</div>}
    </header>
  );
}
