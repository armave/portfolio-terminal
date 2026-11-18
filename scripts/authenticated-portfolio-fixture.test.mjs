import { describe, expect, it } from 'vitest';
import {
  replayPortfolioTransactionJournal,
  isPortfolioTransactionEventList,
  verifyPortfolioTransactionParity
} from '../src/domain/portfolioTransactionJournal.ts';
import {
  replayPortfolioTransactionLots,
  verifyPortfolioTransactionLotParity
} from '../src/domain/portfolioLotJournal.ts';
import { buildAuthenticatedPortfolioFixture } from './authenticated-portfolio-fixture.mjs';

describe('authenticated performance portfolio fixture', () => {
  const fixedNow = Date.UTC(2026, 10, 17, 12, 0, 0);

  it('builds 100 positions, 200 stable open lots, linked closed history and valid journal parity', () => {
    const fixture = buildAuthenticatedPortfolioFixture(fixedNow);
    const tranches = Object.values(fixture.positions).flatMap((position) => position.tranches || []);
    const expectedPositions = Object.fromEntries(Object.entries(fixture.positions).map(([ticker, position]) => [
      ticker,
      { shares: position.shares }
    ]));

    expect(fixture.summary).toMatchObject({
      positionCount: 100,
      openLotCount: 200,
      closedTradeCount: 10,
      transactionEventCount: 220,
      syntheticQuoteClass: 'indicative',
      liveBrokerVerification: false
    });
    expect(Object.keys(fixture.positions)).toHaveLength(100);
    expect(tranches).toHaveLength(200);
    expect(new Set(tranches.map((lot) => lot.lotId)).size).toBe(200);
    expect(fixture.closedTrades).toHaveLength(10);
    expect(fixture.transactionEvents).toHaveLength(220);
    expect(isPortfolioTransactionEventList(fixture.transactionEvents)).toBe(true);

    const replay = replayPortfolioTransactionJournal(fixture.transactionEvents);
    const balanceParity = verifyPortfolioTransactionParity(fixture.transactionEvents, {
      positions: expectedPositions,
      cashCushion: fixture.cashCushion,
      balance: 0,
      realizedMarginCharged: 0
    });
    expect(replay.positions).toEqual(Object.fromEntries(Object.entries(expectedPositions).map(([ticker, value]) => [
      ticker,
      value.shares
    ])));
    expect(balanceParity).toEqual({ matches: true, discrepancies: [] });

    const lotReplay = replayPortfolioTransactionLots(fixture.transactionEvents);
    const lotParity = verifyPortfolioTransactionLotParity(fixture.transactionEvents, {
      positions: fixture.positions,
      closedTrades: fixture.closedTrades
    });
    expect(lotReplay.status).toBe('complete');
    expect(lotReplay.openLots).toHaveLength(200);
    expect(lotReplay.sales).toHaveLength(10);
    expect(lotParity).toMatchObject({
      status: 'complete',
      matches: true,
      discrepancies: [],
      issues: []
    });
  });

  it('is deterministic for an identical timestamp and separates each fixture identity', () => {
    const first = buildAuthenticatedPortfolioFixture(fixedNow);
    const second = buildAuthenticatedPortfolioFixture(fixedNow);
    expect(second).toEqual(first);
    expect(new Set(first.transactionEvents.map((event) => event.idempotencyKey)).size)
      .toBe(first.transactionEvents.length);
  });

  it('rejects invalid fixture timestamps', () => {
    expect(() => buildAuthenticatedPortfolioFixture(0)).toThrow(RangeError);
    expect(() => buildAuthenticatedPortfolioFixture(Number.NaN)).toThrow(RangeError);
  });
});
