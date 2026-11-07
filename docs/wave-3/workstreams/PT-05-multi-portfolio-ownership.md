# Wave 3 PT-05 — Implement tenant and portfolio ownership boundaries

**Tracking issue:** #333  
**Merged architecture foundation:** PR #348  
**Dedicated branch:** feat/wave3-pt05-portfolio-tenancy  
**Client PR target:** dev; Worker/server-only deployment slices must be committed directly to main.

## Objective

Move from one shared administrator workspace plus read-only guest projections toward explicit tenant, workspace, portfolio and membership ownership. Authorization must be enforced at the Worker/Durable Object boundary, not inferred from client UI state.

## Hard prerequisite

Issue #333 explicitly records that PT-05B still requires completion of the PT-02 transaction/audit ownership and mutation contracts in issue #330. Wave 3 includes PT-02 completion for this reason.

PT-05 may work in parallel on tenant directory schemas, scoped identity, server authorization for safe reads and isolated topology proof. It must **not enable independent tenant financial writes or live cutover** until PT-02 acceptance, PT-16 security/key review, adversarial isolation tests and migration/rollback gates pass.

## Starting architecture decision

The existing design proposes keeping the current PortfolioStateDO and migration v1 intact and introducing a separate PortfolioTenantDO / PORTFOLIO_TENANT_DO topology with one canonical tenant object per tenant, routed only after directory authorization. Treat the architecture document as the design baseline, not as implemented functionality.

## Scope and delivery gates

1. **Directory and identity contracts**
   - Tenant, workspace, portfolio, membership, scoped role, grant and ownership record schemas.
   - Stable IDs and normalized membership lookup; never use client-supplied IDs as proof of authorization.
   - Separate platform administrator from tenant owner, portfolio manager, investor and guest.
2. **Server authorization**
   - Authenticated principal and server-side directory resolve the tenant/portfolio for every read/write/backup/stream/share request.
   - Object-level checks cover IDs, alternate routes, batch APIs, export and stream-ticket issuance.
   - Revocation prevents new requests and closes/revalidates active stream sessions.
3. **Storage and key lifecycle**
   - Tenant-scoped storage and per-tenant key ownership, rotation, recovery and deletion.
   - Signed internal authorization assertion or an equally strong Worker-to-DO trust boundary.
   - No reuse of the global workspace key as a substitute for tenant keys.
4. **Migration and rollback**
   - Versioned migration of the legacy administrator workspace and guest projections.
   - Idempotent migration, backup, dry-run/preview, compatibility period, rollback and recovery.
   - No automatic data move or tenant write enablement until security review passes.
5. **Client contract**
   - Minimal typed tenant/portfolio selection and membership state.
   - No permission decisions based solely on hidden controls.
   - Existing admin/guest flows remain compatible until migration and cutover are explicitly approved.

## Acceptance criteria

- Every portfolio has one owning tenant and explicit ownership policy.
- Worker tests prove object-level isolation for cross-tenant reads/writes, guessed IDs, batch requests, streams and revoked sessions.
- Each tenant's data and encryption key are isolated; key rotation/recovery and deletion are tested.
- Existing admin and guest users migrate without data loss or cross-tenant visibility; rollback is demonstrated.
- PT-02 mutation/journal acceptance and PT-16 security review pass before independent financial writes are enabled.
- Existing PortfolioState.positions and financial persistence behavior remain compatible.

## Required validation

Adversarial Worker/Durable Object tests; guest self-read and cross-tenant negative tests; membership/grant revocation; revision/concurrency tests; key isolation and rotation/recovery tests; legacy migration and rollback fixtures; export/delete and stream lifecycle tests. Manual security review and authorized deployment validation are mandatory. Mocked CI is not a substitute.

## Deployment rule

Split mixed changes. Commit Worker/DO-only changes directly to main as additive, backward-compatible slices. Keep client/API-contract changes in a focused PR to dev. Record paired server/client SHAs and deployment order in the client PR. Never enable a new client path before the server route and authorization checks are deployed and verified.
