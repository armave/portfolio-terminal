import { describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { QuoteVolumeBadge } from './QuoteVolumeBadge';

describe('QuoteVolumeBadge', () => {
  it('renders an accessible, separate dollar-volume badge from volume and a valid price', () => {
    setAppLanguage('en');
    const badge = QuoteVolumeBadge({ volume: 1234, price: 50, currency: 'USD' });
    expect(badge).not.toBeNull();
    expect(badge?.props.class).toContain('quote-volume-badge');
    expect(badge?.props['aria-label']).toBe('Volume $61.7K');
    expect(badge?.props.title).toContain('Estimated dollar volume');
  });

  it('hides the badge when the price is missing or the quote currency is non-USD', () => {
    expect(QuoteVolumeBadge({ volume: 1234, price: null })).toBeNull();
    expect(QuoteVolumeBadge({ volume: 1234, price: 50, currency: 'EUR' })).toBeNull();
  });
});
