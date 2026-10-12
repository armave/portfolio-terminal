const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Obtains an ephemeral Yahoo session cookie and authorization crumb.
 */
async function getYahooCredentials() {
    // Step 1: Hit fc.yahoo.com to acquire the initial session cookie
    const initRes = await fetch("https://fc.yahoo.com", {
        headers: { "User-Agent": USER_AGENT }
    });

    const rawCookie = initRes.headers.get("set-cookie") || "";
    const cookieMatch = rawCookie.match(/(A[13]=[^;]+)/);
    const cookie = cookieMatch ? cookieMatch[1] : "";

    // Step 2: Use the cookie to request the session crumb
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
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

export default {
    async fetch(request, env) {

        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Auth"
                }
            });
        }

        const corsHeaders = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        };

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

        try {
            // --- ACTION 0: Cloudflare Workers KV State Storage ---
            if (pathname === "/api/state" || action === "state") {
                if (!env.PORTFOLIO_KV) {
                    return new Response(JSON.stringify({ error: "PORTFOLIO_KV binding is missing." }), {
                        status: 500,
                        headers: corsHeaders
                    });
                }

                if (request.method === "GET") {
                    const rawState = await env.PORTFOLIO_KV.get("portfolio_state");
                    if (!rawState) {
                        return new Response(JSON.stringify({ error: "Portfolio state not found." }), {
                            status: 404,
                            headers: corsHeaders
                        });
                    }
                    return new Response(rawState, {
                        status: 200,
                        headers: corsHeaders
                    });
                }

                if (request.method === "POST") {
                    const body = await request.json().catch(() => null);
                    if (!body || typeof body !== "object") {
                        return new Response(JSON.stringify({ error: "Missing or invalid JSON body." }), {
                            status: 400,
                            headers: corsHeaders
                        });
                    }
                    await env.PORTFOLIO_KV.put("portfolio_state", JSON.stringify(body));
                    return new Response(JSON.stringify({ success: true, timestamp: Date.now() }), {
                        status: 200,
                        headers: corsHeaders
                    });
                }

                return new Response(JSON.stringify({ error: "Method not allowed." }), {
                    status: 405,
                    headers: corsHeaders
                });
            }

            // --- ACTION 1: Finnhub Company News ---
            if (action === "news") {
                if (!symbol) throw new Error("Missing symbol for news.");
                const toDate = new Date().toISOString().split("T")[0];
                const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                const finnhubKey = env.FINNHUB_KEY || env.FINNHUB_API_KEY;

                const res = await fetch(
                    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${finnhubKey}`
                );
                const data = await res.json();
                return new Response(JSON.stringify(data), { headers: corsHeaders });
            }

            // --- ACTION 2: Gemini AI Chat / Intent Routing ---
            if (action === "gemini") {
                const geminiKey = env.GEMINI_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
                if (!geminiKey) {
                    return new Response(JSON.stringify({
                        error: "Gemini key is missing from Worker environment variables. Set GEMINI_KEY in Cloudflare settings."
                    }), { status: 500, headers: corsHeaders });
                }

                const body = await request.json().catch(() => ({}));
                const prompt = body.prompt;

                if (!prompt) {
                    return new Response(JSON.stringify({ error: "Missing 'prompt' in request body." }), {
                        status: 400,
                        headers: corsHeaders
                    });
                }

                // Deduplicate and prioritize models with healthy free limits
                const rawCandidates = [
                    body.model,
                    "gemini-2.0-flash",
                    "gemini-2.0-flash-lite",
                    "gemini-1.5-flash",
                    "gemini-1.5-flash-latest"
                ].filter(Boolean);

                const candidateModels = Array.from(new Set(rawCandidates));

                let lastResponse = null;
                let lastData = null;

                for (const rawModel of candidateModels) {
                    const modelName = rawModel.startsWith("models/") ? rawModel : `models/${rawModel}`;

                    try {
                        // 3.5-second timeout per attempt to prevent serverless worker hang
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3500);

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
                        clearTimeout(timeoutId);

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
                if (provider === "finnhub") {
                    const finnhubKey = env.FINNHUB_KEY || env.FINNHUB_API_KEY;
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
                    const data = await res.json();
                    return new Response(JSON.stringify(data), { headers: corsHeaders });
                }
                if (provider === "twelvedata") {
                    const tdKey = env.TWELVE_KEY || env.TWELVEDATA_KEY;
                    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${tdKey}`);
                    const data = await res.json();
                    return new Response(JSON.stringify(data), { headers: corsHeaders });
                }
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

            if (tickers.length === 0) {
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
                    const response = await fetch(yahooUrl, {
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

                    return {
                        symbol: ticker,
                        price: {
                            current: result.price?.regularMarketPrice?.raw ?? null,
                            previousClose: result.price?.regularMarketPreviousClose?.raw ?? null,
                            change: result.price?.regularMarketChange?.raw ?? null,
                            changePercent: result.price?.regularMarketChangePercent?.raw ?? null
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
