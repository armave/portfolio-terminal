import { describe, expect, it, vi } from 'vitest';
import { applyAiPortfolioActionAfterConfirmation } from './confirmedPortfolioAction';
import type { PortfolioActionIntent } from './intent';

const buyAction: PortfolioActionIntent = {
  intent: 'action',
  action: 'buy',
  ticker: 'AAPL',
  shares: 2,
  price: 100,
  pt: null,
  date: null
};

describe('AI portfolio action confirmation boundary', () => {
  it('does not apply a portfolio mutation when confirmation is declined', async () => {
    const confirm = vi.fn(() => false);
    const apply = vi.fn();

    const result = await applyAiPortfolioActionAfterConfirmation(buyAction, confirm, apply);

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(buyAction);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a validated mutation only after confirmation is accepted', async () => {
    const confirm = vi.fn(() => true);
    const apply = vi.fn();

    const result = await applyAiPortfolioActionAfterConfirmation(buyAction, confirm, apply);

    expect(result).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(buyAction);
  });

  it('propagates mutation failures instead of reporting a successful application', async () => {
    const failure = new Error('store rejected action');
    const apply = vi.fn(() => { throw failure; });

    await expect(applyAiPortfolioActionAfterConfirmation(buyAction, () => true, apply)).rejects.toBe(failure);
  });
});
