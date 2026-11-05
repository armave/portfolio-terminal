import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePortfolioBackup } from '../domain/portfolio';
import { commitPortfolioBackupImport, retryPendingBackupCloudSync } from './backupImport';

describe('commitPortfolioBackupImport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an invalid backup before replacing or persisting the active portfolio', () => {
    const previous = { activeView: 'AAPL', balance: 100 };
    let active = previous;
    const replaceState = vi.fn((next: typeof previous) => { active = next; });
    const persistState = vi.fn(() => true);

    expect(() => {
      const imported = normalizePortfolioBackup({
        positions: null,
        holdings: [{ ticker: 'AAPL' }]
      }, 10_000);
      commitPortfolioBackupImport(imported, previous, replaceState, persistState);
    }).toThrow('Invalid positions in portfolio backup: expected an object keyed by ticker.');

    expect(active).toBe(previous);
    expect(replaceState).not.toHaveBeenCalled();
    expect(persistState).not.toHaveBeenCalled();
  });

  it('normalizes and commits a legacy holdings backup as canonical positions', () => {
    const previous = { activeView: 'COMBINED', balance: 0 };
    let active: unknown = previous;
    let persisted: unknown = null;
    const imported = normalizePortfolioBackup({
      balance: -250,
      holdings: [{
        ticker: 'wdc',
        isMargin: true,
        currentPrice: 11.5,
        tranches: [{ id: 'legacy-wdc', shares: 30, entryPrice: 11.5, purchaseDate: '2026-10-15' }]
      }]
    }, 10_000);

    commitPortfolioBackupImport(
      imported,
      previous,
      (next) => { active = next; },
      () => { persisted = structuredClone(active); return true; }
    );

    expect((active as ReturnType<typeof normalizePortfolioBackup>).positions.WDC).toMatchObject({
      ticker: 'WDC',
      shares: 30,
      tranches: [{ qty: 30, price: 11.5, date: '2026-10-15' }]
    });
    expect(persisted).toEqual(active);
    expect(previous).toEqual({ activeView: 'COMBINED', balance: 0 });
  });

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


describe('retryPendingBackupCloudSync', () => {
  it('refreshes the cloud revision, restores the imported snapshot, and clears the marker after a confirmed push', async () => {
    const order: string[] = [];
    const importedSnapshot = { balance: -250, activeView: 'COMBINED' };
    const result = await retryPendingBackupCloudSync(importedSnapshot, {
      refreshCloudRevision: async () => { order.push('pull'); },
      isCurrentSession: () => true,
      restoreLocalSnapshot: (snapshot) => {
        order.push('restore');
        expect(snapshot).toBe(importedSnapshot);
        return true;
      },
      persistLocalSnapshot: () => { order.push('persist'); return true; },
      pushCloudSnapshot: async () => { order.push('push'); return true; },
      clearPendingMarker: () => { order.push('clear'); }
    });

    expect(result).toBe(true);
    expect(order).toEqual(['pull', 'restore', 'persist', 'push', 'clear']);
  });

  it('keeps the pending marker when the cloud rejects the replacement', async () => {
    const clearPendingMarker = vi.fn();
    const result = await retryPendingBackupCloudSync({ balance: -250 }, {
      refreshCloudRevision: async () => undefined,
      isCurrentSession: () => true,
      restoreLocalSnapshot: () => true,
      persistLocalSnapshot: () => true,
      pushCloudSnapshot: async () => false,
      clearPendingMarker
    });

    expect(result).toBe(false);
    expect(clearPendingMarker).not.toHaveBeenCalled();
  });

  it('does not restore or push after the account session changes during the cloud pull', async () => {
    const restoreLocalSnapshot = vi.fn(() => true);
    const pushCloudSnapshot = vi.fn(async () => true);
    const clearPendingMarker = vi.fn();
    const result = await retryPendingBackupCloudSync({ balance: -250 }, {
      refreshCloudRevision: async () => undefined,
      isCurrentSession: () => false,
      restoreLocalSnapshot,
      persistLocalSnapshot: () => true,
      pushCloudSnapshot,
      clearPendingMarker
    });

    expect(result).toBe(false);
    expect(restoreLocalSnapshot).not.toHaveBeenCalled();
    expect(pushCloudSnapshot).not.toHaveBeenCalled();
    expect(clearPendingMarker).not.toHaveBeenCalled();
  });

  it('does not clear the marker when local persistence fails after restoring the imported snapshot', async () => {
    const pushCloudSnapshot = vi.fn(async () => true);
    const clearPendingMarker = vi.fn();
    const result = await retryPendingBackupCloudSync({ balance: -250 }, {
      refreshCloudRevision: async () => undefined,
      isCurrentSession: () => true,
      restoreLocalSnapshot: () => true,
      persistLocalSnapshot: () => false,
      pushCloudSnapshot,
      clearPendingMarker
    });

    expect(result).toBe(false);
    expect(pushCloudSnapshot).not.toHaveBeenCalled();
    expect(clearPendingMarker).not.toHaveBeenCalled();
  });
});
