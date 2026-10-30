const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Auth, If-Match",
  "Access-Control-Expose-Headers": "ETag"
};

function jsonResponse(body, status = 200, revision = null) {
  const headers = { ...CORS_HEADERS };
  if (revision !== null) headers.ETag = `"${revision}"`;
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Serializes cloud portfolio writes and enforces optimistic concurrency.
 * This application intentionally uses one owner-controlled portfolio shared
 * across the owner's devices; the Worker Gateway Secret is the access boundary.
 * It is not a multi-tenant store. The single named instance is authoritative;
 * KV is only used to migrate the existing portfolio_state value on first access.
 */

const AUTH_USERS_KEY = "auth:users";
const AUTH_SESSION_PREFIX = "auth:session:";
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210_000;
const authEncoder = new TextEncoder();

function authJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}
function normalizeAccountName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function digestHex(value) {
  return toHex(await crypto.subtle.digest("SHA-256", authEncoder.encode(value)));
}
async function derivePasswordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", authEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: authEncoder.encode(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    material, 256
  );
  return toHex(bits);
}
function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function publicUser(user) {
  return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
}
function validAccountInput(name, password) {
  return name.length >= 2 && name.length <= 60 &&
    typeof password === "string" && password.length >= 12 && password.length <= 128;
}

export class PortfolioStateDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async ensureInitialized() {
    const existing = await this.ctx.storage.get("record");
    if (existing) return;

    const legacyPayload = this.env.PORTFOLIO_KV
      ? await this.env.PORTFOLIO_KV.get("portfolio_state")
      : null;

    await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.get("record");
      if (!current && legacyPayload) {
        await txn.put("record", { payload: legacyPayload, revision: 1 });
      }
    });
  }


  async getAuthUsers() {
    const users = await this.ctx.storage.get(AUTH_USERS_KEY);
    return Array.isArray(users) ? users : [];
  }

  async resolveSession(request) {
    const authorization = request.headers.get("Authorization") || "";
    const token = request.headers.get("X-App-Auth") ||
      (authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim());
    if (!token || token.length > 256) return null;
    const sessionKey = AUTH_SESSION_PREFIX + await digestHex(token);
    const session = await this.ctx.storage.get(sessionKey);
    if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      if (session) await this.ctx.storage.delete(sessionKey);
      return null;
    }
    const user = (await this.getAuthUsers()).find((item) => item.id === session.userId);
    if (!user) {
      await this.ctx.storage.delete(sessionKey);
      return null;
    }
    return { user, sessionKey };
  }

  async issueSession(user) {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
    const sessionKey = AUTH_SESSION_PREFIX + await digestHex(token);
    await this.ctx.storage.put(sessionKey, { userId: user.id, expiresAt });
    return { token, user: publicUser(user), expiresAt };
  }

  async revokeUserSessions(userId, exceptSessionKey = "") {
    const sessions = await this.ctx.storage.list({ prefix: AUTH_SESSION_PREFIX });
    for (const [key, session] of sessions.entries()) {
      if (key !== exceptSessionKey && session?.userId === userId) await this.ctx.storage.delete(key);
    }
  }

  async handleAuth(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "GET" && pathname === "/api/auth/status") {
      const users = await this.getAuthUsers();
      return authJson({ setupRequired: users.length === 0, userCount: users.length });
    }

    const body = request.method === "POST" ? await request.json().catch(() => null) : null;
    if (request.method === "POST" && (!body || typeof body !== "object" || Array.isArray(body))) {
      return authJson({ error: "A valid JSON request body is required." }, 400);
    }

    if (request.method === "POST" && pathname === "/api/auth/bootstrap") {
      if (request.headers.get("X-Bootstrap-Authorized") !== "true") return authJson({ error: "Initial setup requires the Gateway Secret." }, 401);
      const name = normalizeAccountName(body.name);
      if (!validAccountInput(name, body.password)) return authJson({ error: "Use a name of 2–60 characters and a password of 12–128 characters." }, 400);
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      const passwordHash = await derivePasswordHash(body.password, salt);
      const user = {
        id: crypto.randomUUID(), name, normalizedName: name.toLocaleLowerCase("en-US"),
        role: "admin", salt, passwordHash, createdAt: new Date().toISOString()
      };
      const created = await this.ctx.storage.transaction(async (txn) => {
        const users = await txn.get(AUTH_USERS_KEY) || [];
        if (users.length) return false;
        await txn.put(AUTH_USERS_KEY, [user]);
        return true;
      });
      if (!created) return authJson({ error: "Initial admin account has already been created." }, 409);
      return authJson(await this.issueSession(user), 201);
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      const name = normalizeAccountName(body.name);
      if (!name || typeof body.password !== "string" || body.password.length > 128) return authJson({ error: "Invalid name or password." }, 400);
      const user = (await this.getAuthUsers()).find((item) => item.normalizedName === name.toLocaleLowerCase("en-US"));
      const salt = user?.salt || "portfolio-terminal-login-validation";
      const expected = user?.passwordHash || await derivePasswordHash("invalid-password", salt);
      const actual = await derivePasswordHash(body.password, salt);
      if (!user || !secureEqual(actual, expected)) return authJson({ error: "Invalid name or password." }, 401);
      return authJson(await this.issueSession(user));
    }

    if (request.method === "POST" && pathname === "/api/auth/verify") {
      const session = await this.resolveSession(request);
      if (!session) return authJson({ error: "Session is invalid or expired." }, 401);
      return authJson({ user: publicUser(session.user) });
    }

    const session = await this.resolveSession(request);
    if (!session) return authJson({ error: "Authentication required." }, 401);
    if (request.method === "GET" && pathname === "/api/auth/me") return authJson({ user: publicUser(session.user) });
    if (request.method === "POST" && pathname === "/api/auth/logout") {
      await this.ctx.storage.delete(session.sessionKey);
      return authJson({ success: true });
    }

    if (pathname === "/api/auth/users" && request.method === "GET") {
      if (session.user.role !== "admin") return authJson({ error: "Admin role required." }, 403);
      return authJson({ users: (await this.getAuthUsers()).map(publicUser) });
    }

    if (pathname === "/api/auth/users" && request.method === "POST") {
      if (session.user.role !== "admin") return authJson({ error: "Admin role required." }, 403);

      if (body.action === "create") {
        const name = normalizeAccountName(body.name);
        const role = body.role === "admin" ? "admin" : "guest";
        if (!validAccountInput(name, body.password)) return authJson({ error: "Use a name of 2–60 characters and a password of 12–128 characters." }, 400);
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        const passwordHash = await derivePasswordHash(body.password, salt);
        const user = {
          id: crypto.randomUUID(), name, normalizedName: name.toLocaleLowerCase("en-US"),
          role, salt, passwordHash, createdAt: new Date().toISOString()
        };
        const created = await this.ctx.storage.transaction(async (txn) => {
          const users = await txn.get(AUTH_USERS_KEY) || [];
          if (users.some((item) => item.normalizedName === user.normalizedName)) return false;
          await txn.put(AUTH_USERS_KEY, [...users, user]);
          return true;
        });
        if (!created) return authJson({ error: "A user with this name already exists." }, 409);
        return authJson({ user: publicUser(user) }, 201);
      }

      if (body.action === "update") {
        const id = typeof body.id === "string" ? body.id : "";
        const name = body.name === undefined ? undefined : normalizeAccountName(body.name);
        const role = body.role === undefined ? undefined : (body.role === "admin" || body.role === "guest" ? body.role : null);
        const password = body.password;
        if (!id || (name !== undefined && (name.length < 2 || name.length > 60)) || role === null ||
            (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 12 || password.length > 128))) {
          return authJson({ error: "Invalid update. Passwords must be 12–128 characters when changing them." }, 400);
        }
        const passwordSalt = typeof password === "string" && password
          ? toHex(crypto.getRandomValues(new Uint8Array(16))) : undefined;
        const passwordHash = passwordSalt ? await derivePasswordHash(password, passwordSalt) : undefined;
        const updated = await this.ctx.storage.transaction(async (txn) => {
          const users = await txn.get(AUTH_USERS_KEY) || [];
          const index = users.findIndex((item) => item.id === id);
          if (index < 0) return { error: "User not found.", status: 404 };
          const current = users[index];
          const nextRole = role || current.role;
          if (name && users.some((item) => item.id !== id && item.normalizedName === name.toLocaleLowerCase("en-US"))) return { error: "A user with this name already exists.", status: 409 };
          if (current.role === "admin" && nextRole !== "admin" && users.filter((item) => item.role === "admin").length <= 1) return { error: "At least one admin account must remain.", status: 409 };
          const next = {
            ...current,
            ...(name ? { name, normalizedName: name.toLocaleLowerCase("en-US") } : {}),
            ...(role ? { role } : {}),
            ...(passwordSalt && passwordHash ? { salt: passwordSalt, passwordHash } : {})
          };
          const nextUsers = [...users];
          nextUsers[index] = next;
          await txn.put(AUTH_USERS_KEY, nextUsers);
          return { user: next, passwordChanged: Boolean(passwordSalt) };
        });
        if (updated.error) return authJson({ error: updated.error }, updated.status);
        if (updated.passwordChanged) await this.revokeUserSessions(id, session.sessionKey);
        return authJson({ user: publicUser(updated.user) });
      }

      if (body.action === "delete") {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id || id === session.user.id) return authJson({ error: "You cannot delete the currently signed-in account." }, 400);
        const removed = await this.ctx.storage.transaction(async (txn) => {
          const users = await txn.get(AUTH_USERS_KEY) || [];
          const target = users.find((item) => item.id === id);
          if (!target) return { error: "User not found.", status: 404 };
          if (target.role === "admin" && users.filter((item) => item.role === "admin").length <= 1) return { error: "At least one admin account must remain.", status: 409 };
          await txn.put(AUTH_USERS_KEY, users.filter((item) => item.id !== id));
          return { success: true };
        });
        if (removed.error) return authJson({ error: removed.error }, removed.status);
        await this.revokeUserSessions(id);
        return authJson({ success: true });
      }
    }
    return authJson({ error: "Unsupported authentication endpoint." }, 404);
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname.startsWith("/api/auth/")) return this.handleAuth(request);

    await this.ensureInitialized();
    const requestPath = requestUrl.pathname;
    const isDigest = requestPath === "/api/margin-digest";
    let recordKey = requestPath === "/api/history" ? "historyRecord" : "record";
    if (isDigest && request.method === "GET") {
      const digestKey = requestUrl.searchParams.get("key") || "";
      if (!/^(portfolio|position:[A-Z0-9.^=-]{1,20})$/.test(digestKey)) {
        return jsonResponse({ error: "A valid digest key is required." }, 400);
      }
      recordKey = "marginDigestRecord:" + digestKey;
    }

    if (request.method === "GET") {
      const record = await this.ctx.storage.get(recordKey);
      if (!record) {
        return jsonResponse({ error: "Portfolio state not found." }, 404, 0);
      }
      return new Response(record.payload, {
        status: 200,
        headers: { ...CORS_HEADERS, ETag: `"${record.revision}"` }
      });
    }

    const expectedHeader = request.headers.get("If-Match");
    if (expectedHeader === null) {
      return jsonResponse({ error: "If-Match revision is required for cloud writes." }, 428);
    }
    const expectedRevision = Number(expectedHeader.replace(/^W\//, "").replace(/^"|"$/g, ""));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return jsonResponse({ error: "Invalid If-Match revision." }, 400);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 20 * 1024 * 1024) {
      return jsonResponse({ error: "Cloud state payload exceeds the 20 MB limit." }, 413);
    }
    if (request.headers.get("Content-Type")?.toLowerCase().includes("application/json") !== true) {
      return jsonResponse({ error: "Cloud state writes must use application/json." }, 415);
    }

    // Bound the actual streamed body too: Content-Length can be omitted, and
    // cloning/arrayBuffer() can buffer an unbounded tee branch before JSON parsing.
    const bodyReader = request.body?.getReader();
    if (bodyReader) {
      let receivedBytes = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await bodyReader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > 20 * 1024 * 1024) {
            await bodyReader.cancel("Cloud state payload exceeds the configured limit.");
            return jsonResponse({ error: "Cloud state payload exceeds the 20 MB limit." }, 413);
          }
          chunks.push(value);
        }
      } finally {
        bodyReader.releaseLock();
      }
      const boundedHeaders = new Headers(request.headers);
      boundedHeaders.delete("Content-Length");
      request = new Request(request.url, {
        method: request.method,
        headers: boundedHeaders,
        body: new Blob(chunks)
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Missing or invalid JSON body." }, 400);
    }

    if (isDigest) {
      if (typeof body.key !== "string" || !/^(portfolio|position:[A-Z0-9.^=-]{1,20})$/.test(body.key)) {
        return jsonResponse({ error: "Digest key must identify a portfolio or ticker position." }, 400);
      }
      if (typeof body.analysis !== "string" || !body.analysis.trim() || body.analysis.length > 30_000 ||
          !Array.isArray(body.articles) || body.articles.length > 20 ||
          typeof body.syncedAt !== "string" || !Number.isFinite(Date.parse(body.syncedAt))) {
        return jsonResponse({ error: "Digest payload is missing valid analysis, articles, or sync timestamp." }, 400);
      }
      recordKey = "marginDigestRecord:" + body.key;
    } else if (typeof body.encryptedPayload !== "string" || !body.encryptedPayload.trim()) {
      return jsonResponse({ error: "Cloud state must contain a non-empty encryptedPayload string." }, 400);
    }

    const result = await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.get(recordKey);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return { conflict: true, revision: currentRevision };
      }
      const nextRevision = currentRevision + 1;
      await txn.put(recordKey, { payload: JSON.stringify(body), revision: nextRevision });
      return { conflict: false, revision: nextRevision };
    });

    if (result.conflict) {
      return jsonResponse({
        error: "Cloud portfolio changed since this device last synced. Pull the latest state before saving.",
        conflict: true,
        currentRevision: result.revision
      }, 409, result.revision);
    }

    return jsonResponse({ success: true, revision: result.revision }, 200, result.revision);
  }
}
