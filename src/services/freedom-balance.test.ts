import { describe, expect, it } from 'vitest';
import { normalizeFreedomPortfolio } from './api';

describe('normalizeFreedomPortfolio USD cash balance', () => {
  it('uses the USD account s balance rather than currval', () => {
    const response = {
      data: {
        result: {
          ps: {
            loaded: true,
            acc: [
              { curr: 'AED', currval: 22.090706, s: 0 },
              { curr: 'RUR', currval: 1, s: 0 },
              { curr: 'USD', currval: 80.5381, s: -17053.5 }
            ],
            pos: []
          }
        }
      }
    };

    const snapshot = normalizeFreedomPortfolio(response);

    expect(snapshot.balances).toHaveLength(1);
    expect(snapshot.balances[0].currency).toBe('USD');
    expect(snapshot.balances[0].amount).toBe(-17053.5);
  });

  it('falls back to currval only when s is absent', () => {
    const response = {
      data: {
        result: {
          ps: {
            loaded: true,
            acc: [{ curr: 'USD', currval: 80.5381 }],
            pos: []
          }
        }
      }
    };

    expect(normalizeFreedomPortfolio(response).balances[0].amount).toBe(80.5381);
  });
});
