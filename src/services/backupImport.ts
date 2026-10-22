/**
 * Replace the active portfolio snapshot only when the replacement can be
 * persisted. If persistence fails or throws, restore the previous snapshot
 * before propagating the failure to the caller.
 */
export function commitPortfolioBackupImport<TState>(
  importedState: TState,
  previousState: TState,
  replaceState: (state: TState) => void,
  persistState: () => boolean
): void {
  replaceState(importedState);
  try {
    if (!persistState()) {
      throw new Error('Could not persist the imported backup to browser storage.');
    }
  } catch (error) {
    replaceState(previousState);
    throw error;
  }
}
