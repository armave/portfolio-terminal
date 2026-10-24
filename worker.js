import { requestTradeNet } from "./src/services/freedomTradeNet.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_TICKERS = 10;
const ALLOWED_GEMINI_MODELS = new Set([
    "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.1-flash",
    "gemini-3.1-pro", "gemini-2.5-flash", "gemini-2.5-pro",
    "gemini-flash", "gemini-pro", "gemini-2.0-flash-lite", "gemini-2.0-flash"
]);

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
const DEFAULT_ALLOWED_ORIGINS = [
    "https://armave.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
];

/**
 * This is a single-owner personal portfolio service, not a multi-tenant API.
 * Browser origins are allowlisted as defense in depth; the Gateway Secret remains
 * the authentication boundary. Configure ALLOWED_ORIGINS as a comma-separated
 * list when using a trusted custom deployment origin.
 */
function resolveCorsHeaders(request, env) {
    const configuredOrigins = typeof env.ALLOWED_ORIGINS === "string" && env.ALLOWED_ORIGINS.trim()
        ? env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean)
        : DEFAULT_ALLOWED_ORIGINS;
    const origin = request.headers.get("Origin");
    if (origin && !configuredOrigins.includes(origin)) return null;
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin || DEFAULT_ALLOWED_ORIGINS[0],
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
        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
            return jsonError("Request body exceeds the 64 KB limit.", 413, corsHeaders);
        }
        if (request.method === "POST") {
            const actionHint = new URL(request.url).searchParams.get("action");
            if (request.headers.get("Content-Type")?.toLowerCase().includes("application/json") !== true) {
                return jsonError("POST requests must use application/json.", 415, corsHeaders);
            }
            // Content-Length may be omitted by clients; measure the actual body as well.
            const rawBody = await request.clone().arrayBuffer();
            if (rawBody.byteLength > MAX_REQUEST_BYTES) {
                return jsonError("Request body exceeds the 64 KB limit.", 413, corsHeaders);
            }
        }

        // SECURITY CHECK: Validate Gateway Secret
        const authHeader = request.headers.get("Authorization") || "";
        const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
        const clientSecret = request.headers.get("X-App-Auth") || bearerToken;
        if (!env.GATEWAY_SECRET || clientSecret !== env.GATEWAY_SECRET) {
            return new Response(JSON.stringify({ error: "Unauthorized gateway access." }), {
                status: 401,
                headers: corsHeaders
            });
        }

        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const pathname = url.pathname;
        const symbol = (url.searchParams.get("symbol") || url.searchParams.get("ticker") || "").toUpperCase();

        if (action && !["state", "news", "gemini", "provider-quote", "stocktwits", "freedom-test", "freedom-positions", "freedom-trades", "freedom-quote", "freedom-news", "freedom-history"].includes(action)) {
            return jsonError("Unsupported action.", 400, corsHeaders);
        }
        if (action !== "gemini" && action !== "state" && pathname !== "/api/state" && symbol && !validSymbolList(symbol)) {
            return jsonError("Invalid symbol list. Use up to 10 ticker symbols with letters, numbers, dots, carets, equals signs, or hyphens.", 400, corsHeaders);
        }
        if ((action === "news" || action === "provider-quote" || action === "stocktwits" || action === "freedom-quote" || action === "freedom-news" || action === "freedom-history") && request.method !== "GET") {
            return jsonError("This action only supports GET.", 405, corsHeaders);
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
                    const data = await requestTradeNet(env, command, params);
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

            // --- ACTION 0: Durable Object cloud portfolio state ---
            if (pathname === "/api/state" || action === "state") {
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
                if (body.model !== undefined && (typeof body.model !== "string" || !ALLOWED_GEMINI_MODELS.has(body.model.replace(/^models\//, "")))) {
                    return jsonError("Unsupported Gemini model.", 400, corsHeaders);
                }

                // Keep proxy model selection bounded to a known allowlist.
                const rawCandidates = [
                    body.model,
                    "gemini-2.5-flash-lite",
                    "gemini-2.0-flash-lite",
                    "gemini-2.0-flash",
                    "gemini-3.1-flash-lite",
                    "gemini-3.1-flash"
                ].filter(Boolean).map(model => model.replace(/^models\//, "")).filter(model => ALLOWED_GEMINI_MODELS.has(model));
                const candidateModels = Array.from(new Set(rawCandidates)).slice(0, 4);

                let lastResponse = null;
                let lastData = null;

                for (const rawModel of candidateModels) {
                    const modelName = rawModel.startsWith("models/") ? rawModel : `models/${rawModel}`;

                    const controller = new AbortController();
                    let timeoutId;
                    try {
                        // Keep the timeout active until the response body has been consumed.
                        timeoutId = setTimeout(() => controller.abort(), 3500);
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

                const res = await fetchWithTimeout(endpoint);
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    return new Response(JSON.stringify(data || { error: `${providerName} returned HTTP ${res.status}.` }), {
                        status: res.status,
                        headers: corsHeaders
                    });
                }
                if (!data || typeof data !== "object") {
                    return new Response(JSON.stringify({ error: `${providerName} returned an invalid response.` }), {
                        status: 502,
                        headers: corsHeaders
                    });
                }
                return new Response(JSON.stringify(data), { headers: corsHeaders });
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
