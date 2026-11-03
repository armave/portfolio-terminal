type ManualPortfolioSyncRole = 'admin' | 'guest' | null;

export interface ManualPortfolioSyncResult {
  role: ManualPortfolioSyncRole;
  success: boolean;
  quotes: boolean;
  brokerAccount?: boolean;
  executedTrades?: boolean;
  activeOrders?: boolean;
  guestSnapshot?: boolean;
  cloud?: boolean;
  cloudHistory?: boolean;
}

export interface ManualPortfolioSyncOperations {
  role: ManualPortfolioSyncRole;
  refreshQuotes: () => Promise<boolean>;
  refreshBrokerAccount: () => Promise<boolean>;
  refreshExecutedTrades: () => Promise<boolean>;
  refreshActiveOrders: () => Promise<boolean>;
  pushCloud: () => Promise<boolean>;
  syncClosedHistory: () => Promise<boolean>;
  pullGuestSnapshot: () => Promise<boolean>;
}

async function trySync(operation: () => Promise<boolean>): Promise<boolean> {
  try {
    return await operation();
  } catch {
    return false;
  }
}

/** Admins refresh broker data, quotes, then shared cloud state. Guests refresh
 * only their server-scoped assigned snapshot and the quotes for those holdings. */
export async function runManualPortfolioSync(
  operations: ManualPortfolioSyncOperations
): Promise<ManualPortfolioSyncResult> {
  if (operations.role === 'admin') {
    const [brokerAccount, executedTrades, activeOrders] = await Promise.all([
      trySync(operations.refreshBrokerAccount),
      trySync(operations.refreshExecutedTrades),
      trySync(operations.refreshActiveOrders)
    ]);
    const quotes = await trySync(operations.refreshQuotes);
    const cloudHistory = await trySync(operations.syncClosedHistory);
    // History fee allocation can update app-owned closed-trade totals in the
    // shared portfolio record, so checkpoint the portfolio after history.
    const cloud = await trySync(operations.pushCloud);
    return {
      role: 'admin',
      brokerAccount,
      executedTrades,
      activeOrders,
      quotes,
      cloud,
      cloudHistory,
      success: brokerAccount && executedTrades && activeOrders && quotes && cloud && cloudHistory
    };
  }

  if (operations.role === 'guest') {
    const guestSnapshot = await trySync(operations.pullGuestSnapshot);
    const quotes = await trySync(operations.refreshQuotes);
    return {
      role: 'guest',
      guestSnapshot,
      quotes,
      success: guestSnapshot && quotes
    };
  }

  return { role: null, quotes: false, success: false };
}
