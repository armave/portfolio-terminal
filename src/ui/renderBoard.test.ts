import { describe, expect, it } from 'vitest';
import { renderBoard, resolveActiveView, resolvePositionEntryDate } from './renderBoard';
import type { PositionRecord } from '../types/portfolio';

describe('resolvePositionEntryDate', () => {
  it('uses the chronologically earliest active tranche date instead of array order or a stale saved date', () => {
    expect(resolvePositionEntryDate([
      { date: '2026-10-22' },
      { date: '2026-10-20' },
      { date: '2026-10-21' }
    ], '2026-10-28')).toBe('2026-10-20');
  });

  it('parses legacy day-month dates and selects the earliest date regardless of array order', () => {
    expect(resolvePositionEntryDate([
      { date: '22 Oct' },
      { date: '21 Oct' },
      { date: '20 Oct' }
    ], '2026-10-28', new Date('2026-10-29T12:00:00Z'))).toBe('2026-10-20');
  });

  it('supports purchaseDate and acquiredAt tranche fields', () => {
    expect(resolvePositionEntryDate([
      { purchaseDate: '2026-10-22' },
      { acquiredAt: Date.parse('2026-10-21T12:00:00Z') }
    ], '2026-10-28', new Date('2026-10-29T12:00:00Z'))).toBe('2026-10-21');
  });

  it('skips active tranches without a valid date until the first valid tranche date', () => {
    expect(resolvePositionEntryDate([
      {},
      { date: 'invalid-date' },
      { date: '2026-10-22' },
      { date: '2026-10-20' }
    ], '2026-10-28')).toBe('2026-10-20');
  });

  it('uses the fallback when no valid tranche dates exist', () => {
    expect(resolvePositionEntryDate([{ date: 'invalid-date' }], '2026-10-28')).toBe('2026-10-28');
  });

  it('returns undefined when neither a valid tranche date nor fallback exists', () => {
    expect(resolvePositionEntryDate([])).toBeUndefined();
  });
});


describe('resolveActiveView', () => {
  it('keeps non-position desks selected without requiring a ticker position', () => {
    expect(resolveActiveView({ activeView: 'CASH_CUSHION' })).toBe('CASH_CUSHION');
    expect(resolveActiveView({ activeView: 'CLOSED_HISTORY' })).toBe('CLOSED_HISTORY');
    expect(resolveActiveView({ activeView: 'GUEST_HISTORY' })).toBe('GUEST_HISTORY');
  });

  it('treats LOTS as a standalone view without recalculating margin metrics', () => {
    const onUpdateCombinedBreakeven = () => { throw new Error('Margin metrics should remain idle on LOTS.'); };
    const visited: string[] = [];
    renderBoard({ activeView: 'GUEST_HISTORY', positions: {} }, {
      rules: {} as any,
      onUpdateCombinedBreakeven,
      onUpdateLastDeskView: (view) => visited.push(view)
    });
    expect(visited).toEqual(['GUEST_HISTORY']);
  });

  it('keeps a selected ticker desk while that position exists', () => {
    const positions = { AAPL: {} as PositionRecord };
    expect(resolveActiveView({ activeView: 'AAPL', positions })).toBe('AAPL');
  });

  it('falls back to the combined desk when a saved ticker no longer exists', () => {
    expect(resolveActiveView({ activeView: 'AAPL', positions: {} })).toBe('COMBINED');
  });

  it('keeps the combined desk selected', () => {
    expect(resolveActiveView({ activeView: 'COMBINED', positions: {} })).toBe('COMBINED');
  });
});
