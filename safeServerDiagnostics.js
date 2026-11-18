const SAFE_SERVER_DIAGNOSTIC_CATEGORIES = new Set([
  "tradenet_quote_stream_failed",
  "tradenet_account_stream_failed",
  "tradenet_market_depth_stream_failed",
  "account_durable_object_request_failed",
  "gemini_provider_failed",
  "session_cleanup_deferred",
  "session_cleanup_deferred_during_issuance"
]);

/**
 * Emit only a fixed event category. Never serialize provider errors, messages,
 * stacks, broker payloads, request URLs, account identifiers or credentials.
 */
export function logServerDiagnostic(level, category) {
  const safeCategory = SAFE_SERVER_DIAGNOSTIC_CATEGORIES.has(category) ? category : "unknown";
  const entry = JSON.stringify({ type: "server_diagnostic", category: safeCategory });
  if (level === "warn") console.warn(entry);
  else console.error(entry);
}
