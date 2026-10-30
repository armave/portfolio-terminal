import { describe, expect, it } from "vitest";
import { canAccessPortfolioView, getAccountPermissions } from "./accountPermissions";

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

describe("canAccessPortfolioView", () => {
  it("allows admins to open every desk", () => {
    expect(canAccessPortfolioView("admin", "COMBINED")).toBe(true);
    expect(canAccessPortfolioView("admin", "CLOSED_HISTORY")).toBe(true);
  });

  it("keeps guest and unknown sessions on the read-only views", () => {
    for (const role of ["guest", null, undefined] as const) {
      expect(canAccessPortfolioView(role, "BALANCE")).toBe(true);
      expect(canAccessPortfolioView(role, "CASH_CUSHION")).toBe(true);
      expect(canAccessPortfolioView(role, "SETTINGS")).toBe(true);
      expect(canAccessPortfolioView(role, "COMBINED")).toBe(false);
      expect(canAccessPortfolioView(role, "CLOSED_HISTORY")).toBe(false);
    }
  });
});
