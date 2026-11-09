# PT-05 next-stage plan — tenant-isolated data plane and key lifecycle

**Prepared:** 2026-11-09  
**Tracking issue:** [#333](https://github.com/armave/portfolio-terminal/issues/333)  
**Security dependency:** [PT-16 issue #344](https://github.com/armave/portfolio-terminal/issues/344)  
**Existing charter:** [Wave 3 PT-05](../wave-3/workstreams/PT-05-multi-portfolio-ownership.md)  
**Client target:** `dev`; Worker/Durable Object implementation must be committed directly to `main`.  
**Status:** First safe implementation slice delivered; tenant financial data plane remains deliberately disabled pending PT-02/PT-16 and key-recovery gates.

## Implemented security hardening — 2026-11-09

This PR now contains the first runtime implementation slice while preserving the metadata-only contract:

- [x] Public Worker allows only the tenant directory's supported GET/POST methods and rejects unknown tenant paths before forwarding.
- [x] `PortfolioStateDO.handleTenantDirectory` independently enforces the same method allowlist and returns `405 Allow: GET, POST` for unsupported verbs.
- [x] Worker and Durable Object tests cover PUT/PATCH/DELETE rejection, no mutation on rejected requests, and unknown-path rejection.
- [x] Client runtime validation checks nested tenant timestamps, membership versions, role/capability arrays, portfolio metadata, and owner roster fields before the Settings UI consumes the response.
- [x] Vitest cases cover malformed nested permission, membership, and timestamp data.
- [ ] No tenant financial-state route or tenant Durable Object binding is enabled by this slice.
- [ ] No per-tenant key is generated, rotated, recovered, exported, or deleted by this slice.

**Direct-to-main server companion:** [commit `8c920311e8a29f32b844fed6558a99ad466f4bbc`](https://github.com/armave/portfolio-terminal/commit/8c920311e8a29f32b844fed6558a99ad466f4bbc) on `main`, containing the Worker/DO method and route guards plus the final regression-test corrections.

- [x] Worker test validation and pinned Wrangler deployment: [Deploy Cloudflare Worker #42561426103](https://github.com/armave/portfolio-terminal/actions/runs/42561426103) — success on the exact server commit.
- [x] Main-branch Operations Browser Journey: [run #42561426142](https://github.com/armave/portfolio-terminal/actions/runs/42561426142) — success on the exact server commit.
- [ ] Authenticated live tenant-boundary smoke/security review: not claimed by mocked Worker tests or the browser fixture.

The deployment preserves `mode: directory-metadata-only` and `financialDataEnabled: false`; it does not enable independent tenant financial data.

**Security disposition:** this is not completion of tenant data-plane isolation. The directory continues to return `mode: directory-metadata-only` and `financialDataEnabled: false`. The design explicitly prohibits enabling financial routes until PT-02 issue #330 and PT-16 issue #344, per-tenant key ownership/recovery, migration/rollback, and adversarial authorization gates are satisfied.

## Audit baseline

The ownership work is not starting from zero:

- PR #348 established the tenant/workspace/portfolio architecture and proposed a separate tenant Durable Object topology.
- PR #381 added a Settings directory for tenant/workspace/portfolio metadata and memberships.
- Paired Worker commits added directory-only endpoints and owner-scoped membership grants/revocation. The API deliberately reports `mode: directory-metadata-only` and `financialDataEnabled: false`.
- Current tenant IDs identify resources; they are not credentials. Admin accounts still use the legacy shared owner workspace and guests still use their server-filtered projection.
- The existing legacy `/api/state`, `/api/history` and digest paths still use the fixed legacy `portfolio_state` storage path. No tenant-specific financial Durable Object or tenant key hierarchy has been enabled.

This is a real security boundary, not a UI-only gap. Do not label the directory as multi-tenant financial isolation.

## Remaining risks to close

1. **Data-plane isolation:** tenant metadata exists, but positions, transactions, cash, history, backups and live updates are not stored/routed independently by tenant.
2. **Authorization completeness:** every protected object read/write/export/import/stream/share route must resolve the authenticated principal and verify current membership and object ownership server-side. Client-supplied IDs are selectors only.
3. **Encryption lifecycle:** the shared workspace key is not a per-tenant key hierarchy. Key creation, rotation, recovery, device revocation and deletion need explicit ownership and tests.
4. **Legacy migration:** the current shared admin workspace and guest projections need a non-destructive, versioned migration and rollback path.
5. **Dependency gates:** independent tenant financial writes must remain disabled until PT-02 transaction/audit acceptance and PT-16 security/key review pass.

## Implementation plan

### A. Define and prove server-authoritative identity
- [ ] Resolve principal from the authenticated session on every request; never trust caller-supplied tenant/workspace/portfolio IDs as authorization evidence.
- [ ] Validate membership, role capability and object ownership for direct IDs, batch IDs, alternate routes, backup/export/import and stream-ticket issuance.
- [ ] Revalidate revocation for subsequent requests and active/long-lived stream sessions.
- [ ] Establish an authenticated Worker-to-tenant-DO assertion (signed, audience-bound, short-lived and replay-resistant) or a security-reviewed equivalent.

### B. Introduce tenant-scoped data storage
- [ ] Implement the approved tenant Durable Object binding/topology without repurposing or destructively migrating the legacy `PortfolioStateDO`.
- [ ] Route tenant portfolio state, transaction journal, closed history, backups and live updates only after directory authorization.
- [ ] Keep legacy owner/guest routes available during the compatibility window, with explicit mode/version metadata.
- [ ] Enforce request size, schema, revision and idempotency checks independently within each tenant object.
- [ ] Add negative tests for guessed IDs, cross-tenant batch requests, alternate endpoints and stale membership.

### C. Establish tenant encryption and recovery
- [ ] Define per-tenant key ownership and encrypted-at-rest envelope versioning.
- [ ] Implement key generation, rotation, recovery, device revocation and deletion semantics; do not reuse the global workspace key as tenant separation.
- [ ] Ensure key material is never returned to guests or logged; constrain internal DO-to-DO access.
- [ ] Define encrypted backup/export and restore ownership, including what happens when a tenant is deleted or a key is rotated.
- [ ] Keep strict encrypted-write enforcement and legacy digest compatibility governed by PT-16 rollout gates.

### D. Migrate with dry-run and rollback
- [ ] Inventory legacy owner state, guest projections, history and digest records without exposing their contents.
- [ ] Provide a dry-run/preview with counts, checksums/revisions and destination ownership.
- [ ] Make migration idempotent and resumable; preserve source records until destination validation succeeds.
- [ ] Test rollback and recovery against existing admin/guest fixtures and a production-safe backup.
- [ ] Enable new read routes first; independent financial writes and cutover require a separate security release approval.

### E. Deliver the client as a compatibility-aware surface
- [ ] Add typed tenant/portfolio selection and permission states only after server contracts are deployed.
- [ ] Do not expose independent financial-write controls while `financialDataEnabled` is false.
- [ ] Preserve existing admin/guest workflows until migration and cutover are explicitly approved.
- [ ] Localize all new selection, migration, denial and recovery copy in English/Russian.

## File and deployment ownership

**Client PR to `dev`:**
- `src/services/tenantDirectoryApi.ts` and future typed portfolio-scoped API contracts
- `src/components/TenantDirectoryPanel.tsx` and permission-aware Settings/navigation wiring
- English/Russian copy and Vitest/browser journey coverage

**Worker/server deployment directly to `main`:**
- `worker.js`, `state-store.js`, `worker.test.js`, `wrangler.jsonc`
- tenant Durable Object class/binding and internal authorization protocol
- key management, route authorization, storage routing, migration and rollback code

Keep the two slices backward-compatible. Record the client branch SHA, server commit SHA, Worker deployment workflow and rollout/rollback evidence together. Never smuggle Worker or Durable Object code into a `dev` PR.

## Required validation

- [ ] Worker/Durable Object adversarial tests for cross-tenant read/write/export/import/backup/stream access.
- [ ] Guessed IDs, mixed-tenant batch IDs, revoked memberships, wrong roles and forged internal assertions fail closed.
- [ ] Concurrency, revision conflicts, idempotent restore, request bounds and session revocation tests.
- [ ] Per-tenant key isolation, rotation, recovery, device revocation and deletion tests.
- [ ] Legacy migration dry-run, successful migration, interrupted/resumed migration, rollback and restore fixtures.
- [ ] PT-02 financial mutation and journal acceptance reviewed before tenant financial writes are enabled.
- [ ] PT-16 security review, threat-model update and strict-encryption rollout gates explicitly approved.
- [ ] Client Vitest, localization parity and browser journeys pass on exact PR head.
- [ ] Worker test workflow and deployment workflow pass on the exact server commit; production smoke verifies the deployed revision.
- [ ] Manual security review and authorized staged cutover are recorded separately from mocks.

## Exit criteria and merge gate

- Every portfolio has one authoritative tenant owner, enforced on every server object path.
- A tenant cannot access another tenant's data, keys, exports, backups or live updates by changing any identifier.
- Data and keys are tenant-isolated with tested rotation/recovery/deletion.
- Existing users migrate without data loss or cross-tenant visibility, with a demonstrated rollback.
- Directory metadata alone never enables financial access.
- No independent tenant financial writes are enabled until PT-02 and PT-16 gates are satisfied and release approval is recorded.
