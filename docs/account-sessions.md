# Account session policy

**Enforcement:** Cloudflare Worker / Portfolio State Durable Object  
**Implementation reference:** `state-store.js`  
**Reviewed against:** `dev`, 2026-11-16

## Active session policy

- Administrator and guest sessions have a 30-day absolute lifetime from issuance. The server checks expiry on authenticated requests; the lifetime is not extended by routine activity.
- Each account can have at most five active sessions. A new sign-in that exceeds the limit evicts the oldest session for that account. Sessions created on different devices or browser profiles share the same per-account limit.
- Logging out invalidates the current session.
- Changing a password revokes the account's other sessions while retaining the current session.
- Changing an account's role or deleting the account invalidates that account's sessions.

## Legacy-session upgrade

- Legacy administrator sessions with a trustworthy `issuedAt` are assigned the 30-day policy expiry. Administrator records without a trustworthy issue time fail closed.
- Older guest records that used the historical seven-day expiry are upgraded using their original issue time to preserve the 30-day guest lifetime policy.
- On the first sign-in after session indexing is introduced for an account, the server establishes that account's session generation. Previously unindexed or older-generation sessions may then be invalidated on their next use; other devices may need to sign in again.

## Bounded maintenance

Expired, orphaned, and stale-generation session records are removed by resumable cleanup. Each cleanup pass examines at most 100 session records, and automatic cleanup is throttled to at most one pass every five minutes. Cleanup is best-effort and does not replace the per-request session validation.

## Security boundary

Session expiry, indexing, and revocation are enforced by the Durable Object. Client-side session state is not authorization evidence. The Durable Object stores hashed token keys; application code must not log or expose raw session tokens.

This policy documents the behavior currently implemented in `state-store.js`. Re-check the code and session tests before changing limits, expiry, or migration behavior.
