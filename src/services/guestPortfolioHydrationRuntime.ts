import { getGuestAssignedCashHoldings } from '../domain/guestPortfolio';
import type { PortfolioState } from '../types/portfolio';
import type { GuestPortfolioSnapshot } from './api';
import {
  isCurrentGuestPortfolioSession,
  resolveGuestPortfolioRefreshView,
  type GuestPortfolioSessionIdentity
} from './guestPortfolioSession';

export interface GuestPortfolioHydrationRuntimeDependencies {
  getSessionIdentity: (missingGeneration: number) => GuestPortfolioSessionIdentity;
  getGuestPortfolioSnapshot: () => Promise<GuestPortfolioSnapshot>;
  getActiveView: () => string | null | undefined;
  getCurrentCashHoldings: () => PortfolioState['cashCushion']['holdings'];
  createCleanWorkspaceState: () => PortfolioState;
  importGuestWorkspace: (guestWorkspace: PortfolioState) => void;
}

export interface GuestPortfolioHydrationRuntime {
  pullGuestPortfolioSnapshot: () => Promise<void>;
}

/**
 * Hydrates only the server-scoped projection belonging to the current guest
 * session. Session matching and projection construction live here; the app
 * retains sole ownership of importing, persisting, and rendering the store.
 */
export function createGuestPortfolioHydrationRuntime(
  dependencies: GuestPortfolioHydrationRuntimeDependencies
): GuestPortfolioHydrationRuntime {
  const pullGuestPortfolioSnapshot = async (): Promise<void> => {
    const requestedSession = dependencies.getSessionIdentity(-1);
    if (requestedSession.role !== 'guest' || !requestedSession.accountId) {
      throw new Error('A guest session is required to load assigned holdings.');
    }

    const snapshot = await dependencies.getGuestPortfolioSnapshot();
    const currentSession = dependencies.getSessionIdentity(-2);

    // A response authorized by the previous guest must never hydrate the next
    // account's local workspace after an account or credential switch.
    if (!isCurrentGuestPortfolioSession(requestedSession, currentSession)) return;

    const guestId = requestedSession.accountId;
    const assignments = Object.fromEntries(snapshot.tranches.map((tranche) => [tranche.id, guestId]));
    const types = Object.fromEntries(snapshot.tranches.map((tranche) => [tranche.id, 'cash' as const]));
    const holdings = getGuestAssignedCashHoldings({
      guestId,
      activeTranches: snapshot.tranches,
      assignments,
      types,
      mixes: {},
      // The server projection carries assignment data, not the live quote metadata
      // already displayed by the guest card. Keep the last accepted quote per ticker.
      cashHoldings: dependencies.getCurrentCashHoldings()
    });

    // A snapshot refresh updates guest data, not the user's current desk.
    // Keep the selected guest-accessible route (Balance, LOTS or Settings).
    const refreshActiveView = resolveGuestPortfolioRefreshView(dependencies.getActiveView());
    const blank = dependencies.createCleanWorkspaceState();
    const guestWorkspace = {
      ...blank,
      activeView: refreshActiveView,
      selectedTicker: null,
      positions: {},
      activeTrancheGuestAssignments: assignments,
      activeTrancheTypes: types,
      activeTrancheMixes: {},
      guestPortfolioSnapshot: { updatedAt: snapshot.updatedAt, tranches: snapshot.tranches },
      guestTrancheLedger: snapshot.ledger,
      brokerAccountInfo: undefined,
      brokerExecutedTrades: [],
      cashflows: [],
      closedTrades: [],
      closedHistory: [],
      balance: 0,
      cashBalance: 0,
      realizedMarginCharged: 0,
      portfolioEquity: holdings.reduce((sum, holding) => sum + (Number(holding.marketValue) || 0), 0),
      cashCushion: { freeCash: 0, holdings },
      cashStocks: holdings,
      gatewaySecret: undefined,
      apiKeys: {}
    } as PortfolioState;

    dependencies.importGuestWorkspace(guestWorkspace);
  };

  return { pullGuestPortfolioSnapshot };
}
