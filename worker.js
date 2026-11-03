import { requestTradeNet } from "./src/services/freedomTradeNet.js";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_TICKERS = 10;
const PROVIDER_CACHE_TTL_MS = { yahoo_quote: 8_000, freedom_quote: 5_000, finnhub: 5_000, twelvedata: 5_000 };
const PROVIDER_COOLDOWN_MS = { yahoo_quote: 3_000, freedom_quote: 10_000, finnhub: 5_000, twelvedata: 5_000 };
const providerResponseCache = new Map();
const providerCooldowns = new Map();
const providerInFlight = new Map();

function providerMetric(metric, fields = {}) {
    // Do not include credentials, raw upstream URLs, or account data in telemetry.
    console.info(JSON.stringify({ type: "provider_metric", metric, ...fields }));
}

async function withProviderCache(provider, key, fetcher) {
    const cacheKey = `${provider}:${key}`;
    const now = Date.now();
    const cached = providerResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        providerMetric("cache_hit", { provider });
        return cached.value;
    }
    const inFlight = providerInFlight.get(cacheKey);
    if (inFlight) {
        providerMetric("inflight_dedup", { provider });
        return inFlight;
    }
    const cooldownUntil = providerCooldowns.get(provider) || 0;
    if (cooldownUntil > now) {
        providerMetric("provider_cooldown", { provider });
        throw new Error(`${provider} provider temporarily cooling down after an upstream failure.`);
    }
    const startedAt = now;
    const request = (async () => {
        try {
            const value = await fetcher();
            providerResponseCache.set(cacheKey, { value, expiresAt: Date.now() + (PROVIDER_CACHE_TTL_MS[provider] || 5_000) });
            if (providerResponseCache.size > 500) {
                providerResponseCache.delete(providerResponseCache.keys().next().value);
            }
            providerCooldowns.delete(provider);
            providerMetric("provider_request", { provider, durationMs: Date.now() - startedAt, success: true });
            return value;
        } catch (error) {
            providerCooldowns.set(provider, Date.now() + (PROVIDER_COOLDOWN_MS[provider] || 5_000));
            providerMetric("provider_failure", { provider, durationMs: Date.now() - startedAt });
            throw error;
        } finally {
            providerInFlight.delete(cacheKey);
        }
    })();
    providerInFlight.set(cacheKey, request);
    return request;
}

const ALLOWED_GEMINI_MODELS = new Set([
    "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite",
    "gemini-3.1-flash", "gemini-3.1-pro", "gemini-2.5-flash",
    "gemini-2.5-pro", "gemini-flash", "gemini-pro"
]);

function normalizeGeminiModel(model) {
    const normalized = typeof model === "string" ? model.replace(/^models\//, "") : model;
    // Google retired this model for new users; keep older clients working by
    // transparently upgrading their request to the supported replacement.
    return normalized === "gemini-2.5-flash-lite" ? "gemini-3.5-flash-lite" : normalized;
}

function jsonError(message, status, headers) {
    return new Response(JSON.stringify({ error: message }), { status, headers });
}

const AUTH_EDGE_RATE_LIMITED_PATHS = new Set([
    "/api/auth/login",
    "/api/auth/bootstrap",
    "/api/auth/users",
    "/api/auth/me"
]);
const AUTH_EDGE_RATE_LIMIT_PERIOD_SECONDS = 60;

function isTrustedCloudflareClientIp(value) {
    // CF-Connecting-IP is injected by Cloudflare for inbound requests. Do not
    // fall back to X-Forwarded-For or other caller-controlled proxy headers.
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 64 &&
        /^[0-9a-fA-F:.]+$/.test(value);
}

async function enforceAuthEdgeRateLimit(request, env, pathname, corsHeaders) {
    const required = env.AUTH_EDGE_LIMITER_REQUIRED === "true";
    const limiter = env.AUTH_EDGE_RATE_LIMITER;

    if (!limiter || typeof limiter.limit !== "function") {
        if (!required) return null; // Local unit tests and unconfigured development.
        console.error("Required authentication edge rate-limit binding is unavailable.");
        return jsonError("Authentication protection is temporarily unavailable.", 503, {
            ...corsHeaders,
            "Cache-Control": "no-store"
        });
    }

    const clientIp = request.headers.get("CF-Connecting-IP")?.trim();
    if (!isTrustedCloudflareClientIp(clientIp)) {
        if (!required) return null;
        console.warn(JSON.stringify({ type: "auth_edge_rate_limit_missing_client_ip", route: pathname }));
        return jsonError("Authentication protection is temporarily unavailable.", 503, {
            ...corsHeaders,
            "Cache-Control": "no-store"
        });
    }

    try {
        // Login is unauthenticated, so the Cloudflare-generated client IP is
        // the only stable pre-authentication identity available here. Include
        // the route to keep login, bootstrap, and account mutations isolated.
        const { success } = await limiter.limit({ key: `auth:${pathname}:${clientIp}` });
        if (typeof success !== "boolean") {
            throw new Error("Rate limiter returned an invalid decision.");
        }
        if (success) return null;

        // Do not log the IP, username, password, session token, or request body.
        console.warn(JSON.stringify({ type: "auth_edge_rate_limited", route: pathname }));
        return jsonError("Too many authentication requests. Try again shortly.", 429, {
            ...corsHeaders,
            "Cache-Control": "no-store",
            "Retry-After": String(AUTH_EDGE_RATE_LIMIT_PERIOD_SECONDS)
        });
    } catch {
        console.error(JSON.stringify({ type: "auth_edge_rate_limit_error", route: pathname }));
        if (!required) return null;
        return jsonError("Authentication protection is temporarily unavailable.", 503, {
            ...corsHeaders,
            "Cache-Control": "no-store"
        });
    }
}

function validSymbolList(symbol) {
    const symbols = symbol.split(",").map(value => value.trim()).filter(Boolean);
    return symbols.length > 0 && symbols.length <= MAX_TICKERS &&
        symbols.every(value => /^[A-Z0-9.^=-]{1,20}$/.test(value));
}

function isValidDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function fetchWithTimeout(input, init = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        controller.abort(externalSignal.reason);
    } else {
        externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    }

    let cleanedUp = false;
    let timeoutId;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener("abort", abortFromExternal);
    };
    timeoutId = setTimeout(() => controller.abort(new Error("Upstream request timed out")), timeoutMs);

    try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        if (!response.body) {
            cleanup();
            return response;
        }

        // fetch() resolves when headers arrive, not when the body is consumed.
        // Keep the timeout and external abort wired until the caller finishes reading.
        const reader = response.body.getReader();
        const timedBody = new ReadableStream({
            async pull(streamController) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        streamController.close();
                        cleanup();
                    } else {
                        streamController.enqueue(value);
                    }
                } catch (error) {
                    cleanup();
                    streamController.error(error);
                }
            },
            async cancel(reason) {
                try {
                    await reader.cancel(reason);
                } finally {
                    cleanup();
                }
            }
        });
        return new Response(timedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });
    } catch (error) {
        cleanup();
        throw error;
    }
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function resolveCorsHeaders(request, env = {}) {
    const configuredOrigins = typeof env.ALLOWED_ORIGINS === "string" && env.ALLOWED_ORIGINS.trim()
        ? env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean)
        : [];
    const origin = request.headers.get("Origin");
    // Permit the exact local Vite development origins used by this project.
    // All other browser origins must still be explicitly configured.
    const localDevelopmentOrigins = new Set([
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ]);
    if (origin && !configuredOrigins.includes(origin) && !localDevelopmentOrigins.has(origin)) return null;
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin || configuredOrigins[0],
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Auth, If-Match",
        "Access-Control-Expose-Headers": "ETag"
    };
}

export function normalizeMarketState(value) {
    const marketState = typeof value === "string" ? value : "CLOSED";
    if (marketState === "PREPRE") return "PRE";
    if (marketState === "POSTPOST") return "POST";
    return marketState;
}

/**
 * Obtains an ephemeral Yahoo session cookie and authorization crumb.
 */
async function getYahooCredentials() {
    // Step 1: Hit fc.yahoo.com to acquire the initial session cookie
    const initRes = await fetchWithTimeout("https://fc.yahoo.com", {
        headers: { "User-Agent": USER_AGENT }
    });

    const rawCookie = initRes.headers.get("set-cookie") || "";
    const cookieMatch = rawCookie.match(/(A[13]=[^;]+)/);
    const cookie = cookieMatch ? cookieMatch[1] : "";

    // Step 2: Use the cookie to request the session crumb
    const crumbRes = await fetchWithTimeout("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: {
            "User-Agent": USER_AGENT,
            "Cookie": cookie
        }
    });

    if (!crumbRes.ok) {
        throw new Error(`Failed to acquire Yahoo crumb (HTTP ${crumbRes.status})`);
    }

    const crumb = await crumbRes.text();
    return { cookie, crumb: crumb.trim() };
}

/**
 * Return only the USD account fields consumed by the app. Never forward the
 * broker's raw response (which includes account identifiers and unrelated data).
 * Preserve the response envelope expected by normalizeFreedomPortfolio().
 */
/** Return only fields required to identify open sell-limit orders. */
export function sanitizeFreedomActiveOrders(response) {
    const candidates = [
        response,
        response?.data?.result?.orders,
        response?.result?.orders,
        response?.data?.orders,
        response?.orders,
        response?.data?.result,
        response?.result,
        response?.data
    ];
    const envelope = candidates.find(value => Array.isArray(value) ||
        (value && typeof value === "object"
            && (Array.isArray(value.order) || Array.isArray(value.orders) || Array.isArray(value.items))));
    const rows = Array.isArray(envelope) ? envelope
        : Array.isArray(envelope?.order) ? envelope.order
            : Array.isArray(envelope?.orders) ? envelope.orders
                : Array.isArray(envelope?.items) ? envelope.items
                    : [];
    const numberOrNull = value => {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    const order = rows.map(row => ({
        order_id: String(row?.order_id ?? row?.id ?? ""),
        instr: String(row?.instr ?? row?.instr_nm ?? row?.i ?? row?.ticker ?? row?.symbol ?? row?.instrument ?? ""),
        oper: numberOrNull(row?.oper ?? row?.operation),
        type: numberOrNull(row?.type ?? row?.order_type),
        p: numberOrNull(row?.p ?? row?.price ?? row?.limit_price),
        q: numberOrNull(row?.q ?? row?.quantity),
        leaves_qty: numberOrNull(row?.leaves_qty ?? row?.remaining_qty ?? row?.remainingQuantity ?? row?.q ?? row?.quantity),
        stat: String(row?.stat ?? row?.status ?? "")
    })).filter(row => row.order_id && row.instr);

    // The documented orders event embeds actual executions in each order's
    // trade array. Forward only the execution contract consumed by
    // normalizeFreedomTrades; never expose owner/login/account/raw order fields.
    const sideForOrderOperation = value => {
        const operation = numberOrNull(value);
        if (operation === 1 || operation === 2) return "BUY";
        if (operation === 3) return "SELL";
        if (operation === 4) return "SELL_SHORT";
        return "Unknown";
    };
    const trade = rows.flatMap(row => {
        const executions = Array.isArray(row?.trade) ? row.trade : [];
        const instrument = String(row?.instr ?? row?.instr_nm ?? row?.i ?? row?.ticker ?? row?.symbol ?? row?.instrument ?? "").slice(0, 64);
        if (!instrument) return [];
        return executions.flatMap(execution => {
            if (!execution || typeof execution !== "object" || Array.isArray(execution)) return [];
            const normalized = {
                order_id: String(row?.order_id ?? row?.id ?? ""),
                instr: instrument,
                side: sideForOrderOperation(row?.oper ?? row?.operation),
                curr: String(row?.cur ?? row?.currency ?? ""),
                date: typeof execution.date === "string" ? execution.date.slice(0, 64) : "",
                p: numberOrNull(execution.p),
                q: numberOrNull(execution.q),
                v: numberOrNull(execution.v),
                profit: numberOrNull(execution.profit),
                acd: numberOrNull(execution.acd),
                fv: numberOrNull(execution.fv),
                go_sum: numberOrNull(execution.go_sum)
            };
            if (execution.id !== null && execution.id !== undefined && String(execution.id).trim() !== "") {
                normalized.id = String(execution.id);
            }
            return [normalized];
        });
    });
    return { orders: { order }, trades: { trade } };
}


/**
 * Return a bounded login error description without exposing identifiers or secrets.
 * TradeNet's documented authByLogin failure shape is { errMsg, code }.
 */
function sanitizeFreedomLoginError(value) {
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

function getFreedomLoginErrorCode(payload) {
    const value = payload?.errorCode ?? payload?.code;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(value)) return value;
    return null;
}

/**
 * Obtain a short-lived TradeNet account SID for a single diagnostic request.
 * Credentials and SID remain inside the Worker; neither is logged or returned.
 */
async function createFreedomDiagnosticSessionDirect(env) {
    if (!env.FREEDOM_LOGIN || !env.FREEDOM_PASSWORD) {
        const error = new Error("FREEDOM_LOGIN and FREEDOM_PASSWORD must be configured as Worker secrets.");
        error.status = 503;
        throw error;
    }
    const authRequest = {
        cmd: "authByLogin",
        params: {
            login: env.FREEDOM_LOGIN,
            password: env.FREEDOM_PASSWORD,
            rememberMe: 1,
            getAccounts: false
        }
    };
    const form = new URLSearchParams({ q: JSON.stringify(authRequest) });
    const response = await fetchWithTimeout("https://tradernet.am/api/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    }, 12000);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error("TradeNet login endpoint returned HTTP " + response.status + ".");
        error.status = response.status >= 500 ? 502 : 401;
        error.diagnostics = {
            phase: "login_http_response",
            loginResponseReceived: true,
            loginHttpStatus: response.status,
            payloadReceived: Boolean(payload)
        };
        throw error;
    }
    if (!payload || payload.success !== true || payload.logged !== true ||
        typeof payload.SID !== "string" || payload.SID.length < 10 || payload.real !== true) {
        const hasFlag = (names) => names.some(name => payload &&
            Object.prototype.hasOwnProperty.call(payload, name) &&
            payload[name] !== false && payload[name] !== null && payload[name] !== "");
        const providerErrorValue = payload?.errMsg ?? payload?.error ?? payload?.message;
        const providerErrorMessage = sanitizeFreedomLoginError(providerErrorValue);
        const providerErrorCode = getFreedomLoginErrorCode(payload);
        const failedChecks = [];
        if (!payload) failedChecks.push("login_payload_missing_or_invalid_json");
        if (payload?.success !== true) failedChecks.push("success_not_true");
        if (payload?.logged !== true) failedChecks.push("logged_not_true");
        if (typeof payload?.SID !== "string" || payload.SID.length < 10) failedChecks.push("sid_missing_or_invalid");
        if (payload?.real !== true) failedChecks.push("production_session_not_confirmed");
        if (providerErrorMessage || providerErrorCode !== null) failedChecks.push("provider_returned_login_error");
        const error = new Error(payload?.real === false
            ? "TradeNet returned a demo or non-production account session."
            : providerErrorMessage
                ? "TradeNet rejected the login request: " + providerErrorMessage
                : "TradeNet login failed or requested additional verification.");
        error.status = payload?.real === false ? 403 : 401;
        error.diagnostics = {
            phase: "login_response_validation",
            loginResponseReceived: true,
            loginHttpStatus: response.status,
            payloadReceived: Boolean(payload),
            success: payload?.success === true,
            logged: payload?.logged === true,
            sidPresent: typeof payload?.SID === "string" && payload.SID.length >= 10,
            productionSession: payload?.real === true ? true : payload?.real === false ? false : null,
            verificationChallengeIndicated: hasFlag([
                "verificationRequired", "needVerification", "challengeRequired",
                "captchaRequired", "twoFactorRequired", "otpRequired", "smsRequired"
            ]),
            providerErrorFieldPresent: Boolean(payload && (
                Object.prototype.hasOwnProperty.call(payload, "errMsg") ||
                Object.prototype.hasOwnProperty.call(payload, "error") ||
                Object.prototype.hasOwnProperty.call(payload, "errorCode") ||
                Object.prototype.hasOwnProperty.call(payload, "code") ||
                Object.prototype.hasOwnProperty.call(payload, "message")
            )),
            providerErrorCode,
            providerErrorMessage,
            failedChecks
        };
        throw error;
    }
    return payload.SID;
}

async function createFreedomDiagnosticSession(env) {
    const namespace = env.PORTFOLIO_STATE_DO;
    if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
        // Local tests/development may omit the Durable Object binding. Production
        // Worker deployments always use the shared Durable Object session broker.
        return createFreedomDiagnosticSessionDirect(env);
    }
    const stub = namespace.get(namespace.idFromName("freedom-tradenet-auth-session:v1"));
    const response = await stub.fetch("https://portfolio-state.internal/internal/freedom-tradenet-session", {
        method: "GET",
        headers: { "Cache-Control": "no-store" }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || typeof payload.sid !== "string" || payload.sid.length < 10) {
        const error = new Error(
            typeof payload?.error === "string" ? payload.error : "TradeNet session broker could not provide an authenticated session."
        );
        error.status = response.status || 502;
        error.diagnostics = payload?.diagnostics || null;
        throw error;
    }
    return payload.sid;
}

async function invalidateFreedomDiagnosticSession(env, sid) {
    const namespace = env.PORTFOLIO_STATE_DO;
    if (!sid || !namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") return;
    try {
        const stub = namespace.get(namespace.idFromName("freedom-tradenet-auth-session:v1"));
        await stub.fetch("https://portfolio-state.internal/internal/freedom-tradenet-session/invalidate", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            body: JSON.stringify({ sid })
        });
    } catch {
        // The next request can still recover after the in-memory cache expires.
    }
}

/**
 * Fetch one production active-orders snapshot over the authenticated TradeNet stream.
 * Only the normalized allowlisted order fields leave the Worker; the SID and raw
 * broker payload stay server-side. The socket is deliberately short-lived.
 */
async function diagnoseFreedomOrdersStream(env) {
    const sid = await createFreedomDiagnosticSession(env);
    const startedAt = Date.now();
    let sanitizedOrders = { order: [] };
    let sanitizedTrades = { trade: [] };
    const diagnostics = {
        endpoint: "wss.tradernet.com",
        phase: "connecting",
        handshakeResponseReceived: false,
        handshakeStatus: null,
        connectionOpened: false,
        ordersSubscriptionSent: false,
        userDataReceived: false,
        isDemo: null,
        sessionMode: null,
        ordersEventReceived: false,
        ordersPayloadType: null,
        ordersPayloadItemKeys: [],
        ordersPreviewCount: 0,
        ordersPreview: [],
        ordersTradeOrdersCount: 0,
        ordersTradeCount: 0,
        ordersTradeItemKeys: [],
        ordersTradePreview: [],
        messageCount: 0,
        parseErrorCount: 0,
        eventCounts: {},
        serverErrorCategory: null,
        socketErrorObserved: false,
        closeCode: null
    };
    const snapshot = () => ({
        ...diagnostics,
        eventCounts: { ...diagnostics.eventCounts },
        ordersSnapshot: sanitizedOrders,
        tradesSnapshot: sanitizedTrades,
        elapsedMs: Date.now() - startedAt
    });

    return await new Promise((resolve, reject) => {
        let socket = null;
        let settled = false;
        let timeoutId;
        const abortController = new AbortController();

        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            const result = snapshot();
            try { socket?.close(1000, "TradeNet diagnostic finished"); } catch { /* ignore close races */ }
            if (error) {
                if ([401, 403].includes(Number(error.status)) ||
                    diagnostics.phase === "demo_session" ||
                    diagnostics.serverErrorCategory === "auth_or_session_rejected") {
                    error.freedomDiagnosticSid = sid;
                }
                const { ordersSnapshot: _ordersSnapshot, ...safeDiagnostics } = result;
                error.diagnostics = safeDiagnostics;
                reject(error);
            } else {
                resolve(result);
            }
        };

        const timeoutMs = 8000;
        timeoutId = setTimeout(() => {
            diagnostics.phase = diagnostics.connectionOpened ? "event_timeout" : "handshake_timeout";
            if (!diagnostics.connectionOpened) abortController.abort();
            finish(null);
        }, timeoutMs);

        const url = new URL("https://wss.tradernet.com/");
        url.searchParams.set("SID", sid);

        fetch(url.toString(), {
            headers: { Upgrade: "websocket" },
            signal: abortController.signal
        }).then(response => {
            if (settled) {
                try { response.webSocket?.close(1000, "Diagnostic already finished"); } catch { /* ignore close races */ }
                return;
            }
            diagnostics.handshakeResponseReceived = true;
            diagnostics.handshakeStatus = Number.isFinite(Number(response.status)) ? Number(response.status) : null;
            socket = response.webSocket || null;
            if (!socket) {
                const status = diagnostics.handshakeStatus;
                const error = new Error(status
                    ? "TradeNet rejected the WebSocket upgrade (HTTP " + status + ")."
                    : "TradeNet did not accept the WebSocket upgrade.");
                error.status = status === 401 || status === 403 ? status : 502;
                diagnostics.phase = "handshake_rejected";
                finish(error);
                return;
            }

            try {
                socket.addEventListener("message", event => {
                    if (settled) return;
                    diagnostics.messageCount += 1;
                    let packet;
                    try {
                        packet = JSON.parse(String(event?.data || ""));
                    } catch {
                        diagnostics.parseErrorCount += 1;
                        return;
                    }
                    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
                    const eventName = packet[0];
                    if (/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(eventName)) {
                        diagnostics.eventCounts[eventName] = (diagnostics.eventCounts[eventName] || 0) + 1;
                    }
                    if (eventName === "userData") {
                        const payload = packet[1];
                        diagnostics.userDataReceived = true;
                        diagnostics.isDemo = typeof payload?.isDemo === "boolean" ? payload.isDemo : null;
                        const mode = String(payload?.mode || "").trim().toLowerCase();
                        diagnostics.sessionMode = ["prod", "demo", "test", "paper", "beta"].includes(mode) ? mode : "unknown";
                        if (diagnostics.isDemo === true || payload?.real === false ||
                            ["demo", "test", "paper", "beta"].includes(diagnostics.sessionMode)) {
                            diagnostics.phase = "demo_session";
                            const error = new Error("TradeNet authenticated a demo or non-production session.");
                            error.status = 403;
                            finish(error);
                            return;
                        }
                    } else if (eventName === "orders") {
                        diagnostics.ordersEventReceived = true;
                        const orderPayload = packet[1];
                        diagnostics.ordersPayloadType = Array.isArray(orderPayload)
                            ? "array"
                            : orderPayload && typeof orderPayload === "object" ? "object"
                                : orderPayload === null ? "null" : typeof orderPayload;
                        const firstOrder = Array.isArray(orderPayload) ? orderPayload[0]
                            : orderPayload && typeof orderPayload === "object" ? orderPayload.order?.[0] ?? orderPayload.orders?.[0] ?? null
                                : null;
                        if (firstOrder && typeof firstOrder === "object" && !Array.isArray(firstOrder)) {
                            const safeKeys = new Set([
                                "order_id", "id", "instr", "instr_nm", "i", "ticker", "symbol", "instrument",
                                "oper", "operation", "type", "order_type", "p", "price", "limit_price",
                                "q", "quantity", "leaves_qty", "remaining_qty", "remainingQuantity", "stat", "status", "trade"
                            ]);
                            diagnostics.ordersPayloadItemKeys = Object.keys(firstOrder).filter(key => safeKeys.has(key)).sort();
                        }
                        const orderRows = Array.isArray(orderPayload) ? orderPayload
                            : Array.isArray(orderPayload?.order) ? orderPayload.order
                                : Array.isArray(orderPayload?.orders) ? orderPayload.orders : [];
                        const tradeKeyAllowlist = new Set(["acd", "date", "fv", "go_sum", "id", "p", "profit", "q", "v"]);
                        const tradeValueFields = ["acd", "fv", "go_sum", "p", "profit", "q", "v"];
                        const tradeRows = [];
                        for (const order of orderRows) {
                            const executions = Array.isArray(order?.trade) ? order.trade : [];
                            if (executions.length) diagnostics.ordersTradeOrdersCount += 1;
                            for (const trade of executions) {
                                if (trade && typeof trade === "object" && !Array.isArray(trade)) {
                                    tradeRows.push({
                                        instrument: String(order?.instr ?? order?.instr_nm ?? order?.i ?? "").slice(0, 64),
                                        trade
                                    });
                                }
                            }
                        }
                        diagnostics.ordersTradeCount = tradeRows.length;
                        const firstTrade = tradeRows[0]?.trade;
                        diagnostics.ordersTradeItemKeys = firstTrade
                            ? Object.keys(firstTrade).filter(key => tradeKeyAllowlist.has(key)).sort()
                            : [];
                        diagnostics.ordersTradePreview = tradeRows.slice(0, 10).map(({ instrument, trade }) => {
                            const preview = {};
                            if (instrument) preview.instr = instrument;
                            if (typeof trade.date === "string") preview.date = trade.date.slice(0, 64);
                            for (const field of tradeValueFields) {
                                const value = trade[field];
                                const numeric = typeof value === "number" ? value
                                    : typeof value === "string" && value.trim() ? Number(value) : NaN;
                                if (Number.isFinite(numeric)) preview[field] = numeric;
                            }
                            return preview;
                        });
                        const sanitizedSnapshot = sanitizeFreedomActiveOrders(orderPayload);
                        sanitizedOrders = sanitizedSnapshot.orders;
                        sanitizedTrades = sanitizedSnapshot.trades;
                        const safeOrders = sanitizedOrders.order;
                        diagnostics.ordersPreviewCount = safeOrders.length;
                        diagnostics.ordersPreview = safeOrders.slice(0, 10).map(({ order_id, ...order }) => order);
                    } else if (eventName === "error") {
                        const payloadText = typeof packet[1] === "string" ? packet[1] : "";
                        diagnostics.serverErrorCategory = /sid|session|auth|login|unauthori[sz]ed|expired/i.test(payloadText)
                            ? "auth_or_session_rejected" : "upstream_error";
                        diagnostics.phase = "server_error";
                        const error = new Error(diagnostics.serverErrorCategory === "auth_or_session_rejected"
                            ? "TradeNet rejected the authenticated session."
                            : "TradeNet returned a WebSocket error.");
                        error.status = diagnostics.serverErrorCategory === "auth_or_session_rejected" ? 401 : 502;
                        finish(error);
                        return;
                    }
                    if (diagnostics.userDataReceived && diagnostics.ordersEventReceived) {
                        diagnostics.phase = "orders_event_received";
                        finish(null);
                    }
                });
                socket.addEventListener("error", () => {
                    diagnostics.socketErrorObserved = true;
                    if (!settled) diagnostics.phase = "websocket_error";
                });
                socket.addEventListener("close", event => {
                    if (settled) return;
                    diagnostics.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
                    diagnostics.phase = "connection_closed";
                    finish(null);
                });
                socket.accept();
                diagnostics.connectionOpened = true;
                diagnostics.phase = "subscribing_orders";
                socket.send(JSON.stringify(["orders"]));
                diagnostics.ordersSubscriptionSent = true;
                diagnostics.phase = "awaiting_events";
            } catch {
                const error = new Error("TradeNet WebSocket opened, but the orders subscription could not be sent.");
                error.status = 502;
                diagnostics.phase = "subscription_send_failed";
                finish(error);
            }
        }).catch(() => {
            if (settled) return;
            diagnostics.phase = abortController.signal.aborted ? "handshake_timeout" : "websocket_handshake_failed";
            const error = new Error(abortController.signal.aborted
                ? "TradeNet WebSocket handshake timed out."
                : "TradeNet WebSocket handshake failed before a connection was opened.");
            error.status = abortController.signal.aborted ? 504 : 502;
            finish(error);
        });
    });
}

/**
 * Subscribe to one allowlisted TradeNet read-only account/market event and
 * return only schema metadata. Portfolio numbers, tickers, login names, IDs,
 * credentials, and the SID never leave the Worker in this diagnostic.
 */
function describeRedactedValueType(value, depth = 0) {
    if (value === null) return "null";
    if (Array.isArray(value)) {
        return {
            type: "array",
            length: value.length,
            item: value.length && depth < 2 ? describeRedactedValueType(value[0], depth + 1) : null
        };
    }
    if (typeof value !== "object") return typeof value;
    if (depth >= 2) return "object";
    const fields = {};
    for (const key of Object.keys(value)
        .filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) && !/^(?:id|_id|login|owner_login|account_id|acc_id)$/i.test(key))
        .sort()
        .slice(0, 64)) {
        fields[key] = describeRedactedValueType(value[key], depth + 1);
    }
    return { type: "object", fields };
}

function summarizeFreedomStreamEvent(eventName, payload) {
    const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const payloadType = Array.isArray(payload) ? "array"
        : isRecord(payload) ? "object"
            : payload === null ? "null" : typeof payload;
    const keys = value => isRecord(value)
        ? Object.keys(value).filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)).sort().slice(0, 40)
        : [];
    if (eventName === "portfolio") {
        const root = isRecord(payload?.portfolio) ? payload.portfolio
            : isRecord(payload?.ps) ? payload.ps : payload;
        const accounts = Array.isArray(root?.acc) ? root.acc
            : Array.isArray(root?.accounts) ? root.accounts : [];
        const positions = Array.isArray(root?.pos) ? root.pos
            : Array.isArray(root?.positions) ? root.positions : [];
        const accountKeys = new Set([
            "curr", "currval", "forecast_in", "forecast_out", "k", "s",
            "sql_exec_tm", "t", "t2_in", "t2_out"
        ]);
        const positionKeys = new Set([
            "Yield", "acc_pos_id", "accruedint_a", "acd", "bal_price_a",
            "base_contract_code", "base_currency", "close_price", "curr", "currval",
            "face_val_a", "fv", "go", "i", "instr_id", "issue_nb", "k", "ltr",
            "market_value", "mkt_id", "mkt_price", "name", "name2", "open_bal",
            "profit_close", "q", "s", "t", "vm"
        ]);
        const accountSample = accounts[0];
        const positionSample = positions[0];
        const accountItemKeys = accountSample ? keys(accountSample).filter(key => accountKeys.has(key)) : [];
        const positionItemKeys = positionSample ? keys(positionSample).filter(key => positionKeys.has(key)) : [];
        return {
            event: eventName,
            payloadType,
            topLevelKeys: keys(payload),
            topLevelFieldTypes: Object.fromEntries(
                ["acc", "acc_srv_tm", "loaded", "m_id", "pos"].filter(key => Object.prototype.hasOwnProperty.call(root || {}, key))
                    .map(key => [key, describeRedactedValueType(root[key])])
            ),
            accountsCount: accounts.length,
            accountItemKeys,
            accountItemTypes: accountSample && isRecord(accountSample)
                ? Object.fromEntries(accountItemKeys.map(key => [key, describeRedactedValueType(accountSample[key])]))
                : {},
            positionsCount: positions.length,
            positionItemKeys,
            positionItemTypes: positionSample && isRecord(positionSample)
                ? Object.fromEntries(positionItemKeys.map(key => [key, describeRedactedValueType(positionSample[key])]))
                : {}
        };
    }
    if (eventName === "markets") {
        const rows = Array.isArray(payload) ? payload
            : Array.isArray(payload?.m) ? payload.m
                : Array.isArray(payload?.markets) ? payload.markets : [];
        const marketKeys = new Set(["c", "date", "dt", "ev", "mkt_id", "n", "n2", "o", "p", "post", "s", "tz"]);
        const marketSample = rows[0];
        const marketItemKeys = marketSample ? keys(marketSample).filter(key => marketKeys.has(key)) : [];
        // Market status and opening/closing times are exchange-level public data.
        // Return only the documented fields; do not forward arbitrary broker payload fields.
        const marketValueFields = ["n", "n2", "s", "o", "c", "dt"];
        const marketPreview = rows.filter(isRecord).slice(0, 50).map(row => {
            const market = {};
            for (const field of marketValueFields) {
                const value = row[field];
                if (typeof value === "string") market[field] = value.slice(0, 64);
                else if (typeof value === "number" && Number.isFinite(value)) market[field] = value;
            }
            return market;
        });
        return {
            event: eventName,
            payloadType,
            topLevelKeys: keys(payload),
            topLevelFieldTypes: Object.fromEntries(
                ["m", "t"].filter(key => Object.prototype.hasOwnProperty.call(payload || {}, key))
                    .map(key => [key, describeRedactedValueType(payload[key])])
            ),
            serverTime: typeof payload?.t === "string" ? payload.t.slice(0, 40) : null,
            marketsCount: rows.length,
            marketItemKeys,
            marketItemTypes: marketSample && isRecord(marketSample)
                ? Object.fromEntries(marketItemKeys.map(key => [key, describeRedactedValueType(marketSample[key])]))
                : {},
            marketPreview
        };
    }
    if (eventName === "quotes") {
        const containers = [
            ["payload.q", payload?.q],
            ["payload.quotes", payload?.quotes],
            ["payload.data.q", payload?.data?.q],
            ["payload.data.quotes", payload?.data?.quotes],
            ["payload.result.q", payload?.result?.q],
            ["payload.result.quotes", payload?.result?.quotes],
            ["payload.data.result.q", payload?.data?.result?.q],
            ["payload.data.result.quotes", payload?.data?.result?.quotes],
            ["payload", payload]
        ];
        let containerPath = "none";
        let container = null;
        for (const [path, value] of containers) {
            if (Array.isArray(value)) {
                containerPath = path;
                container = value;
                break;
            }
        }
        if (!container && isRecord(payload)) {
            const values = Object.values(payload);
            if (values.length && values.every(isRecord)) {
                containerPath = "payload.object_values";
                container = values;
            } else if (["c", "symbol", "ticker", "code", "i", "instr", "instrument"].some(key => payload[key] !== undefined)) {
                containerPath = "payload.single_quote_object";
                container = [payload];
            }
        }
        const rows = Array.isArray(container) ? container : [];
        const quoteKeys = new Set([
            "c", "symbol", "ticker", "code", "i", "instr", "instrument",
            "n", "mrg", "ltr", "kind", "type", "name", "name2", "last", "bid", "ask", "price", "bbp", "bbc",
            "bbs", "bbf", "bap", "bac", "bas", "baf", "pp", "op", "ltp", "lts",
            "ltt", "chg", "pcp", "ltc", "mintp", "maxtp", "vol", "vlt", "trades",
            "min_step", "step_price", "p5", "chg5", "p22", "chg22", "p110",
            "chg110", "p220", "chg220", "x_curr", "x_lot", "x_istrade",
            "ClosePrice", "TradingReferencePrice", "UTCOffset", "Volatility",
            "TradingSessionSubID", "acc_srv_tm", "acd", "base_contract_code",
            "base_currency", "base_ltr", "bat", "bbt", "codesub_nm", "cpn", "cpp",
            "delta", "dpb", "dps", "emitent_type", "fv", "gamma", "indap", "indbp"
        ]);
        const identifierKeys = ["c", "symbol", "ticker", "code", "i", "instr", "instrument"];
        const sample = rows[0];
        // Do not use keys(), which intentionally truncates general object summaries to 40 keys.
        // Quote diagnostics need to show later alphabetic fields such as ltp.
        const quoteItemKeys = sample && isRecord(sample)
            ? Object.keys(sample).filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && quoteKeys.has(key)).sort().slice(0, 80)
            : [];
        const returnedSymbols = rows.slice(0, 10).map(row => {
            if (!isRecord(row)) return null;
            const key = identifierKeys.find(candidate => typeof row[candidate] === "string");
            return key ? row[key].slice(0, 64) : null;
        }).filter(Boolean);
        const keyedSymbols = containerPath === "payload.object_values" ? keys(payload).slice(0, 10) : [];
        return {
            event: eventName,
            payloadType,
            topLevelKeys: keys(payload),
            quoteContainerPath: containerPath,
            quoteContainerType: container === null ? "unrecognized" : "array",
            quotesCount: rows.length,
            quoteItemKeys,
            quoteItemTypes: sample && isRecord(sample)
                ? Object.fromEntries(quoteItemKeys.map(key => [key, describeRedactedValueType(sample[key])]))
                : {},
            identifierFieldTypes: sample && isRecord(sample)
                ? Object.fromEntries(identifierKeys.filter(key => sample[key] !== undefined)
                    .map(key => [key, describeRedactedValueType(sample[key])]))
                : {},
            returnedSymbols,
            keyedSymbols
        };
    }
    throw new Error("Unsupported TradeNet stream event.");
}

async function diagnoseFreedomEventStream(env, eventName, includePayload = false, subscriptionData = undefined) {
    const sid = await createFreedomDiagnosticSession(env);
    const startedAt = Date.now();
    const responseEventName = eventName === "quotes" ? "q" : eventName;
    let eventSummary = null;
    let eventPayload = null;
    const diagnostics = {
        endpoint: "wss.tradernet.com",
        requestedEvent: eventName,
        phase: "connecting",
        handshakeResponseReceived: false,
        handshakeStatus: null,
        connectionOpened: false,
        subscriptionSent: false,
        userDataReceived: false,
        isDemo: null,
        sessionMode: null,
        eventReceived: false,
        messageCount: 0,
        parseErrorCount: 0,
        eventCounts: {},
        serverErrorCategory: null,
        socketErrorObserved: false,
        closeCode: null
    };
    const snapshot = () => ({
        ...diagnostics,
        eventCounts: { ...diagnostics.eventCounts },
        eventSummary,
        ...(includePayload ? { eventPayload } : {}),
        elapsedMs: Date.now() - startedAt
    });

    return await new Promise((resolve, reject) => {
        let socket = null;
        let settled = false;
        let timeoutId;
        const abortController = new AbortController();
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            const result = snapshot();
            try { socket?.close(1000, "TradeNet event diagnostic finished"); } catch { /* ignore close races */ }
            if (error) {
                if ([401, 403].includes(Number(error.status)) ||
                    diagnostics.phase === "demo_session" ||
                    diagnostics.serverErrorCategory === "auth_or_session_rejected") {
                    error.freedomDiagnosticSid = sid;
                }
                error.diagnostics = result;
                reject(error);
            } else {
                resolve(result);
            }
        };
        timeoutId = setTimeout(() => {
            diagnostics.phase = diagnostics.connectionOpened ? "event_timeout" : "handshake_timeout";
            if (!diagnostics.connectionOpened) abortController.abort();
            finish(null);
        }, 8000);

        const url = new URL("https://wss.tradernet.com/");
        url.searchParams.set("SID", sid);
        fetch(url.toString(), {
            headers: { Upgrade: "websocket" },
            signal: abortController.signal
        }).then(response => {
            if (settled) {
                try { response.webSocket?.close(1000, "Diagnostic already finished"); } catch { /* ignore close races */ }
                return;
            }
            diagnostics.handshakeResponseReceived = true;
            diagnostics.handshakeStatus = Number.isFinite(Number(response.status)) ? Number(response.status) : null;
            socket = response.webSocket || null;
            if (!socket) {
                const status = diagnostics.handshakeStatus;
                const error = new Error(status
                    ? "TradeNet rejected the WebSocket upgrade (HTTP " + status + ")."
                    : "TradeNet did not accept the WebSocket upgrade.");
                error.status = status === 401 || status === 403 ? status : 502;
                diagnostics.phase = "handshake_rejected";
                finish(error);
                return;
            }
            try {
                socket.addEventListener("message", event => {
                    if (settled) return;
                    diagnostics.messageCount += 1;
                    let packet;
                    try {
                        packet = JSON.parse(String(event?.data || ""));
                    } catch {
                        diagnostics.parseErrorCount += 1;
                        return;
                    }
                    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
                    const name = packet[0];
                    if (/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) {
                        diagnostics.eventCounts[name] = (diagnostics.eventCounts[name] || 0) + 1;
                    }
                    if (name === "userData") {
                        const userData = packet[1];
                        diagnostics.userDataReceived = true;
                        diagnostics.isDemo = typeof userData?.isDemo === "boolean" ? userData.isDemo : null;
                        const mode = String(userData?.mode || "").trim().toLowerCase();
                        diagnostics.sessionMode = ["prod", "demo", "test", "paper", "beta"].includes(mode) ? mode : "unknown";
                        if (diagnostics.isDemo === true || userData?.real === false ||
                            ["demo", "test", "paper", "beta"].includes(diagnostics.sessionMode)) {
                            diagnostics.phase = "demo_session";
                            const error = new Error("TradeNet authenticated a demo or non-production session.");
                            error.status = 403;
                            finish(error);
                            return;
                        }
                    } else if (name === responseEventName) {
                        diagnostics.eventReceived = true;
                        eventPayload = includePayload ? packet[1] : null;
                        eventSummary = summarizeFreedomStreamEvent(eventName, packet[1]);
                    } else if (name === "error") {
                        const text = typeof packet[1] === "string" ? packet[1] : "";
                        diagnostics.serverErrorCategory = /sid|session|auth|login|unauthori[sz]ed|expired/i.test(text)
                            ? "auth_or_session_rejected" : "upstream_error";
                        diagnostics.phase = "server_error";
                        const error = new Error(diagnostics.serverErrorCategory === "auth_or_session_rejected"
                            ? "TradeNet rejected the authenticated session."
                            : "TradeNet returned a WebSocket error.");
                        error.status = diagnostics.serverErrorCategory === "auth_or_session_rejected" ? 401 : 502;
                        finish(error);
                        return;
                    }
                    if (diagnostics.userDataReceived && diagnostics.eventReceived) {
                        diagnostics.phase = "event_received";
                        finish(null);
                    }
                });
                socket.addEventListener("error", () => {
                    diagnostics.socketErrorObserved = true;
                    if (!settled) diagnostics.phase = "websocket_error";
                });
                socket.addEventListener("close", event => {
                    if (settled) return;
                    diagnostics.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
                    diagnostics.phase = "connection_closed";
                    finish(null);
                });
                socket.accept();
                diagnostics.connectionOpened = true;
                diagnostics.phase = "subscribing_" + eventName;
                socket.send(JSON.stringify(subscriptionData === undefined ? [eventName] : [eventName, subscriptionData]));
                diagnostics.subscriptionSent = true;
                diagnostics.phase = "awaiting_events";
            } catch {
                const error = new Error("TradeNet WebSocket opened, but the " + eventName + " subscription could not be sent.");
                error.status = 502;
                diagnostics.phase = "subscription_send_failed";
                finish(error);
            }
        }).catch(() => {
            if (settled) return;
            diagnostics.phase = abortController.signal.aborted ? "handshake_timeout" : "websocket_handshake_failed";
            const error = new Error(abortController.signal.aborted
                ? "TradeNet WebSocket handshake timed out."
                : "TradeNet WebSocket handshake failed before a connection was opened.");
            error.status = abortController.signal.aborted ? 504 : 502;
            finish(error);
        });
    });
}

function sanitizeFreedomStreamQuote(payload, requestedSymbol) {
    const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const identifierKeys = ["c", "symbol", "ticker", "code", "i", "instr", "instrument"];
    let rows = Array.isArray(payload?.q) ? payload.q
        : Array.isArray(payload) ? payload : [];
    if (rows.length === 0 && isRecord(payload)) {
        // The production raw q event can be a single quote object rather
        // than the Socket.IO { q: [...] } wrapper used in older examples.
        if (identifierKeys.some(key => typeof payload[key] === "string")) {
            rows = [payload];
        } else {
            const values = Object.values(payload);
            if (values.length > 0 && values.every(isRecord)) rows = values;
        }
    }
    const target = String(requestedSymbol || "").trim().toUpperCase();
    const quote = rows.find(row => {
        const identifier = identifierKeys.find(key => typeof row?.[key] === "string");
        return identifier && String(row[identifier]).trim().toUpperCase() === target;
    });
    if (!quote) {
        throw new Error("TradeNet quote stream did not return the requested symbol.");
    }
    // UTCOffset and acc_srv_tm are public quote timing metadata; pass them through
    // only when present so clients can assess timestamps without guessing a zone.
    const allowedFields = new Set([
        "c", "n", "mrg", "ltr", "kind", "type", "name", "name2", "bbp", "bbc",
        "bbs", "bbf", "bap", "bac", "bas", "baf", "pp", "op", "ltp", "lts",
        "ltt", "chg", "pcp", "ltc", "mintp", "maxtp", "vol", "vlt", "trades",
        "min_step", "step_price", "p5", "chg5", "p22", "chg22", "p110",
        "chg110", "p220", "chg220", "x_curr", "x_lot", "x_istrade", "UTCOffset", "acc_srv_tm"
    ]);
    const sanitized = {};
    for (const [key, value] of Object.entries(quote)) {
        if (!allowedFields.has(key)) continue;
        if (typeof value === "string") sanitized[key] = value.slice(0, 160);
        else if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
        else if (typeof value === "boolean" || value === null) sanitized[key] = value;
    }
    if (typeof sanitized.ltp !== "number" && !(typeof sanitized.ltp === "string" && Number.isFinite(Number(sanitized.ltp)))) {
        throw new Error("TradeNet quote stream returned no valid last-trade price.");
    }
    return sanitized;
}

export function sanitizeFreedomPositions(response) {
    // The upstream API response can be wrapped differently depending on the
    // TradeNet gateway/version. Accept only known position-envelope variants.
    const candidates = [
        response?.data?.result?.ps,
        response?.result?.ps,
        response?.data?.ps,
        response?.ps,
        response?.data?.result,
        response?.result
    ];
    const ps = candidates.find(value => value && typeof value === "object"
        && (Array.isArray(value.acc) || Array.isArray(value.pos)));
    const loaded = ps?.loaded === true || ps?.loaded === 1 || ps?.loaded === "1" || ps?.loaded === "true";
    if (!ps || (ps.loaded !== undefined && ps.loaded !== null && !loaded)) {
        throw new Error("TradeNet returned an invalid or unloaded positions response.");
    }
    const usdRows = (rows) => Array.isArray(rows)
        ? rows.filter(row => String(row?.curr ?? row?.base_currency ?? "").toUpperCase() === "USD")
        : [];
    const numberOrNull = value => {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    const acc = usdRows(ps.acc).map(row => ({
        curr: "USD",
        s: numberOrNull(row.s),
        currval: numberOrNull(row.currval),
        forecast_in: numberOrNull(row.forecast_in) ?? 0,
        forecast_out: numberOrNull(row.forecast_out) ?? 0,
        t2_in: numberOrNull(row.t2_in) ?? 0,
        t2_out: numberOrNull(row.t2_out) ?? 0
    }));
    const pos = usdRows(ps.pos).map(row => ({
        i: String(row.i ?? row.base_contract_code ?? ""),
        name: String(row.name ?? row.name2 ?? row.i ?? "Unknown instrument"),
        q: numberOrNull(row.q) ?? 0,
        curr: "USD",
        mkt_price: numberOrNull(row.mkt_price),
        market_value: numberOrNull(row.market_value),
        bal_price_a: numberOrNull(row.bal_price_a),
        profit_close: numberOrNull(row.profit_close),
        acc_pos_id: numberOrNull(row.acc_pos_id)
    })).filter(row => row.i);
    return {
        data: {
            result: {
                ps: { loaded: true, acc, pos }
            }
        }
    };
}

export default {
    async fetch(request, env) {

        const corsHeaders = resolveCorsHeaders(request, env);
        if (!corsHeaders) {
            return jsonError("Origin is not allowed.", 403, {
                "Content-Type": "application/json",
                "Vary": "Origin"
            });
        }

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Reject unsupported methods and oversized bodies before parsing or proxying.
        if (request.method !== "GET" && request.method !== "POST") {
            return jsonError("Method not allowed.", 405, corsHeaders);
        }


        const incomingUrl = new URL(request.url);

        // Browser WebSocket constructors cannot set Authorization headers. The
        // one-use ticket was minted by an authenticated request and is consumed
        // by the Durable Object before it accepts this persistent socket.
        if (incomingUrl.searchParams.get("action") === "freedom-quote-socket") {
            if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
                return jsonError("A WebSocket upgrade is required.", 426, corsHeaders);
            }
            const ticket = incomingUrl.searchParams.get("ticket") || "";
            if (!/^[a-f0-9]{64}$/i.test(ticket)) {
                return jsonError("A valid one-use quote stream ticket is required.", 401, corsHeaders);
            }
            if (!env.PORTFOLIO_STATE_DO) return jsonError("PORTFOLIO_STATE_DO binding is missing.", 500, corsHeaders);
            try {
                const streamStub = env.PORTFOLIO_STATE_DO.get(env.PORTFOLIO_STATE_DO.idFromName("portfolio_state"));
                const socketUrl = new URL("https://portfolio-state.internal/internal/freedom-quote-stream-socket");
                socketUrl.searchParams.set("ticket", ticket);
                const response = await streamStub.fetch(new Request(socketUrl.toString(), {
                    method: "GET",
                    headers: { Upgrade: "websocket" }
                }));
                if (response.status === 101 && response.webSocket) return response;
                const responseHeaders = new Headers(response.headers);
                Object.entries(corsHeaders).forEach(([name, value]) => responseHeaders.set(name, value));
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders
                });
            } catch (error) {
                console.error("Persistent TradeNet quote socket failed", error);
                return jsonError("Could not establish the TradeNet quote socket.", 502, corsHeaders);
            }
        }

        if (incomingUrl.pathname.startsWith("/api/auth/")) {
            if (request.method === "POST" && AUTH_EDGE_RATE_LIMITED_PATHS.has(incomingUrl.pathname)) {
                const rateLimitResponse = await enforceAuthEdgeRateLimit(
                    request,
                    env,
                    incomingUrl.pathname,
                    corsHeaders
                );
                if (rateLimitResponse) return rateLimitResponse;
            }

            if (!env.PORTFOLIO_STATE_DO) return jsonError("PORTFOLIO_STATE_DO binding is missing.", 500, corsHeaders);

            let forwardedRequest = request;
            if (request.method === "POST") {
                if (request.headers.get("Content-Type")?.toLowerCase().includes("application/json") !== true) {
                    return jsonError("Authentication requests must use application/json.", 415, corsHeaders);
                }
                const declaredLength = Number(request.headers.get("Content-Length") || 0);
                if (Number.isFinite(declaredLength) && declaredLength > 8192) {
                    return jsonError("Authentication request exceeds the 8 KB limit.", 413, corsHeaders);
                }
                let rawBody = "";
                const reader = request.body?.getReader();
                if (reader) {
                    const chunks = [];
                    let receivedBytes = 0;
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            receivedBytes += value.byteLength;
                            if (receivedBytes > 8192) {
                                await reader.cancel("Authentication request exceeds the configured limit.");
                                return jsonError("Authentication request exceeds the 8 KB limit.", 413, corsHeaders);
                            }
                            chunks.push(value);
                        }
                    } finally {
                        reader.releaseLock();
                    }
                    const bytes = new Uint8Array(receivedBytes);
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    rawBody = new TextDecoder().decode(bytes);
                }
                let payload;
                try { payload = JSON.parse(rawBody); } catch { return jsonError("Invalid JSON request body.", 400, corsHeaders); }
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) return jsonError("Invalid JSON request body.", 400, corsHeaders);
                const headers = new Headers(request.headers);
                headers.delete("Content-Length");
                if (incomingUrl.pathname === "/api/auth/bootstrap") {
                    if (!env.GATEWAY_SECRET || payload.bootstrapSecret !== env.GATEWAY_SECRET) {
                        return jsonError("Initial setup requires the configured Gateway Secret.", 401, corsHeaders);
                    }
                    delete payload.bootstrapSecret;
                    headers.set("X-Bootstrap-Authorized", "true");
                    headers.set("X-Workspace-Encryption-Key", env.GATEWAY_SECRET);
                }
                headers.set("Content-Type", "application/json");
                forwardedRequest = new Request(request.url, { method: "POST", headers, body: JSON.stringify(payload) });
            }
            let authResponse;
            try {
                const authStub = env.PORTFOLIO_STATE_DO.get(env.PORTFOLIO_STATE_DO.idFromName("portfolio_state"));
                authResponse = await authStub.fetch(forwardedRequest);
            } catch (error) {
                // Preserve CORS headers so the browser can display a useful
                // JSON failure instead of masking the Durable Object error.
                console.error("Account Durable Object request failed", error);
                return jsonError("Account service unavailable. Check the Cloudflare Worker logs.", 503, corsHeaders);
            }
            const authHeaders = new Headers(authResponse.headers);
            Object.entries(corsHeaders).forEach(([name, value]) => authHeaders.set(name, value));
            return new Response(authResponse.body, { status: authResponse.status, statusText: authResponse.statusText, headers: authHeaders });
        }

        // SECURITY CHECK: Validate an account session (the Gateway Secret is bootstrap-only).
        const authHeader = request.headers.get("Authorization") || "";
        const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
        const clientSecret = request.headers.get("X-App-Auth") || bearerToken;
        const isBootstrapCredential = Boolean(env.GATEWAY_SECRET && clientSecret === env.GATEWAY_SECRET);
        let legacyBootstrapAccess = false;
        let accountRole = "";
        let accountId = "";
        if (env.PORTFOLIO_STATE_DO && isBootstrapCredential) {
            const authStub = env.PORTFOLIO_STATE_DO.get(env.PORTFOLIO_STATE_DO.idFromName("portfolio_state"));
            const statusResponse = await authStub.fetch(new Request("https://auth.internal/api/auth/status"));
            const authStatus = statusResponse.ok ? await statusResponse.json().catch(() => null) : null;
            // Keep existing Gateway-Secret-only clients working until the first
            // admin account is created. Bootstrap closes this compatibility path.
            legacyBootstrapAccess = authStatus?.setupRequired === true;
        }
        if (env.PORTFOLIO_STATE_DO && clientSecret) {
            const authStub = env.PORTFOLIO_STATE_DO.get(env.PORTFOLIO_STATE_DO.idFromName("portfolio_state"));
            const verifyResponse = await authStub.fetch(new Request("https://auth.internal/api/auth/verify", {
                method: "POST",
                headers: { Authorization: "Bearer " + clientSecret, "Content-Type": "application/json" },
                body: "{}"
            }));
            if (verifyResponse.ok) {
                const principal = await verifyResponse.json().catch(() => null);
                accountRole = principal?.user?.role || "";
                accountId = typeof principal?.user?.id === "string" ? principal.user.id : "";
            }
        }
        // Retain the Gateway Secret path only for deployments without the account
        // store and during the one-time upgrade window before the first admin.
        const gatewayAdmin = !env.PORTFOLIO_STATE_DO && isBootstrapCredential || legacyBootstrapAccess;
        if (gatewayAdmin && !accountRole) accountRole = "admin";
        if (gatewayAdmin && !accountId) accountId = "legacy-admin";
        if (!gatewayAdmin && !accountRole) return jsonError("Unauthorized gateway access.", 401, corsHeaders);
        if (request.method === "POST" && accountRole !== "admin" && !gatewayAdmin) {
            return jsonError("Guest accounts have read-only access.", 403, corsHeaders);
        }
        // Parse and validate the request contract before reading any POST body.
        // Authenticated but invalid requests should not consume the body budget.
        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const pathname = url.pathname;
        const symbol = (url.searchParams.get("symbol") || url.searchParams.get("ticker") || "").toUpperCase();

        if (accountRole === "guest") {
            const sharedDataPath = ["/api/state", "/api/history", "/api/margin-digest"].includes(pathname);
            const sharedDataAction = [
                "state", "history", "freedom-test", "freedom-positions", "freedom-trades",
                "freedom-orders", "freedom-cashflows", "freedom-orders-stream", "freedom-portfolio-snapshot"
            ].includes(action);
            // Market quotes and exchange schedules are public, read-only data.
            // Guests may use the same server-side authenticated q / markets
            // subscriptions, but never receive account-wide portfolio, order,
            // execution, cashflow, or portfolio-event payloads.
            const guestPublicMarketStream = action === "freedom-quote-stream" ||
                action === "freedom-quote-stream-ticket" ||
                (action === "freedom-event-stream" && url.searchParams.get("event") === "markets");
            const restrictedEventStream = action === "freedom-event-stream" && !guestPublicMarketStream;
            if (sharedDataPath || sharedDataAction || restrictedEventStream) {
                return jsonError("This data is restricted to administrator accounts.", 403, corsHeaders);
            }
        }

        if (action && !["state", "history", "news", "gemini", "provider-quote", "stocktwits", "freedom-test", "freedom-positions", "freedom-trades", "freedom-quote", "freedom-news", "freedom-history", "freedom-cashflows", "freedom-orders", "freedom-orders-stream", "freedom-event-stream", "freedom-portfolio-snapshot", "freedom-quote-stream", "freedom-quote-stream-ticket", "quote"].includes(action)) {
            return jsonError("Unsupported action.", 400, corsHeaders);
        }
        const getOnlyActions = new Set(["news", "provider-quote", "stocktwits", "freedom-test", "freedom-positions", "freedom-trades", "freedom-quote", "freedom-news", "freedom-history", "freedom-cashflows", "freedom-orders", "freedom-orders-stream", "freedom-event-stream", "freedom-portfolio-snapshot", "freedom-quote-stream", "freedom-quote-stream-ticket", "quote"]);
        if (getOnlyActions.has(action) && request.method !== "GET") {
            return jsonError("This action only supports GET.", 405, corsHeaders);
        }
        if (action !== "gemini" && action !== "state" && pathname !== "/api/state" && pathname !== "/api/history" && symbol && !validSymbolList(symbol)) {
            return jsonError("Invalid symbol list. Use up to 10 ticker symbols with letters, numbers, dots, carets, equals signs, or hyphens.", 400, corsHeaders);
        }

        if (action === "freedom-quote-stream-ticket") {
            const rawSymbols = url.searchParams.get("symbols") || "";
            if (!validSymbolList(rawSymbols)) {
                return jsonError("Provide 1–10 valid ticker symbols for the quote stream.", 400, corsHeaders);
            }
            if (!env.PORTFOLIO_STATE_DO || !accountId || !["admin", "guest"].includes(accountRole)) {
                return jsonError("An authenticated portfolio account is required for the quote stream.", 401, corsHeaders);
            }
            const symbols = [...new Set(rawSymbols.split(",").map(value => {
                const normalized = value.trim().toUpperCase();
                return normalized && !normalized.includes(".") ? normalized + ".US" : normalized;
            }))];
            const streamStub = env.PORTFOLIO_STATE_DO.get(env.PORTFOLIO_STATE_DO.idFromName("portfolio_state"));
            const ticketResponse = await streamStub.fetch(new Request(
                "https://portfolio-state.internal/internal/freedom-quote-stream-ticket",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accountId, role: accountRole, symbols })
                }
            ));
            const ticketPayload = await ticketResponse.json().catch(() => null);
            if (!ticketResponse.ok || ticketPayload?.ok !== true || typeof ticketPayload.ticket !== "string") {
                return jsonError(ticketPayload?.error || "Could not create a quote stream ticket.", ticketResponse.status || 502, corsHeaders);
            }
            return new Response(JSON.stringify({
                ok: true,
                provider: "Freedom TradeNet",
                ticket: ticketPayload.ticket,
                expiresAt: ticketPayload.expiresAt,
                symbols
            }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
        }

        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
            return jsonError("Request body exceeds the 20 MB limit.", 413, corsHeaders);
        }
        if (request.method === "POST") {
            if (request.headers.get("Content-Type")?.toLowerCase().includes("application/json") !== true) {
                return jsonError("POST requests must use application/json.", 415, corsHeaders);
            }
            // Content-Length may be omitted or forged. Consume and count the actual
            // stream with a hard ceiling, then rebuild the bounded request body for the
            // action handler. Do not use Request.clone() here: its tee can buffer the
            // unread branch while an attacker streams an arbitrarily large body.
            const bodyReader = request.body?.getReader();
            if (bodyReader) {
                let receivedBytes = 0;
                const chunks = [];
                try {
                    while (true) {
                        const { done, value } = await bodyReader.read();
                        if (done) break;
                        receivedBytes += value.byteLength;
                        if (receivedBytes > MAX_REQUEST_BYTES) {
                            await bodyReader.cancel("Request body exceeds the configured limit.");
                            return jsonError("Request body exceeds the 20 MB limit.", 413, corsHeaders);
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
        }

        try {
            // Read-only Freedom TradeNet connectivity probe. Never accepts a command from the client.
            if (action === "freedom-test") {
                if (request.method !== "GET") {
                    return jsonError("Freedom test only supports GET.", 405, corsHeaders);
                }
                await requestTradeNet(env);
                // Never expose account positions or balances in a connectivity probe.
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    message: "Authenticated read-only request succeeded."
                }), { headers: corsHeaders });
            }

            // Authenticated read-only TradeNet WebSocket orders snapshot.
            // The response includes sanitized normalized order rows plus preview metadata; the SID and raw payload never leave the Worker.
            if (action === "freedom-orders-stream") {
                if (request.method !== "GET") {
                    return jsonError("Freedom orders stream diagnostic only supports GET.", 405, corsHeaders);
                }
                try {
                    const result = await diagnoseFreedomOrdersStream(env);
                    const { ordersSnapshot, tradesSnapshot, ...diagnostics } = result;
                    const eventsConfirmed = diagnostics.connectionOpened &&
                        diagnostics.userDataReceived && diagnostics.ordersEventReceived;
                    return new Response(JSON.stringify({
                        ok: eventsConfirmed,
                        provider: "Freedom TradeNet",
                        message: eventsConfirmed
                            ? "Authenticated orders snapshot delivered by the TradeNet WebSocket."
                            : "WebSocket snapshot completed; inspect the event flags and phase.",
                        diagnostics,
                        ...(eventsConfirmed ? { data: { orders: ordersSnapshot, trades: tradesSnapshot } } : {})
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    if (error?.freedomDiagnosticSid) {
                        await invalidateFreedomDiagnosticSession(env, error.freedomDiagnosticSid);
                    }
                    const status = Number(error?.status);
                    return new Response(JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : "TradeNet orders stream diagnostic failed.",
                        diagnostics: error?.diagnostics || null
                    }), {
                        status: 200,
                        headers: { ...corsHeaders, "Cache-Control": "no-store" }
                    });
                }
            }

            // Authenticated, read-only diagnostics for allowlisted TradeNet event subscriptions.
            if (action === "freedom-event-stream") {
                const eventName = incomingUrl.searchParams.get("event") || "";
                if (!["portfolio", "markets"].includes(eventName)) {
                    return jsonError("Unsupported TradeNet stream event. Allowed events: portfolio, markets.", 400, corsHeaders);
                }
                try {
                    const result = await diagnoseFreedomEventStream(env, eventName);
                    const eventsConfirmed = result.connectionOpened &&
                        result.userDataReceived && result.eventReceived &&
                        result.isDemo !== true && result.sessionMode === "prod";
                    return new Response(JSON.stringify({
                        ok: eventsConfirmed,
                        provider: "Freedom TradeNet",
                        event: eventName,
                        message: eventsConfirmed
                            ? eventName === "markets"
                                ? "Authenticated market status and schedule received; public fields only."
                                : "Authenticated portfolio event received; schema summary only."
                            : "TradeNet event diagnostic completed; inspect the event flags and phase.",
                        data: result.eventSummary,
                        diagnostics: Object.fromEntries(Object.entries(result).filter(([key]) => key !== "eventSummary"))
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    if (error?.freedomDiagnosticSid) {
                        await invalidateFreedomDiagnosticSession(env, error.freedomDiagnosticSid);
                    }
                    return new Response(JSON.stringify({
                        ok: false,
                        event: eventName,
                        error: error instanceof Error ? error.message : "TradeNet event diagnostic failed.",
                        diagnostics: error?.diagnostics || null
                    }), { status: 200, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                }
            }

            // Admin-only sanitized, fully-loaded portfolio event snapshot for read-only REST reconciliation.
            if (action === "freedom-portfolio-snapshot") {
                try {
                    const result = await diagnoseFreedomEventStream(env, "portfolio", true);
                    const eventsConfirmed = result.connectionOpened &&
                        result.userDataReceived && result.eventReceived &&
                        result.isDemo !== true && result.sessionMode === "prod";
                    if (!eventsConfirmed) {
                        return new Response(JSON.stringify({
                            ok: false,
                            error: "TradeNet portfolio WebSocket snapshot was not confirmed.",
                            diagnostics: Object.fromEntries(Object.entries(result).filter(([key]) => !["eventSummary", "eventPayload"].includes(key)))
                        }), { status: 502, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                    }
                    const portfolioPayload = result.eventPayload?.portfolio ?? result.eventPayload?.ps ?? result.eventPayload;
                    if (!portfolioPayload || portfolioPayload.loaded !== true ||
                        !Array.isArray(portfolioPayload.acc) || !Array.isArray(portfolioPayload.pos)) {
                        throw new Error("TradeNet portfolio WebSocket snapshot is not fully loaded.");
                    }
                    const sanitized = sanitizeFreedomPositions({ data: { result: { ps: portfolioPayload } } });
                    return new Response(JSON.stringify({
                        ok: true,
                        provider: "Freedom TradeNet",
                        source: "authenticated_websocket",
                        data: sanitized.data,
                        diagnostics: {
                            phase: result.phase,
                            handshakeStatus: result.handshakeStatus,
                            elapsedMs: result.elapsedMs,
                            accountsCount: sanitized.data.result.ps.acc.length,
                            positionsCount: sanitized.data.result.ps.pos.length
                        }
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    if (error?.freedomDiagnosticSid) {
                        await invalidateFreedomDiagnosticSession(env, error.freedomDiagnosticSid);
                    }
                    const upstreamStatus = Number(error?.status);
                    const status = [401, 403, 429, 503].includes(upstreamStatus) ? upstreamStatus : 502;
                    return new Response(JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : "TradeNet portfolio snapshot failed."
                    }), { status, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                }
            }

            // Authenticated one-shot quote stream diagnostic. This does not replace REST quote retrieval.
            if (action === "freedom-quote-stream") {
                const quoteSymbol = symbol.trim().toUpperCase();
                if (!quoteSymbol || !/^[A-Z0-9.^=-]{1,32}$/.test(quoteSymbol)) {
                    return jsonError("Provide exactly one valid TradeNet ticker symbol.", 400, corsHeaders);
                }
                let quoteStreamDiagnostics = null;
                try {
                    const result = await diagnoseFreedomEventStream(env, "quotes", true, [quoteSymbol]);
                    quoteStreamDiagnostics = {
                        phase: result.phase,
                        requestedEvent: "quotes",
                        responseEvent: "q",
                        requestedSymbol: quoteSymbol,
                        handshakeStatus: result.handshakeStatus,
                        elapsedMs: result.elapsedMs,
                        connectionOpened: result.connectionOpened,
                        userDataReceived: result.userDataReceived,
                        sessionMode: result.sessionMode,
                        eventReceived: result.eventReceived,
                        eventCounts: result.eventCounts,
                        eventSummary: result.eventSummary
                    };
                    const eventsConfirmed = result.connectionOpened &&
                        result.userDataReceived && result.eventReceived &&
                        result.isDemo !== true && result.sessionMode === "prod";
                    if (!eventsConfirmed) {
                        return new Response(JSON.stringify({
                            ok: false,
                            provider: "Freedom TradeNet",
                            symbol: quoteSymbol,
                            error: "Authenticated TradeNet quote event was not confirmed.",
                            diagnostics: Object.fromEntries(Object.entries(result).filter(([key]) => !["eventSummary", "eventPayload"].includes(key)))
                        }), { status: 502, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                    }
                    const quote = sanitizeFreedomStreamQuote(result.eventPayload, quoteSymbol);
                    return new Response(JSON.stringify({
                        ok: true,
                        provider: "Freedom TradeNet",
                        source: "authenticated_websocket",
                        symbol: quoteSymbol,
                        message: "Authenticated TradeNet quote event received.",
                        data: { q: [quote] },
                        diagnostics: {
                            phase: result.phase,
                            requestedEvent: "quotes",
                            responseEvent: "q",
                            requestedSymbol: quoteSymbol,
                            handshakeStatus: result.handshakeStatus,
                            elapsedMs: result.elapsedMs,
                            quoteFieldCount: Object.keys(quote).length
                        }
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    if (error?.freedomDiagnosticSid) {
                        await invalidateFreedomDiagnosticSession(env, error.freedomDiagnosticSid);
                    }
                    const upstreamStatus = Number(error?.status);
                    const status = [401, 403, 429, 503].includes(upstreamStatus) ? upstreamStatus : 502;
                    return new Response(JSON.stringify({
                        ok: false,
                        provider: "Freedom TradeNet",
                        symbol: quoteSymbol,
                        error: error instanceof Error ? error.message : "TradeNet quote stream failed.",
                        diagnostics: error?.diagnostics
                            ? Object.fromEntries(Object.entries(error.diagnostics).filter(([key]) => !["eventPayload"].includes(key)))
                            : quoteStreamDiagnostics
                    }), { status, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                }
            }

            // Read-only positions retrieval. The command is fixed server-side;
            // clients cannot pass arbitrary TradeNet commands or order operations.
            if (action === "freedom-positions") {
                if (request.method !== "GET") {
                    return jsonError("Freedom positions only supports GET.", 405, corsHeaders);
                }
                const rawData = await requestTradeNet(env, "getPositionJson");
                let data;
                try {
                    data = sanitizeFreedomPositions(rawData);
                } catch (error) {
                    return jsonError(error instanceof Error ? error.message : "Invalid TradeNet positions response.", 502, corsHeaders);
                }
                // Keep the gateway envelope shallow: the frontend normalizer expects
                // data.result.ps, not data.data.result.ps.
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    data: data.data
                }), { headers: corsHeaders });
            }

            // Read-only market data. Commands are fixed server-side; callers cannot submit
            // arbitrary TradeNet commands or access trading operations.
            if (["freedom-quote", "freedom-news", "freedom-history"].includes(action)) {
                if (!symbol || symbol.includes(",")) {
                    return jsonError("A single valid symbol is required for Freedom market data.", 400, corsHeaders);
                }
                if (!env.FREEDOM_PUBLIC_KEY || !env.FREEDOM_PRIVATE_KEY) {
                    return jsonError("Freedom market-data credentials are not configured in the Worker.", 503, corsHeaders);
                }
                const command = action === "freedom-quote" ? "getStockQuotesJson" : action === "freedom-news" ? "getNews" : "getHloc";
                // requestTradeNet targets the API-key v2 route: the command is in the URL,
                // and the signed JSON body contains only these method parameters.
                const params = action === "freedom-quote" ? { tickers: [symbol] } : action === "freedom-news" ? { ticker: symbol, limit: 10 } : { ticker: symbol, interval: "D", limit: 100 };
                try {
                    const data = action === "freedom-quote"
                        ? await withProviderCache("freedom_quote", symbol, () => requestTradeNet(env, command, params))
                        : await requestTradeNet(env, command, params);
                    return new Response(JSON.stringify({ ok: true, provider: "Freedom TradeNet", symbol, data }), { headers: corsHeaders });
                } catch (error) {
                    // TradeNet's getNews endpoint currently returns HTTP 404 on some
                    // deployments/accounts. Keep the news UI usable via the existing
                    // Finnhub provider, but do not mask quote/history errors.
                    const message = error instanceof Error ? error.message : "";
                    if (action !== "freedom-news" || !message.includes("HTTP 404")) throw error;
                    const finnhubKey = env.FINNHUB_KEY || env.FINNHUB_API_KEY;
                    if (!finnhubKey) {
                        return jsonError("TradeNet news is unavailable (HTTP 404), and the Finnhub fallback key is not configured.", 502, corsHeaders);
                    }
                    const newsSymbol = symbol.endsWith(".US") ? symbol.slice(0, -3) : symbol;
                    const toDate = new Date().toISOString().split("T")[0];
                    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                    const fallbackResponse = await fetchWithTimeout(
                        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(newsSymbol)}&from=${fromDate}&to=${toDate}&token=${encodeURIComponent(finnhubKey)}`
                    );
                    const fallbackData = await fallbackResponse.json().catch(() => null);
                    if (!fallbackResponse.ok || !Array.isArray(fallbackData)) {
                        return jsonError("TradeNet news returned HTTP 404 and the Finnhub fallback failed.", 502, corsHeaders);
                    }
                    return new Response(JSON.stringify({
                        ok: true,
                        provider: "Finnhub fallback (TradeNet news unavailable)",
                        symbol,
                        data: fallbackData.slice(0, 10)
                    }), { headers: corsHeaders });
                }
            }
            // Read-only executed trade history. The command is fixed server-side;
            // an optional date-only cursor is translated into a bounded broker query.
            if (action === "freedom-trades") {
                if (request.method !== "GET") {
                    return jsonError("Freedom trades only supports GET.", 405, corsHeaders);
                }
                const fromDate = incomingUrl.searchParams.get("fromDate");
                if (fromDate !== null && !isValidDateOnly(fromDate)) {
                    return jsonError("Trade history start date must use YYYY-MM-DD.", 400, corsHeaders);
                }
                const params = fromDate
                    ? {
                        beginDate: fromDate + "T00:00:00",
                        endDate: new Date().toISOString().slice(0, 19),
                        sort: 0
                    }
                    : { sort: 0 };
                const data = await requestTradeNet(env, "getTradesHistory", params);
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    data
                }), { headers: corsHeaders });
            }

            // Read-only current active orders. The command and active_only filter are fixed
            // server-side; clients cannot submit arbitrary broker commands or place orders.
            if (action === "freedom-orders") {
                if (request.method !== "GET") {
                    return jsonError("Freedom orders only supports GET.", 405, corsHeaders);
                }
                const rawData = await requestTradeNet(env, "getNotifyOrderJson", { active_only: 1 });
                let data;
                try {
                    data = sanitizeFreedomActiveOrders(rawData);
                } catch (error) {
                    return jsonError(error instanceof Error ? error.message : "Invalid TradeNet orders response.", 502, corsHeaders);
                }
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    data
                }), { headers: corsHeaders });
            }

            // Read-only Freedom cashflow history. The command and date filter shape
            // are fixed server-side; clients can only provide a validated start date.
            if (action === "freedom-cashflows") {
                if (request.method !== "GET") {
                    return jsonError("Freedom cashflows only supports GET.", 405, corsHeaders);
                }
                const fromDate = incomingUrl.searchParams.get("fromDate");
                if (fromDate !== null && !isValidDateOnly(fromDate)) {
                    return jsonError("Cashflow start date must use YYYY-MM-DD.", 400, corsHeaders);
                }
                // TradeNet's getUserCashFlows accepts a server-side date filter;
                // eqormore includes every cashflow on the start date.
                const params = fromDate ? {
                    filters: [{ field: "date", operator: "eqormore", value: fromDate }],
                    sort: { field: "date", dir: "ASC" }
                } : {};
                const data = await requestTradeNet(env, "getUserCashFlows", params);
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    data
                }), { headers: corsHeaders });
            }

            // --- ACTION 0: Durable Object cloud portfolio state ---
            if (pathname === "/api/state" || pathname === "/api/history" || pathname === "/api/margin-digest" || pathname === "/api/guest-portfolio" || action === "state" || action === "history") {
                if (!env.PORTFOLIO_STATE_DO) {
                    return new Response(JSON.stringify({ error: "PORTFOLIO_STATE_DO binding is missing." }), {
                        status: 500,
                        headers: corsHeaders
                    });
                }
                // The app intentionally has one shared personal portfolio across the owner's
                // devices. Do not change this identity to a client-controlled value.
                const id = env.PORTFOLIO_STATE_DO.idFromName("portfolio_state");
                const stub = env.PORTFOLIO_STATE_DO.get(id);
                const stateResponse = await stub.fetch(new Request(request.url, {
                    method: request.method,
                    headers: request.headers,
                    body: request.method === "POST" ? await request.text() : undefined
                }));
                // Durable Object responses preserve ETag/revision headers while the
                // public Worker applies the request's validated CORS policy.
                const stateHeaders = new Headers(stateResponse.headers);
                Object.entries(corsHeaders).forEach(([name, value]) => stateHeaders.set(name, value));
                return new Response(stateResponse.body, {
                    status: stateResponse.status,
                    statusText: stateResponse.statusText,
                    headers: stateHeaders
                });
            }

            // --- ACTION 1: Finnhub Company News ---
            if (action === "news") {
                if (!symbol) throw new Error("Missing symbol for news.");
                const toDate = new Date().toISOString().split("T")[0];
                const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                const finnhubKey = env.FINNHUB_KEY || env.FINNHUB_API_KEY;

                if (!finnhubKey) {
                    return new Response(JSON.stringify({ error: "Finnhub provider key is not configured." }), {
                        status: 500,
                        headers: corsHeaders
                    });
                }

                const res = await fetchWithTimeout(
                    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${encodeURIComponent(finnhubKey)}`
                );
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    return new Response(JSON.stringify(data || { error: `Finnhub returned HTTP ${res.status}.` }), {
                        status: res.status,
                        headers: corsHeaders
                    });
                }
                if (!Array.isArray(data)) {
                    return new Response(JSON.stringify({ error: "Finnhub returned an invalid news response." }), {
                        status: 502,
                        headers: corsHeaders
                    });
                }
                return new Response(JSON.stringify(data.slice(0, 10)), { headers: corsHeaders });
            }

            // --- ACTION 2: Stocktwits public symbol stream ---
            if (action === "stocktwits") {
                if (!symbol || symbol.includes(",")) {
                    return jsonError("A single valid symbol is required for Stocktwits.", 400, corsHeaders);
                }

                const res = await fetchWithTimeout(
                    `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`,
                    { headers: { "Accept": "application/json", "User-Agent": USER_AGENT } }
                );
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    return new Response(JSON.stringify(data || { error: `Stocktwits returned HTTP ${res.status}.` }), {
                        status: res.status,
                        headers: corsHeaders
                    });
                }
                if (!data || !Array.isArray(data.messages)) {
                    return jsonError("Stocktwits returned an invalid stream response.", 502, corsHeaders);
                }

                // Filter replies before applying the limit so they don't crowd out original posts.
                const standaloneMessages = data.messages.filter((message) =>
                    message &&
                    message.conversation?.parent_message_id == null &&
                    message.in_reply_to == null &&
                    message.reply_to == null
                );
                return new Response(JSON.stringify({
                    symbol,
                    messages: standaloneMessages.slice(0, 40),
                    streamUrl: `https://stocktwits.com/symbol/${encodeURIComponent(symbol)}`
                }), { headers: corsHeaders });
            }

            // --- ACTION 3: Gemini AI Chat / Intent Routing ---
            if (action === "gemini") {
                const geminiKey = env.GEMINI_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
                if (!geminiKey) {
                    return new Response(JSON.stringify({
                        error: "Gemini key is missing from Worker environment variables. Set GEMINI_KEY in Cloudflare settings."
                    }), { status: 500, headers: corsHeaders });
                }

                const body = await request.json().catch(() => null);
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    return jsonError("Request body must be a JSON object.", 400, corsHeaders);
                }
                const prompt = body.prompt;

                if (typeof prompt !== "string" || !prompt.trim()) {
                    return new Response(JSON.stringify({ error: "Missing 'prompt' in request body." }), {
                        status: 400,
                        headers: corsHeaders
                    });
                }

                if (prompt.length > MAX_PROMPT_LENGTH) {
                    return jsonError("Prompt exceeds the 12,000-character limit.", 413, corsHeaders);
                }
                const requestedModel = body.model === undefined ? undefined : normalizeGeminiModel(body.model);
                if (requestedModel !== undefined && (typeof requestedModel !== "string" || !ALLOWED_GEMINI_MODELS.has(requestedModel))) {
                    return jsonError("Unsupported Gemini model.", 400, corsHeaders);
                }

                // Keep proxy model selection bounded to a known allowlist.
                const rawCandidates = [
                    requestedModel,
                    "gemini-3.8-flash",
                    "gemini-3.1-flash-lite",
                    "gemini-3.5-flash-lite",
                    "gemini-3.1-flash"
                ].filter(Boolean).map(model => model.replace(/^models\//, "")).filter(model => ALLOWED_GEMINI_MODELS.has(model));
                const candidateModels = Array.from(new Set(rawCandidates)).slice(0, 3);

                let lastResponse = null;
                let lastData = null;

                for (const rawModel of candidateModels) {
                    const modelName = rawModel.startsWith("models/") ? rawModel : `models/${rawModel}`;

                    const controller = new AbortController();
                    let timeoutId;
                    try {
                        // Keep the timeout active until the response body has been consumed.
                        timeoutId = setTimeout(() => controller.abort(new Error('Gemini upstream request timed out after 10 seconds')), 10_000);
                        const res = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(geminiKey.trim())}`,
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    contents: [{ parts: [{ text: prompt }] }]
                                }),
                                signal: controller.signal
                            }
                        );

                        const data = await res.json().catch(() => null);

                        if (res.ok && data) {
                            return new Response(JSON.stringify(data), {
                                status: 200,
                                headers: corsHeaders
                            });
                        }

                        // Save error details and proceed to the next model for ANY failure
                        lastResponse = res;
                        lastData = data || { error: `Model ${modelName} returned HTTP ${res.status}` };
                        console.warn(`[Gemini Proxy]: ${modelName} failed (HTTP ${res.status}). Trying next candidate...`);

                    } catch (err) {
                        console.error(`[Gemini Proxy Error on ${modelName}]:`, err.message);
                        lastData = { error: `Model ${modelName} fetch failed: ${err.message}` };
                    } finally {
                        if (timeoutId !== undefined) clearTimeout(timeoutId);
                    }
                }

                return new Response(JSON.stringify(lastData || { error: "All candidate models exhausted or failed." }), {
                    status: lastResponse ? lastResponse.status : 502,
                    headers: corsHeaders
                });
            }

            // --- ACTION 3: Fallback Provider Quote (Finnhub / TwelveData) ---
            if (action === "provider-quote") {
                const provider = url.searchParams.get("provider");
                if (!symbol) {
                    return new Response(JSON.stringify({ error: "Missing required 'symbol' parameter." }), {
                        status: 400,
                        headers: corsHeaders
                    });
                }

                let endpoint;
                let providerName;
                if (provider === "finnhub") {
                    const finnhubKey = env.FINNHUB_KEY || env.FINNHUB_API_KEY;
                    if (!finnhubKey) {
                        return new Response(JSON.stringify({ error: "Finnhub provider key is not configured." }), {
                            status: 500,
                            headers: corsHeaders
                        });
                    }
                    providerName = "Finnhub";
                    endpoint = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhubKey)}`;
                } else if (provider === "twelvedata") {
                    const tdKey = env.TWELVE_KEY || env.TWELVEDATA_KEY;
                    if (!tdKey) {
                        return new Response(JSON.stringify({ error: "Twelve Data provider key is not configured." }), {
                            status: 500,
                            headers: corsHeaders
                        });
                    }
                    providerName = "Twelve Data";
                    endpoint = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(tdKey)}`;
                } else {
                    return new Response(JSON.stringify({ error: "Unsupported quote provider." }), {
                        status: 400,
                        headers: corsHeaders
                    });
                }

                try {
                    const cacheProvider = provider === "finnhub" ? "finnhub" : "twelvedata";
                    const data = await withProviderCache(cacheProvider, symbol, async () => {
                        const res = await fetchWithTimeout(endpoint);
                        const payload = await res.json().catch(() => null);
                        if (!res.ok) throw Object.assign(new Error(payload?.error || `${providerName} returned HTTP ${res.status}.`), { status: res.status });
                        if (!payload || typeof payload !== "object") throw new Error(`${providerName} returned an invalid response.`);
                        return payload;
                    });
                    return new Response(JSON.stringify(data), { headers: corsHeaders });
                } catch (error) {
                    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
                    return jsonError(error instanceof Error ? error.message : `${providerName} quote failed.`, status, corsHeaders);
                }
            }

            // Lightweight Yahoo quote path: chart metadata avoids quoteSummary's
            // fundamentals/analyst modules for the high-frequency live-price flow.
            if (action === "quote") {
                const tickers = symbol.split(",").map(value => value.trim()).filter(Boolean);
                if (!tickers.length || tickers.length > MAX_TICKERS || !validSymbolList(symbol)) {
                    return jsonError("No valid symbols provided.", 400, corsHeaders);
                }
                const results = await Promise.all(tickers.map(async ticker => {
                    try {
                        return await withProviderCache("yahoo_quote", ticker, async () => {
                            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m&includePrePost=true`;
                            const response = await fetchWithTimeout(yahooUrl, { headers: { "User-Agent": USER_AGENT } });
                            if (!response.ok) throw new Error(`Yahoo quote returned HTTP ${response.status}`);
                            const raw = await response.json();
                            const chart = raw?.chart?.result?.[0];
                            if (!chart) throw new Error(raw?.chart?.error?.description || "Yahoo returned no chart quote.");
                            const meta = chart.meta || {};
                            const timestamps = chart.timestamp || [];
                            const closes = chart.indicators?.quote?.[0]?.close || [];
                            let lastPrice = null;
                            let lastTimestamp = null;
                            for (let i = closes.length - 1; i >= 0; i--) {
                                if (Number.isFinite(closes[i]) && closes[i] > 0) {
                                    lastPrice = closes[i];
                                    lastTimestamp = timestamps[i] || null;
                                    break;
                                }
                            }
                            const marketState = normalizeMarketState(meta.marketState);
                            const regularPrice = meta.regularMarketPrice ?? lastPrice;
                            const preMarketPrice = meta.preMarketPrice ?? null;
                            const postMarketPrice = meta.postMarketPrice ?? null;
                            const sessionPrice = marketState === "PRE"
                                ? (preMarketPrice ?? lastPrice ?? regularPrice)
                                : marketState === "POST"
                                    ? (postMarketPrice ?? lastPrice ?? regularPrice)
                                    : (regularPrice ?? lastPrice);
                            if (!Number.isFinite(sessionPrice) || sessionPrice <= 0) throw new Error("Yahoo returned no valid quote price.");
                            const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
                            const change = Number.isFinite(previousClose) ? sessionPrice - previousClose : null;
                            return {
                                symbol: ticker,
                                price: {
                                    current: sessionPrice,
                                    previousClose,
                                    change,
                                    changePercent: Number.isFinite(previousClose) && previousClose !== 0 && change !== null ? change / previousClose * 100 : null,
                                    preMarketPrice,
                                    postMarketPrice,
                                    regularMarketTime: meta.regularMarketTime ?? lastTimestamp ?? null,
                                    preMarketTime: meta.preMarketTime ?? lastTimestamp ?? null,
                                    postMarketTime: meta.postMarketTime ?? lastTimestamp ?? null,
                                    marketState
                                }
                            };
                        });
                    } catch (error) {
                        return { symbol: ticker, error: error instanceof Error ? error.message : "Yahoo quote failed" };
                    }
                }));
                return new Response(JSON.stringify(tickers.length === 1 ? results[0] : results), { headers: corsHeaders });
            }

            // --- DEFAULT ACTION: Yahoo Deep Stock Data & Live Quotes (Group Fetch) ---
            if (!symbol) {
                return new Response(JSON.stringify({ error: "Missing required 'symbol' or 'action' parameter." }), {
                    status: 400,
                    headers: corsHeaders
                });
            }

            // Support both single "WDC" and grouped "WDC,GOOGL,META"
            const tickers = symbol.split(',').map(s => s.trim()).filter(s => s);

            if (tickers.length === 0 || tickers.length > MAX_TICKERS || !validSymbolList(symbol)) {
                return new Response(JSON.stringify({ error: "No valid symbols provided." }), {
                    status: 400,
                    headers: corsHeaders
                });
            }

            // Obtain session credentials once for the entire batch
            const { cookie, crumb } = await getYahooCredentials();

            // Create an array of fetch promises
            const fetchPromises = tickers.map(async (ticker) => {
                const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,upgradeDowngradeHistory,calendarEvents&crumb=${encodeURIComponent(crumb)}`;

                try {
                    const response = await fetchWithTimeout(yahooUrl, {
                        headers: {
                            "User-Agent": USER_AGENT,
                            "Cookie": cookie
                        }
                    });

                    if (!response.ok) {
                        return { symbol: ticker, error: `Yahoo returned HTTP ${response.status}` };
                    }

                    const raw = await response.json();
                    const result = raw.quoteSummary?.result?.[0] || {};

                    // Normalize Yahoo's alternate session labels without assignment-based conditionals.
                    const marketState = normalizeMarketState(result.price?.marketState);

                    return {
                        symbol: ticker,
                        price: {
                            // Regular session
                            current: result.price?.regularMarketPrice?.raw ?? null,
                            previousClose: result.price?.regularMarketPreviousClose?.raw ?? null,
                            change: result.price?.regularMarketChange?.raw ?? null,
                            changePercent: result.price?.regularMarketChangePercent?.raw ?? null,

                            // Premarket session (04:00 - 09:30 AM ET)
                            preMarketPrice: result.price?.preMarketPrice?.raw ?? null,
                            preMarketChange: result.price?.preMarketChange?.raw ?? null,
                            preMarketChangePercent: result.price?.preMarketChangePercent?.raw ?? null,

                            // Postmarket session (16:00 - 20:00 PM ET)
                            postMarketPrice: result.price?.postMarketPrice?.raw ?? null,
                            postMarketChange: result.price?.postMarketChange?.raw ?? null,
                            postMarketChangePercent: result.price?.postMarketChangePercent?.raw ?? null,
                            regularMarketTime: result.price?.regularMarketTime?.raw ?? null,
                            preMarketTime: result.price?.preMarketTime?.raw ?? null,
                            postMarketTime: result.price?.postMarketTime?.raw ?? null,

                            marketState
                        },
                        valuation: {
                            peTrailing: result.summaryDetail?.trailingPE?.raw ?? null,
                            peForward: result.summaryDetail?.forwardPE?.raw ?? null,
                            pegRatio: result.defaultKeyStatistics?.pegRatio?.raw ?? null,
                            shortPercentOfFloat: result.defaultKeyStatistics?.shortPercentOfFloat?.fmt ?? null,
                            priceToBook: result.defaultKeyStatistics?.priceToBook?.raw ?? null
                        },
                        financialHealth: {
                            profitMargin: result.financialData?.profitMargins?.fmt ?? null,
                            returnOnEquity: result.financialData?.returnOnEquity?.fmt ?? null,
                            totalDebt: result.financialData?.totalDebt?.raw ?? null
                        },
                        analystTargets: {
                            mean: result.financialData?.targetMeanPrice?.raw ?? null,
                            high: result.financialData?.targetHighPrice?.raw ?? null,
                            low: result.financialData?.targetLowPrice?.raw ?? null,
                            median: result.financialData?.targetMedianPrice?.raw ?? null,
                            consensusRecommendation: result.financialData?.recommendationKey ?? null
                        },
                        calendar: {
                            earningsDate: result.calendarEvents?.earnings?.earningsDate?.[0]?.fmt ?? null
                        },
                        upgradesDowngrades: (result.upgradeDowngradeHistory?.history || []).slice(0, 5).map(item => ({
                            firm: item.firm,
                            toGrade: item.toGrade,
                            fromGrade: item.fromGrade,
                            action: item.action
                        }))
                    };
                } catch (err) {
                    return { symbol: ticker, error: err.message };
                }
            });

            // Execute all requests concurrently
            const resultsArray = await Promise.all(fetchPromises);

            // If a single ticker was requested, return a single object (backward compatibility)
            // If multiple were requested, return an array of objects
            const finalPayload = tickers.length === 1 ? resultsArray[0] : resultsArray;

            return new Response(JSON.stringify(finalPayload), { headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: corsHeaders
            });
        }
    }
};


export { PortfolioStateDO } from "./state-store.js";
