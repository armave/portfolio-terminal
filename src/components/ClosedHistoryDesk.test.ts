import { describe, expect, it } from 'vitest';
import { isSupportedCashflowWorkbook, shouldShowCashflowImportProgress } from './ClosedHistoryDesk';

describe('closed-history cashflow import controls', () => {
  it('shows button progress only for an uploaded workbook', () => {
    expect(shouldShowCashflowImportProgress()).toBe(true);
    expect(shouldShowCashflowImportProgress([])).toBe(false);
    expect(shouldShowCashflowImportProgress([{ id: 'saved-row' } as any])).toBe(false);
  });

  it('only accepts XLSX files supported by the built-in workbook reader', () => {
    expect(isSupportedCashflowWorkbook({ name: 'broker-export.xlsx' })).toBe(true);
    expect(isSupportedCashflowWorkbook({ name: 'BROKER-EXPORT.XLSX' })).toBe(true);
    expect(isSupportedCashflowWorkbook({ name: 'legacy-export.xls' })).toBe(false);
    expect(isSupportedCashflowWorkbook({ name: 'backup.json' })).toBe(false);
  });
});
