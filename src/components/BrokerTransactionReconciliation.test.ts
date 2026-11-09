import { describe, expect, it } from 'vitest';
import { createPortfolioTransactionEvent } from '../domain/portfolioTransactionJournal';
import {
  getBrokerReconciliationCountLabel,
  getBrokerReconciliationEmptyMessage,
  getBrokerReconciliationHeadline,
  getBrokerQuoteReconciliationHeadline,
  getBrokerReconciliationReviewIdempotencyKey,
  findBrokerReconciliationReview,
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


describe('broker reconciliation audit-only review markers', () => {
  it('derives distinct stable idempotency keys for activity and quote findings', () => {
    expect(getBrokerReconciliationReviewIdempotencyKey('activity', 'finding-1'))
      .toBe('reconciliation-review:activity:finding-1');
    expect(getBrokerReconciliationReviewIdempotencyKey('quote', 'finding-1'))
      .toBe('reconciliation-review:quote:finding-1');
    expect(getBrokerReconciliationReviewIdempotencyKey('activity', '')).toBe('');
  });

  it('recognizes only a user-authored review event with no financial deltas', () => {
    const review = createPortfolioTransactionEvent({
      type: 'portfolio.reconciliation',
      effectiveAt: Date.parse('2026-11-09T08:00:00.000Z'),
      note: 'Reviewed activity finding-1. Reason: checked source timestamp.'
    }, {
      eventId: 'review-event-1',
      idempotencyKey: 'reconciliation-review:activity:finding-1',
      requestFingerprint: 'review-fingerprint',
      actor: { type: 'user' },
      source: 'broker-reconciliation-review'
    });
    const forgedFinancialEvent = createPortfolioTransactionEvent({
      type: 'portfolio.reconciliation',
      effectiveAt: Date.parse('2026-11-09T08:00:00.000Z'),
      cashDelta: 100,
      note: 'Not an audit-only review.'
    }, {
      eventId: 'review-event-2',
      idempotencyKey: 'reconciliation-review:activity:finding-1',
      requestFingerprint: 'review-fingerprint',
      actor: { type: 'user' },
      source: 'broker-reconciliation-review'
    });

    expect(findBrokerReconciliationReview([review], 'activity', 'finding-1')).toBe(review);
    expect(findBrokerReconciliationReview([forgedFinancialEvent], 'activity', 'finding-1')).toBeUndefined();
    expect(findBrokerReconciliationReview([review], 'quote', 'finding-1')).toBeUndefined();
  });

  it('localizes every visible review-only action and limitation', () => {
    const copy = [
      'Review item',
      'Reason for review',
      'Record review',
      'Cancel',
      'Reviewed · not resolved',
      'This is an audit note only. It does not resolve the finding or change portfolio data.',
      'Enter a reason to record this review.',
      'Review could not be recorded. No financial data was changed.',
      'Reviewed note',
      'Record a review note only; corrections and writeback remain unavailable.'
    ];
    for (const value of copy) {
      expect(translateBrokerReconciliationCopy(value, 'ru'), value).not.toBe(value);
    }
  });
});
