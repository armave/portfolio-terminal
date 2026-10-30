import { describe, expect, it } from "vitest";
import { getAccountPermissions } from "./accountPermissions";

describe("getAccountPermissions", () => {
  it("grants elevated workspace capabilities only to admins", () => {
    expect(getAccountPermissions("admin")).toEqual({
      isAdmin: true,
      canManageBackups: true,
      canViewKvStatus: true,
      canUseTerminal: true,
      canViewMarginDesk: true,
      canViewClosedHistory: true,
      canViewActiveTranches: true,
      canEditBrokerRules: true
    });
  });

  it("limits guests to the basic read-only workspace", () => {
    expect(getAccountPermissions("guest")).toEqual({
      isAdmin: false,
      canManageBackups: false,
      canViewKvStatus: false,
      canUseTerminal: false,
      canViewMarginDesk: false,
      canViewClosedHistory: false,
      canViewActiveTranches: false,
      canEditBrokerRules: false
    });
  });

  it("fails closed until an authenticated role is known", () => {
    expect(getAccountPermissions(null)).toEqual(getAccountPermissions("guest"));
    expect(getAccountPermissions(undefined)).toEqual(getAccountPermissions("guest"));
  });
});
