/**
 * Minimal read-only TradeNet API probe.
 * Secrets must be configured as Cloudflare Worker secrets.
 */
interface TradeNetWorkerEnv {
    FREEDOM_PUBLIC_KEY?: string;
    FREEDOM_PRIVATE_KEY?: string;
}

export type TradeNetReadCommand = "getPositionJson" | "getTradesHistory" | "getQuotes" | "getNews" | "getHloc" | "getBrokerReport";

export async function requestTradeNet(env: TradeNetWorkerEnv, command: TradeNetReadCommand = "getPositionJson", paramsOverride?: Record<string, string | number | boolean>): Promise<Record<string, unknown>> {
    if (!env.FREEDOM_PUBLIC_KEY || !env.FREEDOM_PRIVATE_KEY) {
        throw new Error("Freedom API secrets are missing from this Worker environment.");
    }
    if (!["getPositionJson", "getTradesHistory", "getQuotes", "getNews", "getHloc", "getBrokerReport"].includes(command)) {
        throw new Error("Unsupported read-only TradeNet command.");
    }

    const params: Record<string, string | number | boolean> = paramsOverride ?? (command === "getTradesHistory" ? { max: 100, sort: 1 } : {});
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // The broker-report endpoint documents GET /api/?q=<JSON payload>.
    // API-key authentication signs GET requests with the Unix timestamp alone;
    // POST requests sign the exact JSON body followed by that timestamp.
    const requestPayload = command === "getBrokerReport"
        ? { cmd: command, nonce: Date.now(), params }
        : { cmd: command, params };
    const body = JSON.stringify(requestPayload);
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.FREEDOM_PRIVATE_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signatureInput = command === "getBrokerReport" ? timestamp : body + timestamp;
    const bytes = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(signatureInput)
    );
    const signature = Array.from(new Uint8Array(bytes))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    const isBrokerReport = command === "getBrokerReport";
    const requestUrl = isBrokerReport
        ? `https://tradernet.com/api/?q=${encodeURIComponent(body)}`
        : `https://tradernet.com/api/${command}`;
    const response = await fetch(requestUrl, {
        method: isBrokerReport ? "GET" : "POST",
        headers: {
            ...(isBrokerReport ? {} : { "Content-Type": "application/json" }),
            "X-NtApi-PublicKey": env.FREEDOM_PUBLIC_KEY,
            "X-NtApi-Sig": signature,
            "X-NtApi-Timestamp": timestamp
        },
        ...(isBrokerReport ? {} : { body }),
        signal: AbortSignal.timeout(12000)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        // Expose only a short, sanitized upstream error field for diagnostics; never return the full body.
        const errorValue = data && typeof data === "object"
            ? (data as Record<string, unknown>).errMsg
                ?? (data as Record<string, unknown>).error
                ?? (data as Record<string, unknown>).message
            : null;
        const upstreamMessage = typeof errorValue === "string"
            ? errorValue
            : "No upstream error message was provided.";
        const safeMessage = upstreamMessage
            .replace(/(public|private)?\s*key\s*[:=]\s*\S+/gi, "$1 key=[redacted]")
            .replace(/(token|signature|sid|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
            .slice(0, 240);
        throw new Error(`TradeNet returned HTTP ${response.status}: ${safeMessage}`);
    }
    if (!data || typeof data !== "object") {
        throw new Error("TradeNet returned a non-JSON response.");
    }
    // TradeNet often returns application-level errors with HTTP 200. Surface only
    // a short, sanitized message so we can diagnose auth/signature/permission issues
    // without logging or returning the full broker payload.
    const errorValue = data.errMsg ?? data.error ?? data.message;
    if (errorValue) {
        const upstreamMessage = typeof errorValue === "string"
            ? errorValue
            : "TradeNet returned an application-level error.";
        const safeMessage = upstreamMessage
            .replace(/(public|private)?\s*key\s*[:=]\s*\S+/gi, "$1 key=[redacted]")
            .replace(/(token|signature|sid|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
            .slice(0, 240);
        throw new Error(`TradeNet API error: ${safeMessage}`);
    }
    return data;
}
