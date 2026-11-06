import type { PortfolioActionIntent } from './intent';
import type { PortfolioTransactionContext } from '../../types/portfolioTransaction';

/**
 * Keep AI-generated portfolio changes behind an explicit, synchronous user decision.
 * A rejected confirmation never invokes the mutation callback.
 */
export async function applyAiPortfolioActionAfterConfirmation(
  action: PortfolioActionIntent,
  requestConfirmation: (action: PortfolioActionIntent) => boolean,
  applyAction: (action: PortfolioActionIntent, context: PortfolioTransactionContext) => void | Promise<void>,
  idempotencyKey: string
): Promise<boolean> {
  if (!requestConfirmation(action)) return false;
  await applyAction(action, { actor: { type: 'ai' }, source: 'ai-confirmed', idempotencyKey });
  return true;
}
