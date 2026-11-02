import { addBrokerEventListener, type BrokerEventPayloads } from './brokerEventBus';
import type { AuthUser, GuestPortfolioPublication } from './api';
import { getActiveTranchesFromTrades, normalizeActiveTrancheMix } from '../domain/freedomPortfolio';
import { getAssignableActiveTrancheCashQuantity } from '../domain/activeTrancheGuestAssignment';
import { buildClosedTradeGuestLedgerUpserts, resolveClosedTradeOperationDate } from '../domain/closedTradeGuestAssignments';
import { createGuestTrancheAssignmentId, createLegacyGuestTrancheAssignmentId } from '../domain/guestTrancheAssignmentIds';
import { attributeClosedTradeExecutions } from '../domain/closedTradeAttribution';
import { calculateBrokerExecutionMetrics, normalizeExecutionTicker } from '../domain/brokerExecutionMetrics';
import type {
  ActiveBrokerTranche,
  ActiveTrancheGuestAssignmentDetail,
  GuestTrancheLedgerRecord,
  PortfolioState
} from '../types/portfolio';

export interface GuestPortfolioAssignmentRuntimeDependencies {
  getAccountRole: () => 'admin' | 'guest' | null;
  requireAdmin: (action: string) => Promise<boolean>;
  getState: () => PortfolioState;
  setState: (updates: Partial<PortfolioState>) => void;
  persistState: (state: PortfolioState) => void;
  pushState: () => void | Promise<unknown>;
  listUsers: () => Promise<AuthUser[]>;
  publishBatch: (publications: GuestPortfolioPublication[]) => Promise<void>;
  renderBoard: () => void;
  showToast: (message: string, tone?: 'error') => void;
  logError: (message: string, error: unknown) => void;
  logTerminal: (message: string) => void;
  now?: () => number;
  getActiveTranches?: typeof getActiveTranchesFromTrades;
}

export interface GuestPortfolioAssignmentRuntime {
  bind: () => () => void;
  setBrokerTradeHistoryLoaded: (loaded: boolean) => void;
  publishGuestPortfolioSnapshots: () => Promise<void>;
  handleSetClosedTradeAllocation: (detail: BrokerEventPayloads['broker:set-closed-trade-allocation']) => Promise<void>;
  handleAssignActiveTrancheGuest: (detail: BrokerEventPayloads['broker:assign-active-tranche-guest']) => Promise<void>;
}

/**
 * Coordinates administrator guest-assignment commands and serialized projection
 * publication. Portfolio state remains owned by the application store; all
 * persistence, authorization, and API operations are injected.
 */
export function createGuestPortfolioAssignmentRuntime(
  dependencies: GuestPortfolioAssignmentRuntimeDependencies
): GuestPortfolioAssignmentRuntime {
  const getNow = dependencies.now || Date.now;
  const getActiveTranches = dependencies.getActiveTranches || getActiveTranchesFromTrades;


let guestPortfolioPublishQueue: Promise<void> = Promise.resolve();
let brokerTradeHistoryLoaded = false;

/** Publish current cash-backed holdings plus durable assignment lifecycle updates.
 * The server retains closed/unassigned rows; only a guest can read their own ledger. */
const publishGuestPortfolioSnapshots = (): Promise<void> => {
  if (dependencies.getAccountRole() !== 'admin') return Promise.resolve();
  const operation = guestPortfolioPublishQueue.then(async () => {
    if (dependencies.getAccountRole() !== 'admin') return;
    let current = dependencies.getState();
    if (!current.brokerAccountInfo?.loaded ||
      current.brokerAccountInfo.status === 'stale' ||
      current.brokerAccountInfo.status === 'unavailable' ||
      !Array.isArray(current.brokerAccountInfo.positions) ||
      !brokerTradeHistoryLoaded || !Array.isArray(current.brokerExecutedTrades)) return;

    const activeTranches = getActiveTranches(current.brokerExecutedTrades, current.brokerAccountInfo);
    const guests = (await dependencies.listUsers()).filter((user) => user.role === 'guest');
    const updatedAt = getNow();
    const assignments = current.activeTrancheGuestAssignments || {};
    const assignmentDetails: Record<string, ActiveTrancheGuestAssignmentDetail> = {
      ...(current.activeTrancheGuestAssignmentDetails || {})
    };
    let migratedLegacyAssignments = false;

    // Backfill IDs for still-open assignments created before the durable ledger.
    // The actual assignment date is unknown, so use the first successful backfill
    // time rather than mislabeling the purchase date as the assignment date.
    // Closed historical quantities are not reconstructed because the old state
    // never stored enough information to do so reliably.
    for (const tranche of activeTranches) {
      const guestId = assignments[tranche.id];
      if (!guestId) continue;
      const type = current.activeTrancheTypes?.[tranche.id] ||
        current.activeTrancheTypes?.[tranche.ticker] || 'cash';
      const mix = normalizeActiveTrancheMix(
        tranche.quantity,
        current.activeTrancheMixes?.[tranche.id] || current.activeTrancheMixes?.[tranche.ticker]
      );
      const assignedQuantity = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
      if (!Number.isFinite(assignedQuantity) || assignedQuantity <= 0) continue;
      const existing = assignmentDetails[tranche.id];
      if (existing?.guestId === guestId && existing.assignmentId) continue;
      assignmentDetails[tranche.id] = {
        assignmentId: createLegacyGuestTrancheAssignmentId(guestId, tranche.id),
        guestId,
        assignedAt: updatedAt,
        assignedQuantity
      };
      migratedLegacyAssignments = true;
    }

    if (migratedLegacyAssignments) {
      dependencies.setState({ activeTrancheGuestAssignmentDetails: assignmentDetails });
      current = dependencies.getState();
      dependencies.persistState(current);
      void dependencies.pushState();
    }

    // Closed Trades rows can be assigned directly after the broker sale. Mirror
    // those cash-funded quantities into the same guest-only durable LOTS ledger.
    const appTradeSources = (current.closedTrades || []).map((trade: any, index: number) => {
      const rawTicker = String(trade?.ticker || '').trim();
      const ticker = rawTicker.toUpperCase().replace(/\.US$/i, '');
      const fallback = String(trade?.closedAt ?? trade?.exitDate ?? trade?.date ?? index);
      const shares = Math.abs(Number(trade?.shares) || 0);
      const averagePriceValue = Number(trade?.avgBuyPrice ?? trade?.entryPrice);
      const sellPriceValue = Number(trade?.sellPrice ?? trade?.exitPrice);
      const directSaleValueRaw = trade?.sellValue ?? trade?.exitValue ?? trade?.proceeds;
      const directSaleValue = directSaleValueRaw === null || directSaleValueRaw === undefined || directSaleValueRaw === ''
        ? NaN : Number(directSaleValueRaw);
      const saleValue = Number.isFinite(directSaleValue) && directSaleValue > 0
        ? directSaleValue
        : Number.isFinite(sellPriceValue) && sellPriceValue > 0 && shares > 0
          ? sellPriceValue * shares : null;
      const grossProfit = trade?.grossProfit == null ? NaN : Number(trade.grossProfit);
      const commissions = Number(trade?.commissions ?? trade?.feesAndCommissions ?? trade?.totalCommissions);
      const marginInterest = Number(trade?.marginInterest);
      const storedNetProfit = trade?.netProfit ?? trade?.netRealizedGain;
      const derivedNetProfit = Number.isFinite(grossProfit) && Number.isFinite(commissions)
        ? grossProfit - commissions - (Number.isFinite(marginInterest) ? marginInterest : 0)
        : NaN;
      const netProfit = storedNetProfit != null && Number.isFinite(Number(storedNetProfit))
        ? Number(storedNetProfit) : Number.isFinite(derivedNetProfit) ? derivedNetProfit : null;
      return {
        allocationKey: 'app:' + String(trade?.id || `${rawTicker || 'trade'}:${fallback}`),
        ticker,
        name: String(trade?.name || ticker),
        quantity: shares,
        averagePrice: Number.isFinite(averagePriceValue) && averagePriceValue > 0 ? averagePriceValue : null,
        purchasedAt: trade?.buyDate ?? trade?.purchaseDate ?? null,
        // Keep the exact precedence used by ClosedHistoryDesk: exitDate,
        // sellDate, closedAt, then date. Never use the guest assignment time.
        operationAt: resolveClosedTradeOperationDate(trade),
        value: saleValue,
        netProfit
      };
    });

    const brokerExecutions = current.brokerExecutedTrades || [];
    // Match ClosedHistoryDesk's sell-only fallback index when a broker row
    // has no execution ID; using the all-executions index would break override
    // lookup whenever buy executions are interleaved.
    const brokerSellExecutions = brokerExecutions.filter((trade) =>
      ['sell', 's', 'sale', 'sold', '2'].includes(String(trade?.side ?? '').toLowerCase())
    );
    const brokerAttributions = attributeClosedTradeExecutions(brokerExecutions, {
      trancheTypes: current.activeTrancheTypes,
      trancheMixes: current.activeTrancheMixes,
      guestAssignments: current.activeTrancheGuestAssignments,
      guestAssignmentDetails: current.activeTrancheGuestAssignmentDetails
    });
    const brokerTradeMetrics = calculateBrokerExecutionMetrics(brokerExecutions);
    const brokerSaleRows = brokerSellExecutions
      .map((trade: any, index: number) => {
        const ticker = normalizeExecutionTicker(trade?.ticker);
        const quantity = Math.abs(Number(trade?.quantity ?? trade?.shares ?? 0));
        if (!ticker || !Number.isFinite(quantity) || quantity <= 0) return null;

        const attribution = brokerAttributions.get(trade);
        const rawGuestMetrics = attribution?.guestMetrics || {};
        const metrics = brokerTradeMetrics.get(trade);
        const commissionCurrency = String(trade?.commissionCurrency ?? trade?.currency ?? '').trim().toUpperCase();
        const commissionCurrencyIsUsd = commissionCurrency === '' || commissionCurrency === 'USD';
        const rawSellCommission = !commissionCurrencyIsUsd ||
          trade?.commission === null || trade?.commission === undefined || trade?.commission === ''
          ? NaN : Math.abs(Number(trade.commission));
        const sellCommission = Number.isFinite(rawSellCommission) ? rawSellCommission : null;
        const buyCommission = metrics?.buyCommission ?? null;
        const commissionsComplete = sellCommission !== null && buyCommission !== null;
        const commissions = Number(((sellCommission ?? 0) + (buyCommission ?? 0)).toFixed(2));
        const allocatedMarginFee = Object.values((trade?.marginFeeAllocations || {}) as Record<string, number>)
          .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
        const marginFee = Number((trade?.marginFeeAllocations && typeof trade.marginFeeAllocations === 'object')
          ? allocatedMarginFee : trade?.marginFee ?? 0) || 0;
        const fees = Number(Math.abs(marginFee).toFixed(2));
        const totalFees = Number((commissions + fees).toFixed(2));
        const netProfit = trade?.profit == null || !commissionsComplete
          ? null : Number((Number(trade.profit) - totalFees).toFixed(2));
        const rawTime = Date.parse(String(trade?.executedAt ?? trade?.date ?? ''));
        const tradeCurrency = String(trade?.currency ?? '').trim().toUpperCase();
        const currencyIsUsd = tradeCurrency === '' || tradeCurrency === 'USD';
        const directTradeValue = Number(trade?.tradeValue);
        const sellPrice = Math.abs(Number(trade?.price ?? trade?.executionPrice ?? 0));
        const saleValue = !currencyIsUsd ? null
          : Number.isFinite(directTradeValue) && directTradeValue > 0
            ? directTradeValue
            : sellPrice > 0 ? sellPrice * quantity : null;
        // Allocate each execution's proceeds and net result to the guest shares
        // actually matched to that execution before same-ticker sells are grouped.
        const guestMetrics = Object.fromEntries(Object.entries(rawGuestMetrics).map(([guestId, metric]) => {
          const shareRatio = quantity > 0 ? Math.min(1, metric.quantity / quantity) : 0;
          return [guestId, {
            ...metric,
            value: saleValue === null ? null : saleValue * shareRatio,
            netProfit: netProfit === null ? null : netProfit * shareRatio
          }];
        }));
        return {
          allocationKey: 'broker:' + String(trade?.id ?? ('tradenet-' + index)),
          ticker,
          name: String(trade?.name || ticker),
          quantity,
          averagePrice: attribution?.averagePrice ?? null,
          purchasedAt: attribution?.purchasedAt ?? null,
          operationAt: Number.isFinite(rawTime) ? rawTime : trade?.executedAt ?? trade?.date ?? null,
          value: saleValue,
          netProfit,
          guestMetrics,
          time: Number.isFinite(rawTime) ? rawTime : null
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

    // Closed History groups adjacent same-ticker sells within one hour. Mirror
    // that row identity and aggregate values so the LOTS ledger matches the
    // exact displayed and editable trade row.
    const brokerSellSources: Array<{
      allocationKey: string;
      ticker: string;
      name: string;
      quantity: number;
      averagePrice: number | null;
      purchasedAt: number | null;
      operationAt: number | string | null;
      value: number | null;
      netProfit: number | null;
      guestMetrics: Record<string, {
        quantity: number;
        averagePrice: number | null;
        purchasedAt: number | null;
        assignedAt: number | null;
        value: number | null;
        netProfit: number | null;
      }>;
      time: number | null;
    }> = [];
    for (const row of brokerSaleRows) {
      const previous = brokerSellSources[brokerSellSources.length - 1];
      if (previous && row.ticker === previous.ticker &&
          row.time !== null && previous.time !== null &&
          row.time - previous.time <= 60 * 60 * 1000) {
        const previousQuantity = previous.quantity;
        const totalQuantity = previousQuantity + row.quantity;
        previous.averagePrice = previous.averagePrice !== null && row.averagePrice !== null && totalQuantity > 0
          ? (previous.averagePrice * previousQuantity + row.averagePrice * row.quantity) / totalQuantity
          : null;
        previous.purchasedAt = previous.purchasedAt !== null && row.purchasedAt !== null
          ? Math.min(previous.purchasedAt, row.purchasedAt) : null;
        previous.netProfit = previous.netProfit !== null && row.netProfit !== null
          ? Number((previous.netProfit + row.netProfit).toFixed(2)) : null;
        previous.value = previous.value !== null && row.value !== null
          ? previous.value + row.value : null;
        previous.operationAt = row.operationAt;
        for (const [guestId, metric] of Object.entries(row.guestMetrics)) {
          const existing = previous.guestMetrics[guestId];
          if (!existing) {
            previous.guestMetrics[guestId] = metric;
          } else {
            const guestQuantity = existing.quantity + metric.quantity;
            existing.averagePrice = existing.averagePrice !== null && metric.averagePrice !== null && guestQuantity > 0
              ? (existing.averagePrice * existing.quantity + metric.averagePrice * metric.quantity) / guestQuantity
              : null;
            existing.purchasedAt = existing.purchasedAt !== null && metric.purchasedAt !== null
              ? Math.min(existing.purchasedAt, metric.purchasedAt) : null;
            existing.assignedAt = existing.assignedAt !== null && metric.assignedAt !== null
              ? Math.min(existing.assignedAt, metric.assignedAt)
              : existing.assignedAt ?? metric.assignedAt;
            existing.value = existing.value !== null && metric.value !== null
              ? existing.value + metric.value : null;
            existing.netProfit = existing.netProfit !== null && metric.netProfit !== null
              ? Number((existing.netProfit + metric.netProfit).toFixed(2)) : null;
            existing.quantity = guestQuantity;
          }
        }
        previous.quantity = totalQuantity;
        previous.time = row.time;
      } else {
        brokerSellSources.push({ ...row, guestMetrics: { ...row.guestMetrics } });
      }
    }

    const closedTradeLedgerUpserts = buildClosedTradeGuestLedgerUpserts(
      current.closedTradeAllocations || {},
      [...appTradeSources, ...brokerSellSources],
      updatedAt
    );

    const publications = guests.map((guest) => {
      const ledgerUpserts: GuestTrancheLedgerRecord[] = [
        ...activeTranches.flatMap((tranche) => {
          if (current.activeTrancheGuestAssignments?.[tranche.id] !== guest.id) return [];
          const detail = current.activeTrancheGuestAssignmentDetails?.[tranche.id];
          if (!detail || detail.guestId !== guest.id || !detail.assignmentId) return [];
          const type = current.activeTrancheTypes?.[tranche.id] ||
            current.activeTrancheTypes?.[tranche.ticker] || 'cash';
          const mix = normalizeActiveTrancheMix(
            tranche.quantity,
            current.activeTrancheMixes?.[tranche.id] || current.activeTrancheMixes?.[tranche.ticker]
          );
          const openQuantity = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
          if (!Number.isFinite(openQuantity) || openQuantity <= 0) return [];
          return [{
            assignmentId: detail.assignmentId,
            trancheId: tranche.id,
            ticker: tranche.ticker,
            name: tranche.name,
            assignedQuantity: Math.max(detail.assignedQuantity, openQuantity),
            openQuantity,
            averagePrice: tranche.averagePrice,
            purchasedAt: tranche.purchasedAt,
            operationAt: tranche.purchasedAt,
            value: tranche.marketPrice === null ? null : tranche.marketPrice * openQuantity,
            assignedAt: detail.assignedAt,
            updatedAt,
            endedAt: null,
            status: 'active' as const
          }];
        }),
        ...closedTradeLedgerUpserts
          .filter((item) => item.guestId === guest.id)
          .map((item) => item.record)
      ];
      const retainedAssignmentIds = Object.entries(current.activeTrancheGuestAssignmentDetails || {})
        .filter(([trancheId, detail]) =>
          detail.guestId === guest.id && current.activeTrancheGuestAssignments?.[trancheId] === guest.id
        )
        .map(([, detail]) => detail.assignmentId);
      const snapshotTranches = activeTranches.flatMap((tranche) => {
        if (current.activeTrancheGuestAssignments?.[tranche.id] !== guest.id) return [];
        const type = current.activeTrancheTypes?.[tranche.id] ||
          current.activeTrancheTypes?.[tranche.ticker] || 'cash';
        const mix = normalizeActiveTrancheMix(
          tranche.quantity,
          current.activeTrancheMixes?.[tranche.id] || current.activeTrancheMixes?.[tranche.ticker]
        );
        const assignedQuantity = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
        if (!Number.isFinite(assignedQuantity) || assignedQuantity <= 0) return [];
        return [{
          id: tranche.id,
          ticker: tranche.ticker,
          name: tranche.name,
          quantity: assignedQuantity,
          averagePrice: tranche.averagePrice,
          marketPrice: tranche.marketPrice,
          marketValue: tranche.marketPrice === null ? null : tranche.marketPrice * assignedQuantity,
          purchasedAt: tranche.purchasedAt
        }];
      });
      return {
        guestId: guest.id,
        snapshot: { updatedAt, tranches: snapshotTranches },
        ledgerUpserts,
        retainedAssignmentIds
      };
    });
    await dependencies.publishBatch(publications);
  });
  guestPortfolioPublishQueue = operation.catch((error) => {
    dependencies.logError('Unable to publish guest portfolio projections:', error);
    dependencies.logTerminal('[Guest Portfolio Sync Error]: Assigned holdings and history could not be refreshed.');
  });
  return guestPortfolioPublishQueue;
};

const handleSetClosedTradeAllocation = async (detail: BrokerEventPayloads['broker:set-closed-trade-allocation']): Promise<void> => {
  if (!(await dependencies.requireAdmin('edit closed-trade classifications'))) return;
  const rowId = String(detail?.rowId || '').trim();
  const requested = detail?.allocation;
  const fundingType = requested?.fundingType;
  if (!rowId || rowId.length > 600 ||
      (fundingType !== 'cash' && fundingType !== 'margin' && fundingType !== 'mix')) return;

  const cashInput = Number(requested?.cashQuantity);
  const marginInput = Number(requested?.marginQuantity);
  if (!Number.isFinite(cashInput) || !Number.isFinite(marginInput) || cashInput < 0 || marginInput < 0) {
    dependencies.showToast('Enter valid cash and margin share quantities.', 'error');
    return;
  }
  const cashQuantity = fundingType === 'cash' ? cashInput
    : fundingType === 'margin' ? 0 : cashInput;
  const marginQuantity = fundingType === 'cash' ? 0 : marginInput;
  const guestId = cashQuantity > 0 ? String(requested?.guestId || '').trim() : '';

  if (guestId) {
    let users;
    try {
      users = await dependencies.listUsers();
    } catch (error) {
      dependencies.showToast(error instanceof Error ? error.message : 'Could not verify guest account.', 'error');
      return;
    }
    if (!users.some((user) => user.id === guestId && user.role === 'guest')) {
      dependencies.showToast('Select an existing guest account.', 'error');
      return;
    }
  }

  const current = dependencies.getState();
  const previousAllocation = current.closedTradeAllocations?.[rowId];
  const historyByGuest = new Map<string, { guestId: string; assignedQuantity: number; assignedAt: number }>();
  for (const item of Array.isArray(previousAllocation?.guestAssignments) ? previousAllocation.guestAssignments : []) {
    const previousId = String(item?.guestId || '').trim();
    const previousQuantity = Number(item?.assignedQuantity);
    const previousAssignedAt = Number(item?.assignedAt);
    if (!previousId || !Number.isFinite(previousQuantity) || previousQuantity <= 0) continue;
    historyByGuest.set(previousId, {
      guestId: previousId,
      assignedQuantity: previousQuantity,
      assignedAt: Number.isFinite(previousAssignedAt) && previousAssignedAt > 0 ? previousAssignedAt : getNow()
    });
  }
  const previousGuestId = String(previousAllocation?.guestId || '').trim();
  const previousCashQuantity = Number(previousAllocation?.cashQuantity);
  if (previousGuestId && Number.isFinite(previousCashQuantity) && previousCashQuantity > 0) {
    const previousHistory = historyByGuest.get(previousGuestId);
    historyByGuest.set(previousGuestId, {
      guestId: previousGuestId,
      assignedQuantity: previousCashQuantity,
      assignedAt: previousHistory?.assignedAt ||
        (Number(previousAllocation?.assignedAt) > 0 ? Number(previousAllocation?.assignedAt) : getNow())
    });
  }

  const now = getNow();
  if (guestId) {
    const previousHistory = historyByGuest.get(guestId);
    historyByGuest.set(guestId, {
      guestId,
      assignedQuantity: cashQuantity,
      assignedAt: previousHistory?.assignedAt || now
    });
  }
  const guestAssignments = Array.from(historyByGuest.values());
  const currentGuestAssignment = guestId
    ? guestAssignments.find((item) => item.guestId === guestId)
    : undefined;

  const closedTradeAllocations = { ...(current.closedTradeAllocations || {}) };
  closedTradeAllocations[rowId] = {
    fundingType,
    cashQuantity,
    marginQuantity,
    ...(guestId ? { guestId, assignedAt: currentGuestAssignment?.assignedAt || now } : {}),
    ...(guestAssignments.length ? { guestAssignments } : {})
  };
  dependencies.setState({ closedTradeAllocations });
  
  dependencies.persistState(dependencies.getState());
  void dependencies.pushState();
  void publishGuestPortfolioSnapshots();
  dependencies.renderBoard();
};

const handleAssignActiveTrancheGuest = async (detail: BrokerEventPayloads['broker:assign-active-tranche-guest']): Promise<void> => {
  if (!(await dependencies.requireAdmin('assign cash tranches to guests'))) return;
  const trancheId = String(detail?.trancheId || '').trim();
  const guestId = String(detail?.guestId || '').trim();
  if (!trancheId) return;

  const current = dependencies.getState();
  let candidateTranche: ActiveBrokerTranche | null = null;
  let candidateCashQuantity = 0;
  if (guestId) {
    const trades = Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
    candidateTranche = getActiveTranches(trades, current.brokerAccountInfo)
      .find((item) => item.id === trancheId) || null;
    if (!candidateTranche) {
      dependencies.showToast('Only an active purchase tranche can be linked to a guest.', 'error');
      return;
    }
    const type = current.activeTrancheTypes?.[trancheId] ||
      current.activeTrancheTypes?.[candidateTranche.ticker] || 'cash';
    const mix = normalizeActiveTrancheMix(
      candidateTranche.quantity,
      current.activeTrancheMixes?.[trancheId] || current.activeTrancheMixes?.[candidateTranche.ticker]
    );
    candidateCashQuantity = getAssignableActiveTrancheCashQuantity(type, candidateTranche.quantity, mix);
    if (!Number.isFinite(candidateCashQuantity) || candidateCashQuantity <= 0) {
      dependencies.showToast('Only a tranche with a positive cash allocation can be linked to a guest.', 'error');
      return;
    }

    let users;
    try {
      users = await dependencies.listUsers();
    } catch (error) {
      dependencies.showToast(error instanceof Error ? error.message : 'Could not verify guest account.', 'error');
      return;
    }
    if (!users.some((user) => user.id === guestId && user.role === 'guest')) {
      dependencies.showToast('Select an existing guest account.', 'error');
      return;
    }
  }

  const assignments = { ...(current.activeTrancheGuestAssignments || {}) };
  const assignmentDetails: Record<string, ActiveTrancheGuestAssignmentDetail> = {
    ...(current.activeTrancheGuestAssignmentDetails || {})
  };
  if (guestId && candidateTranche) {
    const previous = assignmentDetails[trancheId];
    assignments[trancheId] = guestId;
    if (current.activeTrancheGuestAssignments?.[trancheId] !== guestId ||
        previous?.guestId !== guestId || !previous.assignmentId) {
      assignmentDetails[trancheId] = {
        assignmentId: createGuestTrancheAssignmentId(),
        guestId,
        assignedAt: getNow(),
        assignedQuantity: candidateCashQuantity
      };
    }
  } else {
    delete assignments[trancheId];
    delete assignmentDetails[trancheId];
  }

  dependencies.setState({
    activeTrancheGuestAssignments: assignments,
    activeTrancheGuestAssignmentDetails: assignmentDetails
  });
  
  dependencies.persistState(dependencies.getState());
  void dependencies.pushState();
  void publishGuestPortfolioSnapshots();
  dependencies.renderBoard();
};


  const bind = (): (() => void) => {
    const disposers = [
      addBrokerEventListener('broker:set-closed-trade-allocation', (detail) => {
        void handleSetClosedTradeAllocation(detail);
      }),
      addBrokerEventListener('broker:assign-active-tranche-guest', (detail) => {
        void handleAssignActiveTrancheGuest(detail);
      })
    ];
    return () => disposers.forEach((dispose) => dispose());
  };

  return {
    bind,
    setBrokerTradeHistoryLoaded: (loaded) => { brokerTradeHistoryLoaded = loaded; },
    publishGuestPortfolioSnapshots,
    handleSetClosedTradeAllocation,
    handleAssignActiveTrancheGuest
  };
}
