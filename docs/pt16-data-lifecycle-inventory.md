# PT-16 — Data lifecycle, retention and AI privacy inventory

**Status:** Code-informed inventory and proposed control requirements; retention periods and deletion policy are not yet approved.  
**Tracking:** [#551 — data retention, export/deletion and AI privacy](https://github.com/armave/portfolio-terminal/issues/551), parent [#546 — PT-16 security lifecycle](https://github.com/armave/portfolio-terminal/issues/546), related [#560 — telemetry and log redaction](https://github.com/armave/portfolio-terminal/issues/560).

## 1. Purpose and limits

This inventory identifies the main portfolio, identity, broker, analysis and recovery data surfaces evidenced by the repository documentation and current implementation. It is not a legal retention schedule, privacy notice, deletion certification or penetration-test report.

No retention duration is invented here. Where the repository does not define retention or complete deletion behavior, the status is explicitly recorded as **not specified / requires owner decision**.

## 2. Data classification

| Class | Examples | Default handling requirement |
|---|---|---|
| Financial records | Positions, tranches/lots, cash, debt, fees, closed trades, transaction events, cashflows | Confidential; integrity and recovery are critical |
| Broker facts | Executions, balances, positions, orders, provider references and timestamps | Confidential; preserve source and freshness provenance |
| Identity/session | Account names, password hashes, session records, role and grant metadata | Restricted; server-side authorization and revocation |
| Credentials/key material | Gateway/session secret, API keys, broker credentials, encryption keys | Secret; never log or export in plaintext |
| Investment analysis | Margin Intelligence digests, portfolio context, news/article selections | Confidential; minimize provider disclosure |
| Market data | Quotes, history, events, source and freshness metadata | Public or licensed data mixed with portfolio-linked observations |
| Recovery artifacts | JSON backups, encrypted cloud snapshots/history, optional Gist copies | Confidential; integrity, access and deletion scope must be explicit |
| Operational diagnostics | Error categories, request outcomes, durations and release IDs | Minimize; no identity or investment payload by default |

## 3. Observed data-surface inventory

| Surface | Data/representation evidenced | Current lifecycle observations | Open policy or verification requirement |
|---|---|---|---|
| Browser portfolio store | Canonical portfolio snapshot, positions, cash/holdings, closed history and related metadata | Stored through the portfolio storage service; reset clears portfolio-owned fields | Define local retention, explicit delete versus reset, browser-profile loss and device cleanup |
| Browser session/secret storage | Gateway/session secret protected with a non-extractable IndexedDB device key where supported | README documents re-authentication when site data or the device key is lost | Define session revocation and deletion behavior across all browser storage namespaces |
| Browser provider preferences | Provider API keys in localStorage; Gemini key in sessionStorage | README documents browser-side storage and optional Gist synchronization | Inventory each key, permission scope, revocation instructions and account-switch cleanup |
| Cloud portfolio snapshots | AES-GCM v2 encrypted payloads, optimistic revision/ETag checks | Worker/DO store encrypted snapshot payloads and reject stale writes | Define record retention, backup replicas, account deletion and restore-window semantics |
| Cloud history | Separate encrypted history sidecar / history storage path | History sync and quota-reliability controls exist | Define whether history is deleted with the workspace, retained for audit, or expires with an account |
| Guest projections | Server-filtered, encrypted, account-scoped projection and assignment history | Guests receive read-only projections; current roles are admin and guest | Define projection expiry, grant revocation, historical projection retention and deletion |
| Margin Intelligence digests | AES-GCM v2 encrypted digest envelope; encrypted-only Worker writes are configured | Production enforcement is deployed; [#548](https://github.com/armave/portfolio-terminal/issues/548) still tracks post-deploy protocol smoke and inventory evidence | Define digest expiry, deletion across client/cloud copies and retained AI/provider data |
| Broker data and credentials | TradeNet credentials are Worker secrets; short-lived SID is held in Worker/DO memory; sanitized broker facts are returned | Broker integration is read-only; session material is not intended for browser exposure | Define secret rotation, provider disconnect, cached-data expiry and data deletion |
| Market-data caches | Quotes, historical responses, company news and provider metadata | Client/Worker request caches and provider cooldowns have bounded behavior | Record provider/license retention limits and whether portfolio-linked history has a separate expiry |
| JSON export/import | Structured backup containing financial snapshot and supported history/journal fields | Import validates shape and commits atomically; backups can contain highly sensitive data | Define encryption-at-rest expectations, storage advice, export completeness and user deletion of copies |
| Optional GitHub Gist | Auxiliary encrypted provider-key file; README says Gemini key and GitHub PAT are not stored in the Gist payload | User-configured external copy; encryption depends on the user's Gemini key | Define disconnect/delete semantics and disclose that copies outside the app require separate removal |
| AI prompts/results | Investment context and user-selected research sent to Gemini through the AI path | AI output is not the financial calculation authority; consequential mutations require app confirmation | Inventory exact prompt fields, provider processing/disclosure, minimization, user controls and retention |
| Logs/telemetry | Provider metrics, route/error categories and some remaining raw error-message paths | Partial sanitization exists; #560 tracks full inventory and redaction | Approve field allowlist, retention, access, sampling and captured-log tests |

## 4. Reset is not equivalent to deletion

The current portfolio reset boundary clears portfolio-owned snapshot/history sidecars while retaining account/device configuration and the append-only transaction journal, and appends a portfolio reset marker. This behavior is important for audit/recovery integrity; it must not be presented as complete personal-data deletion.

A future deletion feature must explicitly distinguish:

1. Resetting the active portfolio while preserving audit history.
2. Removing a guest grant/projection.
3. Deleting an account and revoking its sessions.
4. Deleting a workspace/tenant and all associated records.
5. Deleting optional external Gist copies.
6. Expiring or removing backup replicas and exported copies.
7. Cryptographic erasure of all recoverable key material.

These operations may have different authorization, retention and recovery requirements. Do not silently repurpose the current reset operation as a destructive account/tenant deletion.

## 5. Retention policy decisions required

For each record class and storage surface, the data owner and privacy/security reviewer must approve:

- purpose and lawful/product basis for collection;
- active-record retention duration;
- audit-record retention duration;
- backup/replica expiry and restore window;
- access roles and support/break-glass access;
- export inclusion and format;
- deletion trigger, completion evidence and exceptions;
- treatment of third-party providers and user-managed external copies;
- legal hold or dispute requirements, if applicable;
- whether the record is deleted, anonymized, cryptographically erased or retained with a documented purpose.

Until those decisions are approved, do not claim a retention schedule or complete deletion capability.

## 6. Export and deletion contract

The implementation contract should make export and deletion explicit and separately testable.

### Export

- Export every supported user-owned financial record needed to restore the accepted canonical snapshot and journal lineage.
- Preserve schema/envelope versions, transaction IDs, idempotency identity, lot lineage, corporate-action evidence, linked closed-history corrections, cashflows, revisions and provenance where supported.
- Exclude credentials, session tokens, plaintext encryption keys and Worker secrets.
- Identify records that cannot be exported or restored without an external provider or separately retained key.
- Label the export with schema version and generated timestamp; do not imply that a local JSON file is encrypted unless it actually is.

### Deletion

- Authorize deletion on the server using canonical ownership and explicit capability checks.
- Revoke sessions and grants before removing or invalidating access.
- Enumerate the records, history, digests, projections, caches and wrapped-key metadata in scope.
- Apply deletion to active storage and supported replicas; return a per-surface result rather than a single misleading success flag.
- Document backup expiry, user-created exports and external Gist copies that cannot be deleted by the service.
- Preserve audit/legal records only under an approved retention exception with limited access.
- Keep operations resumable and idempotent; a partial failure must be visible and retryable.

## 7. AI privacy and untrusted content

- Build prompts from the minimum fields required for the requested analysis. Omit unrelated credentials, session information, user identifiers, private account metadata and irrelevant financial history.
- Keep deterministic financial calculations in the domain engine; AI output must not override portfolio state or authorize writes.
- Treat news/article text, provider descriptions, imported documents and quoted user content as untrusted data, not system instructions.
- Tests must prove a prompt-injection string in an article cannot change system policy, grant permissions, call financial mutation commands or bypass explicit user confirmation.
- Clearly disclose external AI processing and provide user control over which financial context is sent.
- Avoid storing prompts or generated analysis longer than the feature requires unless a reviewed retention purpose is documented.
- Capture test prompts at the boundary and assert that forbidden fields and secrets are absent.

## 8. Required privacy and lifecycle tests

| Test group | Required assertion |
|---|---|
| Storage inventory | Every persisted namespace has an owner, data class and deletion behavior |
| Account switch/logout | Previous-account cached financial data and key grants are not exposed to the next account |
| Reset | Audit journal retention remains distinct from personal-data deletion |
| Account/tenant deletion | Sessions, grants, snapshots, histories, digests and projections are covered |
| Export | Canonical snapshot and supported journal lineage restore without credentials or plaintext keys |
| Gist | External-copy behavior and removal instructions are explicit |
| AI | Minimum required context only; prompt injection cannot authorize financial actions |
| Logs | Captured success/error/auth/provider paths contain no tokens, full URLs, raw payloads or financial snapshots |
| Partial failure | Deletion/export reports per-surface failures and can resume without hiding incomplete work |

## 9. Approval and implementation order

1. Complete the inventory and assign a data owner to each surface.
2. Approve purpose, retention, export and deletion semantics per surface.
3. Align the tenant key lifecycle with [the PT-16 tenant-key ADR](pt16-tenant-key-lifecycle-adr.md).
4. Implement a server-authorized deletion/export contract with idempotent, auditable operations.
5. Add AI minimization and prompt-injection regression tests.
6. Complete log-field allowlisting and captured-log tests under #560.
7. Verify exact-head CI and obtain security/privacy review before enabling new collection or deletion behavior.

**This document records an inventory and proposed contract. It does not claim that a global retention schedule, account deletion workflow or cryptographic-erasure capability is implemented or approved.**
