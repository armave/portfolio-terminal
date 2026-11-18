import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPortfolioTransactionEvent } from '../domain/portfolioTransactionJournal';
import {
  getBrokerReconciliationCountLabel,
  getBrokerReconciliationEmptyMessage,
  getBrokerReconciliationHeadline,
  getBrokerQuoteReconciliationHeadline,
  getPortfolioLotParityHeadline,
  getPortfolioLotParityDiscrepancyLabel,
  translatePortfolioLotParityIssueReason,
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

  it('localizes ambiguous broker cashflow matching evidence in Russian', () => {
    expect(translateBrokerReconciliationCopy('Ambiguous broker cashflow match', 'ru'))
      .toBe('Неоднозначное сопоставление денежного потока брокера');
    expect(translateBrokerReconciliationCopy(
      'More than one app-authored cashflow is an equally strong fallback match for this broker cashflow. No candidate was selected.',
      'ru'
    )).toContain('Ни одна запись не выбрана');
    expect(translateBrokerReconciliationCopy(
      'A broker cashflow has multiple equally strong app fallback candidates; manual review is required.',
      'ru'
    )).toContain('ручная проверка');
    expect(translateBrokerReconciliationCopy(
      'One or more app cashflow events have no usable amount; matching is provisional.',
      'ru'
    )).toContain('предварительное');
  });

  it('localizes execution currency discrepancy labels and evidence in Russian', () => {
    expect(translateBrokerReconciliationCopy('Execution currency differs', 'ru'))
      .toBe('Валюта исполнения отличается');
    expect(translateBrokerReconciliationCopy('Broker currency', 'ru'))
      .toBe('Валюта брокера');
    expect(translateBrokerReconciliationCopy('App currency', 'ru'))
      .toBe('Валюта приложения');
    expect(translateBrokerReconciliationCopy(
      'The broker and app transaction use different execution currencies; no FX conversion was attempted.',
      'ru'
    )).toContain('пересчет валюты не выполнялся');
  });


    expect(translateBrokerReconciliationCopy('Execution evidence incomplete', 'ru'))
      .toBe('Недостаточно данных для проверки исполнения');
    expect(translateBrokerReconciliationCopy('Missing execution evidence', 'ru'))
      .toBe('Отсутствуют данные исполнения');
    for (const field of [
      'App execution quantity',
      'Broker execution price',
      'App execution price',
      'Broker execution timestamp',
      'Broker execution currency',
      'App transaction currency',
      'Broker execution commission',
      'App transaction commission'
    ]) {
      expect(translateBrokerReconciliationCopy(field, 'ru'), field).not.toBe(field);
    }
    expect(translateBrokerReconciliationCopy(
      'The matched execution is missing one or more source values needed for a complete comparison. Missing values were not treated as zero.',
      'ru'
    )).toContain('не считались нулевыми');
  });

  it('localizes the unclassified cashflow explanation in Russian', () => {
    expect(translateBrokerReconciliationCopy(
      'The broker cashflow could not be safely classified or had no usable amount and was excluded from matching.',
      'ru'
    )).toBe('Не удалось безопасно классифицировать денежный поток брокера или определить допустимую сумму; запись исключена из сверки.');
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


describe('execution evidence presentation', () => {
  it('renders the specific missing broker/app values on provisional execution findings', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain("finding.type] || finding.type");
    expect(source).toContain('finding.missingFields && finding.missingFields.length > 0');
    expect(source).toContain("translateBrokerReconciliationCopy('Missing execution evidence')");
    expect(source).toContain('finding.missingFields.map(field => translateBrokerReconciliationCopy(field))');
    expect(source).toContain('finding.brokerCurrency && finding.appCurrency');
  });
});

describe('transaction journal coverage visibility', () => {
  it('renders scoped replay counts and bounded issue explanations in broker reconciliation', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain('inspectPortfolioTransactionJournalReplayCoverage(appEvents)');
    expect(source).toContain("aria-label={translateBrokerReconciliationCopy('App transaction journal coverage')}");
    expect(source).toContain('journalCoverage.issues.slice(0, 5)');
    expect(source).toContain('journalCoverage.replayableCount');
    expect(source).toContain('journalCoverage.evidenceOnlyCount');
    expect(source).toContain('journalCoverage.auditOnlyCount');
    expect(source).toContain('journalCoverage.issues.length');
    expect(source).toContain('Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.');
  });

  it('localizes journal coverage statuses, counts, scope and issue reasons in Russian', () => {
    const copy = [
      'App transaction journal coverage', 'Complete within scope', 'Incomplete', 'Unsupported',
      'Replayable events', 'Evidence-only events', 'Audit-only events', 'Items needing review',
      'Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.',
      'No journal replay issues were detected for the current coverage scope.',
      'Showing first 5 coverage findings',
      'Event is malformed or uses an unsupported transaction schema.',
      'Journal contains a duplicate transaction event ID; replay is blocked to prevent applying the same event more than once.',
      'Journal contains a duplicate transaction idempotency key; replay is blocked to prevent applying the same command more than once.',
      'Broker execution evidence must not post directly to app-owned portfolio balances.',
      'Broker execution evidence is missing its source reference, instrument, side or quantity.',
      'Closed-history fee corrections must not post cash, debt, quantity or realized-margin deltas.',
      'History correction requires a stable closed-trade ID, linked app sale event, immutable fee/P&L snapshots and a valid revision chain.',
      'Trade event requires an instrument, positive quantity and matching signed position delta.',
      'Cash-holding buy is missing a stable lot ID, acquisition date, price, fee evidence or matching quantity delta.',
      'Cash-holding sale is missing exact FIFO lot allocations or a matching negative quantity delta.',
      'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics.',
      'Position adjustment requires an instrument and an explicit quantity delta.',
      'Snapshot reconciliation has no explicit state delta or complete audit-review contract.',
      'Cash adjustment requires an explicit free-cash or margin-debt delta.',
      'Margin adjustment requires an explicit debt delta.',
      'Margin-interest event requires explicit debt and realized-charge deltas; legacy events without the realized-charge delta remain incomplete.',
      'Financial correction requires an original event reference, reason and non-zero inverse state delta.',
      'Financial correction references an event that is not present in the supplied journal.',
      'Only cash/debt balance-adjustment reversals are currently supported; trade, lot and corporate-action reversals remain gated.',
      'Correction state deltas must be the exact inverse of the linked original balance adjustment.',
      'Financial posting has neither an app-owned state delta nor a complete external evidence reference.',
      'Event type is not supported by the current quantity/cash/debt replay contract.'
    ];
    for (const value of copy) {
      expect(translateBrokerReconciliationCopy(value, 'ru'), value).not.toBe(value);
    }
  });
});


describe('lot and closed-trade replay parity visibility', () => {
  it('keeps incomplete and unsupported history distinct from detected differences and a complete match', () => {
    expect(getPortfolioLotParityHeadline('complete', 0)).toBe('Matched within supported history');
    expect(getPortfolioLotParityHeadline('complete', 2)).toBe('Differences found');
    expect(getPortfolioLotParityHeadline('incomplete', 0)).toBe('Incomplete');
    expect(getPortfolioLotParityHeadline('unsupported', 0)).toBe('Unsupported');
  });

  it('provides localized labels for every supported lot and closed-trade discrepancy field', () => {
    const fields = [
      'open-lot-missing', 'open-lot-quantity', 'open-lot-cost', 'open-lot-acquisition-date',
      'open-lot-buy-commission', 'cash-holding-lot-missing', 'cash-holding-lot-quantity',
      'cash-holding-lot-cost', 'cash-holding-lot-acquisition-date', 'cash-holding-lot-buy-commission',
      'position-lot-quantity', 'position-buy-commission', 'closed-trade-missing',
      'closed-trade-duplicate', 'closed-trade-ticker', 'closed-trade-quantity', 'closed-trade-cost',
      'closed-trade-price', 'closed-trade-gross-profit', 'closed-trade-commissions',
      'closed-trade-financing', 'closed-trade-net-profit'
    ] as const;
    for (const field of fields) {
      const label = getPortfolioLotParityDiscrepancyLabel(field);
      expect(label.length, field).toBeGreaterThan(0);
      expect(translateBrokerReconciliationCopy(label, 'ru'), field).not.toBe(label);
    }
  });

  it('localizes fixed and data-bearing replay explanations without dropping ticker or event identity', () => {
    expect(translatePortfolioLotParityIssueReason(
      'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.', 'ru'
    )).toContain('FIFO');
    expect(translatePortfolioLotParityIssueReason(
      'Canonical AAPL contains a legacy lot without stable identity; it was not assigned a synthetic ID.', 'ru'
    )).toContain('AAPL');
    expect(translatePortfolioLotParityIssueReason(
      'Canonical cash holding MSFT has 8 shares but only 5 shares with app-recorded cost basis; remaining quantity is unmapped.', 'ru'
    )).toContain('MSFT');
    expect(translatePortfolioLotParityIssueReason(
      'Closed trade linked to sale-event-123 lacks net-profit data.', 'ru'
    )).toContain('sale-event-123');
  });

  it('wires parity to canonical positions, cash lots and closed trades as a separate read-only report', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain('verifyPortfolioTransactionLotParity(appEvents, {');
    expect(source).toContain('positions,');
    expect(source).toContain('cashHoldings,');
    expect(source).toContain('closedTrades: legacyClosedTrades');
    expect(source).toContain('lotParity.discrepancies.slice(0, 5)');
    expect(source).toContain('lotParity.issues.slice(0, 5)');
    expect(source).toContain("aria-label={translateBrokerReconciliationCopy('Lot and closed-trade replay parity')}");
    expect(source).toContain('Replay and canonical values are shown only as read-only evidence.');
  });

  it('localizes the parity panel, statuses, metrics and limitations in Russian', () => {
    const copy = [
      'Lot and closed-trade replay parity',
      'Matched within supported history',
      'Open lots replayed',
      'Closed sales replayed',
      'Differences',
      'Compares app-owned acquisition lots, FIFO sale allocations and linked closed-trade values. Legacy or unmapped history remains incomplete; no portfolio data is changed.',
      'Replay and canonical values are shown only as read-only evidence.',
      'No lot or closed-trade replay differences were detected for the supplied history.',
      'Showing first 5 lot replay differences',
      'Showing first 5 lot replay issues',
      'Replay',
      'Canonical',
      'Identity',
      'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics; removed cost basis is not treated as a sale.',
      'Buy event does not contain a stable lot ID, ticker, exact acquisition date, positive quantity, acquisition price and matching quantity delta.',
      'A stable acquisition lot ID is reused by more than one buy event.',
      'Buy event predates exact acquisition-date capture; source date was not inferred from the event timestamp.',
      'Buy event does not contain a verifiable non-negative commission amount.',
      'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.',
      'Sale contains legacy-unmapped acquisition slices; those slices remain unlinked and are not reconstructed.',
      'Sale references a stable lot ID that is absent from the available buy-event history.',
      'Sale allocation conflicts with the referenced acquisition lot identity, price, date or remaining quantity.',
      'Sale allocation consumes more buy commission than remains on the referenced lot.',
      'Sale allocations do not consume the known open acquisition lots in FIFO order.',
      'Stable lot sale allocations do not agree with the sale event price and gross proceeds.',
      'Corporate-action lot conversion does not include every open app-owned lot for the affected ticker.',
      'Corporate-action lot conversion conflicts with the recorded lot identity, remaining quantity, price, acquisition date or commission.',
      'Position quantity changed without an exact acquisition-lot adjustment; lot identity was not inferred.',
      'Cash-holding quantity changed without exact acquisition-lot or disposal allocations; cost basis was not inferred.',
      'Trade or cash-holding lot quantity corrections are not supported by the current reversal contract.',
      'Closed-history correction has no linked lot-level correction projection.',
      'A closed-trade replay item is missing required financial data.',
      'Stable sale event has no linked canonical closed-trade record.',
      'Open lot missing',
      'Open lot quantity differs',
      'Open lot cost basis differs',
      'Open lot acquisition date differs',
      'Open lot buy commission differs',
      'Cash-holding lot missing',
      'Cash-holding lot quantity differs',
      'Cash-holding lot cost basis differs',
      'Cash-holding lot acquisition date differs',
      'Cash-holding lot buy commission differs',
      'Position lot quantity differs',
      'Position buy commission differs',
      'Closed trade missing',
      'Duplicate closed trade link',
      'Closed trade ticker differs',
      'Closed trade quantity differs',
      'Closed trade cost basis differs',
      'Closed trade sale price differs',
      'Closed trade gross profit differs',
      'Closed trade commissions differ',
      'Closed trade financing differs',
      'Closed trade net profit differs'
    ];
    for (const value of copy) {
      expect(translateBrokerReconciliationCopy(value, 'ru'), value).not.toBe(value);
    }
  });
});

    expect(translateBrokerReconciliationCopy('Execution evidence incomplete', 'ru'))
      .toBe('Недостаточно данных для проверки исполнения');
    expect(translateBrokerReconciliationCopy('Missing execution evidence', 'ru'))
      .toBe('Отсутствуют данные исполнения');
    for (const field of [
      'App execution quantity',
      'Broker execution price',
      'App execution price',
      'Broker execution timestamp',
      'Broker execution currency',
      'App transaction currency',
      'Broker execution commission',
      'App transaction commission'
    ]) {
      expect(translateBrokerReconciliationCopy(field, 'ru'), field).not.toBe(field);
    }
    expect(translateBrokerReconciliationCopy(
      'The matched execution is missing one or more source values needed for a complete comparison. Missing values were not treated as zero.',
      'ru'
    )).toContain('не считались нулевыми');
  });

  it('localizes the unclassified cashflow explanation in Russian', () => {
    expect(translateBrokerReconciliationCopy(
      'The broker cashflow could not be safely classified or had no usable amount and was excluded from matching.',
      'ru'
    )).toBe('Не удалось безопасно классифицировать денежный поток брокера или определить допустимую сумму; запись исключена из сверки.');
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


describe('execution evidence presentation', () => {
  it('renders the specific missing broker/app values on provisional execution findings', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain("finding.type] || finding.type");
    expect(source).toContain('finding.missingFields && finding.missingFields.length > 0');
    expect(source).toContain("translateBrokerReconciliationCopy('Missing execution evidence')");
    expect(source).toContain('finding.missingFields.map(field => translateBrokerReconciliationCopy(field))');
  });
});

describe('transaction journal coverage visibility', () => {
  it('renders scoped replay counts and bounded issue explanations in broker reconciliation', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain('inspectPortfolioTransactionJournalReplayCoverage(appEvents)');
    expect(source).toContain("aria-label={translateBrokerReconciliationCopy('App transaction journal coverage')}");
    expect(source).toContain('journalCoverage.issues.slice(0, 5)');
    expect(source).toContain('journalCoverage.replayableCount');
    expect(source).toContain('journalCoverage.evidenceOnlyCount');
    expect(source).toContain('journalCoverage.auditOnlyCount');
    expect(source).toContain('journalCoverage.issues.length');
    expect(source).toContain('Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.');
  });

  it('localizes journal coverage statuses, counts, scope and issue reasons in Russian', () => {
    const copy = [
      'App transaction journal coverage', 'Complete within scope', 'Incomplete', 'Unsupported',
      'Replayable events', 'Evidence-only events', 'Audit-only events', 'Items needing review',
      'Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.',
      'No journal replay issues were detected for the current coverage scope.',
      'Showing first 5 coverage findings',
      'Event is malformed or uses an unsupported transaction schema.',
      'Journal contains a duplicate transaction event ID; replay is blocked to prevent applying the same event more than once.',
      'Journal contains a duplicate transaction idempotency key; replay is blocked to prevent applying the same command more than once.',
      'Broker execution evidence must not post directly to app-owned portfolio balances.',
      'Broker execution evidence is missing its source reference, instrument, side or quantity.',
      'Closed-history fee corrections must not post cash, debt, quantity or realized-margin deltas.',
      'History correction requires a stable closed-trade ID, linked app sale event, immutable fee/P&L snapshots and a valid revision chain.',
      'Trade event requires an instrument, positive quantity and matching signed position delta.',
      'Cash-holding buy is missing a stable lot ID, acquisition date, price, fee evidence or matching quantity delta.',
      'Cash-holding sale is missing exact FIFO lot allocations or a matching negative quantity delta.',
      'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics.',
      'Position adjustment requires an instrument and an explicit quantity delta.',
      'Snapshot reconciliation has no explicit state delta or complete audit-review contract.',
      'Cash adjustment requires an explicit free-cash or margin-debt delta.',
      'Margin adjustment requires an explicit debt delta.',
      'Margin-interest event requires explicit debt and realized-charge deltas; legacy events without the realized-charge delta remain incomplete.',
      'Financial correction requires an original event reference, reason and non-zero inverse state delta.',
      'Financial correction references an event that is not present in the supplied journal.',
      'Only cash/debt balance-adjustment reversals are currently supported; trade, lot and corporate-action reversals remain gated.',
      'Correction state deltas must be the exact inverse of the linked original balance adjustment.',
      'Financial posting has neither an app-owned state delta nor a complete external evidence reference.',
      'Event type is not supported by the current quantity/cash/debt replay contract.'
    ];
    for (const value of copy) {
      expect(translateBrokerReconciliationCopy(value, 'ru'), value).not.toBe(value);
    }
  });
});


describe('lot and closed-trade replay parity visibility', () => {
  it('keeps incomplete and unsupported history distinct from detected differences and a complete match', () => {
    expect(getPortfolioLotParityHeadline('complete', 0)).toBe('Matched within supported history');
    expect(getPortfolioLotParityHeadline('complete', 2)).toBe('Differences found');
    expect(getPortfolioLotParityHeadline('incomplete', 0)).toBe('Incomplete');
    expect(getPortfolioLotParityHeadline('unsupported', 0)).toBe('Unsupported');
  });

  it('provides localized labels for every supported lot and closed-trade discrepancy field', () => {
    const fields = [
      'open-lot-missing', 'open-lot-quantity', 'open-lot-cost', 'open-lot-acquisition-date',
      'open-lot-buy-commission', 'cash-holding-lot-missing', 'cash-holding-lot-quantity',
      'cash-holding-lot-cost', 'cash-holding-lot-acquisition-date', 'cash-holding-lot-buy-commission',
      'position-lot-quantity', 'position-buy-commission', 'closed-trade-missing',
      'closed-trade-duplicate', 'closed-trade-ticker', 'closed-trade-quantity', 'closed-trade-cost',
      'closed-trade-price', 'closed-trade-gross-profit', 'closed-trade-commissions',
      'closed-trade-financing', 'closed-trade-net-profit'
    ] as const;
    for (const field of fields) {
      const label = getPortfolioLotParityDiscrepancyLabel(field);
      expect(label.length, field).toBeGreaterThan(0);
      expect(translateBrokerReconciliationCopy(label, 'ru'), field).not.toBe(label);
    }
  });

  it('localizes fixed and data-bearing replay explanations without dropping ticker or event identity', () => {
    expect(translatePortfolioLotParityIssueReason(
      'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.', 'ru'
    )).toContain('FIFO');
    expect(translatePortfolioLotParityIssueReason(
      'Canonical AAPL contains a legacy lot without stable identity; it was not assigned a synthetic ID.', 'ru'
    )).toContain('AAPL');
    expect(translatePortfolioLotParityIssueReason(
      'Canonical cash holding MSFT has 8 shares but only 5 shares with app-recorded cost basis; remaining quantity is unmapped.', 'ru'
    )).toContain('MSFT');
    expect(translatePortfolioLotParityIssueReason(
      'Closed trade linked to sale-event-123 lacks net-profit data.', 'ru'
    )).toContain('sale-event-123');
  });

  it('wires parity to canonical positions, cash lots and closed trades as a separate read-only report', () => {
    const source = readFileSync(new URL('./BrokerTransactionReconciliation.tsx', import.meta.url), 'utf8');
    expect(source).toContain('verifyPortfolioTransactionLotParity(appEvents, {');
    expect(source).toContain('positions,');
    expect(source).toContain('cashHoldings,');
    expect(source).toContain('closedTrades: legacyClosedTrades');
    expect(source).toContain('lotParity.discrepancies.slice(0, 5)');
    expect(source).toContain('lotParity.issues.slice(0, 5)');
    expect(source).toContain("aria-label={translateBrokerReconciliationCopy('Lot and closed-trade replay parity')}");
    expect(source).toContain('Replay and canonical values are shown only as read-only evidence.');
  });

  it('localizes the parity panel, statuses, metrics and limitations in Russian', () => {
    const copy = [
      'Lot and closed-trade replay parity',
      'Matched within supported history',
      'Open lots replayed',
      'Closed sales replayed',
      'Differences',
      'Compares app-owned acquisition lots, FIFO sale allocations and linked closed-trade values. Legacy or unmapped history remains incomplete; no portfolio data is changed.',
      'Replay and canonical values are shown only as read-only evidence.',
      'No lot or closed-trade replay differences were detected for the supplied history.',
      'Showing first 5 lot replay differences',
      'Showing first 5 lot replay issues',
      'Replay',
      'Canonical',
      'Identity',
      'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics; removed cost basis is not treated as a sale.',
      'Buy event does not contain a stable lot ID, ticker, exact acquisition date, positive quantity, acquisition price and matching quantity delta.',
      'A stable acquisition lot ID is reused by more than one buy event.',
      'Buy event predates exact acquisition-date capture; source date was not inferred from the event timestamp.',
      'Buy event does not contain a verifiable non-negative commission amount.',
      'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.',
      'Sale contains legacy-unmapped acquisition slices; those slices remain unlinked and are not reconstructed.',
      'Sale references a stable lot ID that is absent from the available buy-event history.',
      'Sale allocation conflicts with the referenced acquisition lot identity, price, date or remaining quantity.',
      'Sale allocation consumes more buy commission than remains on the referenced lot.',
      'Sale allocations do not consume the known open acquisition lots in FIFO order.',
      'Stable lot sale allocations do not agree with the sale event price and gross proceeds.',
      'Corporate-action lot conversion does not include every open app-owned lot for the affected ticker.',
      'Corporate-action lot conversion conflicts with the recorded lot identity, remaining quantity, price, acquisition date or commission.',
      'Position quantity changed without an exact acquisition-lot adjustment; lot identity was not inferred.',
      'Cash-holding quantity changed without exact acquisition-lot or disposal allocations; cost basis was not inferred.',
      'Trade or cash-holding lot quantity corrections are not supported by the current reversal contract.',
      'Closed-history correction has no linked lot-level correction projection.',
      'A closed-trade replay item is missing required financial data.',
      'Stable sale event has no linked canonical closed-trade record.',
      'Open lot missing',
      'Open lot quantity differs',
      'Open lot cost basis differs',
      'Open lot acquisition date differs',
      'Open lot buy commission differs',
      'Cash-holding lot missing',
      'Cash-holding lot quantity differs',
      'Cash-holding lot cost basis differs',
      'Cash-holding lot acquisition date differs',
      'Cash-holding lot buy commission differs',
      'Position lot quantity differs',
      'Position buy commission differs',
      'Closed trade missing',
      'Duplicate closed trade link',
      'Closed trade ticker differs',
      'Closed trade quantity differs',
      'Closed trade cost basis differs',
      'Closed trade sale price differs',
      'Closed trade gross profit differs',
      'Closed trade commissions differ',
      'Closed trade financing differs',
      'Closed trade net profit differs'
    ];
    for (const value of copy) {
      expect(translateBrokerReconciliationCopy(value, 'ru'), value).not.toBe(value);
    }
  });
});
