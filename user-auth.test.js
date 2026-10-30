import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
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

function post(store, path, body, token, headers = {}) {
  const requestHeaders = { "Content-Type": "application/json", ...headers };
  if (token) requestHeaders.Authorization = "Bearer " + token;
  return store.fetch(new Request("https://durable.test" + path, {
    method: "POST", headers: requestHeaders, body: JSON.stringify(body)
  }));
}

describe("six-character account password minimum", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a six-character password for initial admin bootstrap and login", async () => {
    const deriveIterations = [];
    vi.stubGlobal("crypto", {
      subtle: {
        importKey: (...args) => webcrypto.subtle.importKey(...args),
        deriveBits: (algorithm, key, length) => {
          deriveIterations.push(algorithm.iterations);
          return webcrypto.subtle.deriveBits(algorithm, key, length);
        }
      },
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: webcrypto.randomUUID.bind(webcrypto)
    });
    const { store } = createStore();
    const bootstrap = await post(store, "/api/auth/bootstrap", {
      name: "Primary Admin", password: "secret"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(bootstrap.status).toBe(201);
    const [createdAdmin] = await store.getAuthUsers();
    expect(createdAdmin.passwordHashVersion).toBe(2);

    const login = await post(store, "/api/auth/login", {
      name: "Primary Admin", password: "secret"
    });
    expect(login.status).toBe(200);
    expect(deriveIterations).toEqual(Array(12).fill(100_000));
  });

  it("rejects passwords shorter than six characters at bootstrap and user creation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const shortBootstrap = await post(store, "/api/auth/bootstrap", {
      name: "Primary Admin", password: "12345"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    expect(shortBootstrap.status).toBe(400);

    const admin = await post(store, "/api/auth/bootstrap", {
      name: "Primary Admin", password: "secret"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    const session = await admin.json();
    const shortUser = await post(store, "/api/auth/users", {
      action: "create", name: "Viewer", password: "12345"
    }, session.token);
    expect(shortUser.status).toBe(400);
  });

  it("accepts six-character new-user and password-reset values", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = createStore();
    const adminResponse = await post(store, "/api/auth/bootstrap", {
      name: "Primary Admin", password: "secret"
    }, undefined, {
      "X-Bootstrap-Authorized": "true",
      "X-Workspace-Encryption-Key": "shared-key"
    });
    const admin = await adminResponse.json();
    const created = await post(store, "/api/auth/users", {
      action: "create", name: "Viewer", password: "guest6!"
    }, admin.token);
    expect(created.status).toBe(201);
    const user = (await created.json()).user;
    const reset = await post(store, "/api/auth/users", {
      action: "update", id: user.id, password: "reset6!"
    }, admin.token);
    expect(reset.status).toBe(200);
  });
});
