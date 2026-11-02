import { addBrokerEventListener } from './brokerEventBus';

export interface PortfolioBrokerRequestRuntimeDependencies {
  /** Normal account-info refresh; owns stale-session error publication. */
  refreshAccountInfo: () => Promise<boolean>;
  /** Waitable account-info refresh preserves the resolve(false) failure contract. */
  refreshAccountInfoForWait: () => Promise<boolean>;
  refreshExecutedTrades: () => Promise<boolean>;
  refreshActiveOrders: () => Promise<boolean>;
}

/**
 * Binds administrator broker request channels to their session-scoped loaders.
 * Provider calls and response shaping remain with the caller; this adapter owns
 * event registration, waitable completion, initial refresh ordering, and cleanup.
 */
export function bindPortfolioBrokerRequestRuntime(
  dependencies: PortfolioBrokerRequestRuntimeDependencies
): () => void {
  const run = (operation: () => Promise<boolean>): void => {
    try {
      void Promise.resolve(operation()).catch(() => undefined);
    } catch {
      // Provider adapters publish their own current-session error events.
    }
  };

  const resolveWaiter = (
    operation: () => Promise<boolean>,
    resolve: (success: boolean) => void
  ): void => {
    try {
      void Promise.resolve(operation()).then(resolve, () => resolve(false));
    } catch {
      resolve(false);
    }
  };

  const disposers = [
    addBrokerEventListener('broker:request-account-info', () => run(dependencies.refreshAccountInfo)),
    addBrokerEventListener('broker:request-account-info-and-wait', (request) => {
      resolveWaiter(dependencies.refreshAccountInfoForWait, request.resolve);
    }),
    addBrokerEventListener('broker:request-executed-trades', () => run(dependencies.refreshExecutedTrades)),
    addBrokerEventListener('broker:request-executed-trades-and-wait', (request) => {
      resolveWaiter(dependencies.refreshExecutedTrades, request.resolve);
    }),
    addBrokerEventListener('broker:request-active-orders', () => run(dependencies.refreshActiveOrders)),
    addBrokerEventListener('broker:request-active-orders-and-wait', (request) => {
      resolveWaiter(dependencies.refreshActiveOrders, request.resolve);
    })
  ];

  // Preserve the existing account-switch startup sequence: executions,
  // active orders, then account balances and positions.
  run(dependencies.refreshExecutedTrades);
  run(dependencies.refreshActiveOrders);
  run(dependencies.refreshAccountInfo);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    disposers.forEach((dispose) => dispose());
  };
}
