import { describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { QuoteVolumeBadge } from './QuoteVolumeBadge';

describe('QuoteVolumeBadge', () => {
  it('shows the provider-reported USD daily traded value with a clear full label', () => {
    setAppLanguage('en');
    const badge = QuoteVolumeBadge({ volume: 123456, volumeValue: 9100000000, price: 50, currency: 'USD' });
    expect(badge).not.toBeNull();
    expect(badge?.props.class).toContain('quote-volume-badge');
    expect(badge?.props['aria-label']).toBe('Daily volume $9.1B');
    expect(badge?.props.title).toBe('Daily volume reported by the data provider in USD.');
  });

  it('clearly marks the share-count estimate and explains how it is calculated', () => {
    setAppLanguage('en');
    const badge = QuoteVolumeBadge({ volume: 1234, price: 50, currency: 'USD' });
    expect(badge?.props['aria-label']).toBe('Estimated daily volume ~$61.7K');
    expect(badge?.props.title).toContain('share volume multiplied by the latest USD share price');
  });

  it('hides dollar volume when price or explicit USD currency evidence is missing', () => {
    expect(QuoteVolumeBadge({ volume: 1234, price: null, currency: 'USD' })).toBeNull();
    expect(QuoteVolumeBadge({ volume: 1234, price: 50 })).toBeNull();
    expect(QuoteVolumeBadge({ volume: 1234, volumeValue: 90000, price: 50, currency: 'EUR' })).toBeNull();
    expect(QuoteVolumeBadge({ volume: 1234, price: 50, currency: 'EUR' })).toBeNull();
  });
});
