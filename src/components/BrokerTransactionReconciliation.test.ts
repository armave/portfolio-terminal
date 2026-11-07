import { describe, expect, it } from 'vitest';
import { translateBrokerReconciliationCopy } from './BrokerTransactionReconciliation';

describe('broker reconciliation localization', () => {
  it('provides Russian translations for review labels and safety explanations', () => {
    expect(translateBrokerReconciliationCopy('Reconcile broker activity', 'ru')).toBe('Сверить активность брокера');
    expect(translateBrokerReconciliationCopy('Commission currency differs', 'ru')).toBe('Валюта комиссии отличается');
    expect(translateBrokerReconciliationCopy(
      'Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.',
      'ru'
    )).toContain('предварительными');
  });

  it('preserves English and unknown copy', () => {
    expect(translateBrokerReconciliationCopy('Matched', 'en')).toBe('Matched');
    expect(translateBrokerReconciliationCopy('A future copy key', 'ru')).toBe('A future copy key');
  });
});
