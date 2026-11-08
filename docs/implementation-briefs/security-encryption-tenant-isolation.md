# Implementation brief — Security, encryption & portfolio isolation

Parent contract: `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
Branch: `impl/security-tenant-isolation` · Target: `plan/portfolio-integrity-reliability-2026-11-08` · Status: implementation scaffold

## Mission
Close the gap between client-side encryption and server-side enforcement, then establish server-enforced independent portfolio ownership and access isolation.

## Investigation
Threat-model login/session, owner/guest projection, API authorization, Worker routes, persistence keys, exports, backups, live updates and telemetry. Inventory legacy Margin Intelligence digest formats, migration paths and retention requirements. Identify every resource key depending on client-provided account/tenant/portfolio IDs. Determine revocation/expiry behavior and whether live subscriptions terminate when access is revoked.

## Client-branch requirements
- Remove any silent downgrade to plaintext for new/updated Margin Intelligence digests.
- Make migration state, failure and recovery actionable without revealing digest content.
- Implement/revise migration tooling and tests so migration is idempotent and resumable.
- Add client contracts that do not treat client-supplied tenant IDs as proof of authorization.
- Ensure UI, export and backup flows respect denied/revoked access and surface understandable localized errors.
- Add cross-account UI/service tests for denied access and stale sessions.
- Do not log secrets, tokens, raw account payloads or decrypted digests.

## Server/Worker companion requirements
Repository operating rule: server-side and Cloudflare Worker changes are committed and pushed directly to `main`, not included in this `dev` PR.
- Derive principal and authorized portfolio set from authenticated server-side session.
- Enforce ownership on every read, write, delete, export, backup, migration and live subscription route.
- Treat client-supplied portfolio/tenant IDs as selectors only; verify against server authorization.
- Add negative cross-tenant API, storage, export and websocket/live-stream tests.
- Implement strict encrypted-write enforcement only after migration evidence demonstrates all supported active records are migrated or intentionally retired.
- After enforcement, reject plaintext writes. Do not restore plaintext writes as a rollback path; preserve read access through a safe migration/compatibility strategy.
- Ensure revoked sessions cannot continue protected requests or live updates.
- Add security-header, origin/CSRF, rate-limit and secret-redaction checks appropriate to the current Worker design.
- Record exact production commit SHA, Worker test results, deployment smoke and rollback evidence in this child PR.

## Required tests
Each legacy format; already-encrypted record; rerun; partial migration; invalid/corrupt payload; missing key; interrupted write; denied write; plaintext-write rejection; ciphertext round-trip; tenant A cannot read/mutate/export/restore/subscribe to tenant B; guest restrictions; expiry/revocation; no secrets in logs.

## Acceptance
- [ ] Legacy record inventory and migration/deletion policy approved.
- [ ] Migration is idempotent, resumable and observable.
- [ ] No silent plaintext write fallback.
- [ ] Worker derives and enforces server-side portfolio authorization.
- [ ] Cross-tenant negative tests cover all data surfaces.
- [ ] Revocation, origin/CSRF and security-header tests pass.
- [ ] Direct-to-main Worker/server SHA and production verification recorded.
- [ ] Client Vitest, typecheck, lint, build, browser smoke and i18n checks pass.

## Rollout warning
Do not enable strict encryption or change owner/guest semantics until migration inventory and authorization fixtures are proven. Protect existing users' read access throughout migration.