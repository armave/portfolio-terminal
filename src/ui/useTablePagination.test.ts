import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTablePaginationRange,
  normalizeTablePageSize,
  readTablePageSize,
  sliceTablePage,
  writeTablePageSize
} from './useTablePagination';

describe('table pagination preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes page sizes to the supported compact options', () => {
    expect(normalizeTablePageSize('25')).toBe(25);
    expect(normalizeTablePageSize(50)).toBe(50);
    expect(normalizeTablePageSize(17)).toBe(10);
    expect(normalizeTablePageSize('invalid', 100)).toBe(100);
  });

  it('calculates one-based page ranges and clamps pages after rows are removed', () => {
    expect(getTablePaginationRange(78, 3, 25)).toEqual({
      pageCount: 4, page: 3, start: 51, end: 75
    });
    expect(getTablePaginationRange(12, 5, 10)).toEqual({
      pageCount: 2, page: 2, start: 11, end: 12
    });
    expect(getTablePaginationRange(0, 3, 10)).toEqual({
      pageCount: 1, page: 1, start: 0, end: 0
    });
  });

  it('slices the requested page without mutating the source collection', () => {
    const items = Array.from({ length: 26 }, (_, index) => index + 1);
    expect(sliceTablePage(items, 2, 10)).toEqual(Array.from({ length: 10 }, (_, index) => index + 11));
    expect(items).toHaveLength(26);
  });

  it('persists independent page sizes per table and safely uses defaults when storage is unavailable', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    vi.stubGlobal('window', { localStorage: storage });

    writeTablePageSize('closed-history', 50);
    writeTablePageSize('guest-history', 25);
    expect(readTablePageSize('closed-history')).toBe(50);
    expect(readTablePageSize('guest-history')).toBe(25);
    expect(readTablePageSize('settings-users')).toBe(10);
  });

  it('keeps a usable default when localStorage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); }
      }
    });

    expect(readTablePageSize('closed-history', 25)).toBe(25);
    expect(() => writeTablePageSize('closed-history', 50)).not.toThrow();
  });
});
