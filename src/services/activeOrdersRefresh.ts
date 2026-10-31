export interface ActiveOrdersRefreshDependencies<Response, Order> {
  restoreGatewaySecret: () => Promise<string>;
  fetchActiveOrders: () => Promise<Response>;
  normalizeActiveOrders: (response: Response) => Order[];
  onSuccess: (orders: Order[]) => void;
  onError: () => void;
  logError?: (error: unknown) => void;
  isCurrent?: () => boolean;
}

/**
 * Refresh read-only broker active orders. Missing credentials and provider failures
 * both notify the owner so the UI cannot silently keep presenting old targets as fresh.
 */
export async function refreshActiveOrders<Response, Order>(
  dependencies: ActiveOrdersRefreshDependencies<Response, Order>
): Promise<void> {
  const isCurrent = dependencies.isCurrent || (() => true);
  try {
    const secret = await dependencies.restoreGatewaySecret();
    if (!isCurrent()) return;
    if (!secret.trim()) {
      dependencies.onError();
      return;
    }

    const response = await dependencies.fetchActiveOrders();
    if (!isCurrent()) return;
    dependencies.onSuccess(dependencies.normalizeActiveOrders(response));
  } catch (error) {
    if (!isCurrent()) return;
    dependencies.logError?.(error);
    dependencies.onError();
  }
}
