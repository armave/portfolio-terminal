import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitPortfolioBackupImport } from './backupImport';

describe('commitPortfolioBackupImport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('persists the replacement only after activating it', () => {
    const previous = { activeView: 'AAPL', balance: 100 };
    const imported = { activeView: 'MSFT', balance: 250 };
    let active = previous;
    const replaceState = vi.fn((next: typeof previous) => { active = next; });
    const persistState = vi.fn(() => active === imported);

    expect(() => commitPortfolioBackupImport(imported, previous, replaceState, persistState)).not.toThrow();
    expect(active).toBe(imported);
    expect(persistState).toHaveBeenCalledTimes(1);
  });

  it('restores the previous snapshot when local persistence returns false', () => {
    const previous = { activeView: 'AAPL', balance: 100 };
    const imported = { activeView: 'MSFT', balance: 250 };
    let active = previous;
    const replaceState = (next: typeof previous) => { active = next; };

    expect(() => commitPortfolioBackupImport(imported, previous, replaceState, () => false))
      .toThrow('Could not persist the imported backup to browser storage.');
    expect(active).toBe(previous);
  });

  it('restores the previous snapshot when persistence throws', () => {
    const previous = { activeView: 'AAPL', balance: 100 };
    const imported = { activeView: 'MSFT', balance: 250 };
    let active = previous;
    const replaceState = (next: typeof previous) => { active = next; };
    const storageError = new Error('storage unavailable');

    expect(() => commitPortfolioBackupImport(imported, previous, replaceState, () => { throw storageError; }))
      .toThrow(storageError);
    expect(active).toBe(previous);
  });
});
