/**
 * Minimal read-only TradeNet API probe.
 * Secrets must be configured as Cloudflare Worker secrets.
 */
const TRADENET_API_URL = "https://tradernet.com/api/";

export async function requestTradeNet(env, command = "getPositionJson") {
    if (!env.FREEDOM_PUBLIC_KEY || !env.FREEDOM_PRIVATE_KEY) {
        throw new Error("Freedom API secrets are missing from this Worker environment.");
    }
    if (command !== "getPositionJson") {
        throw new Error("This initial integration only permits getPositionJson.");
    }

    const body = JSON.stringify({ cmd: command, params: {} });
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

    const response = await fetch(TRADENET_API_URL, {
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
    if (!response.ok) {
        // Do not return upstream response bodies, which may contain account details.
        throw new Error(`TradeNet returned HTTP ${response.status}.`);
    }
    if (!data || typeof data !== "object") {
        throw new Error("TradeNet returned a non-JSON response.");
    }
    if (data.errMsg || data.error) {
        throw new Error("TradeNet rejected the request. Verify API credentials, signing format, and API permissions.");
    }
    return data;
}
