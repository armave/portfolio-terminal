/**
 * Minimal read-only TradeNet API probe.
 * Secrets must be configured as Cloudflare Worker secrets.
 */
interface TradeNetWorkerEnv {
    FREEDOM_PUBLIC_KEY?: string;
    FREEDOM_PRIVATE_KEY?: string;
}

export type TradeNetReadCommand = "getPositionJson" | "getOPQ" | "getTradingLimits" | "getTradesHistory" | "getStockQuotesJson" | "getNews" | "getHloc" | "getUserCashFlows" | "getNotifyOrderJson";

export async function requestTradeNet(env: TradeNetWorkerEnv, command: TradeNetReadCommand = "getPositionJson", paramsOverride?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!env.FREEDOM_PUBLIC_KEY || !env.FREEDOM_PRIVATE_KEY) {
        throw new Error("Freedom API secrets are missing from this Worker environment.");
    }
    if (!["getPositionJson", "getOPQ", "getTradingLimits", "getTradesHistory", "getStockQuotesJson", "getNews", "getHloc", "getUserCashFlows", "getNotifyOrderJson"].includes(command)) {
        throw new Error("Unsupported read-only TradeNet command.");
    }

    // The API-key v2 endpoint already identifies the command in the URL. POST
    // only the command parameters as JSON (not the legacy { cmd, params } q-envelope),
    // then sign those exact body bytes concatenated with the Unix timestamp. For trade
    // history, sort=0 with no max asks TradeNet for the full history so FIFO opening
    // executions are not dropped by the API-key endpoint latest-100 default.
    const params: Record<string, unknown> = paramsOverride ?? (command === "getTradesHistory" ? { sort: 0 } : {});
    const body = JSON.stringify(params);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.FREEDOM_PRIVATE_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const bytes = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(body + timestamp)
    );
    const signature = Array.from(new Uint8Array(bytes))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    // /tradernet-api/get-cashflows is the documentation page, not the API transport URL.
    // The signed API-key endpoint uses the command name under tradernet.com/api/.
    // Keep the upstream host and command fixed server-side.
    const response = await fetch(`https://tradernet.com/api/${command}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-NtApi-PublicKey": env.FREEDOM_PUBLIC_KEY,
            "X-NtApi-Sig": signature,
            "X-NtApi-Timestamp": timestamp
        },
        body,
        signal: AbortSignal.timeout(12000)
    });

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        if (!response.ok) throw new Error(`TradeNet returned HTTP ${response.status}.`);
        throw new Error("TradeNet returned a non-JSON response.");
    }

    // Keep only the provider's short error text, never the raw error body. This
    // makes HTTP validation failures actionable without exposing account data.
    const errorValue = data.errMsg ?? data.error ?? data.message;
    const safeProviderMessage = typeof errorValue === "string"
        ? errorValue
            .replace(/(public|private)?\\s*key\\s*[:=]\\s*\\S+/gi, "$1 key=[redacted]")
            .replace(/(password|private[_-]?key|public[_-]?key|secret|token|signature|sid|login|account[_-]?id|user[_-]?id)\\s*[:=]\\s*\\S+/gi, "$1=[redacted]")
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[redacted-email]")
            .trim()
            .slice(0, 180)
        : null;

    if (!response.ok) {
        throw new Error(`TradeNet returned HTTP ${response.status}${safeProviderMessage ? `: ${safeProviderMessage}` : ""}.`);
    }
    if (errorValue) {
        throw new Error(`TradeNet API error: ${safeProviderMessage || "Provider rejected the request."}`);
    }
    return data;
}
