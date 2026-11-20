import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  createTenantKeyRecord,
  decryptTenantRecord,
  encryptTenantRecord,
  isTenantKmsConfigured,
  rewrapTenantDek,
  resetTenantKeyServiceCacheForTests
} from "./tenant-key-service.js";

const KMS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const NEXT_KMS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/22222222-2222-2222-2222-222222222222";

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function pem(label, bytes) {
  const encoded = toBase64(bytes);
  const lines = encoded.match(/.{1,64}/g).join("\n");
  return "-----BEGIN " + label + "-----\n" + lines + "\n-----END " + label + "-----";
}

async function makeConfiguration() {
  const pair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const privateDer = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  // Minimal DER structure for a test certificate whose TBS serial is 0x01020304.
  // Roles Anywhere validates the real X.509 chain; this unit test only exercises
  // the request-signing and certificate-serial extraction boundaries.
  const certificateDer = new Uint8Array([
    0x30, 0x08, 0x30, 0x06, 0x02, 0x04, 0x01, 0x02, 0x03, 0x04
  ]);
  return {
    AWS_KMS_REGION: "us-east-1",
    AWS_KMS_KEY_ARN: KMS_KEY_ARN,
    AWS_ROLESANYWHERE_CERTIFICATE: pem("CERTIFICATE", certificateDer),
    AWS_ROLESANYWHERE_PRIVATE_KEY: pem("PRIVATE KEY", privateDer),
    AWS_ROLESANYWHERE_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:123456789012:profile/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    AWS_ROLESANYWHERE_ROLE_ARN: "arn:aws:iam::123456789012:role/PortfolioTerminalKms",
    AWS_ROLESANYWHERE_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeAwsMock({ dataKey = new Uint8Array(32).fill(0x5a) } = {}) {
  const calls = [];
  const fetchMock = vi.fn(async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, method: init?.method, headers, body });

    if (url.includes("rolesanywhere.")) {
      return response({
        credentials: {
          accessKeyId: "ASIAEXAMPLEACCESSKEY",
          secretAccessKey: "temporary-secret-access-key",
          sessionToken: "temporary-session-token",
          expiration: new Date(Date.now() + 20 * 60 * 1000).toISOString()
        }
      }, 201);
    }

    const target = headers.get("X-Amz-Target");
    if (target === "TrentService.GenerateDataKeyWithoutPlaintext") {
      return response({
        CiphertextBlob: toBase64(new Uint8Array([1, 2, 3, 4, 5, 6])),
        KeyId: KMS_KEY_ARN
      });
    }
    if (target === "TrentService.Decrypt") {
      return response({ Plaintext: toBase64(dataKey), KeyId: KMS_KEY_ARN });
    }
    if (target === "TrentService.ReEncrypt") {
      return response({
        CiphertextBlob: toBase64(new Uint8Array([6, 5, 4, 3, 2, 1])),
        SourceKeyId: KMS_KEY_ARN,
        KeyId: NEXT_KMS_KEY_ARN
      });
    }
    return response({ message: "unexpected operation" }, 400);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("AWS KMS tenant key service", () => {
  afterEach(() => {
    resetTenantKeyServiceCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires a complete Roles Anywhere and KMS configuration", async () => {
    const env = await makeConfiguration();
    expect(isTenantKmsConfigured({})).toBe(false);
    expect(isTenantKmsConfigured(env)).toBe(true);
    expect(() => isTenantKmsConfigured({ AWS_KMS_REGION: "us-east-1" })).toThrow();
  });

  it("uses certificate-backed temporary credentials and stores only a wrapped DEK", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const env = await makeConfiguration();
    const { calls } = makeAwsMock();
    const record = await createTenantKeyRecord(env, "tenant-example-0001", "2026-11-20T00:00:00.000Z");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://rolesanywhere.us-east-1.amazonaws.com/sessions");
    expect(calls[0].headers.get("Authorization")).toContain(
      "AWS4-X509-RSA-SHA256 Credential=16909060/"
    );
    expect(calls[0].headers.get("X-Amz-X509")).toBeTruthy();
    expect(calls[0].body.durationSeconds).toBe(900);

    expect(calls[1].headers.get("Authorization")).toContain(
      "AWS4-HMAC-SHA256 Credential=ASIAEXAMPLEACCESSKEY/"
    );
    expect(calls[1].headers.get("X-Amz-Security-Token")).toBe("temporary-session-token");
    expect(calls[1].headers.get("X-Amz-Target")).toBe(
      "TrentService.GenerateDataKeyWithoutPlaintext"
    );
    expect(calls[1].body.KeySpec).toBe("AES_256");
    expect(calls[1].body.EncryptionContext).toMatchObject({
      Application: "portfolio-terminal",
      Purpose: "tenant-dek",
      KeyId: record.keyId,
      KeyVersion: "1"
    });
    expect(calls[1].body.EncryptionContext.TenantBinding).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[1].body.EncryptionContext).not.toHaveProperty("tenantId");
    expect(record).toMatchObject({
      provider: "aws-kms",
      status: "active",
      tenantId: "tenant-example-0001",
      keyVersion: 1,
      kmsKeyArn: KMS_KEY_ARN,
      wrappedDek: toBase64(new Uint8Array([1, 2, 3, 4, 5, 6]))
    });
    expect(JSON.stringify(record)).not.toContain("temporary-secret-access-key");
    expect(JSON.stringify(record)).not.toContain("5a".repeat(32));
  });

  it("encrypts and decrypts server-side with tenant/resource AAD and never returns the DEK", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const env = await makeConfiguration();
    const { calls } = makeAwsMock();
    const keyRecord = await createTenantKeyRecord(env, "tenant-example-0002");
    const context = {
      tenantId: "tenant-example-0002",
      workspaceId: "workspace-example-0001",
      portfolioId: "portfolio-example-0001",
      recordType: "snapshot"
    };
    const plaintext = "synthetic portfolio snapshot";
    const envelope = await encryptTenantRecord({ env, keyRecord, context, plaintext });
    const decrypted = await decryptTenantRecord({ env, keyRecord, context, envelope });

    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    expect(envelope).toMatchObject({
      envelopeVersion: 1,
      algorithm: "AES-256-GCM",
      keyId: keyRecord.keyId,
      keyVersion: 1
    });
    expect(calls.filter((call) =>
      call.headers.get("X-Amz-Target") === "TrentService.Decrypt"
    )).toHaveLength(2);

    await expect(decryptTenantRecord({
      env,
      keyRecord,
      context: { ...context, portfolioId: "portfolio-example-0002" },
      envelope
    })).rejects.toMatchObject({ code: "tenant_key_authentication_failed" });

    const tampered = { ...envelope, ciphertext: toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])) };
    await expect(decryptTenantRecord({ env, keyRecord, context, envelope: tampered }))
      .rejects.toMatchObject({ code: "tenant_key_authentication_failed" });
  });

  it("re-wraps an existing DEK with a destination KMS key while preserving tenant context", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const env = await makeConfiguration();
    const { calls } = makeAwsMock();
    const keyRecord = await createTenantKeyRecord(env, "tenant-example-0003");
    const rewrapped = await rewrapTenantDek(env, keyRecord, NEXT_KMS_KEY_ARN);
    const reencryptCall = calls.find((call) =>
      call.headers.get("X-Amz-Target") === "TrentService.ReEncrypt"
    );

    expect(rewrapped.kmsKeyArn).toBe(NEXT_KMS_KEY_ARN);
    expect(rewrapped.wrappedDek).toBe(toBase64(new Uint8Array([6, 5, 4, 3, 2, 1])));
    expect(reencryptCall.body.SourceEncryptionContext)
      .toEqual(reencryptCall.body.DestinationEncryptionContext);
    expect(reencryptCall.body.SourceEncryptionContext.TenantBinding).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when the KMS provider rejects the request without exposing provider details", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const env = await makeConfiguration();
    const { fetchMock } = makeAwsMock();
    fetchMock.mockImplementationOnce(async () => response({ credentials: {} }, 403));
    await expect(createTenantKeyRecord(env, "tenant-example-0004")).rejects.toMatchObject({
      code: "kms_credentials_rejected",
      status: 503
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
