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
 * Serializes cloud portfolio writes and enforces optimistic concurrency.
 * This application intentionally uses one owner-controlled portfolio shared
 * across the owner's devices; the Worker Gateway Secret is the access boundary.
 * It is not a multi-tenant store. The single named instance is authoritative;
 * KV is only used to migrate the existing portfolio_state value on first access.
 */
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

    await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.get("record");
      if (!current && legacyPayload) {
        await txn.put("record", { payload: legacyPayload, revision: 1 });
      }
    });
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    await this.ensureInitialized();
    const recordKey = new URL(request.url).pathname === "/api/history" ? "historyRecord" : "record";

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

    if (typeof body.encryptedPayload !== "string" || !body.encryptedPayload.trim()) {
      return jsonResponse({ error: "Cloud state must contain a non-empty encryptedPayload string." }, 400);
    }

    const result = await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.get(recordKey);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return { conflict: true, revision: currentRevision };
      }
      const nextRevision = currentRevision + 1;
      await txn.put(recordKey, { payload: JSON.stringify(body), revision: nextRevision });
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
