import { createFreedomMarketDepthBook } from "./src/services/freedomMarketDepth.js";

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

const FREEDOM_TRADENET_SESSION_TTL_MS = 30 * 60 * 1000;
const FREEDOM_TRADENET_RATE_LIMIT_BASE_MS = 60 * 1000;
const FREEDOM_TRADENET_RATE_LIMIT_MAX_MS = 15 * 60 * 1000;
const FREEDOM_TRADENET_SOCKET_CONNECT_TIMEOUT_MS = 12_000;
const FREEDOM_DEPTH_STREAM_TICKET_TTL_MS = 60_000;
const FREEDOM_DEPTH_STREAM_MAX_LIFETIME_MS = 30 * 60 * 1000;
const FREEDOM_DEPTH_STREAM_IDLE_TIMEOUT_MS = 60_000;
const FREEDOM_DEPTH_STREAM_HANDSHAKE_TIMEOUT_MS = 10_000;
const FREEDOM_DEPTH_STREAM_MAX_SESSIONS = 4;
const FREEDOM_DEPTH_STREAM_MAX_MESSAGE_BYTES = 256 * 1024;
const FREEDOM_DEPTH_STREAM_MAX_PENDING_UPDATES = 20;

function sanitizeFreedomTradeNetLoginError(value) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/(password|passwd|pwd|login|username|email|sid|token|signature|secret)\s*[:=]\s*[^,\s;)]+/gi, "$1=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return sanitized || null;
}

function freedomTradeNetLoginErrorCode(payload) {
  const value = payload?.errorCode ?? payload?.code;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(value)) return value;
  return null;
}

function retryAfterMilliseconds(response, fallbackMs) {
  const value = response?.headers?.get?.("Retry-After");
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(FREEDOM_TRADENET_RATE_LIMIT_MAX_MS, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(1000, Math.min(FREEDOM_TRADENET_RATE_LIMIT_MAX_MS, date - Date.now()));
  return fallbackMs;
}

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
    // Broker SID stays in this Durable Object's memory only. Never persist it
    // to SQLite/KV or expose it through a client-facing route.
    this.freedomTradeNetSession = null;
    this.freedomTradeNetLoginPromise = null;
    this.freedomTradeNetRateLimitUntil = 0;
    this.freedomTradeNetRateLimitAttempts = 0;
    // One authenticated upstream q socket is shared by all browser clients in
    // this account workspace. Browser sockets are hibernatable; TradeNet's SID
    // and upstream socket are never exposed to the browser.
    this.freedomQuoteUpstream = null;
    this.freedomQuoteUpstreamConnectPromise = null;
    this.freedomQuoteUpstreamReady = false;
    this.freedomQuoteUpstreamWaiter = null;
    this.freedomQuoteSubscribedSymbols = new Set();
    this.freedomQuoteLastBySymbol = new Map();
    // Private account updates use their own authenticated upstream socket and
    // a separate hibernatable browser-client group; guests never join this group.
    this.freedomAccountUpstream = null;
    this.freedomAccountUpstreamConnectPromise = null;
    this.freedomAccountUpstreamReady = false;
    this.freedomAccountUpstreamWaiter = null;
    this.freedomAccountLastByEvent = new Map();
    this.freedomAccountOrdersById = new Map();
    this.freedomAccountOrdersSnapshotReceived = false;
    this.freedomAccountPendingEvents = [];
    this.freedomDepthStreams = new Map();
  }

  async requestFreedomTradeNetSession() {
    if (!this.env.FREEDOM_LOGIN || !this.env.FREEDOM_PASSWORD) {
      const error = new Error("FREEDOM_LOGIN and FREEDOM_PASSWORD must be configured as Worker secrets.");
      error.status = 503;
      throw error;
    }

    const authRequest = {
      cmd: "authByLogin",
      params: {
        login: this.env.FREEDOM_LOGIN,
        password: this.env.FREEDOM_PASSWORD,
        rememberMe: 1,
        getAccounts: false
      }
    };
    const form = new URLSearchParams({ q: JSON.stringify(authRequest) });
    const response = await fetch("https://tradernet.am/api/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(12000)
    });
    const payload = await response.json().catch(() => null);

    const providerErrorMessage = sanitizeFreedomTradeNetLoginError(
      payload?.errMsg ?? payload?.error ?? payload?.message
    );
    const providerErrorCode = freedomTradeNetLoginErrorCode(payload);
    const failed = !response.ok || !payload || payload.success !== true ||
      payload.logged !== true || typeof payload.SID !== "string" ||
      payload.SID.length < 10 || payload.real !== true;

    if (failed) {
      const isRateLimited = response.status === 429 ||
        Number(providerErrorCode) === 429 ||
        /request limit has been exceeded|too many requests|rate.?limit/i.test(providerErrorMessage || "");
      let retryAfterSeconds = null;
      if (isRateLimited) {
        this.freedomTradeNetRateLimitAttempts += 1;
        const fallbackMs = Math.min(
          FREEDOM_TRADENET_RATE_LIMIT_MAX_MS,
          FREEDOM_TRADENET_RATE_LIMIT_BASE_MS * (2 ** Math.min(8, this.freedomTradeNetRateLimitAttempts - 1))
        );
        const cooldownMs = retryAfterMilliseconds(response, fallbackMs);
        this.freedomTradeNetRateLimitUntil = Date.now() + cooldownMs;
        retryAfterSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
      }

      const failedChecks = [];
      if (!payload) failedChecks.push("login_payload_missing_or_invalid_json");
      if (payload?.success !== true) failedChecks.push("success_not_true");
      if (payload?.logged !== true) failedChecks.push("logged_not_true");
      if (typeof payload?.SID !== "string" || payload.SID.length < 10) failedChecks.push("sid_missing_or_invalid");
      if (payload?.real !== true) failedChecks.push("production_session_not_confirmed");
      if (providerErrorMessage || providerErrorCode !== null) failedChecks.push("provider_returned_login_error");
      if (isRateLimited) failedChecks.push("login_rate_limit_cooldown");

      const error = new Error(payload?.real === false
        ? "TradeNet returned a demo or non-production account session."
        : isRateLimited
          ? providerErrorMessage || "TradeNet login request was rate limited. Please retry after the cooldown."
          : providerErrorMessage
            ? "TradeNet rejected the login request: " + providerErrorMessage
            : !response.ok
              ? "TradeNet login endpoint returned HTTP " + response.status + "."
              : "TradeNet login failed or requested additional verification.");
      error.status = isRateLimited ? 429 : payload?.real === false ? 403 : response.ok ? 401 : response.status >= 500 ? 502 : 401;
      error.diagnostics = {
        phase: isRateLimited ? "login_rate_limited" : "login_response_validation",
        loginResponseReceived: true,
        loginHttpStatus: response.status,
        payloadReceived: Boolean(payload),
        success: payload?.success === true,
        logged: payload?.logged === true,
        sidPresent: typeof payload?.SID === "string" && payload.SID.length >= 10,
        productionSession: payload?.real === true ? true : payload?.real === false ? false : null,
        providerErrorFieldPresent: Boolean(payload && (
          Object.prototype.hasOwnProperty.call(payload, "errMsg") ||
          Object.prototype.hasOwnProperty.call(payload, "error") ||
          Object.prototype.hasOwnProperty.call(payload, "errorCode") ||
          Object.prototype.hasOwnProperty.call(payload, "code") ||
          Object.prototype.hasOwnProperty.call(payload, "message")
        )),
        providerErrorCode,
        providerErrorMessage,
        ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
        failedChecks
      };
      throw error;
    }

    this.freedomTradeNetRateLimitAttempts = 0;
    this.freedomTradeNetRateLimitUntil = 0;
    return payload.SID;
  }

  async getFreedomTradeNetSession() {
    const now = Date.now();
    if (this.freedomTradeNetSession && this.freedomTradeNetSession.expiresAt > now) {
      return this.freedomTradeNetSession.sid;
    }
    if (this.freedomTradeNetSession) this.freedomTradeNetSession = null;

    if (this.freedomTradeNetRateLimitUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.freedomTradeNetRateLimitUntil - now) / 1000));
      const error = new Error("TradeNet login is rate limited. Retry in " + retryAfterSeconds + " seconds.");
      error.status = 429;
      error.diagnostics = {
        phase: "login_rate_limit_cooldown",
        providerErrorCode: 429,
        providerErrorMessage: "Your request limit has been exceeded. Please try again later.",
        retryAfterSeconds,
        cachedSessionAvailable: false
      };
      throw error;
    }

    if (!this.freedomTradeNetLoginPromise) {
      const loginPromise = this.requestFreedomTradeNetSession();
      this.freedomTradeNetLoginPromise = loginPromise;
    }
    const pending = this.freedomTradeNetLoginPromise;
    try {
      const sid = await pending;
      if (this.freedomTradeNetLoginPromise === pending) {
        this.freedomTradeNetSession = {
          sid,
          expiresAt: Date.now() + FREEDOM_TRADENET_SESSION_TTL_MS
        };
      }
      return sid;
    } finally {
      if (this.freedomTradeNetLoginPromise === pending) {
        this.freedomTradeNetLoginPromise = null;
      }
    }
  }

  invalidateFreedomTradeNetSession(sid) {
    if (!sid || this.freedomTradeNetSession?.sid !== sid) return false;
    this.freedomTradeNetSession = null;
    return true;
  }

  async handleFreedomTradeNetSessionRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/freedom-tradenet-session") {
      if (request.method !== "GET") return authJson({ error: "Method not allowed." }, 405);
      try {
        const sid = await this.getFreedomTradeNetSession();
        return authJson({ ok: true, sid, expiresInSeconds: Math.floor(FREEDOM_TRADENET_SESSION_TTL_MS / 1000) });
      } catch (error) {
        const status = Number(error?.status) || 502;
        return authJson({
          ok: false,
          error: error instanceof Error ? error.message : "TradeNet session could not be created.",
          diagnostics: error?.diagnostics || null
        }, status);
      }
    }

    if (url.pathname === "/internal/freedom-tradenet-session/invalidate") {
      if (request.method !== "POST") return authJson({ error: "Method not allowed." }, 405);
      const body = await request.json().catch(() => null);
      const invalidated = this.invalidateFreedomTradeNetSession(body?.sid);
      return authJson({ ok: true, invalidated });
    }
    return null;
  }


  normalizeFreedomQuoteSymbols(input) {
    const values = Array.isArray(input) ? input : [];
    const symbols = [...new Set(values.map((value) => {
      const normalized = String(value || "").trim().toUpperCase();
      return normalized && !normalized.includes(".") ? normalized + ".US" : normalized;
    }))];
    if (symbols.length < 1 || symbols.length > 10 ||
        symbols.some((symbol) => !/^[A-Z0-9.^=-]{1,32}$/.test(symbol))) {
      throw new Error("Quote stream requires 1–10 valid ticker symbols.");
    }
    return symbols;
  }

  async handleFreedomQuoteStreamTicketRequest(request) {
    if (request.method !== "POST") return authJson({ error: "Method not allowed." }, 405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !["admin", "guest"].includes(body.role) ||
        typeof body.accountId !== "string" || !body.accountId.trim() || body.accountId.length > 128) {
      return authJson({ error: "Invalid quote stream ticket request." }, 400);
    }
    let symbols;
    try {
      symbols = this.normalizeFreedomQuoteSymbols(body.symbols);
    } catch (error) {
      return authJson({ error: error instanceof Error ? error.message : "Invalid quote stream symbols." }, 400);
    }
    const ticket = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const ticketKey = "freedom:quote-stream-ticket:" + await digestHex(ticket);
    const expiresAt = Date.now() + 60_000;
    await this.ctx.storage.put(ticketKey, {
      accountId: body.accountId,
      role: body.role,
      symbols,
      expiresAt
    });
    return authJson({ ok: true, ticket, expiresAt });
  }

  async consumeFreedomQuoteStreamTicket(ticket) {
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/i.test(ticket)) return null;
    const ticketKey = "freedom:quote-stream-ticket:" + await digestHex(ticket);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(ticketKey);
      if (!stored) return null;
      await transaction.delete(ticketKey);
      if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now()) return null;
      if (!["admin", "guest"].includes(stored.role) ||
          typeof stored.accountId !== "string" || !Array.isArray(stored.symbols)) return null;
      try {
        return {
          accountId: stored.accountId,
          role: stored.role,
          symbols: this.normalizeFreedomQuoteSymbols(stored.symbols)
        };
      } catch {
        return null;
      }
    });
  }

  async handleFreedomQuoteStreamSocketRequest(request) {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return authJson({ error: "A WebSocket upgrade is required." }, 426);
    }
    const url = new URL(request.url);
    const claims = await this.consumeFreedomQuoteStreamTicket(url.searchParams.get("ticket"));
    if (!claims) return authJson({ error: "Quote stream ticket is invalid, expired, or already used." }, 401);

    try {
      await this.ensureFreedomQuoteUpstream(claims.symbols);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TradeNet quote stream could not be established.";
      return authJson({ error: message }, 502);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({
      accountId: claims.accountId,
      role: claims.role,
      symbols: claims.symbols
    });
    this.ctx.acceptWebSocket(server, ["freedom-tradenet-quotes"]);
    server.send(JSON.stringify({
      type: "ready",
      provider: "Freedom TradeNet",
      transport: "websocket",
      symbols: claims.symbols
    }));
    for (const symbol of claims.symbols) {
      const cached = this.freedomQuoteLastBySymbol.get(symbol);
      if (cached) server.send(JSON.stringify(cached));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleFreedomAccountStreamTicketRequest(request) {
    if (request.method !== "POST") return authJson({ error: "Method not allowed." }, 405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        body.role !== "admin" ||
        typeof body.accountId !== "string" || !body.accountId.trim() || body.accountId.length > 128) {
      return authJson({ error: "An administrator account is required for the private TradeNet stream." }, 403);
    }
    const ticket = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const ticketKey = "freedom:account-stream-ticket:" + await digestHex(ticket);
    const expiresAt = Date.now() + 60_000;
    await this.ctx.storage.put(ticketKey, { accountId: body.accountId, role: "admin", expiresAt });
    return authJson({ ok: true, ticket, expiresAt });
  }

  async consumeFreedomAccountStreamTicket(ticket) {
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/i.test(ticket)) return null;
    const ticketKey = "freedom:account-stream-ticket:" + await digestHex(ticket);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(ticketKey);
      if (!stored) return null;
      await transaction.delete(ticketKey);
      if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now() ||
          stored.role !== "admin" || typeof stored.accountId !== "string" || !stored.accountId.trim()) return null;
      return { accountId: stored.accountId, role: "admin" };
    });
  }

  async handleFreedomAccountStreamSocketRequest(request) {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return authJson({ error: "A WebSocket upgrade is required." }, 426);
    }
    const url = new URL(request.url);
    const claims = await this.consumeFreedomAccountStreamTicket(url.searchParams.get("ticket"));
    if (!claims) return authJson({ error: "Account stream ticket is invalid, expired, or already used." }, 401);

    try {
      await this.ensureFreedomAccountUpstream(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TradeNet account stream could not be established.";
      return authJson({ error: message }, 502);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ ...claims, stream: "account" });
    this.ctx.acceptWebSocket(server, ["freedom-tradenet-account"]);
    server.send(JSON.stringify({
      type: "ready",
      provider: "Freedom TradeNet",
      transport: "websocket",
      events: ["portfolio", "orders"]
    }));
    for (const eventName of ["portfolio", "orders"]) {
      const cached = this.freedomAccountLastByEvent.get(eventName);
      if (cached) {
        try { server.send(JSON.stringify(cached)); } catch { /* disconnected client */ }
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleFreedomMarketDepthStreamTicketRequest(request) {
    if (request.method !== "POST") return authJson({ error: "Method not allowed." }, 405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        body.role !== "admin" ||
        typeof body.accountId !== "string" || !body.accountId.trim() || body.accountId.length > 128) {
      return authJson({ error: "An administrator account is required for Market Depth." }, 403);
    }
    const rawSymbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    const symbol = rawSymbol && !rawSymbol.includes(".") ? `${rawSymbol}.US` : rawSymbol;
    if (!/^[A-Z0-9.^=-]{1,32}$/.test(symbol)) {
      return authJson({ error: "Provide one valid ticker for Market Depth." }, 400);
    }

    const ticket = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const ticketKey = `freedom:market-depth-stream-ticket:${await digestHex(ticket)}`;
    const expiresAt = Date.now() + FREEDOM_DEPTH_STREAM_TICKET_TTL_MS;
    await this.ctx.storage.put(ticketKey, {
      accountId: body.accountId,
      role: "admin",
      symbol,
      expiresAt
    });
    return authJson({ ok: true, ticket, expiresAt, symbol });
  }

  async consumeFreedomMarketDepthStreamTicket(ticket) {
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/i.test(ticket)) return null;
    const ticketKey = `freedom:market-depth-stream-ticket:${await digestHex(ticket)}`;
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(ticketKey);
      if (!stored) return null;
      await transaction.delete(ticketKey);
      if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now() ||
          stored.role !== "admin" || typeof stored.accountId !== "string" || !stored.accountId.trim() ||
          typeof stored.symbol !== "string" || !/^[A-Z0-9.^=-]{1,32}$/.test(stored.symbol)) return null;
      return { accountId: stored.accountId, role: "admin", symbol: stored.symbol };
    });
  }

  async handleFreedomMarketDepthStreamSocketRequest(request) {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return authJson({ error: "A WebSocket upgrade is required." }, 426);
    }
    const url = new URL(request.url);
    const claims = await this.consumeFreedomMarketDepthStreamTicket(url.searchParams.get("ticket"));
    if (!claims) return authJson({ error: "Market Depth ticket is invalid, expired, or already used." }, 401);
    if (this.freedomDepthStreams.size >= FREEDOM_DEPTH_STREAM_MAX_SESSIONS) {
      return authJson({ error: "The maximum number of live Market Depth sessions is already open." }, 429);
    }

    const streamId = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const session = {
      streamId,
      ...claims,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      upstream: null,
      client: null,
      ready: false,
      waiter: null,
      pendingUpdates: [],
      book: createFreedomMarketDepthBook(claims.symbol),
      lastUpdatedAt: 0
    };
    this.freedomDepthStreams.set(streamId, session);

    try {
      await this.connectFreedomMarketDepthUpstream(session);
    } catch (error) {
      this.closeFreedomMarketDepthSession(streamId, "Market Depth connection failed", false);
      const message = error instanceof Error ? error.message : "TradeNet Market Depth stream could not be established.";
      return authJson({ error: message }, 502);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    session.client = server;
    server.serializeAttachment({
      accountId: claims.accountId,
      role: claims.role,
      symbol: claims.symbol,
      streamId,
      stream: "market-depth"
    });
    this.ctx.acceptWebSocket(server, ["freedom-tradenet-depth"]);
    server.send(JSON.stringify({
      type: "ready",
      provider: "Freedom TradeNet",
      transport: "websocket",
      symbol: claims.symbol
    }));
    if (session.book.updateCount > 0) this.sendFreedomMarketDepthSnapshot(session);
    void this.scheduleFreedomMarketDepthAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async connectFreedomMarketDepthUpstream(session) {
    const sid = await this.getFreedomTradeNetSession();
    if (this.freedomDepthStreams.get(session.streamId) !== session) {
      throw new Error("Market Depth session was closed before TradeNet connected.");
    }
    const url = new URL("https://wss.tradernet.com/");
    url.searchParams.set("SID", sid);
    const response = await fetch(url.toString(), {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(FREEDOM_TRADENET_SOCKET_CONNECT_TIMEOUT_MS)
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      const error = new Error("TradeNet rejected the Market Depth WebSocket connection.");
      error.status = response.status === 401 || response.status === 403 ? response.status : 502;
      throw error;
    }

    session.upstream = socket;
    const handshake = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (session.waiter?.socket === socket) session.waiter = null;
        reject(new Error("TradeNet did not confirm the production Market Depth stream."));
        try { socket.close(1011, "Market Depth handshake timeout"); } catch { /* ignore */ }
      }, FREEDOM_DEPTH_STREAM_HANDSHAKE_TIMEOUT_MS);
      session.waiter = {
        socket,
        resolve: () => {
          clearTimeout(timeout);
          session.waiter = null;
          resolve();
        },
        reject: error => {
          clearTimeout(timeout);
          session.waiter = null;
          reject(error);
        }
      };
    });

    socket.addEventListener("message", event => {
      void this.handleFreedomMarketDepthUpstreamMessage(session, socket, event?.data);
    });
    socket.addEventListener("close", () => {
      if (this.freedomDepthStreams.get(session.streamId) !== session || session.upstream !== socket) return;
      session.upstream = null;
      session.ready = false;
      session.waiter?.reject(new Error("TradeNet closed the Market Depth stream."));
      this.sendFreedomMarketDepthError(session, "TradeNet closed the live Market Depth stream.");
      this.closeFreedomMarketDepthSession(session.streamId, "TradeNet closed the live Market Depth stream");
    });
    socket.addEventListener("error", () => {
      if (this.freedomDepthStreams.get(session.streamId) !== session || session.upstream !== socket) return;
      session.upstream = null;
      session.ready = false;
      session.waiter?.reject(new Error("TradeNet Market Depth stream failed."));
      this.sendFreedomMarketDepthError(session, "TradeNet's live Market Depth connection failed.");
      this.closeFreedomMarketDepthSession(session.streamId, "TradeNet Market Depth connection failed");
      try { socket.close(1011, "Market Depth socket error"); } catch { /* ignore */ }
    });

    try {
      socket.accept();
      socket.send(JSON.stringify(["orderBook", [session.symbol]]));
      await handshake;
    } catch (error) {
      session.waiter?.reject(error);
      try { socket.close(1011, "Market Depth subscription failed"); } catch { /* ignore */ }
      throw error;
    }
  }

  async handleFreedomMarketDepthUpstreamMessage(session, socket, rawMessage) {
    if (this.freedomDepthStreams.get(session.streamId) !== session || session.upstream !== socket) return;
    const text = typeof rawMessage === "string" ? rawMessage : String(rawMessage || "");
    if (new TextEncoder().encode(text).byteLength > FREEDOM_DEPTH_STREAM_MAX_MESSAGE_BYTES) {
      this.sendFreedomMarketDepthError(session, "TradeNet sent an oversized Market Depth update.");
      this.closeFreedomMarketDepthSession(session.streamId, "Oversized Market Depth update");
      return;
    }
    let packet;
    try { packet = JSON.parse(text); } catch { return; }
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const eventName = packet[0];
    if (eventName === "userData") {
      const userData = packet[1];
      const mode = String(userData?.mode || "").trim().toLowerCase();
      if (userData?.isDemo === true || userData?.real === false || mode !== "prod") {
        const error = new Error("TradeNet authenticated a demo or non-production Market Depth session.");
        session.waiter?.reject(error);
        this.sendFreedomMarketDepthError(session, error.message);
        this.closeFreedomMarketDepthSession(session.streamId, "Production session required");
        return;
      }
      session.ready = true;
      session.waiter?.resolve();
      const pendingUpdates = session.pendingUpdates.splice(0);
      for (const payload of pendingUpdates) this.processFreedomMarketDepthUpdate(session, payload);
      return;
    }
    if (eventName === "error") {
      const error = new Error("TradeNet rejected the Market Depth subscription.");
      session.waiter?.reject(error);
      this.sendFreedomMarketDepthError(session, error.message);
      this.closeFreedomMarketDepthSession(session.streamId, "TradeNet subscription rejected");
      return;
    }
    if (eventName !== "b") return;
    if (!session.ready) {
      if (session.pendingUpdates.length < FREEDOM_DEPTH_STREAM_MAX_PENDING_UPDATES) {
        session.pendingUpdates.push(packet[1]);
      }
      return;
    }
    this.processFreedomMarketDepthUpdate(session, packet[1]);
  }

  processFreedomMarketDepthUpdate(session, payload) {
    try {
      const applied = session.book.apply(payload);
      if (applied === 0) return;
      session.lastActivityAt = Date.now();
      session.lastUpdatedAt = session.lastActivityAt;
      this.sendFreedomMarketDepthSnapshot(session);
    } catch (error) {
      this.sendFreedomMarketDepthError(
        session,
        error instanceof Error ? error.message : "TradeNet Market Depth update could not be processed."
      );
      this.closeFreedomMarketDepthSession(session.streamId, "Invalid Market Depth update");
    }
  }

  sendFreedomMarketDepthSnapshot(session) {
    if (!session.client || session.client.readyState !== 1) return;
    const snapshot = session.book.snapshot();
    try {
      session.client.send(JSON.stringify({
        type: "depth",
        symbol: session.symbol,
        updatedAt: session.lastUpdatedAt || Date.now(),
        data: snapshot
      }));
    } catch {
      this.closeFreedomMarketDepthSession(session.streamId, "Market Depth client disconnected");
    }
  }

  sendFreedomMarketDepthError(session, message) {
    if (!session.client || session.client.readyState !== 1) return;
    try { session.client.send(JSON.stringify({ type: "error", message })); } catch { /* socket is closing */ }
  }

  closeFreedomMarketDepthSession(streamId, reason = "Market Depth session closed", closeClient = true) {
    const session = this.freedomDepthStreams.get(streamId);
    if (!session) return;
    this.freedomDepthStreams.delete(streamId);
    session.waiter?.reject(new Error(reason));
    session.waiter = null;
    session.pendingUpdates = [];
    const upstream = session.upstream;
    session.upstream = null;
    if (upstream) {
      try { upstream.close(1000, reason.slice(0, 120)); } catch { /* ignore */ }
    }
    const client = session.client;
    session.client = null;
    if (closeClient && client?.readyState === 1) {
      try { client.close(1000, reason.slice(0, 120)); } catch { /* ignore */ }
    }
    void this.scheduleFreedomMarketDepthAlarm();
  }

  getFreedomMarketDepthClients() {
    if (typeof this.ctx.getWebSockets !== "function") return [];
    return this.ctx.getWebSockets("freedom-tradenet-depth").filter(socket => socket.readyState === 1);
  }

  async scheduleFreedomMarketDepthAlarm() {
    if (typeof this.ctx.storage?.setAlarm !== "function") return;
    const now = Date.now();
    const deadlines = [...this.freedomDepthStreams.values()].map(session =>
      Math.min(session.createdAt + FREEDOM_DEPTH_STREAM_MAX_LIFETIME_MS,
        session.lastActivityAt + FREEDOM_DEPTH_STREAM_IDLE_TIMEOUT_MS)
    );
    if (deadlines.length === 0) {
      if (typeof this.ctx.storage.deleteAlarm === "function") await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(...deadlines)));
  }

  async alarm() {
    const now = Date.now();
    for (const session of [...this.freedomDepthStreams.values()]) {
      if (now - session.createdAt >= FREEDOM_DEPTH_STREAM_MAX_LIFETIME_MS) {
        this.sendFreedomMarketDepthError(session, "This live Market Depth session reached its maximum duration. Close and reopen the modal to continue.");
        this.closeFreedomMarketDepthSession(session.streamId, "Maximum Market Depth session duration reached");
      } else if (now - session.lastActivityAt >= FREEDOM_DEPTH_STREAM_IDLE_TIMEOUT_MS) {
        this.closeFreedomMarketDepthSession(session.streamId, "Market Depth session idle timeout");
      }
    }
    await this.scheduleFreedomMarketDepthAlarm();
  }

  getFreedomAccountClients() {
    if (typeof this.ctx.getWebSockets !== "function") return [];
    return this.ctx.getWebSockets("freedom-tradenet-account")
      .filter((socket) => socket.readyState === 1);
  }

  async ensureFreedomAccountUpstream(force = false) {
    if (!force && this.getFreedomAccountClients().length === 0) return;
    if (this.freedomAccountUpstream && this.freedomAccountUpstream.readyState === 1 &&
        this.freedomAccountUpstreamReady) return;
    if (this.freedomAccountUpstreamConnectPromise) {
      await this.freedomAccountUpstreamConnectPromise;
      return;
    }
    const pending = this.connectFreedomAccountUpstream();
    this.freedomAccountUpstreamConnectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.freedomAccountUpstreamConnectPromise === pending) {
        this.freedomAccountUpstreamConnectPromise = null;
      }
    }
  }

  async connectFreedomAccountUpstream() {
    const sid = await this.getFreedomTradeNetSession();
    const url = new URL("https://wss.tradernet.com/");
    url.searchParams.set("SID", sid);
    const response = await fetch(url.toString(), {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(FREEDOM_TRADENET_SOCKET_CONNECT_TIMEOUT_MS)
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      const error = new Error("TradeNet rejected the persistent portfolio/orders WebSocket connection.");
      error.status = response.status === 401 || response.status === 403 ? response.status : 502;
      throw error;
    }

    this.freedomAccountUpstream = socket;
    this.freedomAccountUpstreamReady = false;
    this.freedomAccountOrdersById.clear();
    this.freedomAccountOrdersSnapshotReceived = false;
    this.freedomAccountPendingEvents = [];

    const handshake = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.freedomAccountUpstreamWaiter?.socket === socket) {
          this.freedomAccountUpstreamWaiter = null;
        }
        reject(new Error("TradeNet did not confirm the production portfolio/orders stream."));
        try { socket.close(1011, "Account stream handshake timeout"); } catch { /* ignore */ }
      }, 10_000);
      this.freedomAccountUpstreamWaiter = {
        socket,
        resolve: () => {
          clearTimeout(timeout);
          this.freedomAccountUpstreamWaiter = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.freedomAccountUpstreamWaiter = null;
          reject(error);
        }
      };
    });

    socket.addEventListener("message", (event) => {
      void this.handleFreedomAccountUpstreamMessage(socket, event?.data);
    });
    socket.addEventListener("close", () => {
      if (this.freedomAccountUpstream !== socket) return;
      this.freedomAccountUpstream = null;
      this.freedomAccountUpstreamReady = false;
      if (this.freedomAccountUpstreamWaiter?.socket === socket) {
        this.freedomAccountUpstreamWaiter.reject(new Error("TradeNet closed the account socket during authentication."));
      }
      this.broadcastFreedomAccountStatus("reconnecting");
    });
    socket.addEventListener("error", () => {
      if (this.freedomAccountUpstream !== socket) return;
      this.freedomAccountUpstream = null;
      this.freedomAccountUpstreamReady = false;
      if (this.freedomAccountUpstreamWaiter?.socket === socket) {
        this.freedomAccountUpstreamWaiter.reject(new Error("TradeNet account socket failed during authentication."));
      }
      this.broadcastFreedomAccountStatus("reconnecting");
      try { socket.close(1011, "TradeNet account socket error"); } catch { /* ignore */ }
    });

    try {
      socket.accept();
      socket.send(JSON.stringify(["portfolio"]));
      socket.send(JSON.stringify(["orders"]));
      await handshake;
    } catch (error) {
      if (this.freedomAccountUpstream === socket) this.freedomAccountUpstream = null;
      this.freedomAccountUpstreamReady = false;
      try { socket.close(1011, "Account stream handshake failed"); } catch { /* ignore */ }
      throw error;
    }
  }

  broadcastFreedomAccountStatus(status, message) {
    const payload = JSON.stringify({ type: "status", status, ...(message ? { message } : {}) });
    for (const client of this.getFreedomAccountClients()) {
      try { client.send(payload); } catch { /* disconnected client */ }
    }
  }

  sanitizeFreedomPortfolioStreamPayload(payload) {
    const source = payload?.portfolio ?? payload?.ps ?? payload?.data?.result?.ps ?? payload?.data?.ps ?? payload;
    const loaded = source?.loaded === true || source?.loaded === 1 ||
      source?.loaded === "1" || source?.loaded === "true";
    if (!source || typeof source !== "object" || !loaded ||
        !Array.isArray(source.acc) || !Array.isArray(source.pos)) return null;
    const numberOrNull = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const usdRows = (rows) => rows.filter((row) =>
      String(row?.curr ?? row?.base_currency ?? "").toUpperCase() === "USD"
    );
    const acc = usdRows(source.acc).map((row) => ({
      curr: "USD",
      s: numberOrNull(row.s),
      currval: numberOrNull(row.currval),
      forecast_in: numberOrNull(row.forecast_in) ?? 0,
      forecast_out: numberOrNull(row.forecast_out) ?? 0,
      t2_in: numberOrNull(row.t2_in) ?? 0,
      t2_out: numberOrNull(row.t2_out) ?? 0
    }));
    const pos = usdRows(source.pos).map((row) => ({
      i: String(row.i ?? row.base_contract_code ?? ""),
      name: String(row.name ?? row.name2 ?? row.i ?? "Unknown instrument"),
      q: numberOrNull(row.q) ?? 0,
      curr: "USD",
      mkt_price: numberOrNull(row.mkt_price),
      market_value: numberOrNull(row.market_value),
      bal_price_a: numberOrNull(row.bal_price_a),
      profit_close: numberOrNull(row.profit_close),
      acc_pos_id: numberOrNull(row.acc_pos_id)
    })).filter((row) => row.i);
    return { data: { result: { ps: { loaded: true, acc, pos } } } };
  }

  sanitizeFreedomOrderStreamPayload(payload) {
    const rows = Array.isArray(payload) ? payload
      : Array.isArray(payload?.orders?.order) ? payload.orders.order
        : Array.isArray(payload?.orders) ? payload.orders
          : Array.isArray(payload?.order) ? payload.order
            : null;
    if (!rows) return null;
    if (rows.length === 0) {
      this.freedomAccountOrdersById.clear();
      this.freedomAccountOrdersSnapshotReceived = true;
      return { data: { orders: { order: [] }, trades: { trade: [] } } };
    }
    const numberOrNull = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    for (const source of rows.slice(0, 500)) {
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const orderId = source.order_id ?? source.id ?? source.orderId;
      const instrument = source.instr ?? source.instr_nm ?? source.i ?? source.ticker ?? source.symbol;
      if (orderId === undefined || orderId === null || !instrument) continue;
      const id = String(orderId).slice(0, 80);
      const side = Number(source.oper ?? source.operation);
      const trades = Array.isArray(source.trade) ? source.trade.slice(0, 500).flatMap((trade) => {
        if (!trade || typeof trade !== "object" || Array.isArray(trade)) return [];
        const tradeId = trade.id ?? trade.trade_id ?? trade.tradeId;
        if (tradeId === undefined || tradeId === null) return [];
        return [{
          id: String(tradeId).slice(0, 80),
          order_id: id,
          instr: String(instrument).slice(0, 64),
          side: side === 1 || side === 2 ? "BUY" : side === 3 ? "SELL" : side === 4 ? "SELL_SHORT" : "Unknown",
          curr: String(source.cur ?? source.curr ?? source.currency ?? "").slice(0, 12),
          date: typeof trade.date === "string" ? trade.date.slice(0, 80) : "",
          p: numberOrNull(trade.p),
          q: numberOrNull(trade.q),
          v: numberOrNull(trade.v),
          profit: numberOrNull(trade.profit),
          acd: numberOrNull(trade.acd),
          fv: numberOrNull(trade.fv),
          go_sum: numberOrNull(trade.go_sum)
        }];
      }) : [];
      const order = {
        order_id: id,
        instr: String(instrument).slice(0, 64),
        oper: Number.isFinite(side) ? side : null,
        type: numberOrNull(source.type),
        p: numberOrNull(source.p),
        q: numberOrNull(source.q),
        leaves_qty: numberOrNull(source.leaves_qty ?? source.remaining_qty),
        stat: source.stat === undefined || source.stat === null ? "" : String(source.stat).slice(0, 32),
        date: typeof source.date === "string" ? source.date.slice(0, 80) : "",
        trade: trades
      };
      const previous = this.freedomAccountOrdersById.get(id);
      const mergedTrades = new Map();
      for (const trade of [...(previous?.trade || []), ...trades]) mergedTrades.set(trade.id, trade);
      this.freedomAccountOrdersById.set(id, {
        ...previous,
        ...order,
        trade: [...mergedTrades.values()].slice(-1000)
      });
    }
    this.freedomAccountOrdersSnapshotReceived = true;
    const orders = [...this.freedomAccountOrdersById.values()].slice(-1000);
    const trades = new Map();
    for (const order of orders) {
      for (const trade of order.trade || []) trades.set(trade.id, trade);
    }
    return {
      data: {
        orders: { order: orders },
        trades: { trade: [...trades.values()].slice(-5000) }
      }
    };
  }

  async handleFreedomAccountUpstreamMessage(socket, rawMessage) {
    if (this.freedomAccountUpstream !== socket) return;
    let packet;
    try {
      packet = JSON.parse(typeof rawMessage === "string" ? rawMessage : String(rawMessage || ""));
    } catch {
      return;
    }
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const eventName = packet[0];
    if (eventName === "userData") {
      const userData = packet[1];
      const mode = String(userData?.mode || "").trim().toLowerCase();
      if (userData?.isDemo === true || userData?.real === false || mode !== "prod") {
        const error = new Error("TradeNet authenticated a demo or non-production account stream.");
        this.freedomAccountUpstreamWaiter?.reject(error);
        this.freedomAccountUpstreamReady = false;
        try { socket.close(1008, "Production TradeNet session required"); } catch { /* ignore */ }
        return;
      }
      this.freedomAccountUpstreamReady = true;
      this.freedomAccountUpstreamWaiter?.resolve();
      this.broadcastFreedomAccountStatus("connected");
      const pendingEvents = this.freedomAccountPendingEvents.splice(0);
      for (const pending of pendingEvents) {
        this.processFreedomAccountEvent(pending.eventName, pending.payload);
      }
      return;
    }
    if (eventName === "error") {
      const error = new Error("TradeNet rejected the portfolio/orders subscription.");
      this.freedomAccountUpstreamWaiter?.reject(error);
      this.freedomAccountUpstreamReady = false;
      this.broadcastFreedomAccountStatus("reconnecting", error.message);
      try { socket.close(1011, "TradeNet account subscription rejected"); } catch { /* ignore */ }
      return;
    }
    if (eventName !== "portfolio" && eventName !== "orders") return;
    if (!this.freedomAccountUpstreamReady) {
      if (this.freedomAccountPendingEvents.length < 4) {
        this.freedomAccountPendingEvents.push({ eventName, payload: packet[1] });
      }
      return;
    }
    this.processFreedomAccountEvent(eventName, packet[1]);
  }

  processFreedomAccountEvent(eventName, payload) {
    const receivedAt = Date.now();
    if (eventName === "portfolio") {
      const data = this.sanitizeFreedomPortfolioStreamPayload(payload);
      if (!data) return;
      const message = { type: "portfolio", data, receivedAt };
      this.freedomAccountLastByEvent.set("portfolio", message);
      for (const client of this.getFreedomAccountClients()) {
        try { client.send(JSON.stringify(message)); } catch { /* disconnected client */ }
      }
      return;
    }
    if (eventName === "orders") {
      const data = this.sanitizeFreedomOrderStreamPayload(payload);
      if (!data) return;
      const message = { type: "orders", data, receivedAt };
      this.freedomAccountLastByEvent.set("orders", message);
      for (const client of this.getFreedomAccountClients()) {
        try { client.send(JSON.stringify(message)); } catch { /* disconnected client */ }
      }
    }
  }

  closeFreedomAccountUpstream(reason = "No account stream clients remain") {
    const socket = this.freedomAccountUpstream;
    this.freedomAccountUpstream = null;
    this.freedomAccountUpstreamReady = false;
    this.freedomAccountOrdersById.clear();
    this.freedomAccountOrdersSnapshotReceived = false;
    this.freedomAccountLastByEvent.clear();
    this.freedomAccountPendingEvents = [];
    if (socket) {
      try { socket.close(1000, reason); } catch { /* ignore */ }
    }
  }

  getFreedomQuoteClients() {
    if (typeof this.ctx.getWebSockets !== "function") return [];
    return this.ctx.getWebSockets("freedom-tradenet-quotes")
      .filter((socket) => socket.readyState === 1);
  }

  getConnectedFreedomQuoteSymbols() {
    const symbols = new Set();
    for (const socket of this.getFreedomQuoteClients()) {
      const attachment = socket.deserializeAttachment?.();
      for (const symbol of Array.isArray(attachment?.symbols) ? attachment.symbols : []) {
        if (typeof symbol === "string") symbols.add(symbol);
      }
    }
    return [...symbols].sort();
  }

  async ensureFreedomQuoteUpstream(requiredSymbols = []) {
    const symbols = [...new Set([
      ...this.getConnectedFreedomQuoteSymbols(),
      ...(Array.isArray(requiredSymbols) ? requiredSymbols : [])
    ])].sort();
    if (!symbols.length) return;

    if (this.freedomQuoteUpstream && this.freedomQuoteUpstream.readyState === 1 &&
        this.freedomQuoteUpstreamReady) {
      const desired = new Set(symbols);
      const hasObsoleteSubscriptions = [...this.freedomQuoteSubscribedSymbols]
        .some((symbol) => !desired.has(symbol));
      if (hasObsoleteSubscriptions) {
        // TradeNet's quote subscription has no verified unsubscribe contract.
        // Rebuild the shared upstream only when active browser clients have
        // dropped a symbol, so old tickers stop consuming provider bandwidth.
        const previous = this.freedomQuoteUpstream;
        this.freedomQuoteUpstream = null;
        this.freedomQuoteUpstreamReady = false;
        this.freedomQuoteSubscribedSymbols.clear();
        for (const symbol of this.freedomQuoteLastBySymbol.keys()) {
          if (!desired.has(symbol)) this.freedomQuoteLastBySymbol.delete(symbol);
        }
        for (const client of this.getFreedomQuoteClients()) {
          try { client.send(JSON.stringify({ type: "status", status: "reconnecting" })); } catch { /* disconnected client */ }
        }
        try { previous.close(1000, "Quote subscription set changed"); } catch { /* ignore close races */ }
      } else {
        const missing = symbols.filter((symbol) => !this.freedomQuoteSubscribedSymbols.has(symbol));
        if (missing.length) {
          this.freedomQuoteUpstream.send(JSON.stringify(["quotes", missing]));
          missing.forEach((symbol) => this.freedomQuoteSubscribedSymbols.add(symbol));
        }
        return;
      }
    }

    if (this.freedomQuoteUpstreamConnectPromise) {
      await this.freedomQuoteUpstreamConnectPromise;
      return this.ensureFreedomQuoteUpstream(symbols);
    }

    const pending = this.connectFreedomQuoteUpstream(symbols);
    this.freedomQuoteUpstreamConnectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.freedomQuoteUpstreamConnectPromise === pending) {
        this.freedomQuoteUpstreamConnectPromise = null;
      }
    }
  }

  async connectFreedomQuoteUpstream(symbols) {
    const sid = await this.getFreedomTradeNetSession();
    const url = new URL("https://wss.tradernet.com/");
    url.searchParams.set("SID", sid);
    const response = await fetch(url.toString(), {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(FREEDOM_TRADENET_SOCKET_CONNECT_TIMEOUT_MS)
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      const error = new Error("TradeNet rejected the persistent quote WebSocket connection.");
      error.status = response.status === 401 || response.status === 403 ? response.status : 502;
      throw error;
    }

    this.freedomQuoteUpstream = socket;
    this.freedomQuoteUpstreamReady = false;
    this.freedomQuoteSubscribedSymbols = new Set(symbols);

    const handshake = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.freedomQuoteUpstreamWaiter?.socket === socket) {
          this.freedomQuoteUpstreamWaiter = null;
        }
        reject(new Error("TradeNet did not confirm the production quote stream."));
        try { socket.close(1011, "Quote stream handshake timeout"); } catch { /* ignore */ }
      }, 10_000);
      this.freedomQuoteUpstreamWaiter = {
        socket,
        resolve: () => {
          clearTimeout(timeout);
          this.freedomQuoteUpstreamWaiter = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.freedomQuoteUpstreamWaiter = null;
          reject(error);
        }
      };
    });

    socket.addEventListener("message", (event) => {
      void this.handleFreedomQuoteUpstreamMessage(socket, event?.data);
    });
    socket.addEventListener("close", () => {
      if (this.freedomQuoteUpstream !== socket) return;
      this.freedomQuoteUpstream = null;
      this.freedomQuoteUpstreamReady = false;
      this.freedomQuoteSubscribedSymbols.clear();
      if (this.freedomQuoteUpstreamWaiter?.socket === socket) {
        this.freedomQuoteUpstreamWaiter.reject(new Error("TradeNet closed the quote socket during authentication."));
      }
      for (const client of this.getFreedomQuoteClients()) {
        try { client.send(JSON.stringify({ type: "status", status: "reconnecting" })); } catch { /* ignore */ }
      }
    });
    socket.addEventListener("error", () => {
      if (this.freedomQuoteUpstream !== socket) return;
      this.freedomQuoteUpstream = null;
      this.freedomQuoteUpstreamReady = false;
      this.freedomQuoteSubscribedSymbols.clear();
      if (this.freedomQuoteUpstreamWaiter?.socket === socket) {
        this.freedomQuoteUpstreamWaiter.reject(new Error("TradeNet quote socket failed during authentication."));
      }
      for (const client of this.getFreedomQuoteClients()) {
        try { client.send(JSON.stringify({ type: "status", status: "reconnecting" })); } catch { /* ignore */ }
      }
      try { socket.close(1011, "TradeNet quote socket error"); } catch { /* ignore */ }
    });

    try {
      socket.accept();
      socket.send(JSON.stringify(["quotes", symbols]));
      await handshake;
    } catch (error) {
      if (this.freedomQuoteUpstream === socket) this.freedomQuoteUpstream = null;
      this.freedomQuoteUpstreamReady = false;
      this.freedomQuoteSubscribedSymbols.clear();
      try { socket.close(1011, "Quote stream handshake failed"); } catch { /* ignore */ }
      throw error;
    }
  }

  async handleFreedomQuoteUpstreamMessage(socket, rawMessage) {
    if (this.freedomQuoteUpstream !== socket) return;
    let packet;
    try {
      packet = JSON.parse(typeof rawMessage === "string" ? rawMessage : String(rawMessage || ""));
    } catch {
      return;
    }
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const eventName = packet[0];
    if (eventName === "userData") {
      const userData = packet[1];
      const mode = String(userData?.mode || "").trim().toLowerCase();
      if (userData?.isDemo === true || userData?.real === false || mode !== "prod") {
        const error = new Error("TradeNet authenticated a demo or non-production quote session.");
        this.freedomQuoteUpstreamWaiter?.reject(error);
        this.freedomQuoteUpstreamReady = false;
        try { socket.close(1008, "Production TradeNet session required"); } catch { /* ignore */ }
        return;
      }
      this.freedomQuoteUpstreamReady = true;
      this.freedomQuoteUpstreamWaiter?.resolve();
      for (const client of this.getFreedomQuoteClients()) {
        try { client.send(JSON.stringify({ type: "status", status: "connected" })); } catch { /* ignore */ }
      }
      return;
    }
    if (eventName === "error") {
      const error = new Error("TradeNet rejected the persistent quote subscription.");
      this.freedomQuoteUpstreamWaiter?.reject(error);
      this.freedomQuoteUpstreamReady = false;
      try { socket.close(1011, "TradeNet quote subscription rejected"); } catch { /* ignore */ }
      return;
    }
    if (eventName !== "q" || !this.freedomQuoteUpstreamReady) return;

    const payload = packet[1];
    const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    const identifierKeys = ["c", "symbol", "ticker", "code", "i", "instr", "instrument"];
    let rows = Array.isArray(payload?.q) ? payload.q
      : Array.isArray(payload) ? payload : [];
    if (rows.length === 0 && isRecord(payload)) {
      if (identifierKeys.some((key) => typeof payload[key] === "string")) rows = [payload];
      else {
        const values = Object.values(payload);
        if (values.length && values.every(isRecord)) rows = values;
      }
    }
    const allowedFields = new Set([
      "c", "n", "mrg", "ltr", "kind", "type", "name", "name2", "bbp", "bbc",
      "bbs", "bbf", "bap", "bac", "bas", "baf", "pp", "op", "ltp", "lts",
      "ltt", "chg", "pcp", "ltc", "mintp", "maxtp", "vol", "vlt", "trades",
      "min_step", "step_price", "p5", "chg5", "p22", "chg22", "p110",
      "chg110", "p220", "chg220", "x_curr", "x_lot", "x_istrade", "UTCOffset", "acc_srv_tm"
    ]);
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const identifier = identifierKeys.find((key) => typeof row[key] === "string");
      if (!identifier) continue;
      const symbol = String(row[identifier]).trim().toUpperCase();
      if (!this.freedomQuoteSubscribedSymbols.has(symbol)) continue;
      const data = {};
      for (const [key, value] of Object.entries(row)) {
        if (!allowedFields.has(key)) continue;
        if (typeof value === "string") data[key] = value.slice(0, 160);
        else if (typeof value === "number" && Number.isFinite(value)) data[key] = value;
        else if (typeof value === "boolean" || value === null) data[key] = value;
      }
      const price = Number(data.ltp);
      if (!Number.isFinite(price) || price <= 0) continue;
      const message = {
        type: "quote",
        symbol,
        data,
        receivedAt: Date.now()
      };
      this.freedomQuoteLastBySymbol.set(symbol, message);
      for (const client of this.getFreedomQuoteClients()) {
        const attachment = client.deserializeAttachment?.();
        if (!attachment?.symbols?.includes(symbol)) continue;
        try { client.send(JSON.stringify(message)); } catch { /* disconnected client */ }
      }
    }
  }

  webSocketMessage(webSocket, message) {
    const attachment = webSocket.deserializeAttachment?.();
    if (attachment?.stream === "market-depth") {
      const session = this.freedomDepthStreams.get(attachment.streamId);
      if (!session || session.accountId !== attachment.accountId || session.symbol !== attachment.symbol) {
        try { webSocket.close(1011, "Market Depth session is no longer active"); } catch { /* ignore */ }
        return;
      }
      session.lastActivityAt = Date.now();
      const text = typeof message === "string" ? message : String(message || "");
      if (text === "ping") {
        try { webSocket.send(JSON.stringify({ type: "pong", at: Date.now() })); } catch { /* ignore */ }
      } else {
        try { webSocket.close(1008, "Unexpected Market Depth client message"); } catch { /* ignore */ }
      }
      void this.scheduleFreedomMarketDepthAlarm();
      return;
    }
    const text = typeof message === "string" ? message : String(message || "");
    if (text === "ping") {
      try { webSocket.send(JSON.stringify({ type: "pong", at: Date.now() })); } catch { /* ignore */ }
      void this.ensureFreedomQuoteUpstream().catch(() => {
        try { webSocket.send(JSON.stringify({ type: "status", status: "reconnecting" })); } catch { /* ignore */ }
      });
      void this.ensureFreedomAccountUpstream().catch(() => {
        this.broadcastFreedomAccountStatus("reconnecting");
      });
    }
  }

  webSocketClose(webSocket) {
    const attachment = webSocket?.deserializeAttachment?.();
    if (attachment?.stream === "market-depth" && typeof attachment.streamId === "string") {
      this.closeFreedomMarketDepthSession(attachment.streamId, "Market Depth client disconnected", false);
      return;
    }
    if (this.getFreedomAccountClients().length === 0) {
      this.closeFreedomAccountUpstream();
    }
    if (this.getFreedomQuoteClients().length > 0) return;
    const socket = this.freedomQuoteUpstream;
    this.freedomQuoteUpstream = null;
    this.freedomQuoteUpstreamReady = false;
    this.freedomQuoteSubscribedSymbols.clear();
    this.freedomQuoteLastBySymbol.clear();
    if (socket) {
      try { socket.close(1000, "No quote stream clients remain"); } catch { /* ignore */ }
    }
  }

  webSocketError(webSocket) {
    this.webSocketClose(webSocket);
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
    if (requestUrl.pathname === "/internal/freedom-quote-stream-ticket") {
      return this.handleFreedomQuoteStreamTicketRequest(request);
    }
    if (requestUrl.pathname === "/internal/freedom-quote-stream-socket") {
      return this.handleFreedomQuoteStreamSocketRequest(request);
    }
    if (requestUrl.pathname === "/internal/freedom-account-stream-ticket") {
      return this.handleFreedomAccountStreamTicketRequest(request);
    }
    if (requestUrl.pathname === "/internal/freedom-account-stream-socket") {
      return this.handleFreedomAccountStreamSocketRequest(request);
    }
    if (requestUrl.pathname === "/internal/freedom-market-depth-stream-ticket") {
      return this.handleFreedomMarketDepthStreamTicketRequest(request);
    }
    if (requestUrl.pathname === "/internal/freedom-market-depth-stream-socket") {
      return this.handleFreedomMarketDepthStreamSocketRequest(request);
    }
    if (requestUrl.pathname.startsWith("/internal/freedom-tradenet-session")) {
      const sessionResponse = await this.handleFreedomTradeNetSessionRequest(request);
      if (sessionResponse) return sessionResponse;
      return authJson({ error: "Not found." }, 404);
    }
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
