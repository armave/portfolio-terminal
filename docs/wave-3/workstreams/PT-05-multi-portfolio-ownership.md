# Wave 3 PT-05 — Implement tenant and portfolio ownership boundaries

**Tracking issue:** [#539 — Complete tenant-owned portfolio storage, authorization and migration](https://github.com/armave/portfolio-terminal/issues/539) (replacement for deleted #333)  
**Merged architecture foundation:** PR #348  
**Dedicated branch:** feat/wave3-pt05-portfolio-tenancy  
**Client PR target:** dev; Worker/server-only deployment slices must be committed directly to main.

## Objective

Move from one shared administrator workspace plus read-only guest projections toward explicit tenant, workspace, portfolio and membership ownership. Authorization must be enforced at the Worker/Durable Object boundary, not inferred from client UI state.

## Hard prerequisite

Issue #539 records that tenant-owned financial writes remain gated on PT-02's transaction/audit ownership and mutation contracts in issue #507, plus PT-16's encryption rollout and key-lifecycle review. Metadata-only directory operations do not enable financial data access.

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


## Delivered safe metadata-directory integrity slice — 2026-11-20

The Durable Object now validates the complete tenant-directory ownership graph before serving or mutating directory metadata. The implementation is server-only and was committed directly to main at [b97534690cbfd6f3ced577a4db30f437af306d2e](https://github.com/armave/portfolio-terminal/commit/b97534690cbfd6f3ced577a4db30f437af306d2e).

The validator rejects duplicate tenant/workspace/portfolio identifiers; missing tenant or workspace parents; portfolio/workspace tenant mismatches; duplicate tenant/user membership identities; unknown or role-inconsistent capability sets; grants that reference another tenant's portfolio; duplicate active grants; and active grants whose membership is revoked or whose membership version is stale. Active guest, manager and investor memberships must retain the expected scoped grant shape. An invalid persisted directory returns the existing 503 recovery response and is left untouched; it is never silently reset or repaired.

worker.test.js adds corruption regressions for orphaned and cross-tenant relationships, forged capabilities, stale grant versions and duplicate membership/grant identities. The test assertions verify both fail-closed responses and preservation of the malformed last-known directory record.

**Exact-main validation:** [Cloudflare Worker deployment #44688202036](https://github.com/armave/portfolio-terminal/actions/runs/44688202036) passed Worker/authentication tests, typecheck, dependency audits, Wrangler dry-run and deploy on the exact SHA above. [Financial Integrity Regression #44688202219](https://github.com/armave/portfolio-terminal/actions/runs/44688202219) also passed on that SHA.

**Scope boundary:** this hardens the metadata directory only. It does not add tenant financial read/write routes, a tenant Durable Object binding, tenant key provisioning, migration, or cutover. financialDataEnabled remains false; the existing PortfolioStateDO remains the financial source of truth. PT-02 #507 and PT-16 #549/#550, plus security and owner approval, remain prerequisites before independent tenant financial writes.
