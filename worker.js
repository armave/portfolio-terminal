import { requestTradeNet } from "./src/services/freedomTradeNet.js";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_TICKERS = 10;
const PROVIDER_CACHE_TTL_MS = { yahoo_quote: 8_000, freedom_quote: 5_000, finnhub: 5_000, twelvedata: 5_000 };
const PROVIDER_COOLDOWN_MS = { yahoo_quote: 3_000, freedom_quote: 10_000, finnhub: 5_000, twelvedata: 5_000 };
const providerResponseCache = new Map();
const providerCooldowns = new Map();
const providerInFlight = new Map();
const FREEDOM_SESSION_TTL_MS = 13 * 24 * 60 * 60 * 1000;
const FREEDOM_SESSION_REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
let freedomSessionRequest = null;

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

function validSymbolList(symbol) {
    const symbols = symbol.split(",").map(value => value.trim()).filter(Boolean);
    return symbols.length > 0 && symbols.length <= MAX_TICKERS &&
        symbols.every(value => /^[A-Z0-9.^=-]{1,20}$/.test(value));
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
    return { orders: { order } };
}

export function sanitizeFreedomMarketDepth(response, requestedSymbol) {
    const dom = Array.isArray(response?.dom) ? response.dom
        : Array.isArray(response?.data?.dom) ? response.data.dom
            : response?.i ? [response]
                : response?.data?.i ? [response.data] : [];
    const ticker = String(requestedSymbol || "").trim().toUpperCase();
    const book = dom.find(row => String(row?.i || "").trim().toUpperCase() === ticker);
    if (!book) throw new Error("TradeNet did not return an order book for this symbol.");
    const rows = Array.isArray(book.ins) ? book.ins : [];
    const toNumber = value => {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    const levels = rows.map(row => ({
        position: toNumber(row?.k),
        price: toNumber(row?.p),
        quantity: toNumber(row?.q),
        side: String(row?.s || "").toUpperCase()
    })).filter(row => row.price !== null && row.price > 0 && row.quantity !== null && row.quantity > 0 &&
        (row.side === "B" || row.side === "S"));
    const bids = levels.filter(row => row.side === "B")
        .sort((a, b) => b.price - a.price || (a.position ?? 0) - (b.position ?? 0))
        .map(({ price, quantity, position }) => ({ price, quantity, position }));
    const asks = levels.filter(row => row.side === "S")
        .sort((a, b) => a.price - b.price || (a.position ?? 0) - (b.position ?? 0))
        .map(({ price, quantity, position }) => ({ price, quantity, position }));
    if (bids.length === 0 && asks.length === 0) throw new Error("TradeNet returned an empty order-book snapshot for this symbol.");
    const minPriceStep = toNumber(book.min_step ?? response?.min_step);
    return {
        symbol: ticker, bids, asks,
        depth: Math.max(0, Number(book.cnt) || bids.length + asks.length),
        minPriceStep: minPriceStep !== null && minPriceStep > 0 ? minPriceStep : null,
        sequence: toNumber(book.n),
        updatedAt: Date.now()
    };
}

function freedomSessionStoreStub(env) {
    if (!env.GATEWAY_SECRET || !env.PORTFOLIO_STATE_DO) {
        const error = new Error("TradeNet session storage is unavailable in this Worker.");
        error.status = 503;
        throw error;
    }
    const id = env.PORTFOLIO_STATE_DO.idFromName("portfolio_state");
    return env.PORTFOLIO_STATE_DO.get(id);
}

async function callFreedomSessionStore(env, method, body) {
    const stub = freedomSessionStoreStub(env);
    const headers = { "X-Internal-Worker-Auth": env.GATEWAY_SECRET };
    const init = { method, headers };
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const response = await stub.fetch(new Request("https://portfolio-state.internal/internal/freedom-session", init));
    if (response.status === 404) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.error || "TradeNet session storage request failed.");
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function readFreedomTradeNetSession(env) {
    const payload = await callFreedomSessionStore(env, "GET");
    const session = payload?.session;
    if (!session || typeof session.sid !== "string" || session.real !== true ||
        !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
}

async function saveFreedomTradeNetSession(env, session) {
    await callFreedomSessionStore(env, "POST", session);
}

function safeTradeNetLoginFailure(payload) {
    const value = payload?.errMsg ?? payload?.error ?? payload?.message;
    if (typeof value !== "string" || !value.trim()) {
        return "TradeNet rejected the configured login or requested additional verification.";
    }
    const safeMessage = value
        .replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, "[account]")
        .replace(/(login|password|sid|token|secret)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
    return safeMessage || "TradeNet rejected the configured login or requested additional verification.";
}

/** Authenticate with the Worker-only login/password secrets and retain the SID in the Durable Object. */
// This endpoint is invoked by authenticated administrator startup; the SID itself stays server-side.
export async function ensureFreedomTradeNetSession(env, options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    if (!env.FREEDOM_LOGIN || !env.FREEDOM_PASSWORD) {
        const error = new Error("FREEDOM_LOGIN and FREEDOM_PASSWORD must be configured as Worker secrets.");
        error.status = 503;
        throw error;
    }
    if (!forceRefresh && freedomSessionRequest) return freedomSessionRequest;

    const request = (async () => {
        const existing = forceRefresh ? null : await readFreedomTradeNetSession(env);
        if (existing && existing.expiresAt - Date.now() > FREEDOM_SESSION_REFRESH_WINDOW_MS) {
            return {
                authenticated: true,
                real: true,
                expiresAt: existing.expiresAt,
                refreshed: false
            };
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
            throw error;
        }
        if (!payload || payload.success !== true || payload.logged !== true ||
            typeof payload.SID !== "string" || payload.SID.length < 10 || payload.real !== true) {
            const message = payload?.real === false
                ? "TradeNet returned a demo or non-production account session. Live market depth is disabled."
                : "TradeNet login failed: " + safeTradeNetLoginFailure(payload);
            const error = new Error(message);
            error.status = payload?.real === false ? 403 : 401;
            throw error;
        }

        const expiresAt = Date.now() + FREEDOM_SESSION_TTL_MS;
        await saveFreedomTradeNetSession(env, {
            sid: payload.SID,
            expiresAt,
            real: true,
            createdAt: Date.now()
        });
        return {
            authenticated: true,
            real: true,
            expiresAt,
            refreshed: true
        };
    })();

    freedomSessionRequest = request;
    try {
        return await request;
    } finally {
        if (freedomSessionRequest === request) freedomSessionRequest = null;
    }
}

export function fetchFreedomMarketDepthWithSid(symbol, session) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let socket;
        let timeout;
        const startedAt = Date.now();
        const requestedSymbol = String(symbol || "").trim().toUpperCase();
        const diagnostics = {
            endpoint: "wss.tradernet.com",
            requestedSymbol,
            phase: "connecting",
            connectionOpened: false,
            subscriptionSent: false,
            subscriptionConfirmed: false,
            userDataReceived: false,
            isDemo: null,
            sessionMode: null,
            messageCount: 0,
            parseErrorCount: 0,
            eventsReceived: [],
            eventCounts: {},
            eventNamesTruncated: false,
            orderBookEventsReceived: 0,
            orderBookSymbolsReceived: [],
            unmatchedOrderBooks: 0,
            quoteSubscriptionSent: false,
            quoteEventsReceived: 0,
            quoteSymbolsReceived: [],
            unmatchedQuotes: 0,
            serverErrorCategory: null,
            socketErrorObserved: false,
            closeCode: null,
            closeReasonPresent: false
        };

        const snapshotDiagnostics = () => ({
            ...diagnostics,
            eventsReceived: [...diagnostics.eventsReceived],
            eventCounts: { ...diagnostics.eventCounts },
            orderBookSymbolsReceived: [...diagnostics.orderBookSymbolsReceived],
            elapsedMs: Date.now() - startedAt
        });

        const recordEvent = eventName => {
            const safeName = typeof eventName === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(eventName)
                ? eventName : "other";
            diagnostics.eventCounts[safeName] = (diagnostics.eventCounts[safeName] || 0) + 1;
            if (diagnostics.eventsReceived.length < 20) {
                diagnostics.eventsReceived.push(safeName);
            } else {
                diagnostics.eventNamesTruncated = true;
            }
        };

        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) {
                const failure = error instanceof Error ? error : new Error("TradeNet market depth is unavailable.");
                const details = snapshotDiagnostics();
                failure.diagnostics = details;
                console.warn(JSON.stringify({
                    type: "tradenet_market_depth",
                    outcome: "failed",
                    status: Number(failure.status) || 502,
                    diagnostics: details
                }));
                try { socket?.close(1000, "Market-depth request finished"); } catch { /* ignore close races */ }
                reject(failure);
                return;
            }

            diagnostics.phase = "snapshot_received";
            diagnostics.subscriptionConfirmed = true;
            const details = snapshotDiagnostics();
            console.info(JSON.stringify({
                type: "tradenet_market_depth",
                outcome: "snapshot_received",
                diagnostics: details
            }));
            try { socket?.close(1000, "Market-depth snapshot received"); } catch { /* ignore close races */ }
            resolve({ data: result, diagnostics: details });
        };

        timeout = setTimeout(() => {
            diagnostics.phase = diagnostics.socketErrorObserved
                ? "websocket_error_timeout"
                : !diagnostics.connectionOpened
                    ? "connection_timeout"
                    : !diagnostics.subscriptionSent
                        ? "subscription_send_timeout"
                        : "snapshot_timeout";
            const error = new Error("TradeNet market-depth request timed out before returning an order book.");
            error.status = 504;
            finish(error);
        }, 10000);

        try {
            const url = new URL("wss://wss.tradernet.com/");
            url.searchParams.set("SID", session.sid);
            socket = new WebSocket(url.toString());
            socket.addEventListener("open", () => {
                if (settled) return;
                diagnostics.connectionOpened = true;
                diagnostics.phase = "sending_subscription";
                try {
                    socket.send(JSON.stringify(["orderBook", [requestedSymbol]]));
                    diagnostics.subscriptionSent = true;
                    // Quotes are a read-only control probe: they help distinguish an
                    // unsupported ticker from an order-book-specific feed/permission issue.
                    socket.send(JSON.stringify(["quotes", [requestedSymbol]]));
                    diagnostics.quoteSubscriptionSent = true;
                    diagnostics.phase = "awaiting_order_book";
                } catch {
                    diagnostics.phase = "subscription_send_failed";
                    const error = new Error("TradeNet market-depth subscription could not be sent.");
                    error.status = 502;
                    finish(error);
                }
            });
            socket.addEventListener("message", message => {
                if (settled) return;
                diagnostics.messageCount += 1;
                let packet;
                try {
                    packet = JSON.parse(String(message.data || ""));
                } catch {
                    diagnostics.parseErrorCount += 1;
                    return;
                }
                if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
                const [event, payload] = packet;
                recordEvent(event);

                if (event === "userData") {
                    diagnostics.userDataReceived = true;
                    diagnostics.isDemo = typeof payload?.isDemo === "boolean" ? payload.isDemo : null;
                    const mode = String(payload?.mode || "").trim().toLowerCase();
                    diagnostics.sessionMode = ["prod", "demo", "test", "paper", "beta"].includes(mode)
                        ? mode : "unknown";
                    if (payload?.isDemo === true || payload?.real === false ||
                        ["demo", "test", "paper", "beta"].includes(mode)) {
                        diagnostics.phase = "demo_session_rejected";
                        const error = new Error("TradeNet returned a demo session. Live market depth is disabled.");
                        error.status = 403;
                        finish(error);
                    }
                    return;
                }

                if (event === "error") {
                    const errorText = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
                    const needsReauth = /sid|session|auth|login|unauthori[sz]ed|expired/i.test(errorText);
                    diagnostics.serverErrorCategory = needsReauth ? "auth_or_session_rejected" : "upstream_error";
                    diagnostics.phase = "server_error";
                    const error = new Error(needsReauth
                        ? "TradeNet rejected the stored session. It will be renewed and retried."
                        : "TradeNet rejected the market-depth subscription.");
                    error.status = needsReauth ? 401 : 502;
                    finish(error);
                    return;
                }

                if (event === "q") {
                    diagnostics.quoteEventsReceived += 1;
                    const quoteSymbol = String(payload?.c || payload?.i || payload?.symbol || "").trim().toUpperCase();
                    if (quoteSymbol && diagnostics.quoteSymbolsReceived.length < 5 &&
                        !diagnostics.quoteSymbolsReceived.includes(quoteSymbol) &&
                        /^[A-Z0-9.^=-]{1,20}$/.test(quoteSymbol)) {
                        diagnostics.quoteSymbolsReceived.push(quoteSymbol);
                    }
                    if (quoteSymbol && quoteSymbol !== requestedSymbol) diagnostics.unmatchedQuotes += 1;
                    return;
                }

                if (event !== "b") return;
                diagnostics.orderBookEventsReceived += 1;
                const ticker = String(payload?.i || payload?.data?.i || "").trim().toUpperCase();
                if (ticker && diagnostics.orderBookSymbolsReceived.length < 5 &&
                    !diagnostics.orderBookSymbolsReceived.includes(ticker) &&
                    /^[A-Z0-9.^=-]{1,20}$/.test(ticker)) {
                    diagnostics.orderBookSymbolsReceived.push(ticker);
                }
                if (ticker !== requestedSymbol) {
                    diagnostics.unmatchedOrderBooks += 1;
                    return;
                }
                try {
                    finish(null, sanitizeFreedomMarketDepth(payload, requestedSymbol));
                } catch (error) {
                    diagnostics.phase = "invalid_order_book";
                    const failure = new Error(error instanceof Error ? error.message : "Invalid TradeNet order-book snapshot.");
                    failure.status = 502;
                    finish(failure);
                }
            });
            socket.addEventListener("error", () => {
                // Wait for the close event when possible so its code is included in diagnostics.
                diagnostics.socketErrorObserved = true;
                if (diagnostics.phase === "awaiting_order_book") diagnostics.phase = "websocket_error";
            });
            socket.addEventListener("close", event => {
                if (settled) return;
                diagnostics.phase = "connection_closed";
                diagnostics.closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
                diagnostics.closeReasonPresent = Boolean(event?.reason);
                const error = new Error("TradeNet closed the market-depth connection before a snapshot arrived.");
                error.status = event?.code === 1008 ? 401 : 502;
                finish(error);
            });
        } catch {
            diagnostics.phase = "connection_initialization_failed";
            const error = new Error("Could not initialize the TradeNet production market-depth connection.");
            error.status = 502;
            finish(error);
        }
    });
}

/** Fetch one live order-book snapshot from Tradernet's production WebSocket endpoint. */
async function fetchFreedomMarketDepth(env, symbol) {
    let session = await readFreedomTradeNetSession(env);
    if (!session || session.expiresAt - Date.now() <= FREEDOM_SESSION_REFRESH_WINDOW_MS) {
        await ensureFreedomTradeNetSession(env);
        session = await readFreedomTradeNetSession(env);
    }
    if (!session) {
        const error = new Error("TradeNet did not provide a valid live account session.");
        error.status = 401;
        throw error;
    }
    try {
        return await fetchFreedomMarketDepthWithSid(symbol, session);
    } catch (error) {
        if (Number(error?.status) !== 401) throw error;
        await ensureFreedomTradeNetSession(env, { forceRefresh: true });
        const renewedSession = await readFreedomTradeNetSession(env);
        if (!renewedSession) throw error;
        return fetchFreedomMarketDepthWithSid(symbol, renewedSession);
    }
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
        if (incomingUrl.pathname.startsWith("/api/auth/")) {
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
            }
        }
        // Retain the Gateway Secret path only for deployments without the account
        // store and during the one-time upgrade window before the first admin.
        const gatewayAdmin = !env.PORTFOLIO_STATE_DO && isBootstrapCredential || legacyBootstrapAccess;
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
            const sharedDataAction = ["state", "history", "freedom-test", "freedom-positions", "freedom-trades", "freedom-orders", "freedom-cashflows", "freedom-session", "freedom-market-depth"].includes(action);
            if (sharedDataPath || sharedDataAction) {
                return jsonError("This data is restricted to administrator accounts.", 403, corsHeaders);
            }
        }

        if (action && !["state", "history", "news", "gemini", "provider-quote", "stocktwits", "freedom-test", "freedom-positions", "freedom-trades", "freedom-quote", "freedom-news", "freedom-history", "freedom-cashflows", "freedom-orders", "freedom-market-depth", "freedom-session", "quote"].includes(action)) {
            return jsonError("Unsupported action.", 400, corsHeaders);
        }
        const getOnlyActions = new Set(["news", "provider-quote", "stocktwits", "freedom-test", "freedom-positions", "freedom-trades", "freedom-quote", "freedom-news", "freedom-history", "freedom-cashflows", "freedom-orders", "freedom-market-depth", "quote"]);
        if (getOnlyActions.has(action) && request.method !== "GET") {
            return jsonError("This action only supports GET.", 405, corsHeaders);
        }
        if (action !== "gemini" && action !== "state" && pathname !== "/api/state" && pathname !== "/api/history" && symbol && !validSymbolList(symbol)) {
            return jsonError("Invalid symbol list. Use up to 10 ticker symbols with letters, numbers, dots, carets, equals signs, or hyphens.", 400, corsHeaders);
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
            // Refresh the broker session once per admin dashboard initialization.
            // The SID is kept in Durable Object storage and never returned to the browser.
            if (action === "freedom-session") {
                if (request.method !== "POST") return jsonError("TradeNet session initialization only supports POST.", 405, corsHeaders);
                if (accountRole !== "admin" && !gatewayAdmin) return jsonError("Administrator access required.", 403, corsHeaders);
                try {
                    const session = await ensureFreedomTradeNetSession(env);
                    return new Response(JSON.stringify({
                        ok: true,
                        provider: "Freedom TradeNet",
                        authenticated: session.authenticated,
                        real: session.real,
                        expiresAt: session.expiresAt,
                        refreshed: session.refreshed
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    return jsonError(error instanceof Error ? error.message : "TradeNet session initialization failed.", Number(error?.status) || 502, corsHeaders);
                }
            }

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
                const command = action === "freedom-quote" ? "getQuotes" : action === "freedom-news" ? "getNews" : "getHloc";
                const params = action === "freedom-quote" ? { ticker: symbol } : action === "freedom-news" ? { ticker: symbol, limit: 10 } : { ticker: symbol, interval: "D", limit: 100 };
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
            // Read-only executed trade history. Command and query limits are fixed server-side.
            if (action === "freedom-trades") {
                if (request.method !== "GET") {
                    return jsonError("Freedom trades only supports GET.", 405, corsHeaders);
                }
                const data = await requestTradeNet(env, "getTradesHistory");
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

            // Read-only Freedom cashflow history. The upstream command is fixed server-side.
            if (action === "freedom-cashflows") {
                if (request.method !== "GET") {
                    return jsonError("Freedom cashflows only supports GET.", 405, corsHeaders);
                }
                const data = await requestTradeNet(env, "getUserCashFlows");
                return new Response(JSON.stringify({
                    ok: true,
                    provider: "Freedom TradeNet",
                    data
                }), { headers: corsHeaders });
            }

            // Read-only market depth. The SID remains in Worker secrets; demo sessions are rejected.
            if (action === "freedom-market-depth") {
                if (request.method !== "GET") return jsonError("Freedom market depth only supports GET.", 405, corsHeaders);
                if (!symbol || symbol.includes(",")) return jsonError("A single valid symbol is required for Freedom market depth.", 400, corsHeaders);
                try {
                    const result = await fetchFreedomMarketDepth(env, symbol);
                    return new Response(JSON.stringify({
                        ok: true,
                        provider: "Freedom TradeNet",
                        symbol,
                        data: result.data,
                        diagnostics: result.diagnostics
                    }), { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
                } catch (error) {
                    const body = { error: error instanceof Error ? error.message : "TradeNet market depth is unavailable." };
                    if (error?.diagnostics) body.diagnostics = error.diagnostics;
                    return new Response(JSON.stringify(body), {
                        status: Number(error?.status) || 502,
                        headers: { ...corsHeaders, "Cache-Control": "no-store" }
                    });
                }
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
