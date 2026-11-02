export type ManualPortfolioSyncRole = 'admin' | 'guest' | null;

export interface ManualPortfolioSyncResult {
  role: ManualPortfolioSyncRole;
  success: boolean;
  quotes: boolean;
  brokerAccount?: boolean;
  executedTrades?: boolean;
  activeOrders?: boolean;
  guestSnapshot?: boolean;
  cloud?: boolean;
}

export interface ManualPortfolioSyncOperations {
  role: ManualPortfolioSyncRole;
  refreshQuotes: () => Promise<boolean>;
  refreshBrokerAccount: () => Promise<boolean>;
  refreshExecutedTrades: () => Promise<boolean>;
  refreshActiveOrders: () => Promise<boolean>;
  pushCloud: () => Promise<boolean>;
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
    const cloud = await trySync(operations.pushCloud);
    return {
      role: 'admin',
      brokerAccount,
      executedTrades,
      activeOrders,
      quotes,
      cloud,
      success: brokerAccount && executedTrades && activeOrders && quotes && cloud
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
