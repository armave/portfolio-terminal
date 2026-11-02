/** Return the next roving-tab index for the supported horizontal tab keys. */
export function resolveTabNavigationIndex(
  currentIndex: number,
  tabCount: number,
  key: string
): number | null {
  if (
    !Number.isInteger(currentIndex) ||
    !Number.isInteger(tabCount) ||
    tabCount < 2 ||
    currentIndex < 0 ||
    currentIndex >= tabCount
  ) {
    return null;
  }

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return tabCount - 1;
    case 'ArrowLeft':
      return (currentIndex - 1 + tabCount) % tabCount;
    case 'ArrowRight':
      return (currentIndex + 1) % tabCount;
    default:
      return null;
  }
}

const NON_MARGIN_DESK_VIEWS = new Set(['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS']);

/** Whether the current session can see the administrator Margin workspace. */
export function isMarginDeskView(view: string, isAdmin: boolean): boolean {
  return isAdmin && !NON_MARGIN_DESK_VIEWS.has(view);
}

/**
 * Refresh quotes when entering Balance or a different administrator Margin section.
 * Balance displays the same live position/holding prices, so returning to it must
 * not leave the user looking at quotes fetched only during the previous app load.
 */
export function shouldRefreshQuotesOnNavigation(
  currentView: string,
  nextView: string,
  isAdmin: boolean
): boolean {
  return currentView !== nextView && (
    nextView === 'BALANCE' || isMarginDeskView(nextView, isAdmin)
  );
}
