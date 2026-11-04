export const PORTFOLIO_BACKUP_FILE_EXTENSION = '.json';
export const PORTFOLIO_BACKUP_MIME_TYPE = 'application/json';
export const MAX_PORTFOLIO_BACKUP_FILE_BYTES = 20 * 1024 * 1024;

export function validatePortfolioBackupFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Portfolio backup file has an invalid size.');
  }
  if (size > MAX_PORTFOLIO_BACKUP_FILE_BYTES) {
    throw new Error(`Portfolio backup exceeds the ${MAX_PORTFOLIO_BACKUP_FILE_BYTES / (1024 * 1024)} MB import limit.`);
  }
}

export function buildPortfolioBackupFilename(date: Date = new Date()): string {
  const dateStamp = date.toISOString().slice(0, 10);
  return `margin_portfolio_backup_${dateStamp}${PORTFOLIO_BACKUP_FILE_EXTENSION}`;
}

export function createPortfolioBackupBlob(snapshot: unknown): Blob {
  return new Blob([JSON.stringify(snapshot, null, 2)], {
    type: PORTFOLIO_BACKUP_MIME_TYPE
  });
}
