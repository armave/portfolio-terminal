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
 * Stores the administrator's encrypted workspace and server-owned guest projections.
 * Guest projection reads are bound to the authenticated guest session; guests cannot
 * read the shared workspace, closed history, or its encryption key.
 */

const AUTH_USERS_KEY = "auth:users";
const AUTH_CLOUD_KEY_KEY = "auth:cloud-encryption-key";
const LEGACY_FREEDOM_TRADE_NET_SESSION_KEY = "freedom:tradenet-session";
const MARKET_DEPTH_SESSION_CLEANUP_KEY = "migration:market-depth-session-cleanup";
const AUTH_SESSION_PREFIX = "auth:session:";
const AUTH_LOGIN_FAILURE_PREFIX = "auth:login-failure:";
const AUTH_LOGIN_FAILURE_CLEANUP_KEY = "migration:login-failure-records-cleaned-v1";
const AUTH_LOGIN_RATE_LIMIT_KEY = "auth:login-rate-limit:v1";
const AUTH_LOGIN_RATE_LIMIT_LIMIT = 10;
const AUTH_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOGIN_RATE_LIMIT_MAX_IPS = 1024;
const AUTH_LOGIN_FAILURE_CLEANUP_BATCH = 128;
const AUTH_GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_LEGACY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_SESSION_MAX_PER_USER = 5;
const AUTH_SESSION_CLEANUP_BATCH_SIZE = 100;
const AUTH_SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const AUTH_SESSION_CLEANUP_CURSOR_KEY = "maintenance:auth-session-cleanup-cursor:v1";
const AUTH_SESSION_CLEANUP_LAST_RUN_KEY = "maintenance:auth-session-cleanup-last-run:v1";
const AUTH_USER_SESSION_INDEX_PREFIX = "auth:user-sessions:";

function userSessionIndexKey(userId) {
  return AUTH_USER_SESSION_INDEX_PREFIX + userId;
}
const PASSWORD_HASH_VERSION = 2;
const PASSWORD_ITERATIONS_PER_STAGE = 100_000;
const PASSWORD_HASH_STAGES = 6;
const authEncoder = new TextEncoder();

function authJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" }
  });
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
  // Cloudflare Workers rejects a single PBKDF2 deriveBits call above 100,000
  // iterations. Chain six independently salted PBKDF2 stages so each native
  // operation stays within that limit while preserving 600,000 total rounds
  // of PBKDF2-HMAC-SHA256 work for every password.
  let input = authEncoder.encode(password);
  for (let stage = 0; stage < PASSWORD_HASH_STAGES; stage += 1) {
    const material = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
    const stageSalt = authEncoder.encode(
      `${salt}:portfolio-terminal:password:v${PASSWORD_HASH_VERSION}:stage:${stage}`
    );
    input = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: stageSalt, iterations: PASSWORD_ITERATIONS_PER_STAGE, hash: "SHA-256" },
      material, 256
    ));
  }
  return toHex(input);
}
function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function isSupportedLanguage(value) {
  return value === "en" || value === "ru";
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    language: isSupportedLanguage(user.language) ? user.language : "en",
    createdAt: user.createdAt
  };
}
function validAccountInput(name, password) {
  return name.length >= 2 && name.length <= 60 &&
    typeof password === "string" && password.length >= 6 && password.length <= 128;
}

export class PortfolioStateDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async clearRetiredTradeNetSession() {
    if (await this.ctx.storage.get(MARKET_DEPTH_SESSION_CLEANUP_KEY)) return;
    await this.ctx.storage.delete(LEGACY_FREEDOM_TRADE_NET_SESSION_KEY);
    await this.ctx.storage.put(MARKET_DEPTH_SESSION_CLEANUP_KEY, true);
  }

  async ensureInitialized() {
    const existing = await this.ctx.storage.get("record");
    if (existing) return;

    const legacyPayload = this.env.PORTFOLIO_KV
      ? await this.env.PORTFOLIO_KV.get("portfolio_state")
      : null;

    await this.ctx.storage.transaction(async () => {
      const current = await this.ctx.storage.get("record");
      if (!current && legacyPayload) {
        await this.ctx.storage.put("record", { payload: legacyPayload, revision: 1 });
      }
    });
  }


  async getAuthUsers() {
    const users = await this.ctx.storage.get(AUTH_USERS_KEY);
    return Array.isArray(users) ? users : [];
  }

  async cleanupLegacyLoginFailureRecords() {
    if (await this.ctx.storage.get(AUTH_LOGIN_FAILURE_CLEANUP_KEY) === true) return;
    const legacy = await this.ctx.storage.list({ prefix: AUTH_LOGIN_FAILURE_PREFIX, limit: AUTH_LOGIN_FAILURE_CLEANUP_BATCH });
    for (const key of legacy.keys()) await this.ctx.storage.delete(key);
    if (legacy.size < AUTH_LOGIN_FAILURE_CLEANUP_BATCH) {
      await this.ctx.storage.put(AUTH_LOGIN_FAILURE_CLEANUP_KEY, true);
    }
  }

  async consumeLoginRateLimit(ipAddress) {
    const ipHash = await digestHex(ipAddress);
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(AUTH_LOGIN_RATE_LIMIT_KEY);
      const source = stored && typeof stored === "object" && stored.buckets &&
        typeof stored.buckets === "object" && !Array.isArray(stored.buckets) ? stored.buckets : {};
      const activeEntries = Object.entries(source).filter(([, bucket]) =>
        bucket && Number.isSafeInteger(bucket.count) && bucket.count > 0 &&
        Number.isFinite(bucket.expiresAt) && bucket.expiresAt > now
      );
      activeEntries.sort((left, right) =>
        (Number(right[1].lastAttemptAt) || 0) - (Number(left[1].lastAttemptAt) || 0)
      );
      const buckets = Object.fromEntries(activeEntries.slice(0, AUTH_LOGIN_RATE_LIMIT_MAX_IPS));
      const current = buckets[ipHash];
      if (current && current.count >= AUTH_LOGIN_RATE_LIMIT_LIMIT) {
        await transaction.put(AUTH_LOGIN_RATE_LIMIT_KEY, { version: 1, buckets });
        return { limited: true, ipHash, retryAfter: Math.max(1, Math.ceil((current.expiresAt - now) / 1000)) };
      }
      if (!current && Object.keys(buckets).length >= AUTH_LOGIN_RATE_LIMIT_MAX_IPS) {
        const earliestExpiry = Math.min(...Object.values(buckets).map((bucket) => bucket.expiresAt));
        await transaction.put(AUTH_LOGIN_RATE_LIMIT_KEY, { version: 1, buckets });
        return { limited: true, ipHash, retryAfter: Math.max(1, Math.ceil((earliestExpiry - now) / 1000)) };
      }
      buckets[ipHash] = {
        count: (current?.count || 0) + 1,
        expiresAt: current?.expiresAt || now + AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
        lastAttemptAt: now
      };
      await transaction.put(AUTH_LOGIN_RATE_LIMIT_KEY, { version: 1, buckets });
      return { limited: false, ipHash };
    });
  }

  async clearLoginRateLimit(ipHash) {
    await this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(AUTH_LOGIN_RATE_LIMIT_KEY);
      if (!stored || typeof stored !== "object" || !stored.buckets ||
          typeof stored.buckets !== "object" || Array.isArray(stored.buckets)) return;
      const buckets = { ...stored.buckets };
      delete buckets[ipHash];
      if (Object.keys(buckets).length) await transaction.put(AUTH_LOGIN_RATE_LIMIT_KEY, { version: 1, buckets });
      else await transaction.delete(AUTH_LOGIN_RATE_LIMIT_KEY);
    });
  }

  async removeSessionFromIndex(userId, sessionKey) {
    if (!userId || !sessionKey) return;
    await this.ctx.storage.transaction(async (transaction) => {
      const key = userSessionIndexKey(userId);
      const index = await transaction.get(key);
      if (!index || !Array.isArray(index.sessions)) return;
      const source = index.sessions.length <= AUTH_SESSION_MAX_PER_USER
        ? index.sessions : [];
      const sessions = source.filter((entry) => entry?.key !== sessionKey);
      await transaction.put(key, { ...index, sessions });
    });
  }

  async cleanupExpiredSessions({ force = false } = {}) {
    const now = Date.now();
    if (!force) {
      const claimed = await this.ctx.storage.transaction(async (transaction) => {
        const lastRun = await transaction.get(AUTH_SESSION_CLEANUP_LAST_RUN_KEY);
        if (Number.isFinite(lastRun) && now - lastRun < AUTH_SESSION_CLEANUP_INTERVAL_MS) return false;
        await transaction.put(AUTH_SESSION_CLEANUP_LAST_RUN_KEY, now);
        return true;
      });
      if (!claimed) return 0;
    } else {
      await this.ctx.storage.put(AUTH_SESSION_CLEANUP_LAST_RUN_KEY, now);
    }

    const cursor = await this.ctx.storage.get(AUTH_SESSION_CLEANUP_CURSOR_KEY);
    const options = {
      prefix: AUTH_SESSION_PREFIX,
      limit: AUTH_SESSION_CLEANUP_BATCH_SIZE
    };
    if (typeof cursor === "string" && cursor.startsWith(AUTH_SESSION_PREFIX)) {
      options.startAfter = cursor;
    }

    let batch;
    try {
      batch = await this.ctx.storage.list(options);
    } catch (error) {
      await this.ctx.storage.delete(AUTH_SESSION_CLEANUP_LAST_RUN_KEY);
      throw error;
    }
    if (batch.size === 0) {
      if (cursor !== undefined) await this.ctx.storage.delete(AUTH_SESSION_CLEANUP_CURSOR_KEY);
      return 0;
    }

    const users = await this.getAuthUsers();
    const usersById = new Map(users.map((user) => [user.id, user]));

    for (const [key, session] of batch.entries()) {
      const user = session && usersById.get(session.userId);
      let invalid = !user;
      let index = null;
      if (user) {
        index = await this.ctx.storage.get(userSessionIndexKey(user.id));
        if (index) {
          const indexed = Array.isArray(index.sessions) &&
            index.sessions.length <= AUTH_SESSION_MAX_PER_USER &&
            index.sessions.some((entry) => entry?.key === key);
          if (!Number.isSafeInteger(index.generation) ||
              session.sessionVersion !== index.generation || !indexed) {
            invalid = true;
          }
        } else if (session.sessionVersion !== undefined && session.sessionVersion !== 0) {
          invalid = true;
        }
      }

      if (!invalid) {
        const issuedAt = Number.isFinite(session.issuedAt)
          ? session.issuedAt
          : user.role === "guest" && Number.isFinite(session.expiresAt)
            ? session.expiresAt - AUTH_LEGACY_SESSION_TTL_MS
            : NaN;
        const ttl = user.role === "guest" ? AUTH_GUEST_SESSION_TTL_MS : AUTH_ADMIN_SESSION_TTL_MS;
        const policyExpiry = issuedAt + ttl;
        const expiresAt = user.role === "guest"
          ? policyExpiry
          : Number.isFinite(session.expiresAt)
            ? Math.min(session.expiresAt, policyExpiry)
            : policyExpiry;

        if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= now) {
          invalid = true;
        } else if (session.issuedAt !== issuedAt || session.expiresAt !== expiresAt ||
            session.sessionVersion === undefined) {
          await this.ctx.storage.put(key, {
            ...session,
            issuedAt,
            expiresAt,
            sessionVersion: session.sessionVersion ?? 0
          });
        }
      }

      if (invalid) {
        await this.ctx.storage.delete(key);
        if (user) await this.removeSessionFromIndex(user.id, key);
      }
    }

    const batchKeys = Array.from(batch.keys());
    const lastKey = batchKeys[batchKeys.length - 1];
    if (batch.size < AUTH_SESSION_CLEANUP_BATCH_SIZE) {
      await this.ctx.storage.delete(AUTH_SESSION_CLEANUP_CURSOR_KEY);
    } else {
      await this.ctx.storage.put(AUTH_SESSION_CLEANUP_CURSOR_KEY, lastKey);
    }
    return batch.size;
  }

  async resolveSession(request) {
    // Session cleanup is deliberately bounded and best-effort. A storage-list
    // hiccup must not make an otherwise valid account session unavailable.
    try {
      await this.cleanupExpiredSessions();
    } catch (error) {
      console.warn("Session cleanup deferred:", error instanceof Error ? error.message : "unknown error");
    }

    const authorization = request.headers.get("Authorization") || "";
    const token = request.headers.get("X-App-Auth") ||
      (authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim());
    if (!token || token.length > 256) return null;
    const sessionKey = AUTH_SESSION_PREFIX + await digestHex(token);
    const session = await this.ctx.storage.get(sessionKey);
    if (!session) return null;

    const user = (await this.getAuthUsers()).find((item) => item.id === session.userId);
    if (!user) {
      await this.ctx.storage.delete(sessionKey);
      return null;
    }

    const index = await this.ctx.storage.get(userSessionIndexKey(user.id));
    if (index) {
      const indexed = Array.isArray(index.sessions) &&
        index.sessions.length <= AUTH_SESSION_MAX_PER_USER &&
        index.sessions.some((entry) => entry?.key === sessionKey);
      if (!Number.isSafeInteger(index.generation) ||
          session.sessionVersion !== index.generation || !indexed) {
        await this.ctx.storage.delete(sessionKey);
        await this.removeSessionFromIndex(user.id, sessionKey);
        return null;
      }
    } else if (session.sessionVersion !== undefined && session.sessionVersion !== 0) {
      // A session issued under an index cannot remain valid if its index is lost.
      await this.ctx.storage.delete(sessionKey);
      return null;
    }

    let issuedAt;
    let expiresAt;
    if (user.role === "guest") {
      // Existing guest sessions stored a seven-day expiry. Reconstruct their
      // original issue time and preserve the existing 30-day lifetime policy.
      issuedAt = Number.isFinite(session.issuedAt)
        ? session.issuedAt
        : Number.isFinite(session.expiresAt)
          ? session.expiresAt - AUTH_LEGACY_SESSION_TTL_MS
          : NaN;
      expiresAt = issuedAt + AUTH_GUEST_SESSION_TTL_MS;
    } else {
      // Legacy administrator records always stored issuedAt, even though their
      // expiresAt was null. Missing/untrustworthy issue times fail closed.
      issuedAt = Number.isFinite(session.issuedAt) ? session.issuedAt : NaN;
      const policyExpiry = issuedAt + AUTH_ADMIN_SESSION_TTL_MS;
      expiresAt = Number.isFinite(session.expiresAt)
        ? Math.min(session.expiresAt, policyExpiry)
        : policyExpiry;
    }

    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await this.ctx.storage.delete(sessionKey);
      await this.removeSessionFromIndex(user.id, sessionKey);
      return null;
    }

    const sessionVersion = session.sessionVersion ?? 0;
    if (session.issuedAt !== issuedAt || session.expiresAt !== expiresAt ||
        session.sessionVersion !== sessionVersion) {
      await this.ctx.storage.put(sessionKey, {
        ...session,
        issuedAt,
        expiresAt,
        sessionVersion
      });
    }

    return { user, sessionKey };
  }

  async issueSession(user) {
    try {
      await this.cleanupExpiredSessions();
    } catch (error) {
      console.warn("Session cleanup deferred during issuance:", error instanceof Error ? error.message : "unknown error");
    }

    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const issuedAt = Date.now();
    const expiresAt = issuedAt + (user.role === "guest"
      ? AUTH_GUEST_SESSION_TTL_MS
      : AUTH_ADMIN_SESSION_TTL_MS);
    const sessionKey = AUTH_SESSION_PREFIX + await digestHex(token);
    const indexKey = userSessionIndexKey(user.id);

    await this.ctx.storage.transaction(async (transaction) => {
      const storedIndex = await transaction.get(indexKey);
      // Creating the index moves this account to the indexed-session generation.
      // Legacy unindexed tokens remain usable until this first new login, after
      // which the account must use the newly issued token on each device.
      const generation = Number.isSafeInteger(storedIndex?.generation) &&
        storedIndex.generation > 0 ? storedIndex.generation : 1;
      const indexedSessions = Array.isArray(storedIndex?.sessions)
        ? storedIndex.sessions.slice(-AUTH_SESSION_MAX_PER_USER) : [];
      const activeSessions = [];

      for (const entry of indexedSessions) {
        if (!entry || typeof entry.key !== "string" || entry.key === sessionKey) continue;
        const existing = await transaction.get(entry.key);
        if (!existing || existing.userId !== user.id ||
            existing.sessionVersion !== generation ||
            !Number.isFinite(existing.issuedAt) ||
            !Number.isFinite(existing.expiresAt) || existing.expiresAt <= issuedAt) {
          if (existing?.userId === user.id) await transaction.delete(entry.key);
          continue;
        }
        activeSessions.push({
          key: entry.key,
          issuedAt: existing.issuedAt,
          expiresAt: existing.expiresAt
        });
      }

      activeSessions.push({ key: sessionKey, issuedAt, expiresAt });
      activeSessions.sort((left, right) => left.issuedAt - right.issuedAt);
      while (activeSessions.length > AUTH_SESSION_MAX_PER_USER) {
        const evicted = activeSessions.shift();
        await transaction.delete(evicted.key);
      }

      await transaction.put(sessionKey, {
        userId: user.id,
        issuedAt,
        expiresAt,
        sessionVersion: generation
      });
      await transaction.put(indexKey, {
        version: 1,
        generation,
        sessions: activeSessions
      });
    });

    return { token, user: publicUser(user), expiresAt };
  }

  async revokeUserSessions(userId, exceptSessionKey = "") {
    await this.ctx.storage.transaction(async (transaction) => {
      const indexKey = userSessionIndexKey(userId);
      const storedIndex = await transaction.get(indexKey);
      const generation = Number.isSafeInteger(storedIndex?.generation) &&
        storedIndex.generation > 0 && storedIndex.generation < Number.MAX_SAFE_INTEGER
        ? storedIndex.generation + 1 : 1;
      const retainedSessions = [];

      if (exceptSessionKey) {
        const current = await transaction.get(exceptSessionKey);
        if (current?.userId === userId && Number.isFinite(current.expiresAt) &&
            current.expiresAt > Date.now()) {
          const updated = { ...current, sessionVersion: generation };
          await transaction.put(exceptSessionKey, updated);
          retainedSessions.push({
            key: exceptSessionKey,
            issuedAt: updated.issuedAt,
            expiresAt: updated.expiresAt
          });
        }
      }

      const indexedSessions = Array.isArray(storedIndex?.sessions)
        ? storedIndex.sessions.slice(-AUTH_SESSION_MAX_PER_USER) : [];
      for (const entry of indexedSessions) {
        if (entry?.key && entry.key !== exceptSessionKey) {
          await transaction.delete(entry.key);
        }
      }

      // Incrementing the generation also invalidates all legacy unindexed
      // tokens without requiring an unbounded scan of every session record.
      await transaction.put(indexKey, {
        version: 1,
        generation,
        sessions: retainedSessions
      });
    });
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
      const workspaceEncryptionKey = request.headers.get("X-Workspace-Encryption-Key") || "";
      if (!workspaceEncryptionKey) return authJson({ error: "Initial workspace encryption key is not configured." }, 500);
      const name = normalizeAccountName(body.name);
      if (!validAccountInput(name, body.password)) return authJson({ error: "Use a name of 2–60 characters and a password of 6–128 characters." }, 400);
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      const passwordHash = await derivePasswordHash(body.password, salt);
      const user = {
        id: crypto.randomUUID(), name, normalizedName: name.toLocaleLowerCase("en-US"),
        role: "admin", language: "en", salt, passwordHash, passwordHashVersion: PASSWORD_HASH_VERSION, createdAt: new Date().toISOString()
      };
      const created = await this.ctx.storage.transaction(async () => {
        const users = await this.ctx.storage.get(AUTH_USERS_KEY) || [];
        if (users.length) return false;
        await this.ctx.storage.put(AUTH_USERS_KEY, [user]);
        await this.ctx.storage.put(AUTH_CLOUD_KEY_KEY, workspaceEncryptionKey);
        return true;
      });
      if (!created) return authJson({ error: "Initial admin account has already been created." }, 409);
      return authJson(await this.issueSession(user), 201);
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      // Throttle before account lookup and PBKDF2 work. Every attempt from the
      // same network address shares one bucket, regardless of submitted name.
      await this.cleanupLegacyLoginFailureRecords();
      const ipHeader = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipAddress = String(ipHeader).trim().slice(0, 128) || "unknown";
      const rateLimit = await this.consumeLoginRateLimit(ipAddress);
      if (rateLimit.limited) {
        return new Response(JSON.stringify({ error: "Too many sign-in attempts. Try again later." }), {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimit.retryAfter || 900)
          }
        });
      }

      const name = normalizeAccountName(body.name);
      if (!name || name.length < 2 || name.length > 60 ||
          typeof body.password !== "string" || body.password.length < 6 || body.password.length > 128) {
        return authJson({ error: "Invalid name or password." }, 400);
      }

      const user = (await this.getAuthUsers()).find((item) => item.normalizedName === name.toLocaleLowerCase("en-US"));
      const salt = user?.salt || "portfolio-terminal-login-validation";
      const expected = user?.passwordHash || await derivePasswordHash("invalid-password", salt);
      const actual = await derivePasswordHash(body.password, salt);
      if (!user || !secureEqual(actual, expected)) {
        return authJson({ error: "Invalid name or password." }, 401);
      }

      await this.clearLoginRateLimit(rateLimit.ipHash);
      return authJson(await this.issueSession(user));
    }

    if (request.method === "GET" && pathname === "/api/auth/cloud-key") {
      const session = await this.resolveSession(request);
      if (!session) return authJson({ error: "Authentication required." }, 401);
      if (session.user.role !== "admin") return authJson({ error: "Administrator access required." }, 403);
      const key = await this.ctx.storage.get(AUTH_CLOUD_KEY_KEY);
      if (typeof key !== "string" || !key) return authJson({ error: "Shared cloud encryption key is not initialized." }, 500);
      return authJson({ key });
    }

    if (request.method === "POST" && pathname === "/api/auth/verify") {
      const session = await this.resolveSession(request);
      if (!session) return authJson({ error: "Session is invalid or expired." }, 401);
      return authJson({ user: publicUser(session.user) });
    }

    const session = await this.resolveSession(request);
    if (!session) return authJson({ error: "Authentication required." }, 401);
    if (request.method === "GET" && pathname === "/api/auth/me") return authJson({ user: publicUser(session.user) });
    if (request.method === "POST" && pathname === "/api/auth/me") {
      if (!isSupportedLanguage(body.language)) {
        return authJson({ error: "Language must be either en or ru." }, 400);
      }
      const updated = await this.ctx.storage.transaction(async () => {
        const users = await this.ctx.storage.get(AUTH_USERS_KEY) || [];
        const index = users.findIndex((item) => item.id === session.user.id);
        if (index < 0) return null;
        const next = { ...users[index], language: body.language };
        const nextUsers = [...users];
        nextUsers[index] = next;
        await this.ctx.storage.put(AUTH_USERS_KEY, nextUsers);
        return next;
      });
      if (!updated) return authJson({ error: "User not found." }, 404);
      return authJson({ user: publicUser(updated) });
    }
    if (request.method === "POST" && pathname === "/api/auth/logout") {
      await this.ctx.storage.delete(session.sessionKey);
      await this.removeSessionFromIndex(session.user.id, session.sessionKey);
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
        if (body.role !== undefined && body.role !== "admin" && body.role !== "guest") return authJson({ error: "Role must be either admin or guest." }, 400);
        if (body.language !== undefined && !isSupportedLanguage(body.language)) return authJson({ error: "Language must be either en or ru." }, 400);
        const role = body.role === "admin" ? "admin" : "guest";
        const language = body.language === "ru" ? "ru" : "en";
        if (!validAccountInput(name, body.password)) return authJson({ error: "Use a name of 2–60 characters and a password of 6–128 characters." }, 400);
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        const passwordHash = await derivePasswordHash(body.password, salt);
        const user = {
          id: crypto.randomUUID(), name, normalizedName: name.toLocaleLowerCase("en-US"),
          role, language, salt, passwordHash, passwordHashVersion: PASSWORD_HASH_VERSION, createdAt: new Date().toISOString()
        };
        const created = await this.ctx.storage.transaction(async () => {
          const users = await this.ctx.storage.get(AUTH_USERS_KEY) || [];
          if (users.some((item) => item.normalizedName === user.normalizedName)) return false;
          await this.ctx.storage.put(AUTH_USERS_KEY, [...users, user]);
          return true;
        });
        if (!created) return authJson({ error: "A user with this name already exists." }, 409);
        return authJson({ user: publicUser(user) }, 201);
      }

      if (body.action === "update") {
        const id = typeof body.id === "string" ? body.id : "";
        const name = body.name === undefined ? undefined : normalizeAccountName(body.name);
        const role = body.role === undefined ? undefined : (body.role === "admin" || body.role === "guest" ? body.role : null);
        const language = body.language === undefined ? undefined : (isSupportedLanguage(body.language) ? body.language : null);
        const password = body.password;
        if (!id || (name !== undefined && (name.length < 2 || name.length > 60)) || role === null || language === null ||
            (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 6 || password.length > 128))) {
          return authJson({ error: "Invalid update. Passwords must be 6–128 characters when changing them." }, 400);
        }
        const passwordSalt = typeof password === "string" && password
          ? toHex(crypto.getRandomValues(new Uint8Array(16))) : undefined;
        const passwordHash = passwordSalt ? await derivePasswordHash(password, passwordSalt) : undefined;
        const updated = await this.ctx.storage.transaction(async () => {
          const users = await this.ctx.storage.get(AUTH_USERS_KEY) || [];
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
            ...(language ? { language } : {}),
            ...(passwordSalt && passwordHash ? { salt: passwordSalt, passwordHash, passwordHashVersion: PASSWORD_HASH_VERSION } : {})
          };
          const nextUsers = [...users];
          nextUsers[index] = next;
          await this.ctx.storage.put(AUTH_USERS_KEY, nextUsers);
          return {
            user: next,
            passwordChanged: Boolean(passwordSalt),
            roleChanged: nextRole !== current.role
          };
        });
        if (updated.error) return authJson({ error: updated.error }, updated.status);
        // A role/name/password change invalidates any previously published
        // guest projection until the administrator republishes the current assignment.
        await this.ctx.storage.delete("guest-portfolio:" + id);
        if (updated.roleChanged) {
          await this.revokeUserSessions(id);
        } else if (updated.passwordChanged) {
          await this.revokeUserSessions(id, session.sessionKey);
        }
        return authJson({ user: publicUser(updated.user) });
      }

      if (body.action === "delete") {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id || id === session.user.id) return authJson({ error: "You cannot delete the currently signed-in account." }, 400);
        const removed = await this.ctx.storage.transaction(async () => {
          const users = await this.ctx.storage.get(AUTH_USERS_KEY) || [];
          const target = users.find((item) => item.id === id);
          if (!target) return { error: "User not found.", status: 404 };
          if (target.role === "admin" && users.filter((item) => item.role === "admin").length <= 1) return { error: "At least one admin account must remain.", status: 409 };
          await this.ctx.storage.put(AUTH_USERS_KEY, users.filter((item) => item.id !== id));
          return { success: true };
        });
        if (removed.error) return authJson({ error: removed.error }, removed.status);
        await this.revokeUserSessions(id);
        await this.ctx.storage.delete("guest-portfolio:" + id);
        return authJson({ success: true });
      }
    }
    return authJson({ error: "Unsupported authentication endpoint." }, 404);
  }

  async encryptGuestPayload(payload) {
    const workspaceKey = await this.ctx.storage.get(AUTH_CLOUD_KEY_KEY);
    if (typeof workspaceKey !== "string" || !workspaceKey) {
      throw new Error("Workspace encryption key is not initialized.");
    }
    const digest = await crypto.subtle.digest("SHA-256", authEncoder.encode(workspaceKey));
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      key,
      authEncoder.encode(JSON.stringify(payload))
    );
    const toBase64 = (bytes) => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    return "aesgcm:v1:" + toBase64(nonce) + ":" + toBase64(new Uint8Array(ciphertext));
  }

  async decryptGuestPayload(envelope) {
    if (typeof envelope !== "string" || !envelope.startsWith("aesgcm:v1:")) {
      throw new Error("Invalid guest portfolio envelope.");
    }
    const workspaceKey = await this.ctx.storage.get(AUTH_CLOUD_KEY_KEY);
    if (typeof workspaceKey !== "string" || !workspaceKey) {
      throw new Error("Workspace encryption key is not initialized.");
    }
    const parts = envelope.slice("aesgcm:v1:".length).split(":");
    if (parts.length !== 2) throw new Error("Invalid guest portfolio envelope.");
    const fromBase64 = (value) => {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    };
    const nonce = fromBase64(parts[0]);
    const ciphertext = fromBase64(parts[1]);
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 16) {
      throw new Error("Invalid guest portfolio envelope.");
    }
    const digest = await crypto.subtle.digest("SHA-256", authEncoder.encode(workspaceKey));
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      key,
      ciphertext
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid guest portfolio payload.");
    }
    return parsed;
  }

  async encryptGuestProjection(snapshot) {
    return this.encryptGuestPayload(snapshot);
  }

  async decryptGuestProjection(envelope) {
    const parsed = await this.decryptGuestPayload(envelope);
    if (!Array.isArray(parsed.tranches)) throw new Error("Invalid guest portfolio snapshot.");
    return parsed;
  }

  normalizeGuestPortfolioSnapshot(source) {
    if (!source || typeof source !== "object" || Array.isArray(source) ||
        !Number.isFinite(Number(source.updatedAt)) || !Array.isArray(source.tranches) ||
        source.tranches.length > 500) {
      return { error: "Invalid guest portfolio snapshot." };
    }

    const seenIds = new Set();
    const tranches = [];
    for (const item of source.tranches) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const ticker = typeof item?.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
      const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : ticker;
      const quantity = Number(item?.quantity);
      if (!id || id.length > 200 || seenIds.has(id) || !/^[A-Z0-9.^=-]{1,20}$/.test(ticker) ||
          !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) {
        return { error: "Guest portfolio contains an invalid tranche." };
      }
      seenIds.add(id);
      const positiveOrNull = (value) => {
        const parsed = Number(value);
        return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) && parsed > 0
          ? parsed : null;
      };
      const purchasedAt = Number(item?.purchasedAt);
      const averagePrice = positiveOrNull(item?.averagePrice);
      const marketPrice = positiveOrNull(item?.marketPrice);
      tranches.push({
        id, ticker, name, quantity,
        averagePrice,
        marketPrice,
        marketValue: marketPrice === null ? null : marketPrice * quantity,
        purchasedAt: Number.isFinite(purchasedAt) && purchasedAt > 0 ? purchasedAt : null
      });
    }

    return { snapshot: { updatedAt: Number(source.updatedAt), tranches } };
  }

  normalizeGuestTrancheLedgerRecord(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return { error: "Invalid guest tranche ledger record." };
    }
    const assignmentId = typeof source.assignmentId === "string" ? source.assignmentId.trim() : "";
    const trancheId = typeof source.trancheId === "string" ? source.trancheId.trim() : "";
    const ticker = typeof source.ticker === "string" ? source.ticker.trim().toUpperCase() : "";
    const name = typeof source.name === "string" ? source.name.trim().slice(0, 120) : ticker;
    const assignedQuantity = Number(source.assignedQuantity);
    const openQuantity = Number(source.openQuantity);
    const assignedAt = Number(source.assignedAt);
    const updatedAt = Number(source.updatedAt);
    const status = source.status;
    if (!assignmentId || assignmentId.length > 240 || !trancheId || trancheId.length > 200 ||
        !/^[A-Z0-9.^=-]{1,20}$/.test(ticker) ||
        !Number.isFinite(assignedQuantity) || assignedQuantity <= 0 || assignedQuantity > 1e9 ||
        !Number.isFinite(openQuantity) || openQuantity < 0 || openQuantity > 1e9 ||
        !Number.isFinite(assignedAt) || assignedAt <= 0 ||
        !Number.isFinite(updatedAt) || updatedAt <= 0 ||
        !["active", "closed", "unassigned"].includes(status) ||
        (status === "active" && openQuantity <= 0) ||
        (status !== "active" && openQuantity !== 0)) {
      return { error: "Guest tranche ledger contains an invalid record." };
    }
    const positiveOrNull = (value) => {
      const parsed = Number(value);
      return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) && parsed > 0
        ? parsed : null;
    };
    const purchasedAt = Number(source.purchasedAt);
    const operationAt = Number(source.operationAt);
    const endedAt = Number(source.endedAt);
    const averagePrice = positiveOrNull(source.averagePrice);
    const marketPrice = positiveOrNull(source.marketPrice);
    const netProfit = source.netProfit === null || source.netProfit === undefined
      ? null : Number(source.netProfit);
    const value = source.value === null || source.value === undefined
      ? null : Number(source.value);
    if ((netProfit !== null && !Number.isFinite(netProfit)) ||
        (value !== null && (!Number.isFinite(value) || value < 0))) {
      return { error: "Guest tranche ledger contains an invalid financial value." };
    }
    return {
      record: {
        assignmentId,
        trancheId,
        ticker,
        name: name || ticker,
        assignedQuantity,
        openQuantity,
        averagePrice,
        netProfit,
        marketPrice,
        marketValue: marketPrice === null || openQuantity <= 0 ? null : marketPrice * openQuantity,
        operationAt: Number.isFinite(operationAt) && operationAt > 0 ? operationAt : null,
        value,
        purchasedAt: Number.isFinite(purchasedAt) && purchasedAt > 0 ? purchasedAt : null,
        assignedAt,
        updatedAt,
        endedAt: status === "active" ? null : (Number.isFinite(endedAt) && endedAt > 0 ? endedAt : updatedAt),
        status
      }
    };
  }

  mergeGuestTrancheLedger(existing, upserts, retainedAssignmentIds, updatedAt) {
    const records = new Map();
    for (const item of Array.isArray(existing?.records) ? existing.records : []) {
      if (item && typeof item.assignmentId === "string") records.set(item.assignmentId, item);
    }
    for (const item of upserts) {
      const previous = records.get(item.assignmentId);
      records.set(item.assignmentId, {
        ...previous,
        ...item,
        // Keep the first assignment timestamp. Active tranche records preserve
        // the largest observed quantity as buys are grouped; closed-trade edits
        // replace their manually assigned cash quantity exactly.
        assignedAt: previous?.assignedAt || item.assignedAt,
        assignedQuantity: String(item.trancheId || "").startsWith("closed-trade:")
          ? item.assignedQuantity
          : Math.max(Number(previous?.assignedQuantity) || 0, item.assignedQuantity),
        purchasedAt: previous?.purchasedAt ?? item.purchasedAt,
        updatedAt: Math.max(Number(previous?.updatedAt) || 0, item.updatedAt),
        ...(item.status === "active" ? { endedAt: null } : {})
      });
    }

    if (retainedAssignmentIds !== null) {
      const retained = new Set(retainedAssignmentIds);
      const active = new Set(upserts.filter((item) => item.status === "active").map((item) => item.assignmentId));
      for (const [assignmentId, item] of records.entries()) {
        if (item.status !== "active") continue;
        if (!retained.has(assignmentId)) {
          records.set(assignmentId, {
            ...item, status: "unassigned", openQuantity: 0, marketValue: null, value: null,
            endedAt: updatedAt, updatedAt
          });
        } else if (!active.has(assignmentId)) {
          records.set(assignmentId, {
            ...item, status: "closed", openQuantity: 0, marketValue: null, value: null,
            endedAt: updatedAt, updatedAt
          });
        }
      }
    }

    return {
      updatedAt,
      records: Array.from(records.values())
        .sort((a, b) => a.assignedAt - b.assignedAt || a.assignmentId.localeCompare(b.assignmentId))
    };
  }

  async handleGuestPortfolio(request) {
    const session = await this.resolveSession(request);
    if (!session) return authJson({ error: "Authentication required." }, 401);

    if (request.method === "GET") {
      if (session.user.role !== "guest") return authJson({ error: "Guest account required." }, 403);
      const record = await this.ctx.storage.get("guest-portfolio:" + session.user.id);
      const revision = Number.isSafeInteger(record?.revision) ? record.revision : 0;
      let snapshot = { updatedAt: 0, tranches: [] };
      let ledger = { updatedAt: 0, records: [] };
      try {
        if (record?.encryptedSnapshot) snapshot = await this.decryptGuestProjection(record.encryptedSnapshot);
        if (record?.encryptedLedger) {
          const decryptedLedger = await this.decryptGuestPayload(record.encryptedLedger);
          if (!Array.isArray(decryptedLedger.records)) throw new Error("Invalid guest tranche ledger.");
          ledger = { updatedAt: Number(decryptedLedger.updatedAt) || 0, records: decryptedLedger.records };
        }
      } catch {
        return authJson({ error: "Guest portfolio data could not be decrypted." }, 500);
      }
      return new Response(JSON.stringify({
        snapshot,
        ledger: ledger.records,
        ledgerUpdatedAt: ledger.updatedAt,
        revision
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ETag: `"${revision}"` }
      });
    }

    if (request.method !== "POST" || session.user.role !== "admin") {
      return authJson({ error: "Administrator role required." }, 403);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 512 * 1024) {
      return authJson({ error: "Guest portfolio update exceeds the 512 KB limit." }, 413);
    }
    let body;
    try { body = JSON.parse(rawBody); } catch { return authJson({ error: "Invalid guest portfolio JSON." }, 400); }

    const items = Array.isArray(body?.snapshots)
      ? body.snapshots
      : (body?.guestId && body?.snapshot ? [{ ...body, snapshots: undefined }] : null);
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return authJson({ error: "A guest portfolio batch must contain between 1 and 100 snapshots." }, 400);
    }

    const existingGuests = new Set(
      (await this.getAuthUsers()).filter((user) => user.role === "guest").map((user) => user.id)
    );
    const seenGuestIds = new Set();
    const prepared = [];
    for (const item of items) {
      const guestId = typeof item?.guestId === "string" ? item.guestId.trim() : "";
      if (!guestId || seenGuestIds.has(guestId)) {
        return authJson({ error: "Guest portfolio batch contains a missing or duplicate guest ID." }, 400);
      }
      if (!existingGuests.has(guestId)) {
        return authJson({ error: "Target guest account does not exist." }, 404);
      }
      seenGuestIds.add(guestId);

      const normalizedSnapshot = this.normalizeGuestPortfolioSnapshot(item.snapshot);
      if (normalizedSnapshot.error) return authJson({ error: normalizedSnapshot.error }, 400);

      const hasLedgerUpserts = item.ledgerUpserts !== undefined;
      const hasRetainedIds = item.retainedAssignmentIds !== undefined;
      if (hasLedgerUpserts && !Array.isArray(item.ledgerUpserts)) {
        return authJson({ error: "Guest tranche ledger updates must be an array." }, 400);
      }
      if (hasRetainedIds && !Array.isArray(item.retainedAssignmentIds)) {
        return authJson({ error: "Retained guest assignment IDs must be an array." }, 400);
      }
      const rawUpserts = hasLedgerUpserts ? item.ledgerUpserts : [];
      const rawRetainedIds = hasRetainedIds ? item.retainedAssignmentIds : [];
      if (rawUpserts.length > 500 || rawRetainedIds.length > 5000) {
        return authJson({ error: "Guest tranche ledger update exceeds its record limit." }, 413);
      }

      const ledgerUpserts = [];
      const seenAssignmentIds = new Set();
      for (const rawRecord of rawUpserts) {
        const normalized = this.normalizeGuestTrancheLedgerRecord(rawRecord);
        if (normalized.error) return authJson({ error: normalized.error }, 400);
        const assignmentId = normalized.record.assignmentId;
        if (seenAssignmentIds.has(assignmentId)) {
          return authJson({ error: "Guest tranche ledger contains a duplicate assignment ID." }, 400);
        }
        seenAssignmentIds.add(assignmentId);
        ledgerUpserts.push(normalized.record);
      }

      const retainedAssignmentIds = hasRetainedIds ? [] : null;
      if (hasRetainedIds) {
        const seenRetainedIds = new Set();
        for (const value of rawRetainedIds) {
          const id = typeof value === "string" ? value.trim() : "";
          if (!id || id.length > 240 || seenRetainedIds.has(id)) {
            return authJson({ error: "Retained guest assignment IDs must be unique non-empty strings." }, 400);
          }
          seenRetainedIds.add(id);
          retainedAssignmentIds.push(id);
        }
      }

      const key = "guest-portfolio:" + guestId;
      const previous = await this.ctx.storage.get(key);
      const previousRevision = Number.isSafeInteger(previous?.revision) ? previous.revision : 0;
      let encryptedLedger;
      if (hasLedgerUpserts || hasRetainedIds) {
        let existingLedger = { updatedAt: 0, records: [] };
        if (previous?.encryptedLedger) {
          try {
            existingLedger = await this.decryptGuestPayload(previous.encryptedLedger);
            if (!Array.isArray(existingLedger.records)) throw new Error("Invalid guest tranche ledger.");
          } catch {
            return authJson({ error: "Existing guest tranche ledger could not be decrypted." }, 500);
          }
        }
        const updatedAt = Number(normalizedSnapshot.snapshot.updatedAt) || Date.now();
        const mergedLedger = this.mergeGuestTrancheLedger(
          existingLedger, ledgerUpserts, retainedAssignmentIds, updatedAt
        );
        if (mergedLedger.records.length > 5000) {
          return authJson({ error: "Guest tranche history exceeds the 5,000-record limit." }, 413);
        }
        try {
          encryptedLedger = await this.encryptGuestPayload(mergedLedger);
        } catch {
          return authJson({ error: "Guest tranche ledger could not be encrypted." }, 500);
        }
      }

      let encryptedSnapshot;
      try {
        encryptedSnapshot = await this.encryptGuestProjection(normalizedSnapshot.snapshot);
      } catch {
        return authJson({ error: "Guest portfolio snapshot could not be encrypted." }, 500);
      }
      prepared.push({
        guestId, key, previousRevision, encryptedSnapshot,
        ...(encryptedLedger ? { encryptedLedger } : {})
      });
    }

    // Re-check roles and revisions in the same transaction as the writes. A user
    // who was deleted/changed, or a concurrent publisher, cannot silently win.
    const result = await this.ctx.storage.transaction(async (transaction) => {
      const users = await transaction.get(AUTH_USERS_KEY) || [];
      const stillGuests = new Set(users.filter((user) => user.role === "guest").map((user) => user.id));
      if (prepared.some((item) => !stillGuests.has(item.guestId))) {
        return { error: "A target guest account changed while the update was being prepared.", status: 409 };
      }
      const currentRecords = [];
      for (const item of prepared) {
        const current = await transaction.get(item.key);
        const revision = Number.isSafeInteger(current?.revision) ? current.revision : 0;
        if (revision !== item.previousRevision) {
          return { error: "Guest portfolio changed while the update was being prepared. Refresh and retry.", status: 409 };
        }
        currentRecords.push({ item, current, revision });
      }
      const revisions = {};
      for (const { item, current, revision } of currentRecords) {
        const nextRevision = revision + 1;
        await transaction.put(item.key, {
          encryptedSnapshot: item.encryptedSnapshot,
          ...(item.encryptedLedger ? { encryptedLedger: item.encryptedLedger } :
            current?.encryptedLedger ? { encryptedLedger: current.encryptedLedger } : {}),
          revision: nextRevision
        });
        revisions[item.guestId] = nextRevision;
      }
      return { revisions };
    });
    if (result.error) return authJson({ error: result.error }, result.status || 409);
    const responseHeaders = { ...CORS_HEADERS, "Cache-Control": "no-store" };
    if (prepared.length === 1) {
      responseHeaders.ETag = `"${result.revisions[prepared[0].guestId]}"`;
    }
    return new Response(JSON.stringify({ success: true, revisions: result.revisions }), {
      status: 200,
      headers: responseHeaders
    });
  }


  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const requestUrl = new URL(request.url);
    await this.clearRetiredTradeNetSession();
    if (requestUrl.pathname.startsWith("/api/auth/")) return this.handleAuth(request);
    if (requestUrl.pathname === "/api/guest-portfolio") return this.handleGuestPortfolio(request);

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

    const result = await this.ctx.storage.transaction(async () => {
      const current = await this.ctx.storage.get(recordKey);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return { conflict: true, revision: currentRevision };
      }
      const nextRevision = currentRevision + 1;
      await this.ctx.storage.put(recordKey, { payload: JSON.stringify(body), revision: nextRevision });
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
