# PT-16 — Tenant key ownership and versioned lifecycle

**Status:** AWS KMS + IAM Roles Anywhere selected for a gated server-mediated implementation; production activation and tenant financial-data use remain blocked pending AWS account configuration, security review, and PT-02/PT-05 acceptance.  
**Tracking:** [#549 — tenant-aware DEK/KEK design](https://github.com/armave/portfolio-terminal/issues/549), parent [#546 — PT-16 security lifecycle](https://github.com/armave/portfolio-terminal/issues/546), dependency [#539 — PT-05 tenancy](https://github.com/armave/portfolio-terminal/issues/539).  
**Scope:** Backend key-custody foundation and provisioning only. No production credentials are committed, no existing financial records are migrated, and no tenant financial-data read/write path is enabled.

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

- **Platform KEK:** A dedicated symmetric AWS KMS key. The Worker authenticates through AWS IAM Roles Anywhere using a v3 RSA X.509 certificate and a PKCS#8 private key held as Worker secrets. AWS issues 15-minute temporary credentials; no long-lived AWS access key is stored.
- **Tenant DEK:** A cryptographically random 256-bit key created with `GenerateDataKeyWithoutPlaintext`. Only the KMS-wrapped DEK is persisted. The Worker unwraps it transiently for server-side AES-256-GCM operations and never returns it to the browser.
- **Optional scoped projection key:** A separate key/envelope for guest projections or narrowly shared records where the guest must not receive the tenant's full DEK. A guest grant must not implicitly reveal the tenant-wide key.
- **Device key:** Remains device-local and serves only its existing browser-secret-storage purpose. It does not replace the tenant DEK or KEK.

Each DEK is stored at rest only as a wrapped envelope. Key metadata is stored with the canonical tenant record in the trusted identity/directory authority; it is not accepted from a client as an authority source.

### Unwrap boundary

The public Worker authenticates the session, resolves the canonical tenant/resource from the trusted directory and authorizes the requested action before any key operation. The trusted Worker/key-service boundary is the only component permitted to unwrap the platform KEK or retrieve an unwrapped tenant DEK.

The selected implementation is **server-mediated encryption**. The Worker resolves the canonical tenant and authorizes the owner before provisioning or using a key. The browser receives neither the wrapped DEK nor the plaintext DEK. Plaintext data and the unwrapped DEK exist transiently inside the trusted Worker/DO boundary only. This changes the target tenant-data encryption boundary from the existing client-side shared-key model; the legacy workspace path remains unchanged until a separately approved migration.

This is **not zero-knowledge encryption**: the Worker processes plaintext and therefore becomes part of the trusted computing boundary. Guest projection keys and projection encryption are not yet implemented; no guest is allowed to use the tenant-wide key.

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

## 8. Required validation before tenant data-plane activation

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

## 9. Implementation record

The backend foundation is implemented in `tenant-key-service.js` and `state-store.js`:

- AWS IAM Roles Anywhere `CreateSession` uses a certificate-bound RSA signature and caches only temporary 15-minute AWS credentials in Worker memory.
- AWS KMS `GenerateDataKeyWithoutPlaintext`, `Decrypt`, and `ReEncrypt` are supported. Tenant IDs are hashed in the KMS encryption context; key ID and key version are also bound.
- AES-256-GCM envelopes bind tenant, workspace, portfolio, record type, key ID and version through authenticated additional data.
- `POST /api/tenants/:tenantId/key/provision` is owner-authorized server-side, idempotent, transactionally persists the wrapped DEK and active pointer, and writes an audit event. It returns only opaque key metadata.
- The Worker route allowlist explicitly includes the provisioning route. Missing or incomplete KMS configuration fails closed.

This is a **key-custody and provisioning foundation**, not a tenant financial data plane. The encryption/decryption helpers are not yet wired into portfolio snapshots, history, digests, projections, backups or migration. No production AWS configuration is included in source control. The endpoint remains unavailable until an operator provisions the AWS resources and Worker secrets described in [Tenant KMS operations](tenant-kms-operations.md).

## 10. Approval gates and open decisions

Before implementing the full tenant data plane or enabling #557:

1. Approve the AWS account, KMS key policy, IAM Roles Anywhere trust policy, certificate lifecycle, KEK custody/rotation owner and outage/recovery procedure.
2. Review and accept the server-mediated plaintext trust boundary; browser DEK delivery is not part of the selected design.
3. Approve separate projection-key semantics for guest access.
4. Approve the envelope/AAD contract, version compatibility and cryptographic usage limits.
5. Complete PT-02 mutation/recovery acceptance and PT-05 server authorization design.
6. Rehearse key-backed backup/restore and rollback using synthetic, non-sensitive data.
7. Obtain security review and record the accepted decision and tested SHAs.

**No production key migration, independent tenant financial writes, or tenant cutover is authorized by this proposal.**

## 11. Decision alternatives and explicit trade-offs

This section records remaining trade-offs for [#549](https://github.com/armave/portfolio-terminal/issues/549). AWS KMS + IAM Roles Anywhere and server-mediated encryption are selected for the gated backend foundation; detailed operational controls and production acceptance remain subject to review.

### Key custody and cryptographic boundary

| Option | Security boundary | Benefits | Costs and residual risks | Decision required |
|---|---|---|---|---|
| Managed key service / KMS-backed KEK | AWS KMS protects the platform KEK; the Worker authenticates through IAM Roles Anywhere | Dedicated key custody, CloudTrail auditability and managed wrapping-key controls | Provider availability and account configuration become production dependencies; pricing, recovery, residency and access policy vary by region | Approve region, access policy, recovery owner and outage behavior |
| Worker-held KEK secret | A versioned secret is available to the production Worker runtime | Fewer external components and a simpler deployment boundary | Secret access is tied to Worker deployment/operations; custody, rotation, audit and recovery become operator responsibilities; no assumption of HSM-backed custody | Identify custodians, reviewer approvals, rotation cadence and emergency recovery process |
| Server-mediated data encryption | Browser sends validated plaintext to an authenticated Worker boundary; the server performs encryption/decryption | Tenant DEKs need not be returned to browser memory | The server processes plaintext; changes the current client-side encryption trust model and increases server responsibility, request size and availability coupling | Explicitly accept the new server trust boundary and prove logs, errors and operational tooling cannot expose plaintext |

AWS KMS with IAM Roles Anywhere is selected for the gated implementation. A Worker-held X.509 private key is a workload identity credential, not a substitute KEK; AWS KMS remains the wrapping authority. The integration must not be treated as production-ready until its account, permissions, certificate lifecycle and recovery path are verified.

### Where encryption and plaintext may exist

| Option | Browser access | Server access | Guest/projection implication |
|---|---|---|---|
| Short-lived scoped DEK grant (not selected) | An authorized client could observe the granted DEK while it is in memory | Lower server-side encryption work | Exposes tenant key material to the browser origin; guest would require a separate projection key |
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

**Tenant financial-data activation remains blocked** until the required operational and security decisions are explicitly accepted and referenced by #549. The backend foundation supports key provisioning, but no production AWS secrets are installed by this change; no existing records are migrated and no PT-05 tenant financial writes are enabled.
