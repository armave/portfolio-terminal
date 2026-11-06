# PT-16 — Security, privacy, and data-lifecycle threat model

**Status:** Initial code-informed threat model; not a penetration test or formal security certification.  
**Related work:** [Umbrella roadmap PR #347](https://github.com/armave/portfolio-terminal/pull/347) · [PT-16 issue #344](https://github.com/armave/portfolio-terminal/issues/344)

## 1. Scope and security objectives

Protect portfolio confidentiality, financial-data integrity, account credentials, broker credentials, AI context, and the availability of account/session services. Prevent cross-account access, accidental disclosure through persistence or telemetry, unauthorized financial mutations, and loss of data during recovery or account lifecycle events.

This review is based on the repository source and documentation inspected for PT-16. It records observed controls and residual questions; it does not establish that the application has passed a penetration test or production security review.

## 2. Assets

| Asset | Examples | Primary security objective |
|---|---|---|
| Portfolio records | Positions, cash, cost basis, closed trades, cashflows, margin history | Confidentiality, integrity, recoverability |
| Investment analysis | Margin Intelligence analysis, article headlines/URLs, position/portfolio context | Confidentiality and integrity |
| Identity and sessions | Account records, password hashes, access tokens, role and session indexes | Authentication, least privilege, revocation |
| Broker credentials | TradeNet login/password Worker secrets, ephemeral broker SID, provider credentials | Confidentiality and restricted use |
| Cloud encryption material | Shared workspace encryption key and encrypted snapshots | Confidentiality, key lifecycle, recovery |
| Local browser state | Device-encrypted Gateway/session secret, IndexedDB key, portfolio cache | Confidentiality on shared/lost devices, XSS resistance |
| AI context | Prompts and data sent to Gemini or other providers | Data minimization and informed disclosure |
| Recovery artifacts | Backups, imports, exports, optional Gist sync | Confidentiality, integrity, retention control |
| Administrative actions | User creation, role/password change, account deletion, guest assignment | Authorization and auditability |

## 3. Trust boundaries and actors

### Boundaries

1. **Browser runtime:** Preact application, in-memory credentials, localStorage, IndexedDB, imported backups, and browser extensions.
2. **Public Cloudflare Worker:** Origin policy, request limits, gateway/session verification, API routing, provider proxies, and role checks.
3. **PortfolioState Durable Object:** Account/session records, encrypted cloud snapshots, guest projections, revisions, and server-owned credentials/state.
4. **External providers:** Freedom TradeNet, market-data providers, Google Gemini, and optional GitHub Gist.
5. **GitHub/deployment pipeline:** Source changes, CI, Worker deployment, and configuration/secrets.

CORS is a browser access policy, not authentication. The Worker must continue to authenticate and authorize every protected request independently of its Origin header.

### Threat actors and failure modes

- Unauthenticated internet clients probing login, bootstrap, or protected API routes.
- A holder of a stolen, expired, revoked, or over-privileged session token.
- A malicious or compromised guest attempting to access another account's positions, history, orders, or shared workspace.
- Cross-origin websites attempting to invoke browser requests.
- XSS, compromised dependencies, browser extensions, or a compromised endpoint operating inside the trusted browser origin.
- Malicious or malformed provider responses, provider outages, and replayed/out-of-order events.
- Prompt injection or untrusted news/article text influencing AI-assisted workflows.
- Accidental operator disclosure through logs, support access, exports, or backups.
- Loss of encryption material or partial/corrupt recovery artifacts.

## 4. Existing controls observed in the repository

The following controls were present in the inspected code/documentation. Their presence is not a substitute for exact-head CI, deployed-configuration verification, or adversarial testing.

- Account passwords are stored as salted PBKDF2-HMAC-SHA256 hashes; the implementation uses six 100,000-iteration stages to stay within the Cloudflare Workers per-call limit.
- Session tokens are stored hashed by the Durable Object, expire after 30 days, have a per-user active-session cap, and are invalidated by logout and relevant password/role/account changes.
- Authentication edge routes use a Cloudflare rate-limit binding configured as required in `wrangler.jsonc`; the Durable Object also maintains a bounded login failure/rate-limit mechanism.
- The Worker checks configured browser origins, validates methods and request schemas, bounds request bodies, and applies role-specific route restrictions.
- Guest reads are served from server-filtered encrypted projections; guests do not receive administrator broker balances, orders, executions, or the shared owner workspace.
- Portfolio and closed-history cloud payloads use the application's AES-GCM v2 encryption path; legacy CryptoJS records remain supported for migration.
- The browser secret store uses a non-extractable device key in IndexedDB to encrypt the locally persisted Gateway/session secret; unavailable secure storage is surfaced rather than silently treating the secret as safely persisted.
- TradeNet login credentials are configured as Worker secrets; the short-lived broker SID is retained in Durable Object memory and is not intended to be persisted or returned to the client.
- The Worker sanitizes selected broker response fields before returning them and existing hardening work removed full decrypted portfolio objects from sync success logs.
- AI-interpreted financial mutations require explicit application confirmation; AI is not the financial calculation authority.
- Cloud writes use revision checks, request-size limits, and explicit conflict responses.

## 5. PT-16 finding addressed: plaintext synced Margin Intelligence digests

### Finding

Before this change, `/api/margin-digest` accepted a digest object containing fields such as `analysis`, `articles`, `title`, and `ticker`, and the Durable Object stored the submitted JSON directly. This bypassed the application's encrypted cloud-state envelope. Margin Intelligence content can reveal portfolio-specific analysis and securities of interest; storing that content as plaintext weakened the confidentiality boundary.

### Change in this workstream

- New clients encrypt the complete digest JSON with the existing `encryptCloudPayload` function (AES-GCM v2 and the existing shared workspace-key path).
- The request body now contains only `key` (the lookup identifier) and `encryptedPayload`; analysis, article headlines/URLs, and other digest content are not separate plaintext fields.
- The Durable Object validates the encrypted envelope shape and rejects additional plaintext fields beside the ciphertext.
- The client decrypts the envelope on read.
- Existing plaintext digest records remain readable during the rollout. The upgraded client attempts a compare-and-swap rewrite using the record's ETag/revision the first time it reads a legacy record. If the migration write fails or another device wins the revision race, the read remains available and a later read can retry.

### Rollout state and limitation

`MARGIN_DIGEST_ENCRYPTION_REQUIRED` is initially configured as `false` to preserve compatibility with already deployed clients. This means old clients can still write plaintext during the release/migration window. The durable target is to:

1. Deploy the encrypted client.
2. Observe that active users have read/migrated their existing digests.
3. Confirm no legacy clients are still writing plaintext.
4. Set `MARGIN_DIGEST_ENCRYPTION_REQUIRED=true` through a Worker deployment.
5. Verify the Worker rejects plaintext writes while encrypted writes, reads, and revision conflicts continue to work.

Do not mark the plaintext-at-rest migration complete until the enforcement flag is enabled and residual legacy records are handled. Existing records that are never opened by an upgraded client remain plaintext until an explicit migration or retention/deletion action is performed.

## 6. Residual risks and required follow-up

| Priority | Area | Observed state / question | Required follow-up |
|---|---|---|---|
| Critical before independent portfolios | Tenant isolation | Current administrator workspace is shared; guest projections are restricted read-only views, not independent editable tenants | Complete PT-05 ownership model, server-side object authorization, cross-tenant adversarial tests, and migration/recovery design before enabling independent portfolios |
| High | Workspace encryption key | A shared workspace key is returned to authenticated admin clients so those clients can encrypt/decrypt cloud data | Threat-model key rotation, recovery, device revocation, and future tenant-specific key derivation before multi-tenant GA |
| High | Browser/XSS exposure | Client-side credentials are available in application memory and local persistence; device encryption does not protect an active compromised origin | Define CSP/security headers and trusted-script policy; minimize third-party scripts/dependencies; add XSS and secret-exposure review |
| High | Provider credentials | README documents browser-managed provider keys and optional Gist sync behavior | Inventory every credential and sync path; prefer Worker-side secrets where feasible; document consent, revocation, and provider-specific exposure |
| High | AI privacy | Gemini prompts are sent to an external provider; prompt construction may include investment context | Add a data-classification/redaction policy, minimize transmitted fields, disclose provider processing, and test untrusted article/prompt injection |
| High | Data lifecycle | Backup/import/export, Gist sync, guest assignment records, cloud snapshots, and account deletion have distinct retention paths | Document retention and deletion by record type; implement verifiable export/delete/recovery workflows and audit their completion |
| Medium | Telemetry and errors | Some failure paths still pass raw Error objects/messages to console or terminal logging | Review every log boundary; replace raw errors with allowlisted categories and request correlation IDs; test that tokens, URLs, account identifiers, and payloads cannot leak |
| Medium | Browser security headers | The inspected `index.html` did not contain a Content-Security-Policy meta policy | Inspect Cloudflare Pages headers/configuration before deciding CSP; define a tested policy compatible with required Worker, Gemini, and market-data connections |
| Medium | Session lifetime | Existing sessions are finite but have a 30-day absolute lifetime and a five-session cap | Validate device-loss response, session inventory/revocation UX, and shorter configurable or risk-based policies where appropriate |
| Medium | AI and sharing grants | Current guest projections are scoped, but future shared report links and AI tools add new access paths | Reuse server-side authorization for every tool/report and test revocation/expiry and cross-account denial |

## 7. Abuse-case validation matrix

These tests must be kept in the automated suite or release checklist as applicable:

- Expired, revoked, malformed, oversized, and wrong-role tokens fail closed.
- A guest cannot access admin state/history/digest records, broker account/order routes, or another guest's assigned snapshot by changing identifiers.
- A new encrypted digest stores only the lookup key and authenticated ciphertext; analysis text and article metadata are absent from the stored JSON envelope.
- Enforced mode rejects plaintext digest writes and encrypted mode rejects extra plaintext fields alongside ciphertext.
- During compatibility mode, a legacy record can be read and upgraded with an ETag-guarded write; a concurrent write must not be overwritten.
- Malformed/tampered AES-GCM payloads fail decryption; no plaintext fallback is attempted for malformed ciphertext.
- A failed migration does not corrupt the legacy record or make the read path unavailable.
- AI tools cannot exceed the requesting user's portfolio scope and cannot mutate financial records without an explicit application confirmation.
- Logs and telemetry do not include credentials, session tokens, raw broker payloads, portfolio snapshots, or full request URLs.
- Backups restore only after schema and integrity validation; deletion and key revocation behavior are tested separately.

## 8. Release and verification requirements

For Worker/server-only changes, follow the repository deployment policy and commit directly to `main`. The Worker deployment workflow runs the Worker/auth test suites and dependency audit before deployment. Verify the workflow for the exact pushed commit; a source edit alone is not evidence of deployment.

For client changes, open a focused PR against `dev`. Preserve English/Russian localization and add Vitest coverage. Run the exact-head typecheck, full Vitest suite, dead-code validation, production dependency audit, and build; record browser and authenticated-broker smoke checks separately.

This threat model is a living artifact. Update the findings, mitigations, and verification evidence as PT-05 tenancy, PT-11 AI, PT-14 administration, and PT-16 security work proceeds.
