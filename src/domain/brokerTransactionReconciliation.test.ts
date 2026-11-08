import { describe, expect, it } from 'vitest';
import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { ClosedTrade } from '../types/portfolio';
import { createPortfolioTransactionEvent } from './portfolioTransactionJournal';
import type { PortfolioTransactionEvent, PortfolioTransactionEventType } from '../types/portfolioTransaction';
import { getExecutionReconciliationFeedStatus, reconcileBrokerActivity } from './brokerTransactionReconciliation';

const at = Date.parse('2026-11-06T10:00:00.000Z');

function execution(overrides: Partial<BrokerExecution> = {}): BrokerExecution {
  return {
    id: 'exec-1', ticker: 'AAPL', side: 'BUY', quantity: 2, price: 100,
    currency: 'USD', executedAt: new Date(at).toISOString(), tradeValue: 200,
    profit: null, marginFee: null, commission: 1, commissionCurrency: 'USD',
    raw: {}, ...overrides
  };
}
function appEvent(
  type: PortfolioTransactionEventType,
  overrides: Partial<Parameters<typeof createPortfolioTransactionEvent>[0]> = {}
): PortfolioTransactionEvent {
  return createPortfolioTransactionEvent({
    type, effectiveAt: at, ticker: 'AAPL', quantity: 2, unitPrice: 100,
    currency: 'USD', fees: 1, feeCurrency: 'USD', ...overrides
  }, { actor: { type: 'user', id: 'investor-1' }, source: 'manual', eventId: `app-${type}`, recordedAt: at });
}
function reconcile(
  brokerExecutions: BrokerExecution[],
  appEvents: PortfolioTransactionEvent[],
  extra: Partial<Parameters<typeof reconcileBrokerActivity>[0]> = {}
) {
  return reconcileBrokerActivity({
    brokerExecutions,
    brokerCashflows: [],
    appEvents,
    executionStatus: 'complete',
    cashflowStatus: 'complete',
    appHistoryStatus: 'complete',
    now: at + 60_000,
    ...extra
  });
}


describe('broker execution feed readiness', () => {
  it.each([
    ['ready', 'complete'],
    ['loading', 'partial'],
    ['refreshing', 'partial'],
    ['stale', 'partial'],
    ['error', 'partial']
  ] as const)('treats %s as %s for reconciliation', (status, expected) => {
    expect(getExecutionReconciliationFeedStatus(status)).toBe(expected);
  });
});

describe('reconcileBrokerActivity', () => {
  it('matches an execution by normalized ticker, side, quantity, price, currency and timestamp', () => {
    const report = reconcile([execution({ ticker: 'AAPL.US' })], [appEvent('trade.buy')]);
    expect(report.status).toBe('matched');
    expect(report.matchedExecutionCount).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it('reports commission differences without converting currencies or changing inputs', () => {
    const broker = execution({ commission: 1.5 });
    const app = appEvent('trade.buy');
    const beforeBroker = structuredClone(broker);
    const beforeApp = structuredClone(app);
    const report = reconcile([broker], [app]);
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_fee_mismatch', brokerValue: 1.5, appValue: 1,
      brokerReferences: ['exec-1'], appEventIds: ['app-trade.buy']
    }));
    expect(broker).toEqual(beforeBroker);
    expect(app).toEqual(beforeApp);
  });

  it('reports quantity and price differences against a same-instrument app trade', () => {
    const report = reconcile(
      [execution({ quantity: 3, price: 101 })],
      [appEvent('trade.buy')]
    );
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'execution_quantity_mismatch', brokerValue: 3, appValue: 2 }),
      expect.objectContaining({ type: 'execution_price_mismatch', brokerValue: 101, appValue: 100 })
    ]));
  });

  it('reports execution fee currency differences without attempting FX conversion', () => {
    const report = reconcile(
      [execution({ commission: 1, commissionCurrency: 'USD' })],
      [appEvent('trade.buy', { fees: 1, feeCurrency: 'EUR' })]
    );
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_fee_currency_mismatch',
      currency: 'USD'
    }));
  });

  it('does not compare broker sell commission to the app sell event total-cost field', () => {
    const report = reconcile(
      [execution({ side: 'SELL', commission: 1 })],
      [appEvent('trade.sell', { fees: 8 })]
    );
    expect(report.findings).not.toContainEqual(expect.objectContaining({
      type: 'execution_fee_mismatch'
    }));
  });

  it('does not flag intraday broker fills against date-only app trade records on the same day', () => {
    const dateOnly = createPortfolioTransactionEvent({
      type: 'trade.buy',
      effectiveAt: Date.parse('2026-11-06T00:00:00.000Z'),
      ticker: 'AAPL', quantity: 2, unitPrice: 100, currency: 'USD', fees: 1
    }, { actor: { type: 'user' }, source: 'manual', eventId: 'app-date-only', recordedAt: at });
    const report = reconcile(
      [execution({ executedAt: '2026-11-06T15:30:00.000Z' })],
      [dateOnly]
    );
    expect(report.findings).toEqual([]);
    expect(report.matchedExecutionCount).toBe(1);
  });

  it('classifies timestamp differences beyond the normal tolerance as timing findings', () => {
    const report = reconcile(
      [execution({ executedAt: new Date(at + 60 * 60_000).toISOString() })],
      [appEvent('trade.buy')]
    );
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_timing_difference',
      difference: 60 * 60_000
    }));
  });

  it('aggregates multiple broker partial fills against one app transaction', () => {
    const report = reconcile([
      execution({ id: 'fill-1', quantity: 0.75, price: 100, commission: 0.4 }),
      execution({ id: 'fill-2', quantity: 1.25, price: 100, commission: 0.6 })
    ], [appEvent('trade.buy')]);
    expect(report.matchedExecutionCount).toBe(2);
    expect(report.findings).toEqual([]);
    expect(report.status).toBe('matched');
  });

  it('detects duplicate broker execution identifiers', () => {
    const report = reconcile(
      [execution(), execution({ quantity: 2 })],
      [appEvent('trade.buy')]
    );
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'duplicate_broker_execution',
      brokerReferences: ['exec-1']
    }));
  });

  it('keeps unmatched execution findings provisional while PT-02 journal coverage is incomplete', () => {
    const report = reconcile(
      [execution({ id: 'unmatched' })],
      [],
      { appHistoryStatus: 'partial' }
    );
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_missing_in_app',
      confidence: 'provisional'
    }));
    expect(report.warnings).toContain(
      'App transaction journal coverage is incomplete; unmatched records are provisional and are not treated as confirmed omissions.'
    );
  });

  it('matches app-authored dividends to broker cashflows while excluding broker import audit events', () => {
    const brokerCashflow: BrokerCashflow = {
      id: 'div-1', date: new Date(at).toISOString(), type: 'Dividend',
      amount: 15, currency: 'USD', description: 'Quarterly dividend', raw: {}
    };
    const importedAudit = createPortfolioTransactionEvent({
      type: 'dividend', effectiveAt: at, currency: 'USD',
      externalCashFlowAmount: 15, externalReferenceId: 'div-1'
    }, { actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow', eventId: 'broker-div-1', recordedAt: at });
    const appDividend = createPortfolioTransactionEvent({
      type: 'dividend', effectiveAt: at, currency: 'USD', externalCashFlowAmount: 15
    }, { actor: { type: 'user' }, source: 'manual', eventId: 'app-div-1', recordedAt: at });
    const report = reconcile([], [importedAudit, appDividend], { brokerCashflows: [brokerCashflow] });
    expect(report.matchedCashflowCount).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it('reports cashflow amount mismatches against a same-currency app event', () => {
    const brokerCashflow: BrokerCashflow = {
      id: 'fee-amount-1', date: new Date(at).toISOString(), type: 'Fee',
      amount: -7, currency: 'USD', description: 'Account fee', raw: {}
    };
    const appFee = createPortfolioTransactionEvent({
      type: 'fee', effectiveAt: at, currency: 'USD', fees: 5
    }, { actor: { type: 'user' }, source: 'manual', eventId: 'app-fee-amount', recordedAt: at });
    const report = reconcile([], [appFee], { brokerCashflows: [brokerCashflow] });
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'cashflow_amount_mismatch',
      brokerValue: -7,
      appValue: 5,
      appEventIds: ['app-fee-amount']
    }));
  });

  it('classifies cashflow category mismatches separately from missing rows', () => {
    const brokerCashflow: BrokerCashflow = {
      id: 'cash-type-1', date: new Date(at).toISOString(), type: 'Dividend',
      amount: 15, currency: 'USD', description: 'Quarterly dividend', raw: {}
    };
    const appAdjustment = createPortfolioTransactionEvent({
      type: 'cash.adjustment', effectiveAt: at, currency: 'USD', externalCashFlowAmount: 15
    }, { actor: { type: 'user' }, source: 'manual', eventId: 'app-adjustment', recordedAt: at });
    const report = reconcile([], [appAdjustment], { brokerCashflows: [brokerCashflow] });
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'cashflow_type_mismatch',
      appEventIds: ['app-adjustment']
    }));
  });

  it('reports cashflow currency mismatches without attempting FX conversion', () => {
    const brokerCashflow: BrokerCashflow = {
      id: 'fee-1', date: new Date(at).toISOString(), type: 'Fee',
      amount: -5, currency: 'USD', description: 'Account fee', raw: {}
    };
    const appFee = createPortfolioTransactionEvent({
      type: 'fee', effectiveAt: at, currency: 'EUR', fees: 5
    }, { actor: { type: 'user' }, source: 'manual', eventId: 'app-fee', recordedAt: at });
    const report = reconcile([], [appFee], { brokerCashflows: [brokerCashflow] });
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'cashflow_currency_mismatch',
      brokerValue: -5,
      appEventIds: ['app-fee']
    }));
  });

  it('does not treat incomplete broker feeds as authoritative absence evidence', () => {
    const report = reconcile([], [appEvent('trade.buy')], {
      executionStatus: 'partial',
      cashflowStatus: 'unavailable'
    });
    expect(report.status).toBe('partial');
    expect(report.findings.every(finding => finding.confidence === 'provisional')).toBe(true);
  });
});


describe('legacy closed-sale reconciliation fallback', () => {
  const closedSale = (overrides: Partial<ClosedTrade> = {}): ClosedTrade => ({
    id: 'closed-sale-1',
    ticker: 'AAPL',
    shares: 2,
    avgBuyPrice: 90,
    sellPrice: 110,
    buyDate: '2026-11-05',
    sellDate: '2026-11-06',
    date: at,
    grossProfit: 40,
    commissions: 1,
    marginInterest: 0,
    netProfit: 39,
    ...overrides
  });

  it('matches a legacy app closed-sale summary to an exact same-day broker sell', () => {
    const report = reconcile(
      [execution({
        id: 'legacy-sell-fill',
        side: 'SELL',
        quantity: 2,
        price: 110,
        executedAt: '2026-11-06T15:30:00.000Z'
      })],
      [],
      { legacyClosedTrades: [closedSale()], appHistoryStatus: 'partial' }
    );

    expect(report.status).toBe('partial');
    expect(report.appExecutionCount).toBe(0);
    expect(report.legacyClosedSaleCount).toBe(1);
    expect(report.matchedLegacyClosedSaleCount).toBe(1);
    expect(report.matchedLegacyExecutionCount).toBe(1);
    expect(report.findings).not.toContainEqual(expect.objectContaining({
      type: 'execution_missing_in_app',
      brokerReferences: ['legacy-sell-fill']
    }));
  });

  it('aggregates partial broker sell fills only when their total quantity and weighted price match one legacy sale', () => {
    const report = reconcile([
      execution({ id: 'legacy-partial-1', side: 'SELL', quantity: 0.75, price: 100 }),
      execution({ id: 'legacy-partial-2', side: 'SELL', quantity: 1.25, price: 100, executedAt: new Date(at + 60_000).toISOString() })
    ], [], {
      legacyClosedTrades: [closedSale({ sellPrice: 100 })],
      appHistoryStatus: 'partial'
    });

    expect(report.matchedLegacyClosedSaleCount).toBe(1);
    expect(report.matchedLegacyExecutionCount).toBe(2);
    expect(report.findings).toEqual([]);
  });

  it('does not infer a historical buy execution from a closed sale average entry price', () => {
    const report = reconcile(
      [execution({ id: 'historical-buy', side: 'BUY', quantity: 2, price: 90 })],
      [],
      { legacyClosedTrades: [closedSale()], appHistoryStatus: 'partial' }
    );

    expect(report.matchedLegacyClosedSaleCount).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_missing_in_app',
      brokerReferences: ['historical-buy'],
      confidence: 'provisional'
    }));
  });

  it('does not match a legacy sale when broker sale price differs', () => {
    const report = reconcile(
      [execution({ id: 'different-price', side: 'SELL', quantity: 2, price: 111 })],
      [],
      { legacyClosedTrades: [closedSale()], appHistoryStatus: 'partial' }
    );

    expect(report.matchedLegacyClosedSaleCount).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'execution_missing_in_app',
      brokerReferences: ['different-price']
    }));
  });

  it('leaves duplicate exact broker candidates unmatched when the legacy sale cannot identify one uniquely', () => {
    const report = reconcile([
      execution({ id: 'ambiguous-1', side: 'SELL', quantity: 2, price: 110 }),
      execution({ id: 'ambiguous-2', side: 'SELL', quantity: 2, price: 110 })
    ], [], {
      legacyClosedTrades: [closedSale()],
      appHistoryStatus: 'partial'
    });

    expect(report.matchedLegacyClosedSaleCount).toBe(0);
    expect(report.matchedLegacyExecutionCount).toBe(0);
  });
});
