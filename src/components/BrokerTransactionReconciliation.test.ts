import { describe, expect, it } from 'vitest';
import {
  getBrokerReconciliationCountLabel,
  getBrokerReconciliationEmptyMessage,
  getBrokerReconciliationHeadline,
  getBrokerQuoteReconciliationHeadline,
  translateBrokerReconciliationCopy
} from './BrokerTransactionReconciliation';

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

describe('broker reconciliation status wording', () => {
  it('does not label provisional findings as confirmed differences', () => {
    expect(getBrokerReconciliationHeadline('partial', 2253)).toBe('Provisional review');
    expect(getBrokerReconciliationCountLabel('partial')).toBe('provisional items');
  });

  it('uses discrepancy wording only for complete comparisons', () => {
    expect(getBrokerReconciliationHeadline('differences', 3)).toBe('Differences found');
    expect(getBrokerReconciliationCountLabel('differences')).toBe('findings');
    expect(getBrokerReconciliationHeadline('matched', 0)).toBe('Matched');
    expect(getBrokerReconciliationHeadline('unavailable', 0)).toBe('History unavailable');
  });

  it('localizes the additional journal and legacy-sale evidence labels', () => {
    expect(translateBrokerReconciliationCopy('App journal executions', 'ru')).toBe('Исполнения в журнале приложения');
    expect(translateBrokerReconciliationCopy('provisional items', 'ru')).toBe('предварительных записей');
  });
});

describe('broker reconciliation empty-state wording', () => {
  it('does not show a successful match for incomplete or unavailable feeds', () => {
    expect(getBrokerReconciliationEmptyMessage('partial')).toContain('incomplete coverage');
    expect(getBrokerReconciliationEmptyMessage('unavailable')).toContain('unavailable');
    expect(getBrokerReconciliationEmptyMessage('matched')).toBe('No transaction-level differences were found in the available records.');
  });
});


describe('broker quote reconciliation localization and status', () => {
  it('localizes quote provenance and safety explanations in Russian', () => {
    expect(translateBrokerReconciliationCopy('Broker market prices', 'ru')).toBe('Рыночные цены брокера');
    expect(translateBrokerReconciliationCopy('Price mismatch', 'ru')).toBe('Расхождение цены');
    expect(translateBrokerReconciliationCopy('App currency', 'ru')).toBe('Валюта приложения');
    expect(translateBrokerReconciliationCopy('Broker received', 'ru')).toBe('Получено брокером');
    expect(translateBrokerReconciliationCopy(
      'The app and broker quotes use different or unverified currencies. No conversion was attempted.',
      'ru'
    )).toContain('Конвертация не выполнялась');
  });

  it('keeps quote-status wording conservative for stale or incomplete inputs', () => {
    expect(getBrokerQuoteReconciliationHeadline('unavailable')).toBe('Broker quote data unavailable');
    expect(getBrokerQuoteReconciliationHeadline('stale')).toBe('Stale broker quote snapshot');
    expect(getBrokerQuoteReconciliationHeadline('partial')).toBe('Provisional price comparison');
    expect(getBrokerQuoteReconciliationHeadline('differences')).toBe('Price differences found');
    expect(getBrokerQuoteReconciliationHeadline('matched')).toBe('Prices matched');
  });
});
