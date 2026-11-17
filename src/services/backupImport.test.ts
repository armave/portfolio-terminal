import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePortfolioBackup } from '../domain/portfolio';
import { commitPortfolioBackupImport } from './backupImport';

describe('commitPortfolioBackupImport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an invalid backup before invoking the atomic store commit', () => {
    const commitState = vi.fn(() => true);

    expect(() => {
      const imported = normalizePortfolioBackup({
        positions: null,
        holdings: [{ ticker: 'AAPL' }]
      }, 10_000);
      commitPortfolioBackupImport(imported, commitState);
    }).toThrow('Invalid positions in portfolio backup: expected an object keyed by ticker.');

    expect(commitState).not.toHaveBeenCalled();
  });

  it('rejects malformed closed-history rows before invoking the atomic store commit', () => {
    const commitState = vi.fn(() => true);

    expect(() => {
      const imported = normalizePortfolioBackup({
        positions: {},
        closedTrades: [{
          id: 'valid-row',
          ticker: 'AAPL',
          shares: 2,
          netProfit: 25
        }, null]
      }, 10_000);
      commitPortfolioBackupImport(imported, commitState);
    }).toThrow('Invalid closedTrades in portfolio backup: each history row must be an object.');

    expect(commitState).not.toHaveBeenCalled();
  });

  it('passes a normalized legacy holdings backup to the atomic commit exactly once', () => {
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
    const commitState = vi.fn((next: unknown) => {
      // Models the store's atomic persist-before-publish contract.
      persisted = structuredClone(next);
      active = next;
      return true;
    });

    commitPortfolioBackupImport(imported, commitState);

    expect(commitState).toHaveBeenCalledTimes(1);
    expect(commitState).toHaveBeenCalledWith(imported);
    expect((active as ReturnType<typeof normalizePortfolioBackup>).positions.WDC).toMatchObject({
      ticker: 'WDC',
      shares: 30,
      tranches: [{ qty: 30, price: 11.5, date: '2026-10-15' }]
    });
    expect(persisted).toEqual(active);
    expect(previous).toEqual({ activeView: 'COMBINED', balance: 0 });
  });

  it('preserves broker position evidence and integrity warnings through the atomic commit', () => {
    const brokerAccountInfo = {
      loaded: true,
      receivedAt: 1_800_000_000_000,
      status: 'stale',
      quality: 'partial',
      snapshotQuality: 'partial',
      balances: [],
      positions: [{
        ticker: 'GOOGL.US',
        name: 'Alphabet',
        quantity: -2,
        currency: 'USD',
        marketPrice: 290,
        marketValue: -580,
        averagePrice: 300,
        profitClose: null,
        accountPositionId: 42,
        direction: 'unknown',
        rawQuantity: -2,
        rawSide: 'S',
        instrumentId: 'security-42',
        raw: { i: 'GOOGL.US', q: -2, position_side: 'S' }
      }],
      positionIntegrityIssues: [{
        ticker: 'GOOGL',
        code: 'negative_quantity_sign_unverified',
        source: 'account_snapshot',
        rawQuantity: -2,
        rawSide: 'S',
        instrumentId: 'security-42',
        raw: { i: 'GOOGL.US', q: -2, position_side: 'S' }
      }]
    };
    const imported = normalizePortfolioBackup({
      balance: 0,
      positions: {},
      cashCushion: { freeCash: 0, holdings: [] },
      brokerAccountInfo
    }, 10_000);
    let active: unknown = null;

    commitPortfolioBackupImport(imported, (next) => {
      active = next;
      return true;
    });

    expect((active as any).brokerAccountInfo).toMatchObject({
      quality: 'partial',
      snapshotQuality: 'partial',
      positions: [{ quantity: -2, direction: 'unknown', rawQuantity: -2, rawSide: 'S' }],
      positionIntegrityIssues: [{ ticker: 'GOOGL', code: 'negative_quantity_sign_unverified', rawQuantity: -2 }]
    });
  });

  it('reports a failed atomic store commit without attempting a compensating import', () => {
    const previous = { activeView: 'AAPL', balance: 100 };
    const imported = { activeView: 'MSFT', balance: 250 };
    let active = previous;
    const commitState = vi.fn(() => false);

    expect(() => commitPortfolioBackupImport(
      imported,
      commitState,
      'Backup transaction history conflicts with this device or is not supported.'
    )).toThrow('Backup transaction history conflicts with this device or is not supported.');

    expect(active).toBe(previous);
    expect(commitState).toHaveBeenCalledTimes(1);
  });

  it('propagates an atomic commit error without attempting a second persistence or rollback call', () => {
    const imported = { activeView: 'MSFT', balance: 250 };
    const storageError = new Error('storage unavailable');
    const commitState = vi.fn(() => { throw storageError; });

    expect(() => commitPortfolioBackupImport(imported, commitState)).toThrow(storageError);
    expect(commitState).toHaveBeenCalledTimes(1);
  });
});
