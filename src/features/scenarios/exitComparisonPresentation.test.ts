import { describe, expect, it } from 'vitest';
import {
  formatExitComparisonDate,
  getProjectedCashDebtStatus,
  parseScenarioSignedMoney
} from './exitComparisonPresentation';

describe('Compare Exits result presentation helpers', () => {
  it('preserves signed values, including Unicode minus, and rejects placeholders', () => {
    expect(parseScenarioSignedMoney('−$2,728.74')).toBe(-2728.74);
    expect(parseScenarioSignedMoney('-$1,416.64')).toBe(-1416.64);
    expect(parseScenarioSignedMoney('+$399.00')).toBe(399);
    expect(parseScenarioSignedMoney('$0.00')).toBe(0);
    expect(parseScenarioSignedMoney('—')).toBeNull();
    expect(parseScenarioSignedMoney('')).toBeNull();
    expect(parseScenarioSignedMoney('$--')).toBeNull();
  });

  it('classifies projected signed cash/debt without confusing debt with equity', () => {
    expect(getProjectedCashDebtStatus('−$1,416.64')).toBe('debt');
    expect(getProjectedCashDebtStatus('$399.00')).toBe('cash');
    expect(getProjectedCashDebtStatus('$0.00')).toBe('settled');
    expect(getProjectedCashDebtStatus('—')).toBe('unavailable');
  });

  it('formats exact calendar dates in English and Russian without UTC shifting', () => {
    expect(formatExitComparisonDate('2026-11-23', 'en')).toBe('Nov 23, 2026');
    expect(formatExitComparisonDate('2026-11-23', 'ru')).toContain('23');
    expect(formatExitComparisonDate('2026-02-31', 'en')).toBe('2026-02-31');
    expect(formatExitComparisonDate('invalid', 'en')).toBe('invalid');
  });
});
