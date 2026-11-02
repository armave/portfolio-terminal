import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from '../domain/brokerAssumptions';
import { createBlankPortfolioState } from './portfolioDefaults';

describe('createBlankPortfolioState', () => {
  it('creates the complete canonical store contract from a supplied clock', () => {
    const now = Date.parse('2026-11-02T00:00:00.000Z');
    const state = createBlankPortfolioState(now);

    expect(state).toMatchObject({
      positions: {},
      activeTrancheTypes: {},
      activeTrancheMixes: {},
      activeTrancheGuestAssignments: {},
      activeTrancheGuestAssignmentDetails: {},
      closedTradeAllocations: {},
      guestTrancheLedger: [],
      cashCushion: { freeCash: 0, holdings: [] },
      balance: 0,
      realizedMarginCharged: 0,
      activeView: 'COMBINED',
      closedTrades: [],
      brokerExecutedTrades: [],
      closedHistory: [],
      cashflows: [],
      brokerAssumptions: DEFAULT_BROKER_ASSUMPTIONS,
      lastRolloverTimestamp: now,
      lastUpdated: now,
      cashBalance: 0,
      holdings: [],
      cashStocks: [],
      apiKeys: {},
      selectedTicker: null,
      pendingMutation: null
    });
    expect(state.startDate).toBe('2026-11-02');
    expect(state).not.toHaveProperty('gatewaySecret');
  });
});
