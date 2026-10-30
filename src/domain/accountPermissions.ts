export type AccountRole = "admin" | "guest";

export interface AccountPermissions {
  isAdmin: boolean;
  canManageBackups: boolean;
  canViewKvStatus: boolean;
  canUseTerminal: boolean;
  canViewMarginDesk: boolean;
  canViewClosedHistory: boolean;
  canViewActiveTranches: boolean;
  canEditBrokerRules: boolean;
}

/** Unknown roles fail closed; only an authenticated admin receives elevated UI capabilities. */
export function getAccountPermissions(role: AccountRole | null | undefined): AccountPermissions {
  const isAdmin = role === "admin";
  return {
    isAdmin,
    canManageBackups: isAdmin,
    canViewKvStatus: isAdmin,
    canUseTerminal: isAdmin,
    canViewMarginDesk: isAdmin,
    canViewClosedHistory: isAdmin,
    canViewActiveTranches: isAdmin,
    canEditBrokerRules: isAdmin
  };
}
