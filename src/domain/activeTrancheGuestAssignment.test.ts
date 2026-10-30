import { describe, expect, it } from 'vitest';
import { getAssignableActiveTrancheCashQuantity } from './activeTrancheGuestAssignment';

describe('getAssignableActiveTrancheCashQuantity', () => {
  it('allows the full quantity of a cash tranche', () => {
    expect(getAssignableActiveTrancheCashQuantity('cash', 12)).toBe(12);
  });

  it('allows only the positive cash allocation of a Mix tranche', () => {
    expect(getAssignableActiveTrancheCashQuantity('mix', 12, { cash: 4.5, margin: 7.5 })).toBe(4.5);
  });

  it('does not allow Mix tranches with zero or negative cash allocation', () => {
    expect(getAssignableActiveTrancheCashQuantity('mix', 12, { cash: 0, margin: 12 })).toBe(0);
    expect(getAssignableActiveTrancheCashQuantity('mix', 12, { cash: -1, margin: 13 })).toBe(0);
  });

  it('does not allow margin-only tranches', () => {
    expect(getAssignableActiveTrancheCashQuantity('margin', 12)).toBe(0);
  });

  it('rejects invalid quantities and clamps cash allocation to the tranche total', () => {
    expect(getAssignableActiveTrancheCashQuantity('cash', Number.NaN)).toBe(0);
    expect(getAssignableActiveTrancheCashQuantity('mix', 12, { cash: 15, margin: 0 })).toBe(12);
    expect(getAssignableActiveTrancheCashQuantity('mix', 12, { cash: Number.NaN, margin: 0 })).toBe(0);
  });
});
