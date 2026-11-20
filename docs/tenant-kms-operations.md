# Tenant KMS operations

**Status:** Implemented backend foundation; production AWS configuration and tenant financial-data use are not verified or enabled.

This runbook configures the managed key-custody integration selected by the [PT-16 tenant key lifecycle ADR](pt16-tenant-key-lifecycle-adr.md). It does not authorize a financial-data migration or independent tenant writes.

## 1. Runtime design

- AWS KMS holds the platform key-encryption key (KEK), a symmetric ENCRYPT_DECRYPT key.
- AWS IAM Roles Anywhere exchanges a certificate-bound RSA signature for temporary AWS credentials. The Worker requests a 15-minute session and caches credentials only in isolate memory until shortly before expiry.
- KMS creates a random 256-bit tenant data-encryption key (DEK) with GenerateDataKeyWithoutPlaintext. Only the KMS-wrapped DEK is persisted.
- Server-side AES-256-GCM helpers unwrap the DEK transiently, encrypt/decrypt the payload, and bind tenant, workspace, portfolio, record type, key ID and key version as authenticated additional data.
- The browser receives only opaque key metadata from the provisioning endpoint. It never receives the wrapped DEK, plaintext DEK, AWS credentials or certificate private key.
- The legacy shared-workspace key and existing AES-GCM v2 record format are not changed by this integration.

The integration is fail-closed. If required configuration is missing, malformed or rejected by AWS, key provisioning and key operations fail with a generic service error. Provider error details, certificate contents, credentials, key material and financial payloads are not returned to clients.

## 2. AWS resources

Create these resources in one AWS partition and KMS / Roles Anywhere region:

1. A symmetric AWS KMS key with key usage ENCRYPT_DECRYPT. Record its full key ARN. Keep key deletion protection and key-administrator separation enabled according to the organization's AWS policy.
2. An X.509 v3 RSA certificate for the Worker workload, issued by a CA configured as an IAM Roles Anywhere trust anchor. Keep the leaf certificate and matching unencrypted PKCS#8 RSA private key. Include intermediate certificates in PEM form if required by the trust configuration. The certificate and private key must match; AWS validates the certificate chain and signature.
3. An IAM Roles Anywhere trust anchor for the issuing CA.
4. An IAM Roles Anywhere profile that allows the dedicated workload role.
5. A dedicated IAM role whose trust policy permits the rolesanywhere.amazonaws.com service principal to call sts:AssumeRole, sts:TagSession and sts:SetSourceIdentity, scoped to the intended trust anchor/profile and certificate identity conditions.

The role needs only these KMS actions on the designated KMS key(s):

- kms:GenerateDataKeyWithoutPlaintext
- kms:Decrypt
- kms:ReEncryptFrom
- kms:ReEncryptTo

Grant these permissions in both the IAM role policy and KMS key policy as required by the selected same-account or cross-account setup. Do not grant broad kms:* , key administration, key deletion, or unrelated data-plane permissions to the runtime role. The application currently uses GenerateDataKeyWithoutPlaintext, Decrypt, and includes a re-wrap helper using ReEncrypt.

The IAM Roles Anywhere trust policy and KMS key policy are security-critical. Have an AWS/IAM owner review them before installing credentials. Use certificate subject/issuer/SAN conditions and a dedicated role where practical. Never reuse a developer workstation certificate.

## 3. Cloudflare Worker secrets

Install the following values as Worker secrets for the production Worker. Do not commit values to wrangler.jsonc, repository variables, CI logs, issue comments or this runbook.

| Secret name | Value |
|---|---|
| AWS_KMS_REGION | AWS region containing the KMS key and Roles Anywhere profile |
| AWS_KMS_KEY_ARN | Full symmetric KMS key ARN |
| AWS_ROLESANYWHERE_CERTIFICATE | PEM-encoded v3 RSA leaf certificate |
| AWS_ROLESANYWHERE_PRIVATE_KEY | Matching unencrypted PKCS#8 RSA private key PEM |
| AWS_ROLESANYWHERE_PROFILE_ARN | Full IAM Roles Anywhere profile ARN |
| AWS_ROLESANYWHERE_ROLE_ARN | Full IAM role ARN assumed by the profile |
| AWS_ROLESANYWHERE_TRUST_ANCHOR_ARN | Full IAM Roles Anywhere trust anchor ARN |
| AWS_ROLESANYWHERE_CERTIFICATE_CHAIN | Optional PEM-encoded intermediate chain; omit if the leaf certificate chains successfully without it |

Use wrangler secret put SECRET_NAME separately for each value, then paste the value into the interactive prompt. Do not put secrets on the command line, in shell history or in CI workflow YAML. Restrict who can update Worker secrets and who can deploy main.

The current implementation supports RSA PKCS#8 private keys for Roles Anywhere. It does not support encrypted PEM private keys, PKCS#1 private-key PEM, EC signing keys, or ML-DSA signing keys. Rotate the certificate/private key as a matched pair and update the Worker secrets as a controlled operational change.

## 4. Provisioning API

After the AWS resources and Worker secrets are installed, an authenticated active tenant owner can request provisioning:

POST /api/tenants/{tenantId}/key/provision

Headers:

- Authorization: Bearer <active account session>
- Content-Type: application/json

Body: an empty JSON object.

The Worker allowlist admits only this exact route shape. The Durable Object rechecks the active session and tenant owner membership/capability against the canonical tenant directory. A caller-supplied tenant ID is only a selector; it is never proof of authorization. The endpoint rejects additional body fields.

A first successful request returns 201; an already-provisioned tenant returns 200. Both return only provider, custody, encryption mode, status, opaque key ID and version, plus financialDataEnabled: false.

The wrapped DEK is stored under a tenant-scoped Durable Object storage key, with an active pointer and an audit event committed in one storage transaction. A short-lived provisioning reservation prevents concurrent provisioning. Existing inconsistent metadata is not overwritten; it fails closed and requires recovery.

When KMS is not configured, the owner receives 503 and no tenant key record or active pointer is written. Unauthorized users receive a not-found response without learning KMS configuration state.

## 5. Verification and operational checks

The repository test suite includes:

- configuration completeness and ARN validation;
- certificate-backed Roles Anywhere request signing and temporary-credential handling;
- KMS GenerateDataKeyWithoutPlaintext, Decrypt, and ReEncrypt request contracts;
- wrapped-DEK-only persistence;
- AES-256-GCM round-trip, tamper detection and wrong-resource AAD rejection;
- tenant-owner authorization, guest denial, missing-provider fail-closed behavior and rejection of client-supplied key material.

The production Worker workflow runs worker.test.js, user-auth.test.js and tenant-key-service.test.js, then performs typecheck, dependency audits and Wrangler dry-run before deployment. A successful mocked unit test does not prove AWS account policies, certificate trust, live KMS permissions, Cloudflare secret installation or production key provisioning.

After secret installation, use a synthetic tenant and synthetic payload only. Confirm a 201 first provision and 200 idempotent retry, verify the DO contains only a wrapped DEK and metadata, and verify AWS CloudTrail records the expected KMS operations. Do not use live financial data for initial validation.

## 6. Current limits and activation gates

The following are deliberately not enabled by this change:

- Tenant financial snapshot, history, digest, projection, backup or restore paths do not yet call the new encryption/decryption helpers.
- Existing shared-workspace AES-GCM v2 records are not migrated or re-encrypted.
- No client receives a tenant DEK, wrapped key or KMS credentials.
- Guest projection-specific keys and guest projection encryption are not implemented.
- DEK rotation, KEK rotation orchestration, revocation, key recovery, backup/restore rehearsal and cryptographic deletion are not exposed as operational APIs. A low-level ReEncrypt helper is present but is not a complete rotation workflow.
- Tenant financial writes remain disabled until PT-02 mutation/journal acceptance, PT-05 object-level authorization and isolation tests, PT-16 migration/recovery review and explicit release approval pass.

Do not enable tenant data access by changing a feature flag or adding a client route alone. The server must resolve canonical resource scope, authorize every read/write/stream/export, and use the tenant key envelope before any financial record can be committed.

## 7. Incident and recovery notes

- If Roles Anywhere or KMS is unavailable, key operations fail closed. Do not fall back to the shared workspace key or silently treat tenant records as plaintext.
- If a tenant key record or active pointer is malformed or inconsistent, do not replace it automatically. Preserve the existing storage state and perform an audited recovery using the wrapped key and matching ciphertext metadata.
- If the certificate is suspected compromised, disable/revoke its trust path and remove the Worker secret. Then issue a replacement certificate and review active temporary credential expiry. Certificate rotation alone does not re-encrypt tenant data.
- If the KMS key is disabled, scheduled for deletion, or unavailable, do not delete wrapped DEKs or ciphertext. Restore KMS availability under the approved recovery process first.
- Keep CloudTrail and Cloudflare operational evidence free of private keys, temporary AWS credentials, plaintext DEKs and portfolio payloads.
