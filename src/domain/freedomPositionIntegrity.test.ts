import { describe, expect, it } from 'vitest';
import { collectFreedomPositionIntegrityIssues } from './freedomPositionIntegrity';

describe('collectFreedomPositionIntegrityIssues', () => {
  it('marks negative broker quantities unknown without converting them into shorts', () => {
    const issues = collectFreedomPositionIntegrityIssues({
      positions: [{
        ticker: 'AAPL.US',
        quantity: -5,
        direction: 'unknown',
        rawQuantity: -5,
        rawSide: null,
        instrumentId: 'instrument-1'
      }]
    });

    expect(issues).toEqual([expect.objectContaining({
      ticker: 'AAPL',
      code: 'negative_quantity_sign_unverified',
      source: 'account_snapshot',
      rawQuantity: -5,
      instrumentId: 'instrument-1'
    })]);
  });

  it('keeps an explicit short position unsupported even when the broker quantity is positive', () => {
    const issues = collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'TSLA', quantity: 3, direction: 'short', rawSide: 'short' }]
    });

    expect(issues).toEqual([expect.objectContaining({
      ticker: 'TSLA',
      code: 'short_position_side_unverified',
      rawSide: 'short'
    })]);
  });

  it('does not interpret unrecognized position-side codes as long or short', () => {
    const issues = collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'NVDA', quantity: 2, direction: 'unknown', rawSide: 'S' }]
    });

    expect(issues[0]).toMatchObject({
      ticker: 'NVDA',
      code: 'unrecognized_position_side',
      rawSide: 'S'
    });
  });

  it('flags outstanding short-sale exposure and an unmatched cover separately', () => {
    const openShort = collectFreedomPositionIntegrityIssues({ positions: [{ ticker: 'GOOGL', quantity: 2 }] }, [
      { ticker: 'GOOGL', side: 'SELL_SHORT', quantity: 2 }
    ]);
    const unmatchedCover = collectFreedomPositionIntegrityIssues({ positions: [{ ticker: 'GOOGL', quantity: 2 }] }, [
      { ticker: 'GOOGL', side: 'BUY_TO_COVER', quantity: 2 }
    ]);

    expect(openShort).toContainEqual(expect.objectContaining({ ticker: 'GOOGL', code: 'short_execution_unsupported' }));
    expect(unmatchedCover).toContainEqual(expect.objectContaining({ ticker: 'GOOGL', code: 'short_cover_unsupported' }));
  });

  it('flags excess sells where the supplied history cannot explain the current long position', () => {
    const issues = collectFreedomPositionIntegrityIssues({ positions: [{ ticker: 'META', quantity: 1 }] }, [
      { ticker: 'META', side: 'BUY', quantity: 2, executedAt: '2026-01-01T10:00:00Z' },
      { ticker: 'META', side: 'SELL', quantity: 3, executedAt: '2026-01-02T10:00:00Z' }
    ]);

    expect(issues).toEqual([expect.objectContaining({
      ticker: 'META',
      code: 'unmatched_sell_quantity',
      rawQuantity: 3
    })]);
  });

  it('does not retain a completed short lifecycle as an open unsupported position', () => {
    expect(collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'GOOGL', quantity: 3, direction: 'long' }]
    }, [
      { ticker: 'GOOGL', side: 'SELL_SHORT', quantity: 2 },
      { ticker: 'GOOGL', side: 'BUY_TO_COVER', quantity: 2 }
    ])).toEqual([]);
  });

  it('ignores closed-ticker executions when evaluating the current open position set', () => {
    expect(collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'AAPL', quantity: 3, direction: 'long' }]
    }, [
      { ticker: 'OLD', side: 'SELL_SHORT', quantity: 2 },
      { ticker: 'OLD', side: 'BUY_TO_COVER', quantity: 2 }
    ])).toEqual([]);
  });

  it('flags executions without an instrument identifier and retains their raw evidence', () => {
    const raw = { operation: 'SELL_SHORT', q: 2, p: 100 };
    expect(collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'AAPL', quantity: 1, direction: 'long' }]
    }, [{ side: 'SELL_SHORT', quantity: 2, raw }])).toContainEqual(expect.objectContaining({
      ticker: 'ROW 1',
      code: 'invalid_execution',
      raw
    }));
  });

  it('flags unknown execution sides and malformed broker positions instead of dropping them', () => {
    const issues = collectFreedomPositionIntegrityIssues({
      positions: [
        { ticker: 'AAPL', quantity: 2 },
        { ticker: '', quantity: 4 }
      ]
    }, [{ ticker: 'AAPL', side: 'Unknown', quantity: 1 }]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: 'ROW 2', code: 'invalid_broker_position' }),
      expect.objectContaining({ ticker: 'AAPL', code: 'unknown_execution_side' })
    ]));
  });

  it('leaves ordinary positive long positions and balanced buy/sell history unchanged', () => {
    expect(collectFreedomPositionIntegrityIssues({
      positions: [{ ticker: 'AAPL.US', quantity: 3, direction: 'long' }]
    }, [
      { ticker: 'AAPL.US', side: 'BUY', quantity: 5 },
      { ticker: 'AAPL.US', side: 'SELL', quantity: 2 }
    ])).toEqual([]);
  });
});
