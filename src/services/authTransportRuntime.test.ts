import { describe, expect, it, vi } from 'vitest';
import { createAuthTransportRuntime } from './authTransportRuntime';

const admin = {
  id: 'admin-1',
  name: 'Administrator',
  role: 'admin',
  language: 'ru',
  createdAt: '2026-01-01T00:00:00.000Z'
};
const guest = {
  id: 'guest-1',
  name: 'Guest',
  role: 'guest',
  createdAt: '2026-01-02T00:00:00.000Z'
};

function createRuntime(fetchImpl: typeof fetch, token = 'session-token', clearAllRequestCaches = vi.fn()) {
  return {
    runtime: createAuthTransportRuntime({
      apiUrl: 'https://worker.example',
      getActiveGatewaySecret: () => token,
      fetchImpl,
      now: () => 100,
      clearAllRequestCaches
    }),
    clearAllRequestCaches
  };
}

describe('auth transport runtime', () => {
  it('coalesces identical concurrent GETs without retaining completed requests', async () => {
    let resolveFirst!: (response: Response) => void;
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolveFirst = done; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ setupRequired: false, userCount: 1 }), { status: 200 })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    const first = runtime.getAuthStatus();
    const second = runtime.getAuthStatus();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFirst(new Response(JSON.stringify({ setupRequired: false, userCount: 1 }), { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { setupRequired: false, userCount: 1 },
      { setupRequired: false, userCount: 1 }
    ]);
    await runtime.getAuthStatus();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('validates the session through /api/auth/me and reuses its normalized user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: admin }), { status: 200 })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    await expect(runtime.validateGatewaySecret(' session-token ')).resolves.toBe(true);
    await expect(runtime.getCurrentUser()).resolves.toMatchObject({ id: 'admin-1', language: 'ru' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('https://worker.example/api/auth/me');
    expect(options.headers['X-App-Auth']).toBe('session-token');
    expect(options.cache).toBe('no-store');
  });

  it('returns false for invalid sessions and empty tokens without network access', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'expired' }), { status: 401 })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl, '');
    await expect(runtime.validateGatewaySecret('')).resolves.toBe(false);
    await expect(runtime.validateGatewaySecret('expired')).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(runtime.getCurrentUser()).rejects.toThrow('Not signed in.');
  });

  it('normalizes legacy account language and rejects malformed user records', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'login-token', user: guest, expiresAt: 99 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'bootstrap-token', user: { ...admin, role: 'owner' }, expiresAt: 99 }), { status: 200 })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    await expect(runtime.loginAccount('Guest', 'password')).resolves.toMatchObject({
      token: 'login-token', user: { language: 'en', role: 'guest' }
    });
    await expect(runtime.bootstrapAdmin('Admin', 'password', 'bootstrap')).rejects.toThrow('authenticated user response was invalid');
  });

  it('scopes user directory caching by the current token and invalidates on mutation', async () => {
    let directoryVersion = 1;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ user: guest }), { status: 200 });
      }
      return new Response(JSON.stringify({
        users: [{ ...guest, id: `guest-${directoryVersion}`, name: `Guest ${directoryVersion}` }]
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    await expect(runtime.listUsers()).resolves.toMatchObject([{ id: 'guest-1' }]);
    await expect(runtime.listUsers()).resolves.toMatchObject([{ id: 'guest-1' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await runtime.createUser({ name: 'Guest 2', password: 'password', role: 'guest' });
    directoryVersion = 2;
    await expect(runtime.listUsers()).resolves.toMatchObject([{ id: 'guest-2' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not let an invalidated in-flight directory read refill the cache', async () => {
    let resolveStale!: (response: Response) => void;
    let getCount = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ user: guest }), { status: 200 });
      }
      getCount += 1;
      if (getCount === 1) return new Promise<Response>((resolve) => { resolveStale = resolve; });
      return new Response(JSON.stringify({ users: [{ ...guest, id: 'guest-new' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    const stale = runtime.listUsers();
    await runtime.updateUser('guest-1', { name: 'Updated Guest', role: 'guest' });
    resolveStale(new Response(JSON.stringify({ users: [guest] }), { status: 200 }));
    await stale;
    await expect(runtime.listUsers()).resolves.toMatchObject([{ id: 'guest-new' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('clears cached identity and invokes application-wide cache clearing after logout', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: admin }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'session expired' }), { status: 401 })) as unknown as typeof fetch;
    const { runtime, clearAllRequestCaches } = createRuntime(fetchImpl);
    await runtime.validateGatewaySecret('session-token');
    await runtime.logoutAccount();
    expect(clearAllRequestCaches).toHaveBeenCalledTimes(1);
    await expect(runtime.getCurrentUser()).rejects.toThrow('HTTP 401');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('propagates authentication errors while clearing rejected in-flight GET entries', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'denied' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ setupRequired: true, userCount: 0 }), { status: 200 })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);
    await expect(runtime.getAuthStatus()).rejects.toThrow('denied');
    await expect(runtime.getAuthStatus()).resolves.toMatchObject({ setupRequired: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
