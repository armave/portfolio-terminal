import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCashHoldingTableRows,
  getReversibleBalanceAdjustmentEvents,
  formatDailyQuoteRange,
  getActiveTrancheMarketPrice,
  getAssignedGuestIds,
  getCashHoldingDisplayMetrics,
  getCashHoldingMarketPrice,
  shouldShowCashHoldingMarketDepth,
  summarizeCashHoldings,
  buildCashHoldingDisplayGroups
} from '../features/cash/cashCushionModel';
import { mergeBrokerExecutionHistory } from '../domain/closedHistoryFees';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { translateText } from '../services/i18n';

describe('active tranche operation accessibility', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('keeps Cash, Margin and Mix choices at least 44px with visible focus styling', () => {
    expect(deskSource.match(/inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-\[10px\] font-bold transition/g)).toHaveLength(6);
    expect(deskSource).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400');
    expect(deskSource).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400');
    expect(deskSource).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400');
  });

  it('keeps tranche retry and disclosure actions touch-sized', () => {
    expect(deskSource).toContain('inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2 py-1');
    expect(deskSource).toContain('inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-amber-700/70');
    expect(deskSource).toContain("aria-expanded={activeTranchesExpanded}");
  });

  it('defaults new active-tranche operations to Margin and preserves explicit saved types', () => {
    expect(deskSource).toContain('getActiveTrancheType(activeTrancheTypes, tranche.id, tranche.ticker)');
    expect(deskSource).toContain('new operations default to Margin');
  });

  it('localizes dynamic active-tranche accessible names without translating ticker values', () => {
    expect(deskSource).toContain("translateText('Operation type', getAppLanguage()) + ': ' + tranche.ticker");
    expect(deskSource).toContain("translateText('Cash shares', getAppLanguage()) + ': ' + tranche.ticker");
    expect(deskSource).toContain("translateText('Margin shares', getAppLanguage()) + ': ' + tranche.ticker");
    expect(deskSource).toContain("translateText('Guest assignment', getAppLanguage()) + ': ' + tranche.ticker");
    expect(translateText('Operation type', 'ru') + ': GOOGL').toBe('Тип операции: GOOGL');
    expect(translateText('Cash shares', 'ru') + ': GOOGL').toBe('Акции за денежные средства: GOOGL');
    expect(translateText('Margin shares', 'ru') + ': GOOGL').toBe('Маржинальные акции: GOOGL');
    expect(translateText('Guest assignment', 'ru') + ': GOOGL').toBe('Назначение гостю: GOOGL');
  });
});

describe('cash/margin mix inputs', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('keeps normalized split values and retains in-progress edits across rerenders', () => {
    expect(deskSource).toContain('value={cashInputValue}');
    expect(deskSource).toContain('value={marginInputValue}');
    expect(deskSource).toContain("cashInputDraft.quantity === tranche.quantity");
    expect(deskSource).toContain("cashInputDraft.cash === mix.cash");
    expect(deskSource).toContain("marginInputDraft.margin === mix.margin");
    expect(deskSource).toContain("delete next[tranche.id + ':cash']");
    expect(deskSource).toContain("delete next[tranche.id + ':margin']");
    expect(deskSource.match(/const value = \(inputEvent\.currentTarget as HTMLInputElement\)\.value;/g)).toHaveLength(2);
    expect(deskSource).toContain("value,\n                                              quantity: tranche.quantity");
    expect(deskSource).toContain("quantity: tranche.quantity");
    expect(deskSource).toContain("cash: mix.cash");
    expect(deskSource).toContain("margin: mix.margin");
    expect(deskSource).toContain("resolveActiveTrancheMixEdit(currentCashInputDraft.value, 'cash', tranche.quantity, mix)");
    expect(deskSource).toContain("resolveActiveTrancheMixEdit(currentMarginInputDraft.value, 'margin', tranche.quantity, mix)");
    expect(deskSource).toContain('cashDraftMix?.margin ?? mix.margin');
    expect(deskSource).toContain('marginDraftMix?.cash ?? mix.cash');
    expect(deskSource).toContain("resolveActiveTrancheMixEdit(value, 'cash', tranche.quantity, mix)");
    expect(deskSource).toContain("resolveActiveTrancheMixEdit(value, 'margin', tranche.quantity, mix)");
    expect(deskSource).not.toContain('defaultValue={mix.cash}');
    expect(deskSource).not.toContain('defaultValue={mix.margin}');
  });
});

describe('broker history adapter boundary', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('shows an explicit localized warning for position-integrity issues', () => {
    expect(deskSource).toContain("state.brokerAccountInfo?.positionIntegrityIssues");
    expect(deskSource).toContain("state.brokerAccountInfo?.lastRefreshIssue?.positionIntegrityIssues");
    expect(deskSource).toContain("translateText('Some broker positions need review'");
    expect(deskSource).toContain('positionIntegrityMessage(issue.code)');
    expect(deskSource).toContain('The app retained the last accepted tracked values');
  });
});

describe('broker history adapter boundary', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('normalizes cached executions through the provider adapter', () => {
    expect(deskSource).toContain("import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';");
    expect(deskSource).toContain("freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data");
    expect(deskSource).not.toContain('normalizeFreedomTrades');
  });
});

describe('Balance guest grouping', () => {
  it('keeps guest group headings as stable keyed table sibling rows', () => {
    const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    const modelSource = readFileSync(new URL('../features/cash/cashCushionModel.ts', import.meta.url), 'utf8');

    expect(modelSource).toContain("type: 'group'");
    expect(modelSource).toContain("type: 'holding'");
    expect(deskSource).toContain('<tr key={row.key} class="cash-holding-group-row');
    expect(deskSource).toContain('text-center');
    expect(deskSource).not.toContain('h.isGroupStart');
  });

  it('uses stable assigned guest IDs rather than asynchronous directory order', () => {
    expect(getAssignedGuestIds({
      trancheC: 'guest-c',
      trancheA: 'guest-a',
      anotherTrancheA: 'guest-a',
      unassigned: ''
    })).toEqual(['guest-a', 'guest-c']);
    expect(getAssignedGuestIds(undefined)).toEqual([]);
  });
});

describe('cash holding market price', () => {
  it('prefers a valid current quote and falls back to the stored price', () => {
    expect(getCashHoldingMarketPrice({ currentPrice: 125, price: 120 })).toBe(125);
    expect(getCashHoldingMarketPrice({ currentPrice: 0, price: 120 })).toBe(120);
    expect(getCashHoldingMarketPrice({ currentPrice: null, price: '120.5' })).toBe(120.5);
  });

  it('does not turn invalid or coercible values into a market price', () => {
    expect(getCashHoldingMarketPrice({})).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: '', price: undefined })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: 'not-a-price', price: Number.NaN })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: -1, price: 0 })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: true, price: '   ' })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: [], price: {} })).toBeNull();
  });
});

describe('Balance holding row calculations', () => {
  it('calculates market value, gross unrealized return, and allocation from valid inputs', () => {
    expect(getCashHoldingDisplayMetrics({ shares: '2', currentPrice: 100, averagePrice: '80' }, 400, 0)).toEqual({
      shares: 2, price: 100, averagePrice: 80, averageValue: 160, marketValue: 200,
      unrealizedPnl: 40, unrealizedPnlPercent: 25, allocation: 50
    });
  });

  it('keeps P/L unavailable for zero or invalid quantities and zero cost basis', () => {
    for (const holding of [
      { shares: 0, currentPrice: 100, averagePrice: 80 },
      { shares: true, currentPrice: 100, averagePrice: 80 },
      { shares: 2, currentPrice: 100, averagePrice: 0 }
    ]) {
      const result = getCashHoldingDisplayMetrics(holding, 200, 0);
      expect(result.unrealizedPnl).toBeNull();
      expect(result.unrealizedPnlPercent).toBeNull();
      expect(result.allocation).toBe(holding.shares === 2 ? 100 : null);
    }
  });

  it('does not claim complete allocation when a different holding is unpriced', () => {
    expect(getCashHoldingDisplayMetrics({ shares: 1, currentPrice: 100, averagePrice: 80 }, 100, 1).allocation).toBeNull();
  });
});

describe('active tranche market price', () => {
  it('uses the newest timestamped quote across cash and margin records', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'AAPL',
      marketPrice: 110
    }, [{
      ticker: 'AAPL',
      currentPrice: 120,
      quoteDetails: { sourceTimestamp: 1_000 }
    }], {
      AAPL: {
        currentPrice: 130,
        quoteDetails: { sourceTimestamp: 2_000 }
      }
    })).toBe(130);
  });

  it('prefers the latest WebSocket receive time when TradeNet ltt has no numeric timestamp', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'GOOGL',
      marketPrice: 265
    }, [{
      ticker: 'GOOGL',
      currentPrice: 280.55,
      price: 280.55,
      quoteUpdatedAt: 1_800_000_000_000,
      quoteDetails: {
        transport: 'websocket',
        receivedAt: 1_800_000_000_000,
        freshness: 'unknown'
      }
    }], {
      GOOGL: {
        currentPrice: 279,
        quoteUpdatedAt: 1_799_999_000_000,
        quoteDetails: {
          transport: 'websocket',
          receivedAt: 1_799_999_000_000,
          freshness: 'unknown'
        }
      }
    })).toBe(280.55);
  });

  it('uses the stored margin position price before the untimestamped broker fallback', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'MSFT',
      marketPrice: 400
    }, [], {
      MSFT: { currentPrice: 410 }
    })).toBe(410);
  });
});

describe('cash holdings daily quote range', () => {
  it('formats the actual high and low prices instead of placeholder text', () => {
    expect(formatDailyQuoteRange({ high: 123.45, low: 120 })).toBe('H 123.45 / L 120.00');
  });
});

describe('cash holdings quote context', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('shows provider volume without adding a currency label and validates percentage metadata', () => {
    expect(deskSource).toContain('const volume = formatQuoteVolume(holding.quoteDetails?.volume)');
    expect(deskSource).toContain('const volume = formatQuoteVolume(h.quoteDetails?.volume)');
    expect(deskSource).toContain('Number.isFinite(h.quoteDetails?.changePercent)');
    expect(deskSource).toContain('formatQuoteMetadata(holding, refreshIntervalMs)');
    expect(deskSource).toContain('renderDailyQuoteSubtext(holding.quoteDetails)');
    expect(deskSource).toContain('volume ??');
  });

  it('shows administrator Market Depth controls only during an open US equity session', () => {
    const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    const marketDepthAction = deskSource.indexOf("emitUiEvent('market:depth-request'");
    const guestCards = deskSource.indexOf('guestHoldings.map((holding)');

    expect(marketDepthAction).toBeGreaterThan(-1);
    expect(deskSource).toMatch(/\{isAdmin && marketDepthAvailable && <button[\s\S]{0,500}emitUiEvent\('market:depth-request'/);
    expect(deskSource).toContain("window.setInterval(refreshMarketSession, 30_000)");
    expect(deskSource).toContain("window.addEventListener('focus', refreshMarketSession)");
    expect(guestCards).toBeGreaterThan(-1);
    expect(deskSource.slice(guestCards, marketDepthAction)).not.toContain("emitUiEvent('market:depth-request'");
  });

  it('keeps the row-level depth control hidden during closed sessions, weekends and holidays', () => {
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-02T12:00:00.000Z'))).toBe(true);
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-02T15:00:00.000Z'))).toBe(true);
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-02T22:00:00.000Z'))).toBe(true);
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-03T02:00:00.000Z'))).toBe(false);
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-07T15:00:00.000Z'))).toBe(false);
    expect(shouldShowCashHoldingMarketDepth(new Date('2026-11-26T15:00:00.000Z'))).toBe(false);
  });

  it('renders group heading rows as stable siblings, independent of the first holding row', () => {
    const groups = [
      { key: 'guest-a', label: 'AM', holdings: [{ ticker: 'GOOGL' }, { ticker: 'MSFT' }] },
      { key: 'guest-b', label: 'SU', holdings: [{ ticker: 'AAPL' }] }
    ];
    expect(buildCashHoldingTableRows(groups, true)).toEqual([
      { type: 'group', key: 'group-guest-a', label: 'AM' },
      { type: 'holding', key: 'holding-guest-a-GOOGL', holding: { ticker: 'GOOGL' } },
      { type: 'holding', key: 'holding-guest-a-MSFT', holding: { ticker: 'MSFT' } },
      { type: 'group', key: 'group-guest-b', label: 'SU' },
      { type: 'holding', key: 'holding-guest-b-AAPL', holding: { ticker: 'AAPL' } }
    ]);
    expect(buildCashHoldingTableRows(groups, false).map((row) => row.type))
      .toEqual(['holding', 'holding', 'holding']);
    expect(buildCashHoldingTableRows([
      { key: 'guest-pending', label: '', holdings: [{ ticker: 'TSLA' }] }
    ], true)).toEqual([
      { type: 'group', key: 'group-guest-pending', label: '' },
      { type: 'holding', key: 'holding-guest-pending-TSLA', holding: { ticker: 'TSLA' } }
    ]);
  });

  it('does not nest the group heading inside a conditional holding fragment', () => {
    const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    const modelSource = readFileSync(new URL('../features/cash/cashCushionModel.ts', import.meta.url), 'utf8');
    expect(modelSource).toContain('buildCashHoldingTableRows');
    expect(deskSource).toContain('buildCashHoldingDisplayGroups');
    expect(deskSource).toContain("if (row.type === 'group')");
    expect(deskSource).not.toContain('<Fragment key={`${h.groupKey}-${h.ticker}`}>');
    expect(deskSource).not.toContain('h.isGroupStart');
  });
});

describe('Balance cache-first history retention', () => {
  it('keeps all cached executions when a refresh returns only one newer row', () => {
    const cached = Array.from({ length: 77 }, (_, index) => ({
      id: 'balance-trade-' + index,
      ticker: 'T' + index,
      side: 'buy',
      executedAt: '2026-10-01T10:00:00Z'
    }));
    const refreshed = [{
      id: 'balance-trade-76',
      ticker: 'T76',
      side: 'buy',
      executedAt: '2026-10-29T10:00:00Z',
      price: 125
    }];

    const merged = mergeBrokerExecutionHistory(cached, refreshed);

    expect(merged).toHaveLength(77);
    expect(merged.find((trade) => trade.id === 'balance-trade-0')).toBeDefined();
    expect(merged.find((trade) => trade.id === 'balance-trade-76')).toMatchObject({ price: 125 });
  });
});

describe('Balance cache-first rendering wiring', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const brokerDataSource = readFileSync(new URL('../services/portfolioBrokerDataRuntime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('uses the saved broker snapshot before showing a blocking first-load state', () => {
    expect(deskSource).toContain('createBalanceSyncState(Boolean(state.brokerAccountInfo?.loaded), isAdmin)');
    expect(deskSource).toContain("type: 'snapshot'");
    expect(deskSource).toContain('loaded: state.brokerAccountInfo?.loaded === true');
    expect(deskSource).toContain("if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot)");
    expect(deskSource).not.toContain('if (executedTradesLoading || guestUsersLoading)');
    expect(deskSource).toContain("emitBrokerEvent('broker:request-account-info')");
  });

  it('clears the balance spinner when an already-current live stream completes the refresh', () => {
    expect(deskSource).toContain("'broker:account-info-refresh-complete'");
    expect(deskSource).toContain("removeRefreshCompleteListener()");
    const spinnerCondition = deskSource.slice(
      deskSource.indexOf('const balanceRefreshing ='),
      deskSource.indexOf(';', deskSource.indexOf('const balanceRefreshing ='))
    );
    expect(spinnerCondition).not.toContain('guestUsersLoading');
  });

  it('shows unpriced admin holdings as unavailable instead of zero-valued assets', () => {
    expect(deskSource).toContain('getCashHoldingDisplayMetrics(h, stocksTotal, unpricedHoldingCount)');
    expect(deskSource).toContain("{price !== null ? formatUSD(price) : '—'}");
    expect(deskSource).toContain("{val !== null ? formatUSD(val) : '—'}");
    expect(deskSource).toContain("allocation !== null ? allocation.toFixed(1) + '%' : '—'");
    expect(deskSource).toContain("unpricedHoldingCount === 0 && stocksTotal > 0");
    expect(deskSource).toContain("translateText('Unpriced holdings', getAppLanguage())");
  });

  it('merges saved and in-memory executions instead of choosing only one cache', () => {
    expect(deskSource).toContain('mergeBrokerExecutionHistory(\n        savedTrades,');
    expect(deskSource).toContain('brokerExecutionHistoryRef.current.trades');
  });

  it('isolates Balance reducer and warning state to the authenticated account session', () => {
    expect(appSource).toContain('const accountSession = brokerSessionIdentityRef.current.capture()');
    expect(appSource).toContain('key={`balance-${accountSession?.identity ?? \'none\'}-${accountSession?.generation ?? -1}`}');
    expect(deskSource).toContain('}, [shouldReadBrokerHistory]);');
    expect(deskSource).toContain('isAdmin && (balanceSync.status === \'stale\' || balanceSync.status === \'error\')');
    expect(deskSource).toContain('shouldReadBrokerHistory && (brokerExecutionHistory.status === \'stale\' || brokerExecutionHistory.status === \'error\')');
  });

  it('starts rendering Balance in the navigation render instead of waiting for a passive effect', () => {
    expect(appSource).toContain("const shouldRenderCashCushion = hasOpenedCashCushion ||");
    expect(appSource).toContain("activeDeskView === 'BALANCE';");
    expect(appSource).toContain('{shouldRenderCashCushion');
  });

  it('subscribes Balance only to portfolio slices it renders', () => {
    expect(deskSource).toContain('usePortfolioSelector(selectCashCushionPortfolioState, areCashCushionPortfolioStatesEqual)');
    expect(deskSource).not.toContain('const state = usePortfolio();');
    expect(deskSource).toContain('useMemo(() => activeTrancheSource.map');
  });

  it('keeps guest group rows stable without exposing raw IDs while names resolve', () => {
    const modelSource = readFileSync(new URL('../features/cash/cashCushionModel.ts', import.meta.url), 'utf8');
    expect(deskSource).toContain('getCachedUsers()');
    expect(deskSource).toContain('guestDirectoryPending');
    expect(modelSource).toContain("label: input.guestNames.get(guestId) ||");
    expect(deskSource).toContain("translateText('Loading guest name', getAppLanguage())");
    expect(modelSource).not.toContain('guestNames.get(guestId) || guestId');
    expect(modelSource).toContain("...(unassignedHoldings.length");
  });

  it('uses the shared role-specific quote refresh defaults', () => {
    const refreshHookSource = readFileSync(new URL('../ui/useQuoteRefreshInterval.ts', import.meta.url), 'utf8');

    expect(deskSource).toContain('DEFAULT_ADMIN_REFRESH_INTERVAL_MS');
    expect(deskSource).toContain('DEFAULT_GUEST_REFRESH_INTERVAL_MS');
    expect(deskSource).toContain("useQuoteRefreshInterval(guestUserId ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS");
    expect(deskSource).not.toContain('guestUserId ? 15_000 : 60_000');
    expect(refreshHookSource).toContain('fallbackMs = DEFAULT_ADMIN_REFRESH_INTERVAL_MS');
    expect(refreshHookSource).not.toContain('fallbackMs = 60000');
  });

  it('refreshes the full Balance snapshot without a date cursor', () => {
    const accountLoaderStart = brokerDataSource.indexOf('const loadFreedomAccount');
    const tradesLoaderStart = brokerDataSource.indexOf('const refreshAccountInfo', accountLoaderStart);
    const accountLoader = brokerDataSource.slice(accountLoaderStart, tradesLoaderStart);
    expect(accountLoader).toContain('fetchAccountInfo()');
    expect(accountLoader).not.toContain('fromDate');
    expect(accountLoader).not.toContain('beginDate');
    expect(accountLoader).not.toContain('endDate');
  });
});


describe('balance adjustment reversal access', () => {
  const event = (
    id: string,
    type: PortfolioTransactionEvent['type'],
    recordedAt: number,
    overrides: Partial<PortfolioTransactionEvent> = {}
  ): PortfolioTransactionEvent => ({
    id,
    schemaVersion: 1,
    type,
    actor: { type: 'user' },
    source: 'manual-balance',
    effectiveAt: recordedAt,
    recordedAt,
    cashDelta: type === 'cash.adjustment' ? 100 : undefined,
    marginDebtDelta: type === 'margin.adjustment' ? 50 : undefined,
    ...overrides
  });

  it('lists only the five newest unreversed cash or margin balance adjustments', () => {
    const events = [
      event('cash-old', 'cash.adjustment', 1),
      event('cash-reversed', 'cash.adjustment', 2),
      event('cash-reversal-invalid', 'correction', 2.5, { relatedEventId: 'cash-reversed', cashDelta: -90 }),
      event('cash-reversal', 'correction', 3, { relatedEventId: 'cash-reversed', cashDelta: -100 }),
      event('trade', 'trade.buy', 4, { ticker: 'AAPL', quantity: 1, cashDelta: -100 }),
      ...Array.from({ length: 6 }, (_, index) =>
        event(`margin-${index}`, 'margin.adjustment', 10 + index)
      ),
      event('empty', 'margin.adjustment', 30, { cashDelta: undefined, marginDebtDelta: 0 })
    ];

    expect(getReversibleBalanceAdjustmentEvents(events).map((item) => item.id)).toEqual([
      'margin-5', 'margin-4', 'margin-3', 'margin-2', 'margin-1'
    ]);
  });

  it('keeps an adjustment visible when a linked correction is not its exact inverse', () => {
    const original = event('cash-original', 'cash.adjustment', 1, { cashDelta: 125 });
    const inconsistentCorrection = event('cash-correction', 'correction', 2, {
      relatedEventId: original.id,
      cashDelta: -120
    });

    expect(getReversibleBalanceAdjustmentEvents([original, inconsistentCorrection]).map((item) => item.id))
      .toEqual(['cash-original']);
  });

  it('keeps reversal controls restricted to the admin Balance desk and calls the guarded store command', () => {
    const source = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain('isAdmin && !guestUserId');
    expect(source).toContain('portfolioStore.reverseBalanceAdjustment(eventId, reason)');
    expect(source).toContain('data-balance-adjustment-event-id={event.id}');
    expect(source).toContain('immutable correction event');
    expect(source).toContain('disabled={!(balanceAdjustmentReasons[event.id] || \'\').trim()}');
    expect(source).toContain('onClick={() => setPendingBalanceAdjustmentId(event.id)}');
    expect(source).toContain("translateText('Confirm reversal', getAppLanguage())");
    expect(source).toContain("translateText('Cancel', getAppLanguage())");
  });

  it('localizes every new adjustment review label in Russian', () => {
    const copy = [
      'Recent balance adjustments',
      'Review and reverse eligible manual cash or margin adjustments.',
      'A reversal appends an immutable correction event. It is blocked when available cash or debt has already been used.',
      'Cash adjustment',
      'Margin adjustment',
      'Cash change',
      'Margin debt change',
      'Reason for reversal',
      'Enter why this adjustment should be reversed',
      'Review reversal',
      'Confirm reversal',
      'Confirm balance reversal',
      'Confirm this balance change. The original event remains in history.',
      'Cancel',
      'Enter a reason to reverse this adjustment.',
      'Balance adjustment reversed.',
      'Balance adjustment could not be reversed. The balance may have changed since the original adjustment.'
    ];
    for (const value of copy) {
      expect(translateText(value, 'ru'), value).not.toBe(value);
    }
  });
});

describe('cash holding model summaries and display groups', () => {
  it('counts only positive-share holdings and keeps missing prices explicitly unpriced', () => {
    expect(summarizeCashHoldings([
      { ticker: 'AAPL', shares: 2, currentPrice: 100 },
      { ticker: 'MSFT', shares: 3, currentPrice: null, price: undefined },
      { ticker: 'ZERO', shares: 0, currentPrice: 50 },
      { ticker: 'INVALID', shares: 'not-shares', currentPrice: 5 }
    ])).toEqual({
      unpricedHoldingCount: 1,
      pricedHoldingCount: 1,
      stocksTotal: 200
    });
  });

  it('splits administrator holdings into guest-assigned and unassigned shares', () => {
    const cashHoldings = [
      { ticker: 'AAPL', shares: 10, currentPrice: 100, price: 100 },
      { ticker: 'MSFT', shares: 5, currentPrice: 200, price: 200 }
    ];
    const activeTranches = [{
      id: 'tranche-aapl',
      ticker: 'AAPL',
      name: 'Apple',
      quantity: 4,
      marketPrice: 100,
      averagePrice: 80,
      marketValue: 400,
      purchasedAt: 1
    }];

    const result = buildCashHoldingDisplayGroups({
      isAdmin: true,
      guestNames: new Map([['guest-a', 'Guest A']]),
      guestDirectoryPending: false,
      guestUnavailableLabel: 'Guest unavailable',
      activeTranches,
      activeTrancheGuestAssignments: { 'tranche-aapl': 'guest-a' },
      activeTrancheTypes: { 'tranche-aapl': 'cash' },
      activeTrancheMixes: {},
      cashHoldings,
      holdings: cashHoldings
    });

    expect(result.adminHoldingGroups).toMatchObject([{
      key: 'guest-a',
      label: 'Guest A',
      holdings: [{ ticker: 'AAPL', shares: 4 }]
    }]);
    expect(result.unassignedHoldings).toMatchObject([
      { ticker: 'AAPL', shares: 6 },
      { ticker: 'MSFT', shares: 5 }
    ]);
    expect(result.displayTableRows.map((row) => row.type)).toEqual([
      'group', 'holding', 'group', 'holding', 'holding'
    ]);
  });

  it('keeps a guest display ungrouped and does not expose administrator assignment rows', () => {
    const guestHoldings = [{
      ticker: 'AAPL',
      shares: 2,
      averagePrice: 80,
      currentPrice: 100,
      price: 100,
      marketValue: 200
    }];
    const result = buildCashHoldingDisplayGroups({
      isAdmin: false,
      guestNames: new Map(),
      guestDirectoryPending: false,
      guestUnavailableLabel: 'Guest unavailable',
      activeTranches: [],
      activeTrancheGuestAssignments: {},
      activeTrancheTypes: {},
      activeTrancheMixes: {},
      cashHoldings: [],
      holdings: guestHoldings
    });
    expect(result.adminHoldingGroups).toEqual([]);
    expect(result.unassignedHoldings).toEqual([]);
    expect(result.displayTableRows).toEqual([
      { type: 'holding', key: 'holding-guest-AAPL', holding: guestHoldings[0] }
    ]);
  });
});
