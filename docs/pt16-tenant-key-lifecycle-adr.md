# PT-16 — Tenant key ownership and versioned lifecycle

**Status:** Proposed architecture for security review; not approved for production implementation.  
**Tracking:** [#549 — tenant-aware DEK/KEK design](https://github.com/armave/portfolio-terminal/issues/549), parent [#546 — PT-16 security lifecycle](https://github.com/armave/portfolio-terminal/issues/546), dependency [#539 — PT-05 tenancy](https://github.com/armave/portfolio-terminal/issues/539).  
**Scope:** Design only. No key generation, migration, production secret change, or tenant data-plane enablement is included.

## 1. Decision context

The current cloud encryption path uses a shared workspace key and AES-GCM v2 envelopes. The encrypted-only Margin Intelligence digest write gate is deployed, but that does not create tenant-specific key ownership. The target PT-05 architecture adds a tenant-scoped data object while retaining the identity/directory authority; it is not yet an implemented financial data plane.

The shared workspace key, Gateway bootstrap secret, account passwords, session tokens, and broker credentials must not become tenant encryption keys. The existing device key used to protect locally persisted session material is also not a tenant key.

## 2. Security objectives

1. A tenant's data key must be distinct from every other tenant's data key.
2. Ciphertext must be cryptographically bound to the canonical tenant, workspace, portfolio, record type and envelope version.
3. A client-provided tenant or portfolio identifier must never authorize key access.
4. Wrapped keys and key metadata may be backed up; plaintext DEKs, KEKs and wrapping secrets may not.
5. Rotation and recovery must be resumable, revision-safe and fail closed.
6. Legacy workspace records remain recoverable until an independently approved migration and rollback plan is completed.
7. The implementation must not imply that key revocation can erase a key already copied by an authorized or compromised client.

## 3. Proposed key hierarchy

The following is the recommended starting point for review:

- **Platform KEK:** A dedicated, versioned wrapping key held only by a managed key service or a dedicated Worker secret with an explicit rotation owner. It is not the Gateway bootstrap secret. Selection of the actual key-management provider is an approval gate.
- **Tenant DEK:** A cryptographically random 256-bit key generated for each canonical tenant and version. It is used for authenticated encryption of data belonging to that tenant.
- **Optional scoped projection key:** A separate key/envelope for guest projections or narrowly shared records where the guest must not receive the tenant's full DEK. A guest grant must not implicitly reveal the tenant-wide key.
- **Device key:** Remains device-local and serves only its existing browser-secret-storage purpose. It does not replace the tenant DEK or KEK.

Each DEK is stored at rest only as a wrapped envelope. Key metadata is stored with the canonical tenant record in the trusted identity/directory authority; it is not accepted from a client as an authority source.

### Unwrap boundary

The public Worker authenticates the session, resolves the canonical tenant/resource from the trusted directory and authorizes the requested action before any key operation. The trusted Worker/key-service boundary is the only component permitted to unwrap the platform KEK or retrieve an unwrapped tenant DEK.

To preserve the current client-side AES-GCM snapshot model, the proposed protocol may issue a short-lived, resource-scoped key grant to an already-authorized browser client after server-side authorization. The browser receives only the tenant DEK needed for its authorized workspace operation; it never receives the KEK or wrapped key. The DEK is held in memory only and is not written to localStorage, sessionStorage, IndexedDB, URLs, logs or telemetry. Guest projection access uses a distinct scoped key and never returns the tenant-wide DEK.

This design is **not zero-knowledge encryption**: an authorized browser and an active-origin compromise can observe any DEK granted to that browser. Revocation prevents future grants and requests, but cannot make a previously copied plaintext key disappear. If this residual risk is unacceptable, select a fully server-mediated encryption protocol instead; that would change the current client-side encryption trust model and must be treated as a separate architecture decision.

## 4. Versioned envelope contract

Use a new encryption-envelope version independent of portfolio transaction-event schema versions and snapshot versions. The exact wire schema must be agreed with the current AES-GCM v2 implementation before code is written.

The proposed data envelope contains:

| Field | Purpose |
|---|---|
| `envelopeVersion` | Version of the outer encrypted-record contract |
| `algorithm` | Explicit allowlisted authenticated-encryption algorithm |
| `keyId` | Opaque canonical tenant-key identifier |
| `keyVersion` | Monotonically increasing DEK version |
| `nonce` | Unique, correctly sized nonce for the selected algorithm |
| `ciphertext` | Authenticated encrypted payload, including the authentication tag as defined by the implementation |

The wrapped-DEK record contains the tenant key ID/version, KEK identifier/version, wrapping algorithm, wrapped bytes, creation timestamp and lifecycle state. It does not contain the plaintext DEK or KEK.

### Authenticated context

Construct additional authenticated data (AAD) from canonical server-resolved values, not arbitrary client strings. At minimum bind:

- tenant ID;
- workspace ID;
- portfolio ID;
- record type (snapshot, history, digest, projection or backup metadata);
- record/envelope version;
- DEK key ID and version.

A ciphertext copied from one tenant, portfolio or record class must fail authentication in another context. Exact canonical serialization and field ordering must be specified in the implementation contract and covered by known-answer tests.

Do not invent a custom wrapping primitive. Use a well-reviewed standard supported by the selected key-management service, with explicit algorithm/version metadata and bounded input validation.

## 5. Key lifecycle state machine

A tenant key version follows an explicit state machine:

`provisioning → active → rotation_pending → rotating → verifying → active(new version)`

The previous version then becomes `retired_read_only` only after the new version is verified against all required records and recovery artifacts. Error/interruption transitions to `recovery_required`; revocation transitions to `revoked`. Unknown states or key versions fail closed.

### KEK rotation versus DEK rotation

These are separate operations:

- **KEK rotation:** Re-wrap existing DEKs under a new KEK version. Portfolio ciphertext does not need to change when the wrapping scheme permits safe re-wrapping.
- **DEK rotation:** Generate a new tenant DEK and re-encrypt every record bound to the old DEK. Keep the old version available for reads during the verified migration window; never mix untracked versions or discard the old key after a partial run.

Every batch is idempotent and compare-and-swap protected by the source record revision, key version and migration cursor. Preserve the last-known-good encrypted record until the replacement ciphertext and its authenticated context have been verified.

## 6. Authorization and session interaction

- Key grants are issued only after server-side membership, portfolio grant, role/capability, session and permission-version checks.
- Tenant IDs, key IDs and portfolio IDs from the browser are selectors only; the directory supplies canonical identifiers.
- Key-grant responses are no-store, TLS-only, short-lived and limited to the exact resource and operation.
- A role/grant change or session revocation blocks subsequent key grants and data requests. Active streams must be invalidated or re-authorized.
- The system must document the limitation that a key already copied by an authorized browser cannot be remotely erased.
- Platform support access requires a separately approved, audited break-glass process; ordinary platform administration must not imply data decryption permission.

## 7. Backup, recovery and deletion

Backups may contain ciphertext, wrapped DEKs, key identifiers, versions, migration cursors and integrity metadata. They must not contain plaintext keys, KEKs, session tokens or broker credentials.

A restore must first authorize the tenant and validate the key envelope and key version. It must fail closed for missing, revoked, malformed or unavailable wrapping material. Recovery must be rehearsed from a backup that includes both portfolio ciphertext and the corresponding wrapped-key metadata.

Deletion requires a record-level inventory across active data, replicas, local device caches, user exports and retained backups. Cryptographic erasure may be claimed only after every recoverable copy of the relevant DEK and its wrapped form is covered by the approved deletion policy. Backup expiry and third-party Gist copies must be described honestly; removing the live record alone is not proof that all copies are gone.

## 8. Required validation before implementation

| Area | Required evidence |
|---|---|
| Tenant isolation | A tenant cannot unwrap, read or use another tenant's DEK even with guessed tenant/resource IDs |
| Envelope binding | Wrong tenant, workspace, portfolio, record type, nonce, key version or modified ciphertext fails authentication |
| Authorization | Guest, revoked, expired and ungranted sessions cannot obtain the tenant-wide key |
| Rotation | KEK re-wrap and DEK re-encryption are separately tested and resumable |
| Atomicity | Failed key or ciphertext persistence leaves prior committed key metadata and data readable |
| Concurrency | Two rotation attempts cannot advance incompatible versions/cursors |
| Backup | Wrapped key metadata restores with the exact ciphertext version and tenant scope |
| Deletion | Replica, local-cache, export and backup retention semantics are explicit |
| Telemetry | Captured logs contain no DEK, KEK, wrapped key bytes, access token or financial payload |

## 9. Approval gates and open decisions

Before implementing #550 or enabling #557:

1. Select and approve the key-management provider and KEK custody/rotation owner.
2. Decide whether short-lived DEK delivery to an authorized browser is acceptable or a server-mediated protocol is required.
3. Approve separate projection-key semantics for guest access.
4. Approve the envelope/AAD contract, version compatibility and cryptographic usage limits.
5. Complete PT-02 mutation/recovery acceptance and PT-05 server authorization design.
6. Rehearse key-backed backup/restore and rollback using synthetic, non-sensitive data.
7. Obtain security review and record the accepted decision and tested SHAs.

**No production key migration, independent tenant financial writes, or tenant cutover is authorized by this proposal.**

## 10. Decision alternatives and explicit trade-offs

This section is a review packet for [#549](https://github.com/armave/portfolio-terminal/issues/549), not an approval. The options below are intentionally left open; the proposed hierarchy in sections 3–7 must not be treated as an accepted implementation choice.

### Key custody and cryptographic boundary

| Option | Security boundary | Benefits | Costs and residual risks | Decision required |
|---|---|---|---|---|
| Managed key service / KMS-backed KEK | The provider protects and unwraps the platform KEK; the Worker is an authenticated caller | Dedicated key custody, provider audit controls and managed rotation facilities where supported | Provider availability and account configuration become production dependencies; pricing, recovery, residency and access policy vary by provider | Select provider, region, access policy, recovery owner and outage behavior |
| Worker-held KEK secret | A versioned secret is available to the production Worker runtime | Fewer external components and a simpler deployment boundary | Secret access is tied to Worker deployment/operations; custody, rotation, audit and recovery become operator responsibilities; no assumption of HSM-backed custody | Identify custodians, reviewer approvals, rotation cadence and emergency recovery process |
| Server-mediated data encryption | Browser sends validated plaintext to an authenticated Worker boundary; the server performs encryption/decryption | Tenant DEKs need not be returned to browser memory | The server processes plaintext; changes the current client-side encryption trust model and increases server responsibility, request size and availability coupling | Explicitly accept the new server trust boundary and prove logs, errors and operational tooling cannot expose plaintext |

No provider or custody model is selected by this ADR. A Worker secret is not automatically equivalent to a managed HSM/KMS boundary, and a KMS integration must not be assumed available until its account, permissions and recovery path are verified.

### Where encryption and plaintext may exist

| Option | Browser access | Server access | Guest/projection implication |
|---|---|---|---|
| Short-lived scoped DEK grant | An authorized client can observe the granted DEK while it is in memory | Worker/key service unwraps and authorizes grants | Guest must use a separate projection key or a separately encrypted projection; never grant the tenant-wide DEK |
| Server-mediated encryption | Browser sees only the plaintext records it is authorized to display, not the DEK | Worker/DO necessarily sees plaintext during the operation | The server constructs the projection after validating the guest grant; key scope remains server-owned |

A non-extractable IndexedDB device key protects its existing stored-secret use; it does not prevent an active-origin script from reading plaintext or a DEK deliberately delivered to that origin. Revocation can deny future requests and grants but cannot erase a key or plaintext already copied by an authorized or compromised client.

### Required decision record

Before implementation, reviewers must record a decision for each item. An unchecked row is a blocker, not an implicit default.

| Decision | Required evidence |
|---|---|
| KEK custody | Provider/secret boundary, owner, approvers, access policy, backup and emergency recovery |
| Client versus server encryption | Threat-model comparison, plaintext exposure map, operational impact and accepted residual risk |
| Guest projection encryption | Proof that a guest grant cannot unwrap or infer the tenant-wide DEK |
| Envelope and AAD | Canonical byte serialization, field ordering, versioning, allowlisted algorithms and wrong-context failure tests |
| Nonce and key usage | Provider/algorithm-approved nonce generation, uniqueness enforcement and per-key usage limits; do not invent limits in application code |
| Rotation | Separate KEK re-wrap and DEK re-encryption procedures, resumable cursors, CAS/revision checks and rollback |
| Revocation | New-request denial, stream invalidation and explicit disclosure that copied plaintext cannot be remotely erased |
| Backup and deletion | Matched ciphertext/wrapped-key restore, replica inventory, external-copy limits and honest erasure claims |
| Telemetry | Captured-log proof that keys, wrapped bytes, grants, credentials and financial content are excluded |

### Security review evidence and sign-off

The security review should include: (1) data-flow and trust-boundary diagrams; (2) compromise scenarios for the browser origin, administrator session, Worker, Durable Object, key service and backups; (3) cross-tenant and wrong-context negative tests; (4) interrupted rotation and restore exercises using synthetic data; (5) failure-mode behavior when key custody is unavailable; and (6) a documented rollback owner.

Record approvals without attaching secrets or key material:

| Reviewer role | Required decision | Status |
|---|---|---|
| Security reviewer | Approve threat model, cryptographic envelope and residual risks | Pending |
| Platform/operations owner | Approve custody, permissions, deployment and recovery responsibilities | Pending |
| Data owner | Approve tenant/guest scope, backup and deletion semantics | Pending |
| PT-02 owner | Confirm journal/snapshot restore and recovery compatibility | Pending |
| Product/authorization owner | Confirm guest projection and revocation contract | Pending |

**Implementation remains blocked** until the required decisions are explicitly accepted and referenced by #549. This review packet does not provision keys, change production secrets, migrate encrypted records, or enable PT-05 tenant financial writes.
