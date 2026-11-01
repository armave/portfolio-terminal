import type { PortfolioActionIntent } from './intent';

/**
 * Keep AI-generated portfolio changes behind an explicit, synchronous user decision.
 * A rejected confirmation never invokes the mutation callback.
 */
export async function applyAiPortfolioActionAfterConfirmation(
  action: PortfolioActionIntent,
  requestConfirmation: (action: PortfolioActionIntent) => boolean,
  applyAction: (action: PortfolioActionIntent) => void | Promise<void>
): Promise<boolean> {
  if (!requestConfirmation(action)) return false;
  await applyAction(action);
  return true;
}
