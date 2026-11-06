import type { PortfolioState } from '../types/portfolio';
import { DEFAULT_BROKER_ASSUMPTIONS } from '../domain/brokerAssumptions';

/**
 * Creates a complete, canonical application portfolio state.
 *
 * Unlike the legacy backup snapshot factory in domain/portfolio.ts, this
 * includes the fields required by the current store contract.
 */
export function createBlankPortfolioState(now = Date.now()): PortfolioState {
  return {
    positions: {},
    activeTrancheTypes: {},
    activeTrancheMixes: {},
    activeTrancheGuestAssignments: {},
    activeTrancheGuestAssignmentDetails: {},
    closedTradeAllocations: {},
    guestPortfolioSnapshot: undefined,
    guestTrancheLedger: [],
    brokerAccountInfo: undefined,
    cashCushion: { freeCash: 0, holdings: [] },
    balance: 0,
    portfolioEquity: undefined,
    portfolioEquityUpdatedAt: undefined,
    realizedMarginCharged: 0,
    tranches: [],
    startDate: new Date(now).toISOString().slice(0, 10),
    activeView: 'COMBINED',
    closedTrades: [],
    brokerExecutedTrades: [],
    transactionEvents: [],
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
  };
}
