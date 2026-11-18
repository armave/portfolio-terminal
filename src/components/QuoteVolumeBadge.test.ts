import { afterEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { QuoteVolumeBadge } from './QuoteVolumeBadge';

afterEach(() => setAppLanguage('en'));

describe('QuoteVolumeBadge', () => {
  it('shows provider-reported USD monetary turnover instead of the share count', () => {
    const badge = QuoteVolumeBadge({
      volumeValue: 9_100_000_000,
      currency: 'USD'
    });
    expect(badge).not.toBeNull();
    expect(badge?.props.class).toContain('quote-volume-badge');
    expect(badge?.props['aria-label']).toBe('Daily volume $9.1B');
    expect(badge?.props.title).toBe('Daily traded value reported by the data provider in USD.');
  });

  it('uses the shorter Vol. label for administrators', () => {
    const badge = QuoteVolumeBadge({
      volumeValue: 9_100_000_000,
      currency: 'USD',
      isAdmin: true
    });
    expect(badge?.props['aria-label']).toBe('Vol. $9.1B');
    expect(badge?.props.children[0].props.children).toBe('Vol.');
    expect(badge?.props.children[1].props.children).toBe('$9.1B');
  });

  it('requires provider-reported monetary turnover and explicit USD currency', () => {
    expect(QuoteVolumeBadge({ currency: 'USD' })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: null, currency: 'USD' })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: 9_100_000_000 })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: 9_100_000_000, currency: 'EUR' })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: '9100000000', currency: 'USD' })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: -1, currency: 'USD' })).toBeNull();
    expect(QuoteVolumeBadge({ volumeValue: Number.NaN, currency: 'USD' })).toBeNull();
  });

  it('localizes the turnover label and accessible description in Russian', () => {
    setAppLanguage('ru');
    const badge = QuoteVolumeBadge({
      volumeValue: 9_100_000_000,
      currency: 'USD',
      isAdmin: true
    });
    expect(badge?.props['aria-label']).toMatch(/^Объём/);
    expect(badge?.props['aria-label']).toContain('$');
    expect(badge?.props.title).toBe('Денежный объём торгов за день в USD по данным поставщика.');
  });
});
