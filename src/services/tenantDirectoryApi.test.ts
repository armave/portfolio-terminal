import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTenantDirectory,
  getTenantDirectory,
  grantTenantMembership,
  revokeTenantMembership
} from './tenantDirectoryApi';
import * as storage from './storage';

beforeEach(() => {
  storage.setGatewaySecret('test-gateway-secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.setGatewaySecret('');
});

describe('tenant directory authenticated transport', () => {
  const directoryResponse = {
    version: 1 as const,
    revision: 1,
    mode: 'directory-metadata-only' as const,
    financialDataEnabled: false as const,
    tenants: []
  };

  it('sends the active session token on tenant directory reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(directoryResponse), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTenantDirectory()).resolves.toEqual(directoryResponse);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    expect(new URL(String(requestUrl)).pathname).toBe('/api/tenants');
    const headers = new Headers(requestInit.headers);
    expect(headers.get('X-App-Auth')).toBe('test-gateway-secret');
    expect(headers.get('Authorization')).toBe('Bearer test-gateway-secret');
    expect(requestInit.cache).toBe('no-store');
  });

  it('authenticates tenant creation and membership grant/revocation requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, financialDataEnabled: false }), {
        status: 201, headers: { 'Content-Type': 'application/json' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, membership: { userId: 'guest-1' } }), {
        status: 201, headers: { 'Content-Type': 'application/json' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, membershipVersion: 2 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    await createTenantDirectory({ name: 'Family Investments', workspaceName: 'Family', portfolioName: 'Core' });
    await grantTenantMembership({
      tenantId: 'tenant-123',
      userId: 'guest-1',
      role: 'guest',
      portfolioIds: ['portfolio-456']
    });
    await revokeTenantMembership({ tenantId: 'tenant-123', userId: 'guest-1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const expectedPaths = [
      '/api/tenants',
      '/api/tenants/tenant-123/memberships',
      '/api/tenants/tenant-123/memberships/revoke'
    ];
    fetchMock.mock.calls.forEach((call, index) => {
      const [requestUrl, requestInit] = call as [string | URL, RequestInit];
      expect(new URL(String(requestUrl)).pathname).toBe(expectedPaths[index]);
      expect(requestInit.method).toBe('POST');
      const headers = new Headers(requestInit.headers);
      expect(headers.get('X-App-Auth')).toBe('test-gateway-secret');
      expect(headers.get('Authorization')).toBe('Bearer test-gateway-secret');
      expect(headers.get('Content-Type')).toContain('application/json');
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      name: 'Family Investments', workspaceName: 'Family', portfolioName: 'Core'
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      userId: 'guest-1', role: 'guest', portfolioIds: ['portfolio-456']
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ userId: 'guest-1' });
  });

  it('does not issue tenant directory requests without a stored session credential', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    storage.setGatewaySecret('');

    await expect(getTenantDirectory()).rejects.toThrow('A signed-in account is required');
    await expect(createTenantDirectory({ name: 'Unauthorized' })).rejects.toThrow('A signed-in account is required');
    await expect(grantTenantMembership({
      tenantId: 'tenant-123', userId: 'guest-1', role: 'guest', portfolioIds: ['portfolio-456']
    })).rejects.toThrow('A signed-in account is required');
    await expect(revokeTenantMembership({ tenantId: 'tenant-123', userId: 'guest-1' }))
      .rejects.toThrow('A signed-in account is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly for a server-side authorization denial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Tenant not found or membership management is not permitted.'
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(grantTenantMembership({
      tenantId: 'tenant-123', userId: 'guest-1', role: 'guest', portfolioIds: ['portfolio-456']
    })).rejects.toThrow('Tenant not found or membership management is not permitted.');
  });
  it('rejects malformed nested tenant permission and membership metadata before rendering', async () => {
    const validPayload = {
      version: 1,
      revision: 2,
      mode: 'directory-metadata-only',
      financialDataEnabled: false,
      tenants: [{
        tenant: {
          id: 'tenant-12345678',
          name: 'Family',
          status: 'active',
          createdAt: '2026-11-09T00:00:00.000Z'
        },
        membership: {
          role: 'owner',
          status: 'active',
          membershipVersion: 1,
          capabilities: ['tenant.read', 'tenant.members.manage']
        },
        workspaces: [{ id: 'workspace-12345678', name: 'Family', status: 'active' }],
        portfolios: [{
          id: 'portfolio-12345678',
          workspaceId: 'workspace-12345678',
          name: 'Core',
          status: 'active',
          access: 'owner',
          capabilities: ['portfolio.read']
        }],
        memberships: [{
          userId: 'owner-1',
          role: 'owner',
          status: 'active',
          membershipVersion: 1,
          createdAt: '2026-11-09T00:00:00.000Z',
          portfolioIds: ['portfolio-12345678']
        }]
      }]
    };
    const malformedPayloads: unknown[] = [];

    const invalidVersion = structuredClone(validPayload);
    invalidVersion.tenants[0].membership.membershipVersion = '1';
    malformedPayloads.push(invalidVersion);

    const invalidCapabilities = structuredClone(validPayload);
    invalidCapabilities.tenants[0].portfolios[0].capabilities = ['portfolio.read', 7];
    malformedPayloads.push(invalidCapabilities);

    const invalidRoster = structuredClone(validPayload);
    invalidRoster.tenants[0].memberships[0].portfolioIds = [42];
    malformedPayloads.push(invalidRoster);

    const invalidTimestamp = structuredClone(validPayload);
    invalidTimestamp.tenants[0].tenant.createdAt = 'not-a-date';
    malformedPayloads.push(invalidTimestamp);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const payload of malformedPayloads) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }));
      await expect(getTenantDirectory()).rejects.toThrow(
        'The tenant directory response is malformed or incomplete.'
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(malformedPayloads.length);
  });

  it('rejects malformed directory payloads before they reach the Settings view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: 1,
      revision: 1,
      mode: 'directory-metadata-only',
      financialDataEnabled: false,
      tenants: [{ tenant: { id: 'tenant-1', name: 'Broken', status: 'active' }, portfolios: [] }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTenantDirectory()).rejects.toThrow(
      'The tenant directory response is malformed or incomplete.'
    );
  });

});
