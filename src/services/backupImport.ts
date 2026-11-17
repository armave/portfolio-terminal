/**
 * Commit a validated backup through the store's single atomic import boundary.
 *
 * The callback must validate, persist, and publish the imported state as one
 * operation (for example, PortfolioStore.importState). Do not split this into
 * an in-memory replacement followed by a second persistence call: same-workspace
 * imports intentionally merge append-only journals and cannot undo that merge
 * by importing the previous snapshot again.
 */
export function commitPortfolioBackupImport<TState>(
  importedState: TState,
  commitState: (state: TState) => boolean,
  failureMessage = 'Could not commit the imported portfolio backup.'
): void {
  if (!commitState(importedState)) {
    throw new Error(failureMessage);
  }
}
