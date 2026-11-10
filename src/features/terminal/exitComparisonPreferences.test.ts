import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  getExitDayOffset,
  loadExitComparisonPreferences,
  saveExitComparisonPreferences,
  toLocalIsoDate,
  type ExitComparisonPreferences
} from './exitComparisonPreferences';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const sample: ExitComparisonPreferences = {
  version: 1,
  ticker: 'GOOGL',
  periods: [
    { date: '2026-11-10', price: '294.00' },
    { date: '2026-11-24', price: '303.00' }
  ],
  lastResult: {
    savedAt: 1_794_321_000_000,
    columns: ['Today · $294.00', 'In 14 days · $303.00'],
    rows: [
      { label: 'Net P&L', values: ['−$2,000.00', '−$1,550.00'], kind: 'result', deltas: ['−$450.00', 'BEST'] },
      { label: 'Resulting Account Balance', values: ['−$1,000.00', '−$1,400.00'], kind: 'balance' }
    ],
    note: 'Estimate only.',
    summary: 'Last deterministic comparison.'
  }
};

describe('exit comparison preferences', () => {
  it('restores the last ticker, both editable periods, and complete last result', () => {
    const storage = new MemoryStorage();
    expect(saveExitComparisonPreferences('account-a', sample, storage)).toBe(true);
    expect(loadExitComparisonPreferences('account-a', storage)).toEqual(sample);
  });

  it('isolates saved preferences by storage key and tolerates missing/corrupt data', () => {
    const storage = new MemoryStorage();
    saveExitComparisonPreferences('account-a', sample, storage);
    expect(loadExitComparisonPreferences('account-b', storage)).toBeNull();
    storage.setItem('broken', '{not json');
    expect(loadExitComparisonPreferences('broken', storage)).toBeNull();
    storage.setItem('wrong-version', JSON.stringify({ ...sample, version: 2 }));
    expect(loadExitComparisonPreferences('wrong-version', storage)).toBeNull();
  });

  it('rejects invalid saved date and price shapes rather than restoring unsafe input', () => {
    const storage = new MemoryStorage();
    storage.setItem('invalid-date', JSON.stringify({
      ...sample,
      periods: [{ date: '2026-02-31', price: '100' }, sample.periods[1]]
    }));
    storage.setItem('invalid-price', JSON.stringify({
      ...sample,
      periods: [sample.periods[0], { date: '2026-11-24', price: 303 }]
    }));
    expect(loadExitComparisonPreferences('invalid-date', storage)).toBeNull();
    expect(loadExitComparisonPreferences('invalid-price', storage)).toBeNull();
  });

  it('calculates local calendar-day offsets and enforces the supported 10-year horizon', () => {
    expect(getExitDayOffset('2026-11-10', '2026-11-10')).toBe(0);
    expect(getExitDayOffset('2026-11-24', '2026-11-10')).toBe(14);
    expect(getExitDayOffset('2026-11-09', '2026-11-10')).toBeNull();
    expect(getExitDayOffset(addCalendarDays('2026-11-10', 3650), '2026-11-10')).toBe(3650);
    expect(getExitDayOffset('2036-11-10', '2026-11-10')).toBeNull();
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(toLocalIsoDate(new Date(2026, 10, 10, 12))).toBe('2026-11-10');
  });

  it('fails safely when browser storage is unavailable or full', () => {
    expect(saveExitComparisonPreferences('account-a', sample, null)).toBe(false);
    expect(loadExitComparisonPreferences('account-a', null)).toBeNull();
    const failingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); }
    };
    expect(saveExitComparisonPreferences('account-a', sample, failingStorage)).toBe(false);
  });
});
