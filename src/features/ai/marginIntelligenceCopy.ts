import type { AppLanguage } from '../../services/i18n';
import { translateText } from '../../services/i18n';
import type { MarginNewsCoverage } from './marginIntelligence';

export function formatMarginCoverageStatus(
  item: Pick<MarginNewsCoverage, 'status' | 'availableArticleCount' | 'selectedArticleCount' | 'error'>,
  language: AppLanguage = 'en'
): string {
  if (item.status === 'error') {
    return translateText('Feed unavailable', language) + (item.error ? ': ' + item.error : '');
  }
  if (item.status === 'empty') return translateText('Feed returned no articles', language);
  return `${item.availableArticleCount} ${translateText('available', language)} · ${item.selectedArticleCount} ${translateText('reviewed', language)}`;
}

export function formatMarginFetchedLabel(value: string, language: AppLanguage = 'en'): string {
  return `${translateText('Fetched', language)} ${value}`;
}

export function formatMarginSourcesHeading(count: number, language: AppLanguage = 'en'): string {
  return `${translateText('Sources reviewed', language)} (${count})`;
}
