import { afterEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { QuoteVolumeBadge } from './QuoteVolumeBadge';

afterEach(() => setAppLanguage('en'));

describe('QuoteVolumeBadge', () => {
  it('shows the provider-reported daily share count, not monetary turnover', () => {
    const badge = QuoteVolumeBadge({ volume: 32_176_544 });
    expect(badge).not.toBeNull();
    expect(badge?.props.class).toContain('quote-volume-badge');
    expect(badge?.props['aria-label']).toBe('Daily volume 32.2M shares');
    expect(badge?.props.title).toBe('Daily share volume reported by the data provider.');
  });

  it('does not manufacture a volume figure when the provider count is missing or invalid', () => {
    expect(QuoteVolumeBadge({ volume: null })).toBeNull();
    expect(QuoteVolumeBadge({ volume: undefined })).toBeNull();
    expect(QuoteVolumeBadge({ volume: '32176544' })).toBeNull();
    expect(QuoteVolumeBadge({ volume: -1 })).toBeNull();
    expect(QuoteVolumeBadge({ volume: Number.NaN })).toBeNull();
    expect(QuoteVolumeBadge({ volume: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('localizes the count and accessible description in Russian', () => {
    setAppLanguage('ru');
    const badge = QuoteVolumeBadge({ volume: 32_176_544 });
    expect(badge?.props['aria-label']).toBe('Дневной объём торгов 32,2 млн акций');
    expect(badge?.props.title).toBe('Количество акций, проторгованных за день, по данным поставщика.');
  });
});
