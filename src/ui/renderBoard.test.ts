import { describe, expect, it } from 'vitest';
import { resolvePositionEntryDate } from './renderBoard';

describe('resolvePositionEntryDate', () => {
  it('uses the first active tranche date instead of sorting or using a stale persisted start date', () => {
    expect(resolvePositionEntryDate([
      { date: '2026-10-22' },
      { date: '2026-10-20' },
      { date: '2026-10-21' }
    ], '2026-10-28')).toBe('2026-10-22');
  });

  it('skips active tranches without a valid date until the first valid tranche date', () => {
    expect(resolvePositionEntryDate([
      {},
      { date: 'invalid-date' },
      { date: '2026-10-22' },
      { date: '2026-10-20' }
    ], '2026-10-28')).toBe('2026-10-22');
  });

  it('uses the fallback when no valid tranche dates exist', () => {
    expect(resolvePositionEntryDate([{ date: 'invalid-date' }], '2026-10-28')).toBe('2026-10-28');
  });

  it('returns undefined when neither a valid tranche date nor fallback exists', () => {
    expect(resolvePositionEntryDate([])).toBeUndefined();
  });
});
