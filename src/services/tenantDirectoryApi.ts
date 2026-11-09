import { getGatewaySecret } from './storage';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchAndConsumeWithTimeout } from './requestTimeout';

const TENANT_DIRECTORY_API_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';

interface TenantDirectoryMembership {
  userId: string;
  role: 'owner' | 'manager' | 'investor' | 'guest';
  status: 'active' | 'revoked';
  membershipVersion: number;
  createdAt: string;
  portfolioIds: string[];
}

export interface TenantDirectoryTenantView {
  tenant: { id: string; name: string; status: 'active' | 'suspended'; createdAt: string };
  membership: {
    role: 'owner' | 'manager' | 'investor' | 'guest';
    status: 'active';
    membershipVersion: number;
    capabilities: string[];
  };
  workspaces: Array<{ id: string; name: string; status: string }>;
  portfolios: Array<{
    id: string;
    workspaceId: string;
    name: string;
    status: string;
    access: 'owner' | 'portfolio' | 'projection';
    capabilities: string[];
  }>;
  /** Returned only to active owners; never returned to guests or investors. */
  memberships?: TenantDirectoryMembership[];
}

export interface TenantDirectoryResponse {
  version: 1;
  revision: number;
  mode: 'directory-metadata-only';
  financialDataEnabled: false;
  tenants: TenantDirectoryTenantView[];
}

export interface TenantDirectoryGrantedMembership {
  userId: string;
  role: 'manager' | 'investor' | 'guest';
  status: 'active';
  membershipVersion: number;
  capabilities: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the runtime response before a typed value reaches the Settings UI. */
function isNonEmptyString(value: unknown, maximumLength = 160): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength;
}

function isTimestampString(value: unknown): value is string {
  return isNonEmptyString(value, 64) && Number.isFinite(Date.parse(value));
}

function isStringList(value: unknown, maximumItems = 100): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems &&
    value.every((item) => isNonEmptyString(item, 100));
}

function isTenantRole(value: unknown): value is TenantDirectoryMembership['role'] {
  return ['owner', 'manager', 'investor', 'guest'].includes(String(value));
}

/** Validate the complete runtime contract before data reaches the Settings UI. */
function isTenantDirectoryResponse(value: unknown): value is TenantDirectoryResponse {
  if (!isRecord(value) || value.version !== 1 ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
      value.mode !== 'directory-metadata-only' || value.financialDataEnabled !== false ||
      !Array.isArray(value.tenants) || value.tenants.length > 100) return false;

  return value.tenants.every((item) => {
    if (!isRecord(item) || !isRecord(item.tenant) || !isRecord(item.membership) ||
        !Array.isArray(item.workspaces) || item.workspaces.length > 250 ||
        !Array.isArray(item.portfolios) || item.portfolios.length > 1000) return false;

    if (!isNonEmptyString(item.tenant.id, 80) ||
        !isNonEmptyString(item.tenant.name, 80) ||
        !isTimestampString(item.tenant.createdAt) ||
        !['active', 'suspended'].includes(String(item.tenant.status))) return false;

    if (!isTenantRole(item.membership.role) ||
        item.membership.status !== 'active' ||
        !Number.isSafeInteger(item.membership.membershipVersion) ||
        (item.membership.membershipVersion as number) < 1 ||
        !isStringList(item.membership.capabilities, 64)) return false;

    if (!item.workspaces.every((workspace) => isRecord(workspace) &&
        isNonEmptyString(workspace.id, 80) &&
        isNonEmptyString(workspace.name, 80) &&
        isNonEmptyString(workspace.status, 32))) return false;

    if (!item.portfolios.every((portfolio) => isRecord(portfolio) &&
        isNonEmptyString(portfolio.id, 80) &&
        isNonEmptyString(portfolio.workspaceId, 80) &&
        isNonEmptyString(portfolio.name, 80) &&
        isNonEmptyString(portfolio.status, 32) &&
        ['owner', 'portfolio', 'projection'].includes(String(portfolio.access)) &&
        isStringList(portfolio.capabilities, 64))) return false;

    if (item.memberships !== undefined && !Array.isArray(item.memberships)) return false;
    return item.memberships === undefined || (item.memberships.length <= 5000 &&
      item.memberships.every((member) =>
        isRecord(member) &&
        isNonEmptyString(member.userId, 128) &&
        isTenantRole(member.role) &&
        ['active', 'revoked'].includes(String(member.status)) &&
        Number.isSafeInteger(member.membershipVersion) &&
        (member.membershipVersion as number) >= 1 &&
        isTimestampString(member.createdAt) &&
        isStringList(member.portfolioIds, 1000)
      ));
  });
}


function getTenantDirectorySessionToken(): string {
  const token = getGatewaySecret().trim();
  if (!token) throw new Error('A signed-in account is required to access portfolio ownership.');
  return token;
}

/** Requests use the current account session; tenant IDs are resource identifiers, never credentials. */
async function tenantDirectoryRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = getTenantDirectorySessionToken();
  return fetchAndConsumeWithTimeout(
    fetch,
    new URL(path, TENANT_DIRECTORY_API_URL),
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': token,
        Authorization: `Bearer ${token}`
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store'
    },
    async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `Tenant directory request failed (HTTP ${response.status}).`);
      }
      return payload as T;
    },
    DEFAULT_REQUEST_TIMEOUT_MS
  );
}

export async function getTenantDirectory(): Promise<TenantDirectoryResponse> {
  const payload = await tenantDirectoryRequest<unknown>('/api/tenants');
  if (!isTenantDirectoryResponse(payload)) {
    throw new Error('The tenant directory response is malformed or incomplete.');
  }
  return payload;
}

export function createTenantDirectory(input: {
  name: string;
  workspaceName?: string;
  portfolioName?: string;
}): Promise<{
  success: true;
  revision: number;
  financialDataEnabled: false;
  tenant: { id: string; name: string; status: string };
  workspace: { id: string; tenantId: string; name: string };
  portfolio: { id: string; tenantId: string; workspaceId: string; name: string };
}> {
  return tenantDirectoryRequest('/api/tenants', input);
}

export function grantTenantMembership(input: {
  tenantId: string;
  userId: string;
  role: 'manager' | 'investor' | 'guest';
  portfolioIds: string[];
}): Promise<{ success: true; revision: number; membership: TenantDirectoryGrantedMembership }> {
  return tenantDirectoryRequest(
    `/api/tenants/${encodeURIComponent(input.tenantId)}/memberships`,
    { userId: input.userId, role: input.role, portfolioIds: input.portfolioIds }
  );
}

export function revokeTenantMembership(input: {
  tenantId: string;
  userId: string;
}): Promise<{ success: true; revision: number; membershipVersion: number }> {
  return tenantDirectoryRequest(
    `/api/tenants/${encodeURIComponent(input.tenantId)}/memberships/revoke`,
    { userId: input.userId }
  );
}
