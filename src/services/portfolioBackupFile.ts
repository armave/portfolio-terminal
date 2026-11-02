export const PORTFOLIO_BACKUP_FILE_EXTENSION = '.json';
export const PORTFOLIO_BACKUP_MIME_TYPE = 'application/json';

export function buildPortfolioBackupFilename(date: Date = new Date()): string {
  const dateStamp = date.toISOString().slice(0, 10);
  return `margin_portfolio_backup_${dateStamp}${PORTFOLIO_BACKUP_FILE_EXTENSION}`;
}

export function createPortfolioBackupBlob(snapshot: unknown): Blob {
  return new Blob([JSON.stringify(snapshot, null, 2)], {
    type: PORTFOLIO_BACKUP_MIME_TYPE
  });
}
