const encoder = new TextEncoder();
const MAX_TENANT_RECORD_BYTES = 20 * 1024 * 1024;
const AWS_SESSION_DURATION_SECONDS = 900;
const AWS_CREDENTIAL_REFRESH_SKEW_MS = 60_000;

let cachedCredentials = null;
let cachedSigningKey = null;

export class TenantKeyServiceError extends Error {
  constructor(code, status = 503) {
    super("Tenant key service is unavailable or rejected the operation.");
    this.name = "TenantKeyServiceError";
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, maxLength = 4096) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength && value.trim() === value;
}

function readConfiguration(env) {
  const values = {
    region: env?.AWS_KMS_REGION,
    keyArn: env?.AWS_KMS_KEY_ARN,
    certificate: env?.AWS_ROLESANYWHERE_CERTIFICATE,
    privateKey: env?.AWS_ROLESANYWHERE_PRIVATE_KEY,
    profileArn: env?.AWS_ROLESANYWHERE_PROFILE_ARN,
    roleArn: env?.AWS_ROLESANYWHERE_ROLE_ARN,
    trustAnchorArn: env?.AWS_ROLESANYWHERE_TRUST_ANCHOR_ARN,
    certificateChain: env?.AWS_ROLESANYWHERE_CERTIFICATE_CHAIN
  };
  const required = [
    values.region, values.keyArn, values.certificate, values.privateKey,
    values.profileArn, values.roleArn, values.trustAnchorArn
  ];
  if (required.every((value) => value === undefined || value === null || value === "")) {
    return null;
  }
  if (!required.every((value) => requiredString(value))) {
    throw new TenantKeyServiceError("kms_configuration_incomplete", 503);
  }
  if (!/^[a-z]{2}(?:-[a-z]+)?-[a-z]+-\d+$/.test(values.region)) {
    throw new TenantKeyServiceError("kms_configuration_invalid", 503);
  }

  const keyArnMatch = values.keyArn.match(
    /^arn:(aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):kms:([a-z0-9-]+):\d{12}:key\/[A-Za-z0-9-]+$/
  );
  const roleArnMatch = values.roleArn.match(
    /^arn:(aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/
  );
  const profileArnMatch = values.profileArn.match(
    /^arn:(aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):rolesanywhere:([a-z0-9-]+):\d{12}:profile\/[A-Za-z0-9-]+$/
  );
  const trustAnchorArnMatch = values.trustAnchorArn.match(
    /^arn:(aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):rolesanywhere:([a-z0-9-]+):\d{12}:trust-anchor\/[A-Za-z0-9-]+$/
  );
  if (!keyArnMatch || keyArnMatch[2] !== values.region ||
      !roleArnMatch || !profileArnMatch || !trustAnchorArnMatch ||
      profileArnMatch[2] !== values.region || trustAnchorArnMatch[2] !== values.region ||
      keyArnMatch[1] !== roleArnMatch[1] ||
      keyArnMatch[1] !== profileArnMatch[1] ||
      keyArnMatch[1] !== trustAnchorArnMatch[1]) {
    throw new TenantKeyServiceError("kms_configuration_invalid", 503);
  }
  if (values.certificateChain !== undefined &&
      !requiredString(values.certificateChain, 32_768)) {
    throw new TenantKeyServiceError("kms_configuration_invalid", 503);
  }
  return values;
}

export function isTenantKmsConfigured(env) {
  return readConfiguration(env) !== null;
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length === 0 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TenantKeyServiceError("kms_response_invalid", 503);
  }
  try {
    const binary = atob(value);
    if (btoa(binary) !== value) throw new Error("invalid base64");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TenantKeyServiceError("kms_response_invalid", 503);
  }
}

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function hex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

function awsTimestamp(date = new Date()) {
  const iso = date.toISOString();
  return {
    date: iso.slice(0, 10).replace(/-/g, ""),
    timestamp: iso.slice(0, 19).replace(/[-:T]/g, "") + "Z"
  };
}

function pemToDer(pem, label) {
  if (typeof pem !== "string" || pem.length > 32_768) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  const expression = new RegExp("-----BEGIN " + label + "-----([\\s\\S]+?)-----END " + label + "-----");
  const match = pem.match(expression);
  if (!match) throw new TenantKeyServiceError("kms_identity_invalid", 503);
  const encoded = match[1].replace(/\s+/g, "");
  return decodeBase64(encoded);
}

function readDerElement(bytes, offset) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset + 2 > bytes.length) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  const tag = bytes[offset];
  let cursor = offset + 1;
  let length = bytes[cursor++];
  if ((length & 0x80) !== 0) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || cursor + lengthBytes > bytes.length) {
      throw new TenantKeyServiceError("kms_identity_invalid", 503);
    }
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = length * 256 + bytes[cursor++];
    }
  }
  const end = cursor + length;
  if (end > bytes.length) throw new TenantKeyServiceError("kms_identity_invalid", 503);
  return { tag, valueStart: cursor, end, next: end };
}

function certificateSerialNumber(certificateDer) {
  const certificate = readDerElement(certificateDer, 0);
  if (certificate.tag !== 0x30 || certificate.next !== certificateDer.length) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  const tbs = readDerElement(certificateDer, certificate.valueStart);
  if (tbs.tag !== 0x30) throw new TenantKeyServiceError("kms_identity_invalid", 503);
  let cursor = tbs.valueStart;
  let element = readDerElement(certificateDer, cursor);
  if (element.tag === 0xa0) {
    cursor = element.next;
    element = readDerElement(certificateDer, cursor);
  }
  if (element.tag !== 0x02 || element.end <= element.valueStart ||
      element.end - element.valueStart > 20) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  let serialBytes = certificateDer.subarray(element.valueStart, element.end);
  while (serialBytes.length > 1 && serialBytes[0] === 0) {
    serialBytes = serialBytes.subarray(1);
  }
  let serial = 0n;
  for (const byte of serialBytes) serial = (serial << 8n) | BigInt(byte);
  if (serial <= 0n) throw new TenantKeyServiceError("kms_identity_invalid", 503);
  return serial.toString(10);
}

function certificateChainHeader(chainPem) {
  if (!chainPem) return null;
  const blocks = [...chainPem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)];
  if (blocks.length < 1 || blocks.length > 5) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  return blocks.map((block) => {
    const encoded = block[1].replace(/\s+/g, "");
    return encodeBase64(decodeBase64(encoded));
  }).join(",");
}

async function importRolesAnywhereSigningKey(configuration) {
  const cacheKey = configuration.privateKey;
  if (cachedSigningKey?.cacheKey === cacheKey) return cachedSigningKey.key;
  if (!configuration.privateKey.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new TenantKeyServiceError("kms_identity_invalid", 503);
  }
  const der = pemToDer(configuration.privateKey, "PRIVATE KEY");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cachedSigningKey = { cacheKey, key };
  return key;
}

function normalizeHeaders(entries) {
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => name + ":" + String(value).trim().replace(/\s+/g, " ") + "\n")
    .join("");
}

async function signedRolesAnywhereFetch(configuration) {
  const certificateDer = pemToDer(configuration.certificate, "CERTIFICATE");
  const certificate = encodeBase64(certificateDer);
  const serial = certificateSerialNumber(certificateDer);
  const chain = certificateChainHeader(configuration.certificateChain);
  const signingKey = await importRolesAnywhereSigningKey(configuration);
  const timestamp = awsTimestamp();
  const host = "rolesanywhere." + configuration.region + ".amazonaws.com" +
    (configuration.region.startsWith("cn-") ? ".cn" : "");
  const url = "https://" + host + "/sessions";
  const body = JSON.stringify({
    profileArn: configuration.profileArn,
    roleArn: configuration.roleArn,
    trustAnchorArn: configuration.trustAnchorArn,
    durationSeconds: AWS_SESSION_DURATION_SECONDS
  });
  const payloadHash = await sha256Hex(encoder.encode(body));
  const entries = [
    ["content-type", "application/json"],
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", timestamp.timestamp],
    ["x-amz-x509", certificate]
  ];
  if (chain) entries.push(["x-amz-x509-chain", chain]);
  const canonicalHeaders = normalizeHeaders(entries);
  const signedHeaders = entries.map(([name]) => name).sort().join(";");
  const canonicalRequest = [
    "POST", "/sessions", "", canonicalHeaders, signedHeaders, payloadHash
  ].join("\n");
  const scope = timestamp.date + "/" + configuration.region + "/rolesanywhere/aws4_request";
  const stringToSign = [
    "AWS4-X509-RSA-SHA256",
    timestamp.timestamp,
    scope,
    await sha256Hex(encoder.encode(canonicalRequest))
  ].join("\n");
  const signature = hex(new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", signingKey, encoder.encode(stringToSign)
  )));
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Amz-Content-Sha256": payloadHash,
    "X-Amz-Date": timestamp.timestamp,
    "X-Amz-X509": certificate,
    "Authorization": "AWS4-X509-RSA-SHA256 Credential=" + serial + "/" + scope +
      ", SignedHeaders=" + signedHeaders + ", Signature=" + signature
  });
  if (chain) headers.set("X-Amz-X509-Chain", chain);

  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } catch {
    throw new TenantKeyServiceError("kms_credentials_unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 201) {
    throw new TenantKeyServiceError("kms_credentials_rejected", 503);
  }
  let payload;
  try { payload = await response.json(); } catch {
    throw new TenantKeyServiceError("kms_credentials_invalid", 503);
  }
  const credentialSet = payload?.credentialSet;
  const credentials = Array.isArray(credentialSet) && credentialSet.length === 1
    ? (credentialSet[0]?.credentials || {})
    : {};
  const accessKeyId = credentials.accessKeyId || credentials.AccessKeyId;
  const secretAccessKey = credentials.secretAccessKey || credentials.SecretAccessKey;
  const sessionToken = credentials.sessionToken || credentials.SessionToken;
  const expiration = credentials.expiration || credentials.Expiration;
  const expiresAt = Date.parse(expiration);
  if (!requiredString(accessKeyId, 128) || !requiredString(secretAccessKey, 256) ||
      !requiredString(sessionToken, 8192) || !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() + AWS_CREDENTIAL_REFRESH_SKEW_MS) {
    throw new TenantKeyServiceError("kms_credentials_invalid", 503);
  }
  return { accessKeyId, secretAccessKey, sessionToken, expiresAt };
}

async function awsCredentials(configuration) {
  const cacheKey = [
    configuration.region, configuration.profileArn, configuration.roleArn,
    configuration.trustAnchorArn, configuration.certificate
  ].join("|");
  if (cachedCredentials?.cacheKey === cacheKey &&
      cachedCredentials.credentials.expiresAt > Date.now() + AWS_CREDENTIAL_REFRESH_SKEW_MS) {
    return cachedCredentials.credentials;
  }
  const credentials = await signedRolesAnywhereFetch(configuration);
  cachedCredentials = { cacheKey, credentials };
  return credentials;
}

async function hmacSha256(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, value));
}

async function signKmsRequest(configuration, operation, payload) {
  const credentials = await awsCredentials(configuration);
  const timestamp = awsTimestamp();
  const host = "kms." + configuration.region + ".amazonaws.com" +
    (configuration.region.startsWith("cn-") ? ".cn" : "");
  const body = JSON.stringify(payload);
  const payloadHash = await sha256Hex(encoder.encode(body));
  const entries = [
    ["content-type", "application/x-amz-json-1.1"],
    ["host", host],
    ["x-amz-date", timestamp.timestamp],
    ["x-amz-security-token", credentials.sessionToken],
    ["x-amz-target", "TrentService." + operation]
  ];
  const canonicalHeaders = normalizeHeaders(entries);
  const signedHeaders = entries.map(([name]) => name).sort().join(";");
  const canonicalRequest = [
    "POST", "/", "", canonicalHeaders, signedHeaders, payloadHash
  ].join("\n");
  const scope = timestamp.date + "/" + configuration.region + "/kms/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp.timestamp,
    scope,
    await sha256Hex(encoder.encode(canonicalRequest))
  ].join("\n");
  const dateKey = await hmacSha256(encoder.encode("AWS4" + credentials.secretAccessKey), encoder.encode(timestamp.date));
  const regionKey = await hmacSha256(dateKey, encoder.encode(configuration.region));
  const serviceKey = await hmacSha256(regionKey, encoder.encode("kms"));
  const signingKey = await hmacSha256(serviceKey, encoder.encode("aws4_request"));
  const signature = hex(await hmacSha256(signingKey, encoder.encode(stringToSign)));
  const headers = new Headers({
    "Content-Type": "application/x-amz-json-1.1",
    "X-Amz-Date": timestamp.timestamp,
    "X-Amz-Security-Token": credentials.sessionToken,
    "X-Amz-Target": "TrentService." + operation,
    "Authorization": "AWS4-HMAC-SHA256 Credential=" + credentials.accessKeyId + "/" + scope +
      ", SignedHeaders=" + signedHeaders + ", Signature=" + signature
  });
  return { host, headers, body };
}

async function kmsRequest(env, operation, payload) {
  const configuration = readConfiguration(env);
  if (!configuration) throw new TenantKeyServiceError("kms_not_configured", 503);
  const signed = await signKmsRequest(configuration, operation, payload);
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    response = await fetch("https://" + signed.host + "/", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal
    });
  } catch {
    throw new TenantKeyServiceError("kms_request_unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new TenantKeyServiceError("kms_request_rejected", 503);
  try {
    return await response.json();
  } catch {
    throw new TenantKeyServiceError("kms_response_invalid", 503);
  }
}

function validateTenantId(value) {
  if (!requiredString(value, 128) || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new TenantKeyServiceError("tenant_key_context_invalid", 400);
  }
}

function validateKeyRecord(record, tenantId) {
  validateTenantId(tenantId);
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      record.schemaVersion !== 1 || record.provider !== "aws-kms" ||
      record.status !== "active" || record.tenantId !== tenantId ||
      !/^[0-9a-f-]{36}$/i.test(record.keyId || "") ||
      !Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1 ||
      typeof record.kmsKeyArn !== "string" ||
      typeof record.wrappedDek !== "string" || record.wrappedDek.length > 16_384) {
    throw new TenantKeyServiceError("tenant_key_record_invalid", 409);
  }
  decodeBase64(record.wrappedDek);
}

function normalizeRecordContext(context, keyRecord) {
  const recordTypes = new Set(["snapshot", "history", "digest", "projection", "backup-metadata"]);
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TenantKeyServiceError("tenant_key_context_invalid", 400);
  }
  const fields = ["tenantId", "workspaceId", "portfolioId"];
  for (const field of fields) {
    if (!requiredString(context[field], 128) || !/^[A-Za-z0-9_-]{8,128}$/.test(context[field])) {
      throw new TenantKeyServiceError("tenant_key_context_invalid", 400);
    }
  }
  if (!recordTypes.has(context.recordType)) {
    throw new TenantKeyServiceError("tenant_key_context_invalid", 400);
  }
  validateKeyRecord(keyRecord, context.tenantId);
  return [
    "portfolio-terminal",
    1,
    context.tenantId,
    context.workspaceId,
    context.portfolioId,
    context.recordType,
    keyRecord.keyId,
    keyRecord.keyVersion
  ];
}

async function kmsEncryptionContext(tenantId, keyId, keyVersion) {
  validateTenantId(tenantId);
  return {
    Application: "portfolio-terminal",
    Purpose: "tenant-dek",
    TenantBinding: await sha256Hex(encoder.encode(tenantId)),
    KeyId: keyId,
    KeyVersion: String(keyVersion)
  };
}

function validatePlaintext(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  throw new TenantKeyServiceError("tenant_key_payload_invalid", 400);
}

async function unwrapTenantKey(env, keyRecord, tenantId, usages) {
  validateKeyRecord(keyRecord, tenantId);
  const configuration = readConfiguration(env);
  if (!configuration) throw new TenantKeyServiceError("kms_not_configured", 503);
  const context = await kmsEncryptionContext(tenantId, keyRecord.keyId, keyRecord.keyVersion);
  const result = await kmsRequest(env, "Decrypt", {
    CiphertextBlob: keyRecord.wrappedDek,
    KeyId: keyRecord.kmsKeyArn,
    EncryptionContext: context
  });
  const plaintext = decodeBase64(result?.Plaintext || "");
  if (plaintext.length !== 32 || result?.KeyId !== keyRecord.kmsKeyArn) {
    plaintext.fill(0);
    throw new TenantKeyServiceError("kms_data_key_invalid", 503);
  }
  try {
    return await crypto.subtle.importKey("raw", plaintext, { name: "AES-GCM" }, false, usages);
  } catch {
    throw new TenantKeyServiceError("kms_data_key_invalid", 503);
  } finally {
    plaintext.fill(0);
  }
}

export async function createTenantKeyRecord(env, tenantId, createdAt = new Date().toISOString()) {
  validateTenantId(tenantId);
  const configuration = readConfiguration(env);
  if (!configuration) throw new TenantKeyServiceError("kms_not_configured", 503);
  const keyId = crypto.randomUUID();
  const keyVersion = 1;
  const context = await kmsEncryptionContext(tenantId, keyId, keyVersion);
  const result = await kmsRequest(env, "GenerateDataKeyWithoutPlaintext", {
    KeyId: configuration.keyArn,
    KeySpec: "AES_256",
    EncryptionContext: context
  });
  if (typeof result?.CiphertextBlob !== "string" || !result.CiphertextBlob ||
      result.KeyId !== configuration.keyArn) {
    throw new TenantKeyServiceError("kms_data_key_invalid", 503);
  }
  decodeBase64(result.CiphertextBlob);
  return {
    schemaVersion: 1,
    provider: "aws-kms",
    status: "active",
    tenantId,
    keyId,
    keyVersion,
    kmsKeyArn: configuration.keyArn,
    wrappedDek: result.CiphertextBlob,
    encryptionContextVersion: 1,
    createdAt
  };
}

export async function encryptTenantRecord({ env, keyRecord, context, plaintext }) {
  const aad = normalizeRecordContext(context, keyRecord);
  const bytes = validatePlaintext(plaintext);
  if (bytes.byteLength > MAX_TENANT_RECORD_BYTES) {
    throw new TenantKeyServiceError("tenant_key_payload_too_large", 413);
  }
  const key = await unwrapTenantKey(env, keyRecord, context.tenantId, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(JSON.stringify(aad)), tagLength: 128 },
    key,
    bytes
  );
  return {
    envelopeVersion: 1,
    algorithm: "AES-256-GCM",
    keyId: keyRecord.keyId,
    keyVersion: keyRecord.keyVersion,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(new Uint8Array(encrypted))
  };
}

export async function decryptTenantRecord({ env, keyRecord, context, envelope }) {
  const aad = normalizeRecordContext(context, keyRecord);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(",") !== "algorithm,ciphertext,envelopeVersion,keyId,keyVersion,nonce" ||
      envelope.envelopeVersion !== 1 || envelope.algorithm !== "AES-256-GCM" ||
      envelope.keyId !== keyRecord.keyId || envelope.keyVersion !== keyRecord.keyVersion) {
    throw new TenantKeyServiceError("tenant_key_envelope_invalid", 400);
  }
  const nonce = decodeBase64(envelope.nonce);
  const ciphertext = decodeBase64(envelope.ciphertext);
  if (nonce.length !== 12 || ciphertext.length < 16 ||
      ciphertext.length > MAX_TENANT_RECORD_BYTES + 16) {
    throw new TenantKeyServiceError("tenant_key_envelope_invalid", 400);
  }
  const key = await unwrapTenantKey(env, keyRecord, context.tenantId, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(JSON.stringify(aad)), tagLength: 128 },
      key,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new TenantKeyServiceError("tenant_key_authentication_failed", 409);
  }
}

export async function rewrapTenantDek(env, keyRecord, destinationKeyArn) {
  validateKeyRecord(keyRecord, keyRecord?.tenantId);
  const configuration = readConfiguration(env);
  if (!configuration) throw new TenantKeyServiceError("kms_not_configured", 503);
  const destinationMatch = destinationKeyArn?.match(
    /^arn:(aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b):kms:([a-z0-9-]+):\d{12}:key\/[A-Za-z0-9-]+$/
  );
  if (!destinationMatch || destinationMatch[2] !== configuration.region ||
      destinationMatch[1] !== configuration.keyArn.split(":")[1]) {
    throw new TenantKeyServiceError("kms_destination_invalid", 400);
  }
  const context = await kmsEncryptionContext(keyRecord.tenantId, keyRecord.keyId, keyRecord.keyVersion);
  const result = await kmsRequest(env, "ReEncrypt", {
    CiphertextBlob: keyRecord.wrappedDek,
    SourceKeyId: keyRecord.kmsKeyArn,
    DestinationKeyId: destinationKeyArn,
    SourceEncryptionContext: context,
    DestinationEncryptionContext: context
  });
  if (typeof result?.CiphertextBlob !== "string" || result.KeyId !== destinationKeyArn) {
    throw new TenantKeyServiceError("kms_rewrap_invalid", 503);
  }
  decodeBase64(result.CiphertextBlob);
  return {
    ...keyRecord,
    kmsKeyArn: destinationKeyArn,
    wrappedDek: result.CiphertextBlob,
    lastRewrappedAt: new Date().toISOString()
  };
}

export function resetTenantKeyServiceCacheForTests() {
  cachedCredentials = null;
  cachedSigningKey = null;
}
