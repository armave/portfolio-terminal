# PT-05 — Multi-portfolio ownership, tenant isolation, and sharing architecture

**Status:** Architecture/design foundation; implementation is deliberately gated  
**Tracking issue:** [#333](https://github.com/armave/portfolio-terminal/issues/333)  
**Umbrella product roadmap:** [PR #347](https://github.com/armave/portfolio-terminal/pull/347)  
**Target implementation PR branch:** `feat/pt-05-portfolio-tenancy` → `dev`  
**Scope of this change:** Architecture and migration specification only. It does not enable tenant creation, alter authorization, change Worker routes, migrate stored portfolios, or change encryption keys.

---

## 1. Executive decision

Portfolio Terminal must evolve from one administrator-owned shared portfolio with read-only guest projections into a multi-user platform where users can own or participate in multiple workspaces and portfolios.

**Recommended design:** introduce a stable tenant/workspace ownership model and portfolio-level grants, with server-authoritative authorization at every data boundary. Keep the current account directory/session authority separate from tenant portfolio data. Use explicit resource scope for every portfolio read, write, export, stream, and share operation.

Do not implement this as a client-only role expansion. Do not use a client-provided user, tenant, workspace, or portfolio ID as proof of access. Do not enable independent portfolio writes until authorization, encryption/key lifecycle, migration, recovery, and adversarial isolation tests have all passed.

The present system is already a useful starting point: it has authenticated account identities, administrator/guest roles, guest-scoped projections, encrypted guest snapshots, revisions, session revocation, and server tests for cross-guest isolation. The target model should preserve those protections and generalize them.

## 2. Verified current-state baseline

The design is based on the current `dev` source inspected for this workstream.

### Identity and roles

- `state-store.js` stores the account directory at `auth:users`.
- Current account records include a stable user ID, name/normalized name, `role` (`admin` or `guest`), language, password salt/hash metadata, and creation time.
- The initial bootstrap creates one administrator and stores a shared cloud-encryption key at `auth:cloud-encryption-key`.
- Account management is administrator-only. The role API currently accepts only `admin` and `guest`.
- The Worker verifies the session and obtains the authenticated account role and ID before handling protected requests.
- Guest sessions are read-only at the public Worker boundary. Guests cannot read the administrator's shared state/history/margin-digest records or private account/order/cashflow paths.

### Portfolio and guest data

- The Worker routes `/api/state`, `/api/history`, `/api/margin-digest`, and `/api/guest-portfolio` to a Durable Object named `portfolio_state`.
- The owner portfolio state and history use shared record keys in that Durable Object; the state route does not yet select a tenant portfolio.
- Guest data is stored separately under `guest-portfolio:<guestUserId>`.
- An authenticated guest GET is bound to the current guest's own ID. An administrator POST publishes a guest projection, and the server checks that every target ID is an existing guest.
- Guest projections and assignment ledgers are encrypted by the Durable Object using the current shared workspace encryption key. Guest publication uses revision checks and a transaction to prevent partial batch writes or stale publisher wins.
- Existing tests cover guest self-read, cross-guest isolation, guest write rejection, guest access to the workspace key rejection, publication atomicity, and session revocation.
- `src/domain/guestPortfolio.ts` and related guest assignment services produce restricted assigned-tranche and guest-history projections. These are projections, not independent tenant-owned portfolio books.
- `src/domain/accountPermissions.ts` and `canAccessPortfolioView` currently model the two client account roles for presentation/navigation. They are not a substitute for server authorization.

### Consequence

The current security model is **one shared administrator portfolio plus user-scoped, read-only guest projections**. It is not yet an independent multi-tenant portfolio platform. A new portfolio ID cannot safely be added only to frontend state or to a request body while the Worker and Durable Object still read/write the shared record.

This baseline must remain the compatibility contract until an approved migration is implemented.

## 3. Vocabulary and ownership model

Use the following distinct concepts. Do not overload the existing `accountId` name for all of them.

| Entity | Meaning | Ownership/security boundary |
|---|---|---|
| User | Authenticated human/service principal | Identity directory |
| Tenant | Top-level security and data-isolation boundary, normally one investor organization or personal investment space | Tenant membership and tenant encryption context |
| Workspace | Collaborative environment inside a tenant; may group portfolios and shared settings | Workspace membership |
| Portfolio | A distinct investment book with its own transactions, cash, positions, settings, analytics, and sharing policy | Portfolio owner and portfolio grants |
| Broker connection | Credential/connection metadata for one broker identity | Tenant/workspace owner; secret material remains server-side |
| Broker account | An account reported by a broker connection | Linked to a tenant and, where appropriate, one or more portfolios under explicit allocation rules |
| Membership | A user's role in a tenant or workspace | Server-side membership record |
| Portfolio grant | A user's scoped access to one portfolio or a permitted projection/report | Server-side resource grant |
| Share link | Revocable, optionally expiring, read-only access to a specifically scoped view | Unauthenticated bearer capability with expiry/revocation and server validation |
| Audit event | A record of a security, ownership, membership, sharing, or administrative action | Append-only audit stream |

### Required invariants

1. A portfolio has exactly one owning tenant and one explicit owner/owner policy. It may be shared with multiple authorized members.
2. A broker account is not automatically a portfolio. Linking a broker account does not grant every workspace member access to credentials or all broker data.
3. Portfolio data is not implicitly shared across every portfolio in the same tenant; the tenant establishes isolation, and portfolio grants establish access within it.
4. A user may belong to more than one tenant/workspace and may have different roles in each.
5. Platform administration is separate from tenant ownership and portfolio membership.
6. A guest is not a weakly authenticated tenant owner. Guest access is a narrow grant to an explicitly selected view/projection.
7. All resource ownership and grants are resolved by the server from the authenticated principal and stored records.
8. Tenant/workspace/portfolio IDs are identifiers, never authorization evidence.
9. Every ownership, membership, permission, share, and account-lifecycle change is auditable.
10. Revocation must invalidate subsequent API requests and new stream tickets; existing live streams must also be closed or revalidated.

## 4. Proposed roles and capabilities

Use scoped roles rather than adding a global role for every product persona. A role is meaningful only with its scope (platform, tenant, workspace, or portfolio).

| Role | Scope | Default capabilities |
|---|---|---|
| Platform administrator | Platform | Operate user/platform settings and system health; no implicit portfolio-content access |
| Tenant/workspace owner | Tenant or workspace | Create/manage workspaces and portfolios, invite/revoke members, manage connections, configure sharing, and access owned portfolio data |
| Portfolio manager | Assigned portfolios | Read and manage the portfolios explicitly assigned to them; cannot change tenant ownership or grant platform-wide access |
| Investor | Assigned portfolios | Read authorized portfolio, performance, risk, projection, and report views; no broker credential access or portfolio mutation by default |
| Guest | Explicit portfolio projection/report | Read only the selected projection/fields; no account-wide data, mutation, membership, broker connection, or workspace key access |

The role names do not dictate every product feature. Define permissions as capabilities and evaluate each capability against a scope.

### Initial capability vocabulary

- `tenant.read`, `tenant.update`, `tenant.members.manage`
- `workspace.read`, `workspace.create`, `workspace.update`, `workspace.members.manage`
- `portfolio.read`, `portfolio.create`, `portfolio.update`, `portfolio.archive`, `portfolio.delete`
- `portfolio.positions.read`, `portfolio.transactions.read`, `portfolio.transactions.write`
- `portfolio.performance.read`, `portfolio.risk.read`, `portfolio.projections.read`
- `portfolio.reports.read`, `portfolio.reports.export`
- `portfolio.share.manage`
- `broker.connection.read`, `broker.connection.manage`, `broker.credentials.use`
- `platform.users.manage`, `platform.health.read`, `platform.audit.read`
- `support.break_glass` (separate, exceptional, time-limited, reason-required, and fully audited)

### Permission matrix (initial safe defaults)

| Capability | Platform admin | Tenant/workspace owner | Portfolio manager | Investor | Guest |
|---|---:|---:|---:|---:|---:|
| Platform user administration | Yes | No | No | No | No |
| Read all tenant portfolio data | No by default | Own scope | Assigned | Assigned | No |
| Manage workspace membership | No by default | Own scope | No | No | No |
| Create/delete portfolios | No by default | Own scope | No by default | No | No |
| Read assigned portfolio analytics | Break-glass only | Yes | Yes | Yes | Only explicitly shared projection |
| Mutate financial transactions | No by default | Yes | Explicit grant | No by default | No |
| Manage broker connections/credentials | No by default | Own scope | Explicit grant, no secret reveal | No | No |
| Export full portfolio data | Break-glass only | Own scope | Explicit grant | No by default | No |
| Share/revoke a portfolio | No by default | Own scope | Explicit grant | No | No |
| Read guest projection/assigned lots | Only with audited support grant | Own scope | Explicit grant | Explicit grant | Own grant only |

"Yes" is still constrained by resource scope. A platform administrator is not automatically a tenant owner. Any emergency support access must be separately authorized, justified, time-limited, and audited.

## 5. Authorization contract

### Principal

After successful authentication, the server constructs a principal from verified session state. Conceptually:

```ts
interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  platformCapabilities: string[];
  // Loaded by the server; never copied from untrusted request claims.
  tenantMemberships: TenantMembership[];
}

interface TenantMembership {
  tenantId: string;
  workspaceIds: string[];
  role: "owner" | "manager" | "investor" | "guest";
  membershipVersion: number;
}
```

This is a conceptual target contract, not a type to add to client code as a source of truth. Session validation and membership resolution happen at the trusted server boundary.

### Authorization decision

Every protected operation should be describable as:

```ts
authorize(principal, {
  action: "portfolio.transactions.write",
  tenantId,
  workspaceId,
  portfolioId
});
```

The policy evaluator must:
- Fail closed for missing/unknown users, roles, memberships, resources, and permissions.
- Resolve tenant/workspace/portfolio relationships from server-owned records.
- Verify that the portfolio belongs to the requested workspace and tenant.
- Verify that the principal's membership/grant is active and not expired/revoked.
- Apply field-level filtering for read-only guest/report projections.
- Check mutation-specific capabilities independently from read capabilities.
- Record an auditable denial for security-sensitive cross-scope probes without logging tokens or private portfolio payloads.

A client may select a portfolio ID, but the server must resolve that ID and prove access before reading, mutating, exporting, or creating a stream for it.

### Endpoint and resource rules

- Prefer resource-scoped routes, for example `/api/tenants/:tenantId/workspaces/:workspaceId/portfolios/:portfolioId/state`.
- The server must not trust `tenantId`, `workspaceId`, `portfolioId`, `ownerId`, or role values in POST bodies as proof of access.
- Do not use a request's supplied ID directly to select a Durable Object before authorization. Resolve a canonical resource record through the trusted directory, authorize it, then route using the canonical server-held identifier.
- Never let a guest read the shared legacy `/api/state`, `/api/history`, `/api/margin-digest`, or raw broker account paths as a side effect of receiving a portfolio grant.
- Exports, backups, reports, AI tools, polling jobs, quote subscriptions, and WebSocket ticket creation are also protected resource reads.
- WebSocket tickets should carry only short-lived, minimum necessary scope. Ticket consumption must validate ticket age, single-use state, user/session revocation state, portfolio scope, and permission version; role changes and grant revocation must terminate or invalidate relevant streams.

## 6. Target storage and Cloudflare boundary

### Separation of authority

The current `PortfolioStateDO` instance is both the account/auth directory and the shared portfolio-data endpoint. The target design should separate those responsibilities:

1. **Identity/directory authority:** verifies sessions, manages users and memberships, issues/revokes sessions, resolves canonical tenant/workspace/portfolio ownership and grants.
2. **Tenant data authority:** stores tenant/workspace-scoped portfolio and history data and enforces the authorized scope passed by the trusted Worker.
3. **Public Worker:** authenticates the request, obtains a verified principal, resolves and authorizes the resource, then routes to the correct tenant data boundary.
4. **Client:** caches only the currently authorized workspace/portfolio view and clears scoped caches when identity, tenant, workspace, portfolio, or permission revision changes.

The exact Cloudflare topology (new Durable Object class/binding versus a carefully isolated per-tenant instance strategy) must be selected after checking Wrangler configuration, namespace/class migration behavior, data size/transaction needs, and current deployment bindings. Do not assume a new named Durable Object alone provides identity separation: the existing DO also contains session/user records, so moving a request to a different instance without a directory design would make session verification fail or duplicate identities.

### Resource key model

Conceptual target keys should make ownership explicit, e.g.:

- `tenant:<tenantId>:metadata`
- `tenant:<tenantId>:workspace:<workspaceId>:metadata`
- `tenant:<tenantId>:portfolio:<portfolioId>:snapshot`
- `tenant:<tenantId>:portfolio:<portfolioId>:history`
- `tenant:<tenantId>:portfolio:<portfolioId>:transactions`
- `tenant:<tenantId>:portfolio:<portfolioId>:revision`
- `tenant:<tenantId>:portfolio:<portfolioId>:audit`

The exact storage layout is an implementation decision. Avoid embedding raw user-controlled strings directly into keys. Validate identifier format/length and construct key names only from canonical server records.

### Encryption and key lifecycle

The current system has a shared `auth:cloud-encryption-key` and uses it to encrypt guest projection/ledger payloads. That is a legacy compatibility constraint, not a suitable final per-tenant key hierarchy.

Target requirements:
- Unique tenant-scoped data encryption keys (DEKs), with versioned key metadata.
- Envelope encryption using a dedicated, separately managed key-encryption key (KEK) or approved managed key service.
- No reuse of passwords, session tokens, broker credentials, or the Gateway bootstrap secret as data-encryption keys.
- Authenticated encryption with versioned envelopes, nonce uniqueness, algorithm metadata, and tenant/resource context bound as associated data where supported.
- Key rotation that can rewrap DEKs without rewriting all portfolio data where the chosen scheme supports it.
- Defined recovery, key-loss, tenant deletion, export, and support-access procedures.
- Explicit secret lifecycle for client-encrypted data and server-encrypted projections; do not confuse transport TLS, application envelope encryption, and provider-side storage encryption.

**Decision gate:** do not migrate or issue per-tenant encryption keys until the key hierarchy, recovery, rotation, backup, and disaster recovery owners are selected and tested. Do not silently repurpose the current shared key or assume the Gateway Secret is a durable KMS.

## 7. Migration from the current shared workspace

Migration must preserve current administrator and guest experiences and must be reversible until the new model is proven.

### Legacy mapping

- Create one explicit legacy tenant/workspace representing the current administrator-owned shared workspace.
- Map the bootstrap/owning administrator to the legacy tenant/workspace owner.
- If additional current administrators exist, preserve their present access in the legacy workspace as an explicit membership; do not grant them platform-wide portfolio access.
- Preserve each guest as an authenticated user, but map only its existing assignment/projection to a narrow guest grant. Do not convert guest status into tenant-wide access.
- Preserve current guest snapshot, tranche ledger, assignment IDs, revision, and session-revocation semantics.
- Keep existing global owner record, history, margin-digest, and per-guest record data readable during the transition.

### Migration phases

**Phase 0 — Inventory and snapshot**
- Inventory all keys, record versions, encrypted envelopes, account records, session indexes, cloud revisions, guest projections, ledger rows, assignment identifiers, and backups.
- Capture an immutable migration snapshot with counts, hashes, and source revision.
- Verify available backups and restore procedure before changing production routing.

**Phase 1 — Add the new model without changing behavior**
- Introduce versioned tenant/workspace/portfolio/membership/grant schema and validation.
- Resolve the legacy account-to-tenant mapping in a server-only compatibility layer.
- Continue routing all live reads/writes through the existing legacy path.
- Keep new multi-tenant write paths feature-flagged off.

**Phase 2 — Shadow authorization and resource resolution**
- Resolve the same authenticated requests through the new policy model without changing returned data.
- Compare old authorization outcomes with the proposed membership/grant policy.
- Record mismatches and fail the rollout if any current guest receives broader access or a current admin loses intended legacy scope.
- Run cross-tenant and forged-ID tests with adversarial principals.

**Phase 3 — Copy and verify**
- Freeze or revision-lock legacy writes for the snapshot/copy window, or use a proven revision-aware incremental copy mechanism.
- Copy portfolio/history/digest records and each guest projection/ledger into the mapped tenant/workspace/portfolio locations.
- Re-encrypt guest and other application-encrypted payloads under the new per-tenant key hierarchy.
- Verify record counts, identifiers, revisions, assignment histories, hashes where applicable, and independently recalculated financial totals.
- Do not delete or overwrite source records.

**Phase 4 — Controlled read cutover**
- Enable tenant-scoped reads for one internal/test workspace first, then a small owner-only cohort.
- Compare new reads with legacy outputs; any unexplained difference stops rollout.
- Keep writes on the legacy path until read parity, authorization, key recovery, and browser validation gates pass.

**Phase 5 — Controlled write cutover**
- Enable writes only after PT-01/PT-02 financial and mutation contracts are merged and tested.
- Use one authoritative write path. Do not independently accept writes into both legacy and tenant stores without a transaction/reconciliation design.
- Persist migration version, last confirmed source revision, target revision, and audit event for cutover.
- Roll out one tenant at a time with per-tenant kill switch and monitoring.

**Phase 6 — Legacy retirement**
- Retire legacy route/key/storage behavior only after all tenants are migrated, exports/restores have been proven, audit retention requirements are met, and rollback window is closed.
- Keep a documented read-only archive/retention policy if legal or operational requirements demand it.

### Rollback rules

- Before write cutover: disable the feature flag and route reads back to the untouched legacy snapshot.
- During controlled write cutover: freeze writes, capture both revisions, reconcile all mutations, then either complete forward or restore from a verified snapshot. Do not simply point reads back to old data after new writes have been accepted.
- Never delete old source records as part of the same release that performs the first tenant write cutover.
- Never use a rollback path that silently loses transactions, assignment history, or guest revocation changes.

## 8. Security and privacy threat model

| Threat | Required defense |
|---|---|
| User changes a portfolio/tenant ID in a URL or body | Resolve canonical resource and authorize server-side before storage routing |
| Guest requests another guest's snapshot or ledger | Bind reads to authenticated principal and explicit grant; test forged IDs |
| Investor reads another portfolio in the same tenant | Portfolio-level grant check; tenant membership alone is insufficient |
| Manager grants themselves tenant ownership | Separate owner-only membership/role mutation; validate actor capability and target role |
| Platform admin browses private holdings | No implicit data access; explicit audited break-glass grant |
| Stale session after role/grant removal | Permission/session revision checks and immediate revocation for API and streams |
| Replayed or stolen share link | Short expiry, revocation, scoped fields, rate limits, no mutation, optional recipient binding |
| WebSocket outlives membership revocation | Short-lived scoped ticket and stream closure/revalidation on revocation |
| ID collision or key namespace confusion | Canonical IDs, strict validation, tenant/resource context binding |
| Key theft or one tenant's key exposes every tenant | Per-tenant DEK, isolated wrapping-key policy, rotation/recovery and scoped access |
| Error/log leaks portfolio data or credentials | Sanitized responses and privacy-safe logs; no token or raw financial payload logging |
| AI prompt tries to read other workspaces | AI tools receive only authorized server-side projections; model text is never an authorization source |
| Export/backup bypasses access checks | Same resource authorization and audit policy as API reads |

## 9. Required test matrix

Tests must exercise the Worker/Durable Object boundary and use at least two tenants, multiple workspaces, several portfolios, and principals with different scoped roles. Client-only permission tests are not enough.

### Authentication and resource scope
- Unauthenticated, expired, revoked, or wrong-session requests cannot read or mutate any tenant data.
- A valid user cannot access another tenant by substituting tenant/workspace/portfolio IDs.
- A user belonging to two tenants sees only resources granted in the active scope.
- A tenant member without a portfolio grant cannot read that portfolio.
- Client-submitted owner, tenant, role, or membership claims are ignored/rejected.

### Role and capability matrix
- Owner, manager, investor, and guest each receive only their allowed capabilities.
- Platform administrator has no implicit content access.
- Managers cannot elevate themselves, change tenant ownership, or grant platform roles.
- Guests see only the permitted projection/report fields and cannot reach raw account, balance, order, credential, or history endpoints outside their grant.

### Mutation and concurrency
- Unauthorized create/update/delete, transaction write, membership change, share, export, and key operations fail closed.
- Concurrent owner membership/role updates use revision/transaction checks.
- Removing a membership or changing a role revokes old sessions/tickets according to policy version.
- Replays, duplicate requests, stale revisions, and partial batches cannot cross portfolio boundaries.

### Storage and encryption
- A tenant's keys and ciphertext cannot decrypt another tenant's data.
- Tenant context tampering fails authenticated decryption.
- Key rotation, restore, export, deletion, and version migration are tested.
- A missing/corrupt key fails closed without overwriting the source data.
- Legacy shared key and encrypted guest envelopes remain readable through the migration adapter until explicitly retired.

### Migration and recovery
- Current admin and guest accounts are mapped deterministically.
- Existing guest assignment and closed/unassigned tranche history is preserved exactly.
- Financial values and revisions match before/after migration.
- Failure at each migration phase leaves the legacy copy intact and allows a documented rollback.
- No new tenant becomes writable before the approved cutover gate.

### Client behavior
- Account/tenant/workspace/portfolio/permission changes clear or re-scope client caches and in-flight requests.
- Navigation and controls reflect effective capabilities but never serve as the security boundary.
- English/Russian localization, empty/error/denied states, keyboard navigation, and responsive layouts are covered.

## 10. Implementation sequence and dependency gates

This PT-05 workstream is intentionally staged. The present PR defines architecture and invariants; it does not mark the issue's implementation acceptance criteria complete.

| Step | Work | Dependency / gate |
|---|---|---|
| PT-05A | Approve this ownership, capability, storage, encryption, and migration model | Product/security review |
| PT-05B | Complete PT-01 financial/data inventory and PT-02 transaction/audit ownership contracts | Required before tenant financial writes |
| PT-05C | Select Cloudflare identity/data boundary and per-tenant key lifecycle; threat-model and deployment review | Wrangler/Worker/DO and recovery design |
| PT-05D | Add versioned identity, tenant, workspace, portfolio, membership, and grant records behind disabled flags | Server-only schema migration and rollback tests |
| PT-05E | Implement central authorization and resource-scoped routing with negative/cross-tenant tests | No client-controlled DO routing |
| PT-05F | Implement tenant data storage, encryption, exports/deletion, and legacy migration adapters | Key recovery + parity tests |
| PT-05G | Shadow authorization, migrate one test workspace, then phased read/write cutover | Financial reconciliation and security sign-off |
| PT-05H | Add client workspace/portfolio selection and role-specific views | Backend contracts and server tests merged |
| PT-05I | Enable independent editable portfolios and retire compatibility paths | All release gates signed off |

### Deployment policy

- This design document is delivered as a client/docs PR to `dev`.
- Any later Worker/Durable Object/server-only implementation must follow the repository policy and be committed/pushed directly to `main` for immediate deployment.
- A mixed feature must split server deployment and client presentation into compatible slices, with both commits/PRs cross-linked to issue #333 and the umbrella roadmap.
- Do not merge a client that assumes a server capability which has not been deployed. Keep feature flags disabled until the server contract is live and verified.

## 11. Decision register

| Decision | Recommendation | Status |
|---|---|---|
| Security boundary | Tenant is the top-level isolation boundary; portfolio grants scope access within it | Proposed |
| Identity roles | Separate platform role from scoped tenant/workspace membership roles | Proposed |
| Current admin migration | Map current owner workspace into one explicit legacy tenant/workspace | Proposed |
| Guest migration | Preserve guest identities as narrow, read-only projection grants | Proposed |
| Data source of truth | Keep existing portfolio state/financial contracts until PT-01/PT-02 approve any evolution | Required constraint |
| DO topology | Separate identity authority from tenant data authority; final binding/class choice requires Wrangler review | Open implementation decision |
| Encryption | Per-tenant DEK with versioned envelope encryption and separately managed KEK | Proposed; key service must be selected |
| Cutover | Shadow auth, copy/verify, controlled read, then controlled write | Proposed |
| Platform admin access | No implicit portfolio content access; audited break-glass only | Proposed |

## 12. Completion criteria for the PT-05 workstream

The parent issue #333 may be closed only when all of the following are demonstrated:

- Each portfolio has canonical tenant/workspace ownership and an enforceable server-side policy.
- Every protected read, write, export, report, AI tool, and streaming path checks authenticated ownership/grants.
- Cross-tenant and same-tenant/no-grant adversarial tests pass at the Worker/Durable Object boundary.
- Guest access remains least-privilege and does not expose shared owner state or broker credentials.
- Per-tenant encryption, key rotation, backup, restore, export, deletion, and recovery are implemented and reviewed.
- Current administrator and guest data are migrated with financial, assignment, and revision parity.
- Rollback is demonstrated after failures before and during write cutover.
- Role-aware client views work against deployed server authorization and preserve English/Russian localization.
- Exact-head CI, browser flows, security review, and production smoke evidence are attached to implementation PRs.

**This design PR completes PT-05A only.** It is a necessary design milestone, not completion of independent multi-portfolio tenancy. The remaining PT-05 steps require PT-01/PT-02 inputs and a separate server-side implementation/deployment sequence.
