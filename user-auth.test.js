import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import worker from "./worker.js";
import { PortfolioStateDO } from "./state-store.js";

class MemoryDurableStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { return this.values.delete(key); }
  async list({ prefix = "", limit = Number.POSITIVE_INFINITY, startAfter } = {}) {
    return new Map([...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && (typeof startAfter !== "string" || key > startAfter))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .slice(0, limit));
  }
  async transaction(callback) {
    return callback({
      get: async (key) => this.values.get(key),
      put: async (key, value) => { this.values.set(key, value); },
      delete: async (key) => { this.values.delete(key); }
    });
  }
}

function createStore() {
  const storage = new MemoryDurableStorage();
  return { store: new PortfolioStateDO({ storage }, {}), storage };
}

function request(store, path, body, token, headers = {}) {
  const requestHeaders = { "Content-Type": "application/json", ...headers };
  if (token) requestHeaders.Authorization = "Bearer " + token;
  return store.fetch(new Request("https://durable.test" + path, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body)
  }));
}

async function bootstrap(store) {
  const response = await request(store, "/api/auth/bootstrap", {
    name: "Primary Admin",
    password: "a-long-password-123"
  }, undefined, {
    "X-Bootstrap-Authorized": "true",
    "X-Workspace-Encryption-Key": "legacy-shared-cloud-key"
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function sessionStorageKey(token) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return "auth:session:" + hex;
}

describe("Durable Object account authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates one initial admin account and persists only a salted password hash", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const session = await bootstrap(store);
    expect(session.user).toMatchObject({ name: "Primary Admin", role: "admin" });
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
    const users = await storage.get("auth:users");
    expect(users[0]).not.toHaveProperty("password");
    expect(users[0].salt).toMatch(/^[a-f0-9]{32}$/);
    expect(users[0].passwordHash).toMatch(/^[a-f0-9]{64}$/);

    const duplicate = await request(store, "/api/auth/bootstrap", {
      name: "Second Admin",
      password: "another-long-password-123"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "legacy-shared-cloud-key"
    });
    expect(duplicate.status).toBe(409);
  });


  it("returns the stable shared encryption key only to an active account session", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const session = await bootstrap(store);
    expect(await storage.get("auth:cloud-encryption-key")).toBe("legacy-shared-cloud-key");

    const result = await store.fetch(new Request("https://durable.test/api/auth/cloud-key", {
      headers: { Authorization: "Bearer " + session.token }
    }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ key: "legacy-shared-cloud-key" });

    const denied = await store.fetch(new Request("https://durable.test/api/auth/cloud-key"));
    expect(denied.status).toBe(401);
  });

  it("shares the bounded login throttle across different usernames from the same IP", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    await bootstrap(store);
    const ipAddress = "198.51.100.24";
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(ipAddress));
    const ipHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    await storage.put("auth:login-rate-limit:v1", {
      version: 1,
      buckets: {
        [ipHash]: { count: 9, expiresAt: Date.now() + 15 * 60 * 1000, lastAttemptAt: Date.now() }
      }
    });

    const wrongName = await request(store, "/api/auth/login", {
      name: "random-user-1",
      password: "incorrect-password"
    }, undefined, { "CF-Connecting-IP": ipAddress });
    expect(wrongName.status).toBe(401);

    const validNameSameIp = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    }, undefined, { "CF-Connecting-IP": ipAddress });
    expect(validNameSameIp.status).toBe(429);
    expect(validNameSameIp.headers.get("Retry-After")).toBeTruthy();

    const stored = await storage.get("auth:login-rate-limit:v1");
    expect(Object.keys(stored.buckets)).toEqual([ipHash]);
    expect([...storage.values.keys()].filter((key) => key.startsWith("auth:login-failure:"))).toHaveLength(0);
  });

  it("rejects new IP buckets when the fixed login-throttle capacity is full", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const buckets = {};
    for (let index = 0; index < 1024; index++) {
      buckets["ip-" + index] = {
        count: 1,
        expiresAt: Date.now() + 15 * 60 * 1000,
        lastAttemptAt: Date.now() - index
      };
    }
    await storage.put("auth:login-rate-limit:v1", { version: 1, buckets });

    const response = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    }, undefined, { "CF-Connecting-IP": "203.0.113.250" });
    expect(response.status).toBe(429);
    expect(Object.keys((await storage.get("auth:login-rate-limit:v1")).buckets)).toHaveLength(1024);
  });

  it("cleans old unbounded username/IP lockout keys in bounded batches", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    await bootstrap(store);
    await storage.put("auth:login-failure:old-1", { count: 10, expiresAt: Date.now() - 1 });
    await storage.put("auth:login-failure:old-2", { count: 2, expiresAt: Date.now() - 1 });

    const login = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    }, undefined, { "CF-Connecting-IP": "192.0.2.10" });
    expect(login.status).toBe(200);
    expect(await storage.get("auth:login-failure:old-1")).toBeUndefined();
    expect(await storage.get("auth:login-failure:old-2")).toBeUndefined();
    expect(await storage.get("migration:login-failure-records-cleaned-v1")).toBe(true);
    expect(await storage.get("auth:login-rate-limit:v1")).toBeUndefined();
  });

  it("rejects malformed account names and passwords before PBKDF2 verification", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    await bootstrap(store);
    const shortName = await request(store, "/api/auth/login", { name: "x", password: "wrong-password" });
    expect(shortName.status).toBe(400);
    const shortPassword = await request(store, "/api/auth/login", { name: "Primary Admin", password: "12345" });
    expect(shortPassword.status).toBe(400);
  });

  it("creates guest users by default and blocks guest account administration", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123"
    }, admin.token);
    expect(created.status).toBe(201);
    expect((await created.json()).user.role).toBe("guest");

    const login = await request(store, "/api/auth/login", {
      name: "viewer",
      password: "another-long-password-123"
    });
    expect(login.status).toBe(200);
    const guest = await login.json();
    const denied = await request(store, "/api/auth/users", {
      action: "create",
      name: "Not Allowed",
      password: "another-long-password-123",
      role: "admin"
    }, guest.token);
    expect(denied.status).toBe(403);
  });

  it("rejects incorrect passwords and does not allow the final admin to be demoted", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    const wrongPassword = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "incorrect-password"
    });
    expect(wrongPassword.status).toBe(401);

    const demote = await request(store, "/api/auth/users", {
      action: "update",
      id: admin.user.id,
      name: admin.user.name,
      role: "guest"
    }, admin.token);
    expect(demote.status).toBe(409);
  });

  it("issues administrator sessions with a finite 30-day absolute expiry", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const before = Date.now();
    const session = await bootstrap(store);
    const sessionKey = await sessionStorageKey(session.token);
    const stored = await storage.get(sessionKey);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    expect(session.expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDays);
    expect(stored).toMatchObject({
      userId: session.user.id,
      issuedAt: expect.any(Number),
      expiresAt: session.expiresAt,
      sessionVersion: 1
    });
    expect(session.expiresAt - stored.issuedAt).toBe(thirtyDays);

    const verify = await request(store, "/api/auth/verify", {}, session.token);
    expect(verify.status).toBe(200);
  });

  it("migrates legacy administrator expiry from issuedAt and rejects sessions without a trustworthy issue time", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const admin = await bootstrap(store);
    const sessionKey = await sessionStorageKey(admin.token);
    const issuedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const legacy = await storage.get(sessionKey);
    await storage.put(sessionKey, { ...legacy, issuedAt, expiresAt: null });

    const migrated = await request(store, "/api/auth/verify", {}, admin.token);
    expect(migrated.status).toBe(200);
    expect(await storage.get(sessionKey)).toMatchObject({
      issuedAt,
      expiresAt: issuedAt + 30 * 24 * 60 * 60 * 1000,
      sessionVersion: 1
    });

    const secondLogin = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    });
    expect(secondLogin.status).toBe(200);
    const secondSession = await secondLogin.json();
    const secondKey = await sessionStorageKey(secondSession.token);
    const secondStored = await storage.get(secondKey);
    const { issuedAt: _discardedIssueTime, ...withoutIssueTime } = secondStored;
    await storage.put(secondKey, withoutIssueTime);

    const rejected = await request(store, "/api/auth/verify", {}, secondSession.token);
    expect(rejected.status).toBe(401);
    expect(await storage.get(secondKey)).toBeUndefined();
  });

  it("rejects administrator sessions after 30 days even when their stored expiry is null", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const admin = await bootstrap(store);
    const sessionKey = await sessionStorageKey(admin.token);
    const stored = await storage.get(sessionKey);
    const issuedAt = Date.now() - 30 * 24 * 60 * 60 * 1000 - 1;
    await storage.put(sessionKey, { ...stored, issuedAt, expiresAt: null });

    const verify = await request(store, "/api/auth/verify", {}, admin.token);
    expect(verify.status).toBe(401);
    expect(await storage.get(sessionKey)).toBeUndefined();
  });

  it("keeps at most five active sessions per user and evicts the oldest session", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const first = await bootstrap(store);
    const sessions = [first];

    for (let index = 0; index < 5; index += 1) {
      const login = await request(store, "/api/auth/login", {
        name: "Primary Admin",
        password: "a-long-password-123"
      });
      expect(login.status).toBe(200);
      sessions.push(await login.json());
    }

    const indexRecord = await storage.get("auth:user-sessions:" + first.user.id);
    expect(indexRecord.sessions).toHaveLength(5);
    expect(indexRecord.sessions.map((entry) => entry.key)).not.toContain(await sessionStorageKey(first.token));

    const oldest = await request(store, "/api/auth/verify", {}, first.token);
    expect(oldest.status).toBe(401);
    for (const session of sessions.slice(1)) {
      const valid = await request(store, "/api/auth/verify", {}, session.token);
      expect(valid.status).toBe(200);
    }
  });

  it("cleans expired and orphaned session records in bounded resumable batches", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    for (let index = 0; index < 205; index += 1) {
      const key = "auth:session:" + String(index).padStart(4, "0");
      await storage.put(key, {
        userId: "deleted-user-" + index,
        issuedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 10 * 24 * 60 * 60 * 1000
      });
    }

    expect(await store.cleanupExpiredSessions({ force: true })).toBe(100);
    expect([...storage.values.keys()].filter((key) => key.startsWith("auth:session:"))).toHaveLength(105);
    expect(await storage.get("maintenance:auth-session-cleanup-cursor:v1")).toBe("auth:session:0099");

    expect(await store.cleanupExpiredSessions({ force: true })).toBe(100);
    expect([...storage.values.keys()].filter((key) => key.startsWith("auth:session:"))).toHaveLength(5);
    expect(await store.cleanupExpiredSessions({ force: true })).toBe(5);
    expect([...storage.values.keys()].filter((key) => key.startsWith("auth:session:"))).toHaveLength(0);
    expect(await storage.get("maintenance:auth-session-cleanup-cursor:v1")).toBeUndefined();
  });

  it("removes a logged-out token from the per-user session index", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const session = await bootstrap(store);
    const sessionKey = await sessionStorageKey(session.token);
    const indexKey = "auth:user-sessions:" + session.user.id;

    const logout = await request(store, "/api/auth/logout", {}, session.token);
    expect(logout.status).toBe(200);
    expect(await storage.get(sessionKey)).toBeUndefined();
    expect((await storage.get(indexKey)).sessions).toHaveLength(0);

    const verify = await request(store, "/api/auth/verify", {}, session.token);
    expect(verify.status).toBe(401);
  });

  it("throttles session cleanup while allowing an explicit bounded cleanup pass", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const listSpy = vi.spyOn(storage, "list");

    expect(await store.cleanupExpiredSessions()).toBe(0);
    expect(await store.cleanupExpiredSessions()).toBe(0);
    expect(listSpy).toHaveBeenCalledTimes(1);

    await store.cleanupExpiredSessions({ force: true });
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(await storage.get("maintenance:auth-session-cleanup-last-run:v1")).toEqual(expect.any(Number));
  });

  it("invalidates legacy unindexed sessions when the account enters the indexed-session generation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const legacy = await bootstrap(store);
    const legacyKey = await sessionStorageKey(legacy.token);
    const stored = await storage.get(legacyKey);
    await storage.delete("auth:user-sessions:" + legacy.user.id);
    await storage.put(legacyKey, {
      ...stored,
      sessionVersion: 0,
      expiresAt: null
    });

    const beforeLogin = await request(store, "/api/auth/verify", {}, legacy.token);
    expect(beforeLogin.status).toBe(200);
    expect(Number.isFinite((await storage.get(legacyKey)).expiresAt)).toBe(true);

    const newLogin = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    });
    expect(newLogin.status).toBe(200);
    const migratedSession = await newLogin.json();

    const oldToken = await request(store, "/api/auth/verify", {}, legacy.token);
    expect(oldToken.status).toBe(401);
    const newToken = await request(store, "/api/auth/verify", {}, migratedSession.token);
    expect(newToken.status).toBe(200);
  });

  it("keeps the current session after password change and revokes other sessions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const current = await bootstrap(store);
    const otherLogin = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    });
    const other = await otherLogin.json();

    const changed = await request(store, "/api/auth/users", {
      action: "update",
      id: current.user.id,
      password: "new-strong-password-456"
    }, current.token);
    expect(changed.status).toBe(200);

    const currentStillValid = await request(store, "/api/auth/verify", {}, current.token);
    const otherRevoked = await request(store, "/api/auth/verify", {}, other.token);
    expect(currentStillValid.status).toBe(200);
    expect(otherRevoked.status).toBe(401);

    const oldPassword = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    });
    const newPassword = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "new-strong-password-456"
    });
    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  });

  it("revokes all target-user sessions when an administrator changes their role", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const administrator = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Second Admin",
      password: "another-long-password-123",
      role: "admin"
    }, administrator.token);
    expect(created.status).toBe(201);
    const secondUser = (await created.json()).user;
    const secondLogin = await request(store, "/api/auth/login", {
      name: "Second Admin",
      password: "another-long-password-123"
    });
    const secondSession = await secondLogin.json();

    const changed = await request(store, "/api/auth/users", {
      action: "update",
      id: secondUser.id,
      role: "guest"
    }, administrator.token);
    expect(changed.status).toBe(200);

    const revoked = await request(store, "/api/auth/verify", {}, secondSession.token);
    expect(revoked.status).toBe(401);
  });

  it("issues guest sessions for 30 days and upgrades legacy guest sessions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123"
    }, admin.token);
    expect(created.status).toBe(201);
    const guestUser = (await created.json()).user;

    const login = await request(store, "/api/auth/login", {
      name: "Viewer",
      password: "another-long-password-123"
    });
    expect(login.status).toBe(200);
    const guestSession = await login.json();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(guestSession.expiresAt - Date.now()).toBeGreaterThan(thirtyDays - 5000);
    expect(guestSession.expiresAt - Date.now()).toBeLessThanOrEqual(thirtyDays);

    // Legacy sessions only stored expiresAt = issuedAt + seven days.
    // They receive a full 30-day lifetime measured from their original issue time.
    const sessionKey = await sessionStorageKey(guestSession.token);
    const issuedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const issuedSession = await storage.get(sessionKey);
    await storage.put(sessionKey, {
      ...issuedSession,
      expiresAt: issuedAt + 7 * 24 * 60 * 60 * 1000,
      issuedAt: undefined
    });
    const verify = await request(store, "/api/auth/verify", {}, guestSession.token);
    expect(verify.status).toBe(200);
    expect(await storage.get(sessionKey)).toEqual({
      ...issuedSession,
      issuedAt,
      expiresAt: issuedAt + thirtyDays,
      sessionVersion: 1
    });
  });

  it("rejects guest sessions more than 30 days after issuance", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123"
    }, admin.token);
    const guestUser = (await created.json()).user;
    const login = await request(store, "/api/auth/login", {
      name: "Viewer",
      password: "another-long-password-123"
    });
    const guestSession = await login.json();
    const sessionKey = await sessionStorageKey(guestSession.token);
    const issuedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const issuedSession = await storage.get(sessionKey);
    await storage.put(sessionKey, {
      ...issuedSession,
      issuedAt,
      expiresAt: issuedAt + 30 * 24 * 60 * 60 * 1000
    });

    const verify = await request(store, "/api/auth/verify", {}, guestSession.token);
    expect(verify.status).toBe(401);
    expect(await storage.get(sessionKey)).toBeUndefined();
  });
});

describe("Worker session endpoints", () => {

  it("validates the bootstrap secret and forwards it only as an internal workspace key", async () => {
    const forwarded = [];
    const doStub = {
      fetch: vi.fn(async (request) => {
        forwarded.push(request);
        return new Response(JSON.stringify({ token: "admin-session" }), { status: 201 });
      })
    };
    const response = await worker.fetch(new Request("https://worker.test/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First Admin",
        password: "a-long-password-123",
        bootstrapSecret: "expected-gateway-secret"
      })
    }), {
      GATEWAY_SECRET: "expected-gateway-secret",
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => doStub }
    });
    expect(response.status).toBe(201);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].headers.get("X-Bootstrap-Authorized")).toBe("true");
    expect(forwarded[0].headers.get("X-Workspace-Encryption-Key")).toBe("expected-gateway-secret");
    expect(await forwarded[0].json()).toEqual({
      name: "First Admin",
      password: "a-long-password-123"
    });
  });

  it("serves the existing shared encryption key to valid account sessions only", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const authStub = {
      fetch: vi.fn(async (request) => {
        if (new URL(request.url).pathname === "/api/auth/cloud-key") {
          const token = request.headers.get("Authorization");
          return token === "Bearer valid-session"
            ? new Response(JSON.stringify({ key: "legacy-shared-cloud-key" }), { status: 200, headers: { "Content-Type": "application/json" } })
            : new Response(JSON.stringify({ error: "expired" }), { status: 401 });
        }
        return new Response(JSON.stringify({ user: { id: "admin-id", name: "Admin", role: "admin" } }), { status: 200 });
      })
    };
    const response = await worker.fetch(new Request("https://worker.test/api/auth/cloud-key", {
      headers: { Authorization: "Bearer valid-session" }
    }), {
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => authStub }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: "legacy-shared-cloud-key" });

    const denied = await worker.fetch(new Request("https://worker.test/api/auth/cloud-key", {
      headers: { Authorization: "Bearer expired-session" }
    }), {
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => authStub }
    });
    expect(denied.status).toBe(401);
  });

  it("bounds streamed authentication request bodies before buffering them", async () => {
    let chunksSent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (chunksSent === 5) {
          controller.close();
          return;
        }
        chunksSent += 1;
        controller.enqueue(new Uint8Array(4096));
      }
    });
    const request = new Request("https://worker.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half"
    });
    const response = await worker.fetch(request, {
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => ({ fetch: vi.fn() }) }
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Authentication request exceeds the 8 KB limit." });
  });
});

describe("Worker role enforcement", () => {
  it("blocks guest write requests before invoking protected actions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const doStub = {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        user: { id: "guest-id", name: "Guest", role: "guest" }
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
    };
    const response = await worker.fetch(new Request("https://worker.test/?action=gemini", {
      method: "POST",
      headers: { Authorization: "Bearer guest-session", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "should never reach the provider" })
    }), {
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => doStub }
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Guest accounts have read-only access." });
    expect(doStub.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("six-character account password minimum", () => {
  it("accepts a six-character password for initial admin bootstrap and login", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const bootstrapResponse = await request(store, "/api/auth/bootstrap", {
      name: "Primary Admin",
      password: "secret"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(bootstrapResponse.status).toBe(201);

    const login = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "secret"
    });
    expect(login.status).toBe(200);
  });

  it("rejects passwords shorter than six characters at bootstrap and user creation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const shortBootstrap = await request(store, "/api/auth/bootstrap", {
      name: "Primary Admin",
      password: "12345"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(shortBootstrap.status).toBe(400);

    const admin = await bootstrap(store);
    const shortUser = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "12345"
    }, admin.token);
    expect(shortUser.status).toBe(400);
  });

  it("accepts six-character new-user and password-reset values", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "guest6!"
    }, admin.token);
    expect(created.status).toBe(201);
    const user = (await created.json()).user;

    const reset = await request(store, "/api/auth/users", {
      action: "update",
      id: user.id,
      password: "reset6!"
    }, admin.token);
    expect(reset.status).toBe(200);
  });
});

describe("six-character account password minimum", () => {
  it("accepts a six-character password for initial admin bootstrap and login", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const bootstrapResponse = await request(store, "/api/auth/bootstrap", {
      name: "Primary Admin",
      password: "secret"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(bootstrapResponse.status).toBe(201);
    const login = await request(store, "/api/auth/login", {
      name: "Primary Admin", password: "secret"
    });
    expect(login.status).toBe(200);
  });

  it("rejects passwords shorter than six characters at bootstrap and user creation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const shortBootstrap = await request(store, "/api/auth/bootstrap", {
      name: "Primary Admin", password: "12345"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(shortBootstrap.status).toBe(400);
    const admin = await bootstrap(store);
    const shortUser = await request(store, "/api/auth/users", {
      action: "create", name: "Viewer", password: "12345"
    }, admin.token);
    expect(shortUser.status).toBe(400);
  });

  it("accepts six-character new-user and password-reset values", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create", name: "Viewer", password: "guest6!"
    }, admin.token);
    expect(created.status).toBe(201);
    const user = (await created.json()).user;
    const reset = await request(store, "/api/auth/users", {
      action: "update", id: user.id, password: "reset6!"
    }, admin.token);
    expect(reset.status).toBe(200);
  });
});


describe("Cloudflare PBKDF2 iteration compatibility", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps every PBKDF2 operation at or below the Worker iteration limit", async () => {
    const deriveIterations = [];
    vi.stubGlobal("crypto", {
      subtle: {
        importKey: (...args) => webcrypto.subtle.importKey(...args),
        digest: (...args) => webcrypto.subtle.digest(...args),
        deriveBits: (algorithm, key, length) => {
          deriveIterations.push(algorithm.iterations);
          return webcrypto.subtle.deriveBits(algorithm, key, length);
        }
      },
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: webcrypto.randomUUID.bind(webcrypto)
    });

    const { store } = createStore();
    await bootstrap(store);
    const login = await request(store, "/api/auth/login", {
      name: "Primary Admin",
      password: "a-long-password-123"
    });
    expect(login.status).toBe(200);
    expect(deriveIterations).toEqual(Array(12).fill(100_000));
  });
});


describe("account language preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults new accounts to English and lets each user change their own language", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    expect(admin.user.language).toBe("en");

    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123"
    }, admin.token);
    expect(created.status).toBe(201);
    const createdUser = (await created.json()).user;
    expect(createdUser.language).toBe("en");

    const login = await request(store, "/api/auth/login", {
      name: "Viewer",
      password: "another-long-password-123"
    });
    const guest = await login.json();

    const changed = await request(store, "/api/auth/me", { language: "ru" }, guest.token);
    expect(changed.status).toBe(200);
    expect((await changed.json()).user).toMatchObject({ id: createdUser.id, language: "ru" });

    const current = await store.fetch(new Request("https://durable.test/api/auth/me", {
      headers: { Authorization: "Bearer " + guest.token }
    }));
    expect((await current.json()).user.language).toBe("ru");

    const invalid = await request(store, "/api/auth/me", { language: "fr" }, guest.token);
    expect(invalid.status).toBe(400);
  });

  it("lets administrators set another account's language and keeps legacy accounts in English", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const admin = await bootstrap(store);
    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123",
      language: "ru"
    }, admin.token);
    const createdPayload = await created.json();
    expect(createdPayload.user.language).toBe("ru");
    const user = createdPayload.user;

    const updated = await request(store, "/api/auth/users", {
      action: "update",
      id: user.id,
      language: "en"
    }, admin.token);
    expect((await updated.json()).user.language).toBe("en");

    const storedUsers = await storage.get("auth:users");
    const legacyUsers = storedUsers.map(({ language, ...legacyUser }) => legacyUser);
    await storage.put("auth:users", legacyUsers);
    const current = await store.fetch(new Request("https://durable.test/api/auth/me", {
      headers: { Authorization: "Bearer " + admin.token }
    }));
    expect((await current.json()).user.language).toBe("en");
  });

  it("rejects unsupported languages when creating or administratively updating accounts", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const admin = await bootstrap(store);
    const invalidCreate = await request(store, "/api/auth/users", {
      action: "create",
      name: "Bad Language",
      password: "another-long-password-123",
      language: "fr"
    }, admin.token);
    expect(invalidCreate.status).toBe(400);

    const created = await request(store, "/api/auth/users", {
      action: "create",
      name: "Viewer",
      password: "another-long-password-123"
    }, admin.token);
    const user = (await created.json()).user;
    const invalidUpdate = await request(store, "/api/auth/users", {
      action: "update",
      id: user.id,
      language: "fr"
    }, admin.token);
    expect(invalidUpdate.status).toBe(400);
  });
});
