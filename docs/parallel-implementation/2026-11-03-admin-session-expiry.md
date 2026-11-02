# Administrator session expiry and bounded session lifecycle

**PR:** #280  
**Branch:** `fix/admin-session-expiry-2026-11-03`  
**Base:** `main` at `033e90667d2a3e32ca5f63a7ea27fa1f57fb2a50`

## Implemented

- [x] Administrator sessions now receive a finite 30-day absolute expiry. The server checks it on every authenticated request.
- [x] New admin and guest sessions carry finite `issuedAt`, `expiresAt`, and a session-index generation.
- [x] Legacy administrator sessions with a trustworthy finite `issuedAt` and null expiry are upgraded to `issuedAt + 30 days`; sessions without a trustworthy issue time are rejected and deleted.
- [x] Existing guest sessions preserve the existing 30-day lifetime policy. Older guest records with the historical seven-day expiry are upgraded from their original issue time.
- [x] Per-user session indexes retain at most five active sessions. A new login evicts the oldest session.
- [x] The first post-upgrade login creates the per-user session generation. Previously unindexed legacy tokens remain verifiable (and receive finite expiry) until that login; after the generation is created, unindexed/older-generation tokens are invalidated on their next use. Other devices may need to sign in again.
- [x] Logout removes its token from the index.
- [x] Password changes revoke other sessions while retaining the current session under the new generation.
- [x] Role changes invalidate all sessions for the changed account. Account deletion invalidates existing sessions as well.
- [x] Expired, orphaned, or stale-generation session records are cleaned in resumable pages using `startAfter`; at most 100 session keys are examined per cleanup pass, and automatic cleanup runs at most once every five minutes.
- [x] The cleanup cursor and per-user indexes are bounded/validated so malformed index data cannot create an unbounded session walk.

## Regression coverage added

- [x] Administrator token receives a finite 30-day expiry.
- [x] Legacy admin token with `issuedAt` is migrated; token without trustworthy issue time is rejected.
- [x] Admin token is rejected after 30 days even if legacy storage has null expiry.
- [x] Five-session cap evicts the oldest token.
- [x] Logout removes index membership and invalidates the token.
- [x] Password change retains the current session and revokes other sessions.
- [x] Role change revokes all target-account sessions.
- [x] Legacy unindexed tokens are invalidated when an account enters the new index generation.
- [x] Bounded cleanup processes 100/100/5 records across three resumable passes.
- [x] Cleanup is throttled to one automatic pass per five minutes.

## Acceptance

- [x] No new administrator session is non-expiring.
- [x] Expiry is enforced server-side on every authenticated request.
- [x] Per-account active sessions are capped at five.
- [x] Legacy migration is finite and fail-closed when issue time is untrustworthy.
- [x] Guest 30-day policy remains intact.
- [x] Logout, password-change, role-change, and deletion invalidation are covered.
- [x] Cleanup is bounded and cursor-resumable.
- [ ] Exact-head Worker auth tests and full CI pass.
- [ ] Deployment smoke confirms the Worker is serving the updated session policy.

## Rollout note

Existing legacy tokens with valid `issuedAt` can continue to work until their derived 30-day expiry or until the account's first login after this migration creates its session index. That first login invalidates old unindexed tokens for that account; other devices should sign in again. Legacy records without a trustworthy issue time fail closed immediately. The session index is stored in the same Durable Object as the token records, and only hashed token keys are stored in the index.
