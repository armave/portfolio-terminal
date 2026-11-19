# PT-16 — Encrypted digest and tenant key lifecycle

> **Status: draft scope charter only.** This file reserves the grouped PR scope before implementation. It is not production smoke evidence, a security approval, or an approved key design. Remove or replace it with the real implementation record before marking this PR ready or mergeable.

## Issues in this PR

- #546 — Complete production verification and security lifecycle (parent)
- #548 — Verify encrypted-only digest protocol in production
- #549 — Design tenant-aware DEK/KEK ownership and versioned key lifecycle
- #550 — Implement tenant key rotation, recovery, revocation and backup handling

## Intended outcome

Close the encrypted-digest and tenant-key lifecycle as a gated sequence: verify the deployed encrypted-only protocol, approve a tenant-aware key architecture, then implement its lifecycle. Do not treat the existing shared-workspace encryption path as tenant isolation.

## Scope and required sequence

1. **Production digest smoke (#548):** verify plaintext writes are rejected, encrypted writes/reads succeed, ciphertext-only storage is observed, stale revisions return the documented conflict response, and post-deployment inventory reconciles. Use disposable non-sensitive test data and verify cleanup.
2. **Key architecture (#549):** obtain security review and document KEK custody/provider, per-tenant DEK boundaries, envelope/versioning, authenticated additional data, browser/server trust boundaries, recovery, backup, revocation, deletion, and migration. Design only; no production key migration in the architecture step.
3. **Key lifecycle (#550):** implement rotation, recovery, revocation, and backup handling only after #549 is approved and provider/custody ownership is available. Ensure resumable rotation and last-known-good behavior.
4. **Parent acceptance (#546):** include exact CI/security workflow and deployment evidence, key lifecycle test evidence, and remaining retention/privacy/browser-security sign-off references.

## Non-negotiable invariants

- No cross-tenant key reuse or client-visible raw key material.
- No destructive production key changes or real-user key migration as a test.
- Wrong-key, revoked-key, stale, malformed, interrupted, and failed-persistence paths must fail safely.
- Preserve existing encrypted data and last-known-good recovery; do not silently downgrade to plaintext.

## Acceptance evidence required before ready

- Captured protocol smoke and before/after inventory on exact deployed Worker SHA.
- Security-reviewed ADR with named custody/provider decision and accepted threat boundaries.
- Rotation/recovery/revocation/backup tests and explicit cleanup evidence.
- Security review and exact-head CI/deployment references; mocked tests are not production proof.
