import { canAccessPortfolioView } from '../domain/accountPermissions';

type PortfolioAccountRole = 'admin' | 'guest' | null;

export interface GuestPortfolioSessionIdentity {
  role: PortfolioAccountRole;
  accountId: string | null;
  secret: string;
  generation: number;
}

/**
 * Prevents an in-flight guest snapshot from being applied after the authenticated
 * account or credential changes. The secret is compared in memory only.
 */
export function isCurrentGuestPortfolioSession(
  requested: GuestPortfolioSessionIdentity,
  current: GuestPortfolioSessionIdentity
): boolean {
  return requested.role === 'guest' &&
    Boolean(requested.accountId?.trim()) &&
    Boolean(requested.secret.trim()) &&
    current.role === 'guest' &&
    current.accountId === requested.accountId &&
    current.secret === requested.secret &&
    current.generation === requested.generation;
}

/** Preserve the signed-in guest's current desk while refreshing its snapshot. */
export function resolveGuestPortfolioRefreshView(currentView: string | null | undefined): string {
  return currentView && canAccessPortfolioView('guest', currentView) ? currentView : 'BALANCE';
}
