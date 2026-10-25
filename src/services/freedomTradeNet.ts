/**
 * Minimal read-only TradeNet API probe.
 * Secrets must be configured as Cloudflare Worker secrets.
 */
export interface TradeNetWorkerEnv {
    FREEDOM_PUBLIC_KEY?: string;
    FREEDOM_PRIVATE_KEY?: string;
}

export type TradeNetReadCommand = "getPositionJson" | "getTradesHistory" | "getQuotes" | "getNews" | "getHloc" | "getBrokerReport";

export async function requestTradeNet(
    env: TradeNetWorkerEnv,
    command: TradeNetReadCommand = "getPositionJson",
    paramsOverride?: Record<string, string | number | boolean>
): Promise<Record<string, unknown>> {

    if (!env.FREEDOM_PUBLIC_KEY || !env.FREEDOM_PRIVATE_KEY) {
        throw new Error("Freedom API secrets are missing from this Worker environment.");
    }
    if (!["getPositionJson", "getTradesHistory", "getQuotes", "getNews", "getHloc", "getBrokerReport"].includes(command)) {
        throw new Error("Unsupported read-only TradeNet command.");
    }

    const params: Record<string, string | number | boolean> = paramsOverride ?? (command === "getTradesHistory" ? { max: 100, sort: 1 } : {});
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Broker reports use the documented API V2 root endpoint and include a nonce.
    // Other commands retain the established /api/<command> request route.
    const requestPayload = command === "getBrokerReport"
        ? { cmd: command, nonce: Number(timestamp), params }
        : { cmd: command, params };
    const body = JSON.stringify(requestPayload);

    // Keep broker reports on the same API-key authentication flow as the
    // working getTradesHistory request instead of using a separate legacy path.
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.FREEDOM_PRIVATE_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const isBrokerReport = command === "getBrokerReport";
    // TradeNet's API-key signing rules differ by HTTP method:
    // POST signs JSON body + timestamp; GET signs the timestamp only.
    const signatureInput = isBrokerReport ? timestamp : body + timestamp;
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signatureInput));
    const signature = Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const endpoint = isBrokerReport
        ? `https://tradernet.am/api/?q=${encodeURIComponent(body)}`
        : `https://tradernet.am/api/${command}`;
    const response = await fetch(endpoint, {
        method: isBrokerReport ? "GET" : "POST",
        headers: {
            "Content-Type": "application/json",
            "X-NtApi-PublicKey": env.FREEDOM_PUBLIC_KEY,
            "X-NtApi-Sig": signature,
            "X-NtApi-Timestamp": timestamp
        },
        ...(isBrokerReport ? {} : { body }),
        signal: AbortSignal.timeout(12000)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const errorValue = data && typeof data === "object"
            ? (data as Record<string, unknown>).errMsg ?? (data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message
            : null;

        const upstreamMessage = typeof errorValue === "string" ? errorValue : "No upstream error message was provided.";
        const safeMessage = upstreamMessage
            .replace(/(public|private)?\s*key\s*[:=]\s*\S+/gi, "$1 key=[redacted]")
            .replace(/(token|signature|sid|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
            .slice(0, 240);

        throw new Error(`TradeNet returned HTTP ${response.status}: ${safeMessage}`);
    }

    if (!data || typeof data !== "object") {
        throw new Error("TradeNet returned a non-JSON response.");
    }

    const errorValue = data.errMsg ?? data.error ?? data.message;
    if (errorValue) {
        const upstreamMessage = typeof errorValue === "string" ? errorValue : "TradeNet returned an application-level error.";
        const safeMessage = upstreamMessage
            .replace(/(public|private)?\s*key\s*[:=]\s*\S+/gi, "$1 key=[redacted]")
            .replace(/(token|signature|sid|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
            .slice(0, 240);

        throw new Error(`TradeNet API error: ${safeMessage}`);
    }

    return data;
}