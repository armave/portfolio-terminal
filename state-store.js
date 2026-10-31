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
const FREEDOM_TRADE_NET_SESSION_KEY = "freedom:tradenet-session";
const AUTH_SESSION_PREFIX = "auth:session:";
const AUTH_LOGIN_FAILURE_PREFIX = "auth:login-failure:";
const AUTH_LOGIN_FAILURE_LIMIT = 10;
const AUTH_LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_LEGACY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

  async resolveSession(request) {
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

    if (user.role === "guest") {
      // Existing sessions predate issuedAt and carry a seven-day expiresAt.
      // Reconstruct their original issue time so active legacy guest tokens
      // receive the full 30-day policy without restarting the session clock.
      const issuedAt = Number.isFinite(session.issuedAt)
        ? session.issuedAt
        : Number.isFinite(session.expiresAt)
          ? session.expiresAt - AUTH_LEGACY_SESSION_TTL_MS
          : NaN;
      const expiresAt = issuedAt + AUTH_GUEST_SESSION_TTL_MS;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await this.ctx.storage.delete(sessionKey);
        return null;
      }
      if (session.issuedAt !== issuedAt || session.expiresAt !== expiresAt) {
        await this.ctx.storage.put(sessionKey, { ...session, issuedAt, expiresAt });
      }
    }

    // Administrator sessions are intentionally non-expiring. Logout,
    // password changes, and account deletion still revoke them explicitly.
    return { user, sessionKey };
  }

  async issueSession(user) {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const issuedAt = Date.now();
    const expiresAt = user.role === "guest"
      ? issuedAt + AUTH_GUEST_SESSION_TTL_MS
      : null;
    const sessionKey = AUTH_SESSION_PREFIX + await digestHex(token);
    await this.ctx.storage.put(sessionKey, { userId: user.id, issuedAt, expiresAt });
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
      const name = normalizeAccountName(body.name);
      if (!name || typeof body.password !== "string" || body.password.length > 128) return authJson({ error: "Invalid name or password." }, 400);
      const ipAddress = request.headers.get("CF-Connecting-IP") || "unknown";
      const failureKey = AUTH_LOGIN_FAILURE_PREFIX + await digestHex(name.toLocaleLowerCase("en-US") + "|" + ipAddress);
      const previousFailures = await this.ctx.storage.get(failureKey);
      if (previousFailures && previousFailures.expiresAt > Date.now() && previousFailures.count >= AUTH_LOGIN_FAILURE_LIMIT) {
        return new Response(JSON.stringify({ error: "Too many failed sign-in attempts. Try again in 15 minutes." }), {
          status: 429, headers: { ...CORS_HEADERS, "Retry-After": "900" }
        });
      }
      const user = (await this.getAuthUsers()).find((item) => item.normalizedName === name.toLocaleLowerCase("en-US"));
      const salt = user?.salt || "portfolio-terminal-login-validation";
      const expected = user?.passwordHash || await derivePasswordHash("invalid-password", salt);
      const actual = await derivePasswordHash(body.password, salt);
      if (!user || !secureEqual(actual, expected)) {
        const activeFailures = previousFailures && previousFailures.expiresAt > Date.now() ? previousFailures : { count: 0, expiresAt: Date.now() + AUTH_LOGIN_FAILURE_WINDOW_MS };
        const count = activeFailures.count + 1;
        await this.ctx.storage.put(failureKey, { count, expiresAt: activeFailures.expiresAt });
        if (count >= AUTH_LOGIN_FAILURE_LIMIT) {
          return new Response(JSON.stringify({ error: "Too many failed sign-in attempts. Try again in 15 minutes." }), {
            status: 429, headers: { ...CORS_HEADERS, "Retry-After": "900" }
          });
        }
        return authJson({ error: "Invalid name or password." }, 401);
      }
      await this.ctx.storage.delete(failureKey);
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
          return { user: next, passwordChanged: Boolean(passwordSalt) };
        });
        if (updated.error) return authJson({ error: updated.error }, updated.status);
        // A role/name/password change invalidates any previously published
        // guest projection until the administrator republishes the current assignment.
        await this.ctx.storage.delete("guest-portfolio:" + id);
        if (updated.passwordChanged) await this.revokeUserSessions(id, session.sessionKey);
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

  async encryptGuestProjection(snapshot) {
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
      authEncoder.encode(JSON.stringify(snapshot))
    );
    const toBase64 = (bytes) => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    return "aesgcm:v1:" + toBase64(nonce) + ":" + toBase64(new Uint8Array(ciphertext));
  }

  async decryptGuestProjection(envelope) {
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
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tranches)) {
      throw new Error("Invalid guest portfolio snapshot.");
    }
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

  async handleGuestPortfolio(request) {
    const session = await this.resolveSession(request);
    if (!session) return authJson({ error: "Authentication required." }, 401);

    if (request.method === "GET") {
      if (session.user.role !== "guest") return authJson({ error: "Guest account required." }, 403);
      const record = await this.ctx.storage.get("guest-portfolio:" + session.user.id);
      const revision = Number.isSafeInteger(record?.revision) ? record.revision : 0;
      let snapshot = { updatedAt: 0, tranches: [] };
      if (record?.encryptedSnapshot) {
        try {
          snapshot = await this.decryptGuestProjection(record.encryptedSnapshot);
        } catch {
          return authJson({ error: "Guest portfolio snapshot could not be decrypted." }, 500);
        }
      }
      return new Response(JSON.stringify({ snapshot, revision }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ETag: `"${revision}"` }
      });
    }

    if (request.method !== "POST" || session.user.role !== "admin") {
      return authJson({ error: "Administrator role required." }, 403);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 512 * 1024) {
      return authJson({ error: "Guest portfolio snapshot exceeds the 512 KB limit." }, 413);
    }
    let body;
    try { body = JSON.parse(rawBody); } catch { return authJson({ error: "Invalid guest portfolio JSON." }, 400); }
    if (Array.isArray(body?.snapshots)) {
      if (body.snapshots.length === 0 || body.snapshots.length > 100) {
        return authJson({ error: "A guest portfolio batch must contain between 1 and 100 snapshots." }, 400);
      }

      const existingGuests = new Set(
        (await this.getAuthUsers()).filter((user) => user.role === "guest").map((user) => user.id)
      );
      const seenGuestIds = new Set();
      const prepared = [];
      for (const item of body.snapshots) {
        const guestId = typeof item?.guestId === "string" ? item.guestId.trim() : "";
        if (!guestId || seenGuestIds.has(guestId)) {
          return authJson({ error: "Guest portfolio batch contains a missing or duplicate guest ID." }, 400);
        }
        if (!existingGuests.has(guestId)) {
          return authJson({ error: "Target guest account does not exist." }, 404);
        }
        seenGuestIds.add(guestId);

        const normalized = this.normalizeGuestPortfolioSnapshot(item.snapshot);
        if (normalized.error) return authJson({ error: normalized.error }, 400);
        let encryptedSnapshot;
        try {
          encryptedSnapshot = await this.encryptGuestProjection(normalized.snapshot);
        } catch {
          return authJson({ error: "Guest portfolio snapshot could not be encrypted." }, 500);
        }
        prepared.push({ guestId, encryptedSnapshot });
      }

      // Re-check guest roles inside the same transaction as the writes. A user
      // deleted or changed to admin while snapshots were being encrypted cannot
      // receive a stale guest projection.
      const result = await this.ctx.storage.transaction(async (transaction) => {
        const users = await transaction.get(AUTH_USERS_KEY) || [];
        const stillGuests = new Set(users.filter((user) => user.role === "guest").map((user) => user.id));
        if (prepared.some((item) => !stillGuests.has(item.guestId))) {
          return { error: "A target guest account changed while the batch was being published." };
        }

        const revisions = {};
        for (const item of prepared) {
          const key = "guest-portfolio:" + item.guestId;
          const current = await transaction.get(key);
          const revision = (Number.isSafeInteger(current?.revision) ? current.revision : 0) + 1;
          await transaction.put(key, { encryptedSnapshot: item.encryptedSnapshot, revision });
          revisions[item.guestId] = revision;
        }
        return { revisions };
      });
      if (result.error) return authJson({ error: result.error }, 409);
      return new Response(JSON.stringify({ success: true, revisions: result.revisions }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store" }
      });
    }

    const guestId = typeof body?.guestId === "string" ? body.guestId.trim() : "";
    const source = body?.snapshot;
    if (!guestId || !source || typeof source !== "object" || Array.isArray(source) ||
        !Number.isFinite(Number(source.updatedAt)) || !Array.isArray(source.tranches) ||
        source.tranches.length > 500) {
      return authJson({ error: "Invalid guest portfolio snapshot." }, 400);
    }

    const guest = (await this.getAuthUsers()).find((user) => user.id === guestId && user.role === "guest");
    if (!guest) return authJson({ error: "Target guest account does not exist." }, 404);

    const seenIds = new Set();
    const tranches = [];
    for (const item of source.tranches) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const ticker = typeof item?.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
      const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : ticker;
      const quantity = Number(item?.quantity);
      if (!id || id.length > 200 || seenIds.has(id) || !/^[A-Z0-9.^=-]{1,20}$/.test(ticker) ||
          !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) {
        return authJson({ error: "Guest portfolio contains an invalid tranche." }, 400);
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

    const snapshot = { updatedAt: Number(source.updatedAt), tranches };
    let encryptedSnapshot;
    try {
      encryptedSnapshot = await this.encryptGuestProjection(snapshot);
    } catch {
      return authJson({ error: "Guest portfolio snapshot could not be encrypted." }, 500);
    }
    const key = "guest-portfolio:" + guestId;
    const revision = await this.ctx.storage.transaction(async () => {
      const current = await this.ctx.storage.get(key);
      const nextRevision = (Number.isSafeInteger(current?.revision) ? current.revision : 0) + 1;
      await this.ctx.storage.put(key, { encryptedSnapshot, revision: nextRevision });
      return nextRevision;
    });
    return new Response(JSON.stringify({ success: true, revision }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ETag: `"${revision}"` }
    });
  }

  async handleInternalFreedomSession(request) {
    const expectedSecret = typeof this.env.GATEWAY_SECRET === "string" ? this.env.GATEWAY_SECRET : "";
    const suppliedSecret = request.headers.get("X-Internal-Worker-Auth") || "";
    if (!expectedSecret || !secureEqual(suppliedSecret, expectedSecret)) {
      return authJson({ error: "Internal Worker authorization required." }, 401);
    }

    if (request.method === "GET") {
      const session = await this.ctx.storage.get(FREEDOM_TRADE_NET_SESSION_KEY);
      if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
        if (session) await this.ctx.storage.delete(FREEDOM_TRADE_NET_SESSION_KEY);
        return authJson({ error: "TradeNet session is not available." }, 404);
      }
      return authJson({ session });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return authJson({ error: "A valid TradeNet session payload is required." }, 400);
      }
      if (body.clear === true) {
        await this.ctx.storage.delete(FREEDOM_TRADE_NET_SESSION_KEY);
        return authJson({ success: true });
      }
      if (typeof body.sid !== "string" || body.sid.length < 10 || body.sid.length > 4096 ||
          !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now() || body.real !== true) {
        return authJson({ error: "Invalid TradeNet session payload." }, 400);
      }
      const session = {
        sid: body.sid,
        expiresAt: body.expiresAt,
        real: true,
        createdAt: Number.isSafeInteger(body.createdAt) ? body.createdAt : Date.now()
      };
      await this.ctx.storage.put(FREEDOM_TRADE_NET_SESSION_KEY, session);
      return authJson({ success: true, expiresAt: session.expiresAt });
    }

    return authJson({ error: "Method not allowed." }, 405);
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/internal/freedom-session") return this.handleInternalFreedomSession(request);
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
