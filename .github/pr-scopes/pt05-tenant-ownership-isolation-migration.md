# PT-05 — Tenant ownership, isolation and migration

> **Status: draft scope charter only.** This file reserves the grouped PR scope before implementation. It is not an authorization, isolation, migration, or production-cutover approval. Remove or replace it with the real implementation record before marking this PR ready or mergeable.

## Issues in this PR

- #539 — Complete tenant-owned portfolio storage, authorization and migration (parent)
- #556 — Define canonical tenant ownership and server authorization contracts
- #557 — Implement isolated tenant Durable Object data plane and internal trust boundary
- #558 — Migrate legacy workspace into tenant ownership with parity and rollback

## Intended outcome

Deliver a dependency-ordered tenant ownership and storage lifecycle. Ownership/authentication contracts must precede tenant data routing; tenant isolation and key lifecycle must be proven before any legacy workspace migration or cutover.

## Scope and required sequence

1. **Ownership/authorization (#556):** define canonical tenant/workspace/portfolio relationships and server-authoritative authorization. Client-supplied IDs are selectors, never proof of access. Add adversarial cross-tenant, missing-grant, guest-escalation, alternate-route, and batch-path tests.
2. **Isolated data plane (#557):** only after the authorization and PT-16 tenant-key contracts are approved, implement the Worker-to-tenant-DO trust boundary and tenant-scoped storage. Keep financial data disabled until isolation, revision, idempotency, atomicity, and recovery gates pass.
3. **Migration/rollback (#558):** provide dry-run ownership mapping, orphan/ambiguous-record reporting, idempotent revision-safe copy, full snapshot/journal/history/FIFO/cash/debt/broker-evidence parity, and a rehearsed rollback.
4. **Parent acceptance (#539):** verify admin/guest compatibility, security review, account-scoped access, observability, and explicit owner approval before any production cutover.

## Dependencies and guardrails

- #557 depends on accepted #556 authorization contracts and approved PT-16 key ownership/lifecycle (#549/#550).
- #558 depends on the isolated tenant data plane and complete parity/rollback evidence.
- Keep the current PortfolioStateDO source of truth and `financialDataEnabled=false` until all gates pass.
- No tenant financial writes, legacy migration, or cutover merely because a route, mock, or metadata directory exists.
- Do not weaken current admin/guest behavior or expose cross-account financial data.

## Acceptance evidence required before ready

- Approved ownership/auth contract and adversarial Worker tests.
- Tenant storage namespace/trust-boundary tests including cross-tenant denial, revision conflicts, idempotency, and atomic persistence.
- Dry-run mapping plus sanitized parity and rollback rehearsal.
- Explicit security/owner sign-off and exact-head CI/deployment evidence; production cutover remains a separate approval.
