import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import worker from "./worker.js";
import { PortfolioStateDO } from "./state-store.js";

class MemoryDurableStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { return this.values.delete(key); }
  async list({ prefix = "" } = {}) {
    return new Map([...this.values.entries()].filter(([key]) => key.startsWith(prefix)));
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
  }, undefined, { "X-Bootstrap-Authorized": "true" });
  expect(response.status).toBe(201);
  return response.json();
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
    }, undefined, { "X-Bootstrap-Authorized": "true" });
    expect(duplicate.status).toBe(409);
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

  it("invalidates expired sessions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, storage } = createStore();
    const session = await bootstrap(store);
    const sessionKey = [...storage.values.keys()].find(key => key.startsWith("auth:session:"));
    await storage.put(sessionKey, { userId: session.user.id, expiresAt: Date.now() - 1000 });
    const verify = await request(store, "/api/auth/verify", {}, session.token);
    expect(verify.status).toBe(401);
  });
});

describe("Worker session endpoints", () => {
  it("serves the existing shared encryption key to valid account sessions only", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const authStub = {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        user: { id: "admin-id", name: "Admin", role: "admin" }
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
    };
    const response = await worker.fetch(new Request("https://worker.test/api/auth/cloud-key", {
      headers: { Authorization: "Bearer valid-session" }
    }), {
      GATEWAY_SECRET: "legacy-shared-cloud-key",
      PORTFOLIO_STATE_DO: { idFromName: () => "portfolio_state", get: () => authStub }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: "legacy-shared-cloud-key" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    authStub.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    const denied = await worker.fetch(new Request("https://worker.test/api/auth/cloud-key", {
      headers: { Authorization: "Bearer expired-session" }
    }), {
      GATEWAY_SECRET: "legacy-shared-cloud-key",
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
