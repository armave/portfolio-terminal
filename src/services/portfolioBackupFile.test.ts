import { describe, expect, it } from 'vitest';
import {
  buildPortfolioBackupFilename,
  createPortfolioBackupBlob,
  MAX_PORTFOLIO_BACKUP_FILE_BYTES,
  PORTFOLIO_BACKUP_FILE_EXTENSION,
  PORTFOLIO_BACKUP_MIME_TYPE,
  validatePortfolioBackupFileSize
} from './portfolioBackupFile';

describe('portfolio backup file contract', () => {
  it('uses the same JSON extension for exported files and the import picker', () => {
    const filename = buildPortfolioBackupFilename(new Date('2026-11-02T12:00:00.000Z'));

    expect(PORTFOLIO_BACKUP_FILE_EXTENSION).toBe('.json');
    expect(filename).toBe('margin_portfolio_backup_2026-11-02.json');
    expect(filename.endsWith(PORTFOLIO_BACKUP_FILE_EXTENSION)).toBe(true);
  });

  it('creates a standards-compliant JSON Blob with formatted backup content', async () => {
    const snapshot = { balance: -1250, positions: { AAPL: { shares: 5 } } };
    const blob = createPortfolioBackupBlob(snapshot);

    expect(blob.type).toBe(PORTFOLIO_BACKUP_MIME_TYPE);
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(JSON.stringify(snapshot, null, 2));
  });

  it('accepts backups up to the import limit and rejects invalid or oversized files before parsing', () => {
    expect(MAX_PORTFOLIO_BACKUP_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(() => validatePortfolioBackupFileSize(MAX_PORTFOLIO_BACKUP_FILE_BYTES)).not.toThrow();
    expect(() => validatePortfolioBackupFileSize(MAX_PORTFOLIO_BACKUP_FILE_BYTES + 1))
      .toThrow('Portfolio backup exceeds the 20 MB import limit.');
    expect(() => validatePortfolioBackupFileSize(Number.NaN))
      .toThrow('Portfolio backup file has an invalid size.');
    expect(() => validatePortfolioBackupFileSize(-1))
      .toThrow('Portfolio backup file has an invalid size.');
  });

});
