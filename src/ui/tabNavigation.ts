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
