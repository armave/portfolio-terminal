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

/** Balance is stored as CASH_CUSHION after the navigation event is normalized. */
export function isBalanceDeskView(view: string): boolean {
  return view === 'BALANCE' || view === 'CASH_CUSHION';
}

/** Refresh only on an actual transition into Balance, not on same-page clicks. */
export function shouldRefreshQuotesWhenEnteringBalance(
  currentView: string,
  nextView: string
): boolean {
  return !isBalanceDeskView(currentView) && isBalanceDeskView(nextView);
}

/** Refresh quotes when an administrator selects a different Margin section. */
export function shouldRefreshQuotesOnNavigation(
  currentView: string,
  nextView: string,
  isAdmin: boolean
): boolean {
  return currentView !== nextView && isMarginDeskView(nextView, isAdmin);
}


/** Build workspace destinations in the same order used by keyboard navigation. */
export function getWorkspaceNavigationViews(
  tickers: string[],
  isAdmin: boolean,
  canViewGuestHistory: boolean
): string[] {
  const marginViews = tickers.length === 0
    ? ['COMBINED']
    : tickers.length === 1
      ? [tickers[0]]
      : ['COMBINED', ...tickers];

  if (isAdmin) return [...marginViews, 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'];
  return canViewGuestHistory
    ? ['BALANCE', 'GUEST_HISTORY', 'SETTINGS']
    : ['BALANCE', 'SETTINGS'];
}
