import { describe, expect, it, vi } from 'vitest';
import { createBlankPortfolioState } from '../store/portfolioDefaults';
import type { GuestPortfolioSnapshot } from './api';
import type { PortfolioState } from '../types/portfolio';
import type { GuestPortfolioSessionIdentity } from './guestPortfolioSession';
import {
  createGuestPortfolioHydrationRuntime,
  type GuestPortfolioHydrationRuntimeDependencies
} from './guestPortfolioHydrationRuntime';

function createSnapshot(): GuestPortfolioSnapshot {
  return {
    updatedAt: 42,
    tranches: [],
    ledger: [],
    ledgerUpdatedAt: 42
  };
}

function createFixture(options: {
  session?: GuestPortfolioSessionIdentity;
  currentView?: string | null;
  snapshot?: GuestPortfolioSnapshot;
  currentCashHoldings?: PortfolioState['cashCushion']['holdings'];
  missingIdentityGeneration?: boolean;
} = {}) {
  let session: GuestPortfolioSessionIdentity = options.session ?? {
    role: 'guest',
    accountId: 'guest-a',
    secret: 'session-token-a',
    generation: 1
  };
  const dependencies = {
    getSessionIdentity: vi.fn((missingGeneration: number) => ({
      ...session,
      generation: options.missingIdentityGeneration ? missingGeneration : session.generation
    })),
    getGuestPortfolioSnapshot: vi.fn(async () => options.snapshot ?? createSnapshot()),
    getActiveView: vi.fn(() => options.currentView ?? 'BALANCE'),
    getCurrentCashHoldings: vi.fn(() => options.currentCashHoldings ?? []),
    createCleanWorkspaceState: vi.fn(() => createBlankPortfolioState(100)),
    importGuestWorkspace: vi.fn()
  } satisfies GuestPortfolioHydrationRuntimeDependencies;

  return {
    dependencies,
    getSession: () => session,
    setSession: (next: GuestPortfolioSessionIdentity) => { session = next; }
  };
}

describe('guest portfolio hydration runtime', () => {
  it('requires an authenticated guest before requesting their assigned snapshot', async () => {
    const fixture = createFixture({
      session: { role: 'admin', accountId: 'admin-a', secret: 'admin-token', generation: 2 }
    });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await expect(runtime.pullGuestPortfolioSnapshot()).rejects.toThrow(
      'A guest session is required to load assigned holdings.'
    );

    expect(fixture.dependencies.getGuestPortfolioSnapshot).not.toHaveBeenCalled();
    expect(fixture.dependencies.importGuestWorkspace).not.toHaveBeenCalled();
  });

  it('hydrates only the active guest projection and preserves the current guest desk', async () => {
    const fixture = createFixture({ currentView: 'SETTINGS' });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    expect(fixture.dependencies.getGuestPortfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.importGuestWorkspace).toHaveBeenCalledTimes(1);
    const [workspace] = vi.mocked(fixture.dependencies.importGuestWorkspace).mock.calls[0];
    expect(workspace).toMatchObject({
      activeView: 'SETTINGS',
      selectedTicker: null,
      positions: {},
      activeTrancheGuestAssignments: {},
      activeTrancheTypes: {},
      activeTrancheMixes: {},
      guestPortfolioSnapshot: { updatedAt: 42, tranches: [] },
      guestTrancheLedger: [],
      brokerAccountInfo: undefined,
      brokerExecutedTrades: [],
      cashflows: [],
      closedTrades: [],
      closedHistory: [],
      balance: 0,
      cashBalance: 0,
      realizedMarginCharged: 0,
      portfolioEquity: 0,
      cashCushion: { freeCash: 0, holdings: [] },
      cashStocks: [],
      gatewaySecret: undefined,
      apiKeys: {}
    });
  });

  it('preserves the daily quote badge while refreshing the guest portfolio snapshot', async () => {
    const receivedAt = Date.parse('2026-11-03T15:00:00.000Z');
    const quoteDetails = {
      price: 278.62,
      change: -0.36,
      changePercent: -0.13,
      freshness: 'fresh' as const,
      receivedAt,
      sourceTimestamp: receivedAt
    };
    const fixture = createFixture({
      currentCashHoldings: [{
        ticker: 'GOOGL',
        shares: 31,
        averagePrice: 337.77,
        price: 278.62,
        currentPrice: 278.62,
        quoteUpdatedAt: receivedAt,
        quoteSource: 'Freedom TradeNet',
        quoteDetails
      }],
      snapshot: {
        updatedAt: 43,
        tranches: [{
          id: 'GOOGL:buy-1',
          ticker: 'GOOGL',
          name: 'Alphabet',
          quantity: 31,
          marketPrice: 277.5,
          averagePrice: 337.77,
          marketValue: 8602.5,
          purchasedAt: receivedAt - 86_400_000
        }],
        ledger: [],
        ledgerUpdatedAt: 43
      }
    });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    const [workspace] = vi.mocked(fixture.dependencies.importGuestWorkspace).mock.calls[0];
    expect(workspace.cashCushion.holdings).toEqual([
      expect.objectContaining({
        ticker: 'GOOGL',
        shares: 31,
        currentPrice: 278.62,
        price: 278.62,
        quoteUpdatedAt: receivedAt,
        quoteSource: 'Freedom TradeNet',
        quoteDetails
      })
    ]);
    expect(workspace.guestPortfolioSnapshot?.tranches[0]).toMatchObject({
      marketPrice: 277.5,
      averagePrice: 337.77
    });
  });

  it('falls back to Balance when the current route is not guest-accessible', async () => {
    const fixture = createFixture({ currentView: 'CLOSED_HISTORY' });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    expect(fixture.dependencies.importGuestWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ activeView: 'BALANCE' })
    );
  });

  it('rejects the request when the session guard cannot capture an identity', async () => {
    const fixture = createFixture({ missingIdentityGeneration: true });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    expect(fixture.dependencies.getSessionIdentity).toHaveBeenNthCalledWith(1, -1);
    expect(fixture.dependencies.getSessionIdentity).toHaveBeenNthCalledWith(2, -2);
    expect(fixture.dependencies.importGuestWorkspace).not.toHaveBeenCalled();
  });

  it('ignores a snapshot response after the active account or credential changes', async () => {
    const fixture = createFixture();
    fixture.dependencies.getGuestPortfolioSnapshot = vi.fn(async () => {
      fixture.setSession({
        role: 'guest',
        accountId: 'guest-b',
        secret: 'session-token-b',
        generation: 2
      });
      return createSnapshot();
    });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    expect(fixture.dependencies.importGuestWorkspace).not.toHaveBeenCalled();
  });

  it('ignores an old login generation after the same guest signs out and back in', async () => {
    const fixture = createFixture();
    fixture.dependencies.getGuestPortfolioSnapshot = vi.fn(async () => {
      fixture.setSession({
        role: 'guest',
        accountId: 'guest-a',
        secret: 'session-token-a',
        generation: 3
      });
      return createSnapshot();
    });
    const runtime = createGuestPortfolioHydrationRuntime(fixture.dependencies);

    await runtime.pullGuestPortfolioSnapshot();

    expect(fixture.dependencies.importGuestWorkspace).not.toHaveBeenCalled();
  });
});
