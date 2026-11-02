import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankPortfolioState } from '../store/portfolioDefaults';
import type { ActiveBrokerTranche } from '../types/portfolio';
import { emitBrokerEvent } from './brokerEventBus';
import type { AuthUser, GuestPortfolioPublication } from './api';
import type { GuestPortfolioAssignmentRuntimeDependencies } from './guestPortfolioAssignmentRuntime';
import { createGuestPortfolioAssignmentRuntime } from './guestPortfolioAssignmentRuntime';

const guest = (id: string): AuthUser => ({
  id,
  name: id,
  role: 'guest',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z'
});

function activeTranche(overrides: Partial<ActiveBrokerTranche> = {}): ActiveBrokerTranche {
  return {
    id: 'AAPL:buy-1', ticker: 'AAPL', name: 'Apple', quantity: 4,
    marketPrice: 120, averagePrice: 100, marketValue: 480, purchasedAt: 10,
    ...overrides
  };
}

function createFixture(overrides: Partial<GuestPortfolioAssignmentRuntimeDependencies> = {}) {
  const state = createBlankPortfolioState(1);
  let accountRole: 'admin' | 'guest' | null = 'admin';
  let activeTrancheResults: ActiveBrokerTranche[] = [];
  const dependencies: GuestPortfolioAssignmentRuntimeDependencies = {
    getAccountRole: () => accountRole,
    requireAdmin: vi.fn(async () => true),
    getState: () => state,
    setState: (updates) => { Object.assign(state, updates); },
    persistState: vi.fn(),
    pushState: vi.fn(async () => true),
    listUsers: vi.fn(async () => [guest('guest-1'), guest('guest-2')]),
    publishBatch: vi.fn(async (_publications: GuestPortfolioPublication[]) => undefined),
    renderBoard: vi.fn(),
    showToast: vi.fn(),
    logError: vi.fn(),
    logTerminal: vi.fn(),
    now: () => 1_000,
    getActiveTranches: vi.fn(() => activeTrancheResults),
    ...overrides
  };
  return {
    state,
    dependencies,
    runtime: createGuestPortfolioAssignmentRuntime(dependencies),
    setAccountRole: (role: 'admin' | 'guest' | null) => { accountRole = role; },
    setActiveTranches: (tranches: ActiveBrokerTranche[]) => { activeTrancheResults = tranches; }
  };
}

function preparePublisher(fixture: ReturnType<typeof createFixture>, tranche = activeTranche()): void {
  fixture.state.brokerAccountInfo = { loaded: true, receivedAt: 1_000, balances: [], positions: [] };
  fixture.state.brokerExecutedTrades = [];
  fixture.state.activeTrancheGuestAssignments = { [tranche.id]: 'guest-1' };
  fixture.state.activeTrancheGuestAssignmentDetails = {
    [tranche.id]: {
      assignmentId: 'assignment-aapl-1',
      guestId: 'guest-1',
      assignedAt: 100,
      assignedQuantity: tranche.quantity
    }
  };
  fixture.setActiveTranches([tranche]);
  fixture.runtime.setBrokerTradeHistoryLoaded(true);
}

describe('guest portfolio assignment runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves closed-trade assignment history when moving an allocation to another guest', async () => {
    const fixture = createFixture();
    fixture.state.closedTradeAllocations = {
      'trade-1': {
        fundingType: 'cash', cashQuantity: 3, marginQuantity: 0, guestId: 'guest-1', assignedAt: 100,
        guestAssignments: [{ guestId: 'guest-1', assignedQuantity: 3, assignedAt: 100 }]
      }
    };

    await fixture.runtime.handleSetClosedTradeAllocation({
      rowId: 'trade-1',
      allocation: { fundingType: 'cash', cashQuantity: 2, marginQuantity: 0, guestId: 'guest-2' }
    });

    expect(fixture.state.closedTradeAllocations?.['trade-1']).toEqual({
      fundingType: 'cash',
      cashQuantity: 2,
      marginQuantity: 0,
      guestId: 'guest-2',
      assignedAt: 1_000,
      guestAssignments: [
        { guestId: 'guest-1', assignedQuantity: 3, assignedAt: 100 },
        { guestId: 'guest-2', assignedQuantity: 2, assignedAt: 1_000 }
      ]
    });
    expect(fixture.dependencies.persistState).toHaveBeenCalledWith(fixture.state);
    expect(fixture.dependencies.pushState).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.renderBoard).toHaveBeenCalledTimes(1);
  });

  it('validates active tranche eligibility and supports unassignment', async () => {
    const tranche = activeTranche({ quantity: 5 });
    const fixture = createFixture({ getActiveTranches: vi.fn(() => [tranche]) });
    fixture.state.brokerExecutedTrades = [];

    await fixture.runtime.handleAssignActiveTrancheGuest({ trancheId: tranche.id, guestId: 'guest-1' });
    expect(fixture.state.activeTrancheGuestAssignments?.[tranche.id]).toBe('guest-1');
    expect(fixture.state.activeTrancheGuestAssignmentDetails?.[tranche.id]).toMatchObject({
      guestId: 'guest-1', assignedAt: 1_000, assignedQuantity: 5
    });
    expect(fixture.state.activeTrancheGuestAssignmentDetails?.[tranche.id]?.assignmentId).toBeTruthy();

    await fixture.runtime.handleAssignActiveTrancheGuest({ trancheId: tranche.id, guestId: '' });
    expect(fixture.state.activeTrancheGuestAssignments?.[tranche.id]).toBeUndefined();
    expect(fixture.state.activeTrancheGuestAssignmentDetails?.[tranche.id]).toBeUndefined();
    expect(fixture.dependencies.persistState).toHaveBeenCalledTimes(2);
  });

  it('rejects margin-only and zero-cash Mix tranches without changing assignments', async () => {
    const tranche = activeTranche({ id: 'AAPL:margin', quantity: 4 });
    const fixture = createFixture({ getActiveTranches: vi.fn(() => [tranche]) });
    fixture.state.brokerExecutedTrades = [];
    fixture.state.activeTrancheTypes = { [tranche.id]: 'margin' };

    await fixture.runtime.handleAssignActiveTrancheGuest({ trancheId: tranche.id, guestId: 'guest-1' });
    expect(fixture.state.activeTrancheGuestAssignments?.[tranche.id]).toBeUndefined();
    expect(fixture.dependencies.showToast).toHaveBeenCalledWith(
      'Only a tranche with a positive cash allocation can be linked to a guest.',
      'error'
    );
  });

  it('does not execute assignment commands when administrator authorization fails', async () => {
    const fixture = createFixture({ requireAdmin: vi.fn(async () => false) });
    await fixture.runtime.handleSetClosedTradeAllocation({
      rowId: 'trade-1',
      allocation: { fundingType: 'cash', cashQuantity: 1, marginQuantity: 0 }
    });
    expect(fixture.state.closedTradeAllocations?.['trade-1']).toBeUndefined();
    expect(fixture.dependencies.listUsers).not.toHaveBeenCalled();
    expect(fixture.dependencies.persistState).not.toHaveBeenCalled();
  });

  it('binds broker commands and disposes both listeners', async () => {
    const fixture = createFixture();
    const dispose = fixture.runtime.bind();
    emitBrokerEvent('broker:set-closed-trade-allocation', {
      rowId: 'trade-1',
      allocation: { fundingType: 'cash', cashQuantity: 1, marginQuantity: 0 }
    });
    await vi.waitFor(() => expect(fixture.dependencies.requireAdmin).toHaveBeenCalledTimes(1));
    dispose();
    emitBrokerEvent('broker:set-closed-trade-allocation', {
      rowId: 'trade-2',
      allocation: { fundingType: 'cash', cashQuantity: 1, marginQuantity: 0 }
    });
    await Promise.resolve();
    expect(fixture.dependencies.requireAdmin).toHaveBeenCalledTimes(1);
  });

  it('does not publish while the broker snapshot is absent, stale, or trade history is not ready', async () => {
    const fixture = createFixture();
    fixture.runtime.setBrokerTradeHistoryLoaded(true);
    await fixture.runtime.publishGuestPortfolioSnapshots();
    expect(fixture.dependencies.listUsers).not.toHaveBeenCalled();

    preparePublisher(fixture);
    fixture.state.brokerAccountInfo = { ...fixture.state.brokerAccountInfo!, status: 'stale' };
    await fixture.runtime.publishGuestPortfolioSnapshots();
    expect(fixture.dependencies.listUsers).not.toHaveBeenCalled();
    expect(fixture.dependencies.publishBatch).not.toHaveBeenCalled();
  });

  it('backfills legacy assignment IDs and publishes guest-filtered snapshots with active and closed ledger rows', async () => {
    const fixture = createFixture();
    const tranche = activeTranche({ quantity: 3 });
    preparePublisher(fixture, tranche);
    fixture.state.activeTrancheGuestAssignmentDetails = {};
    fixture.state.closedTrades = [{
      id: 'row-1', ticker: 'AAPL', shares: 2, avgBuyPrice: 100, sellPrice: 110,
      buyDate: '2026-10-01', exitDate: '2026-10-03', grossProfit: 20, commissions: 1
    }];
    fixture.state.closedTradeAllocations = {
      'app:row-1': {
        fundingType: 'cash', cashQuantity: 1, marginQuantity: 1, guestId: 'guest-1', assignedAt: 200,
        guestAssignments: [{ guestId: 'guest-1', assignedQuantity: 1, assignedAt: 200 }]
      }
    };

    await fixture.runtime.publishGuestPortfolioSnapshots();

    const details = fixture.state.activeTrancheGuestAssignmentDetails?.[tranche.id];
    expect(details).toMatchObject({
      guestId: 'guest-1',
      assignmentId: expect.stringMatching(/^legacy-/),
      assignedAt: 1_000,
      assignedQuantity: 3
    });
    expect(fixture.dependencies.persistState).toHaveBeenCalledWith(fixture.state);
    expect(fixture.dependencies.pushState).toHaveBeenCalledTimes(1);

    const publications = vi.mocked(fixture.dependencies.publishBatch).mock.calls[0]?.[0] || [];
    const guestOne = publications.find((publication) => publication.guestId === 'guest-1');
    const guestTwo = publications.find((publication) => publication.guestId === 'guest-2');
    expect(guestOne?.snapshot.tranches).toEqual([
      expect.objectContaining({ id: tranche.id, quantity: 3 })
    ]);
    expect(guestOne?.ledgerUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentId: details?.assignmentId, openQuantity: 3, status: 'active' }),
      expect.objectContaining({
        ticker: 'AAPL', assignedQuantity: 1, openQuantity: 0, status: 'closed', netProfit: 9.5, value: 110
      })
    ]));
    expect(guestOne?.retainedAssignmentIds).toContain(details?.assignmentId);
    expect(guestTwo?.snapshot.tranches).toEqual([]);
    expect(guestTwo?.ledgerUpserts).toEqual([]);
  });

  it('serializes projection writes and continues after a failed publication', async () => {
    const fixture = createFixture();
    preparePublisher(fixture);
    let releaseFirst: (() => void) | undefined;
    const writes: string[] = [];
    const publishBatch = vi.fn(async (publications: GuestPortfolioPublication[]) => {
      writes.push('start:' + publications[0]?.guestId);
      if (writes.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      writes.push('end:' + publications[0]?.guestId);
    });
    fixture.dependencies.publishBatch = publishBatch;

    const first = fixture.runtime.publishGuestPortfolioSnapshots();
    await vi.waitFor(() => expect(publishBatch).toHaveBeenCalledTimes(1));
    const second = fixture.runtime.publishGuestPortfolioSnapshots();
    await Promise.resolve();
    expect(publishBatch).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(publishBatch).toHaveBeenCalledTimes(2);
    expect(writes).toEqual(['start:guest-1', 'end:guest-1', 'start:guest-1', 'end:guest-1']);

    publishBatch.mockRejectedValueOnce(new Error('temporary ledger failure'));
    await fixture.runtime.publishGuestPortfolioSnapshots();
    await fixture.runtime.publishGuestPortfolioSnapshots();
    expect(fixture.dependencies.logError).toHaveBeenCalledWith(
      'Unable to publish guest portfolio projections:',
      expect.any(Error)
    );
    expect(publishBatch).toHaveBeenCalledTimes(4);
  });
});
