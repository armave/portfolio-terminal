import type { MarginIntelligenceArticle, MarginNewsCoverage } from '../features/ai/marginIntelligence';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchAndConsumeWithTimeout } from './requestTimeout';

export interface SyncedMarginDigest {
  key: string;
  title: string;
  scope: 'position' | 'portfolio';
  ticker?: string;
  analysis: string;
  articles: MarginIntelligenceArticle[];
  snapshotFingerprint?: string;
  snapshotAsOf?: string;
  promptVersion?: number;
  coverage?: MarginNewsCoverage[];
  syncedAt: string;
}

export type MarginDigestEncryptionMigrationStatus = 'not-required' | 'migrated' | 'pending';

export interface LoadedSyncedMarginDigest {
  digest: SyncedMarginDigest;
  revision: number;
  migrationStatus: MarginDigestEncryptionMigrationStatus;
}

export interface MarginDigestMigrationInventory {
  totalRecords: number;
  plaintextRecords: number;
  encryptedV2Records: number;
  legacyEncryptedRecords: number;
  unreadableRecords: number;
  scannedAt: string;
  migrationReady: boolean;
}

export interface MarginDigestMigrationBatchResult {
  scanned: number;
  migrated: number;
  alreadyEncrypted: number;
  unreadable: number;
  conflicts: number;
  nextCursor: string | null;
  done: boolean;
}

export interface MarginDigestRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MarginDigestTransportDependencies {
  workerProxyUrl: string;
  getActiveGatewaySecret: () => string;
  encryptCloudPayload: (plaintext: string, sessionToken: string) => Promise<string>;
  decryptCloudPayload: (payload: string, sessionToken: string) => Promise<{ plaintext: string; legacy: boolean }>;
  readCloudRevision?: (headers?: Headers | null) => number | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MarginDigestTransportRuntime {
  loadSyncedMarginDigest(key: string, options?: MarginDigestRequestOptions): Promise<LoadedSyncedMarginDigest | null>;
  saveSyncedMarginDigest(digest: SyncedMarginDigest, revision: number, options?: MarginDigestRequestOptions): Promise<number>;
  fetchMarginDigestMigrationInventory(options?: MarginDigestRequestOptions): Promise<MarginDigestMigrationInventory>;
  migrateMarginDigestBatch(
    input?: { cursor?: string | null; limit?: number },
    options?: MarginDigestRequestOptions
  ): Promise<MarginDigestMigrationBatchResult>;
}

const MARGIN_DIGEST_PATH = '/api/margin-digest';
const MARGIN_DIGEST_MIGRATION_PATH = '/api/margin-digest-migration';

function defaultReadCloudRevision(headers?: Headers | null): number | null {
  const etag = headers?.get('ETag');
  if (!etag) return null;
  const raw = etag.startsWith('W/') ? etag.slice(2) : etag;
  const revision = Number(raw.replace(/^"/, '').replace(/"$/, ''));
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function readPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const error = (payload as Record<string, unknown>).error;
  return typeof error === 'string' && error ? error : null;
}

/**
 * Owns the encrypted Margin Intelligence digest API and its bounded
 * migration workflow. It stays separate from portfolio snapshot/history
 * synchronization because it has an independent record contract.
 */
export function createMarginDigestTransportRuntime(
  dependencies: MarginDigestTransportDependencies
): MarginDigestTransportRuntime {
  const fetchImpl = dependencies.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const readRevision = dependencies.readCloudRevision ?? defaultReadCloudRevision;

  const requestJson = async (
    input: RequestInfo | URL,
    init: RequestInit,
    options: MarginDigestRequestOptions = {}
  ): Promise<{ response: Response; payload: unknown }> => fetchAndConsumeWithTimeout(
    fetchImpl,
    input,
    { ...init, signal: options.signal },
    async (response) => ({
      response,
      payload: await response.json().catch(() => null)
    }),
    options.timeoutMs ?? timeoutMs
  );

  const requireSecret = (): string => {
    const secret = dependencies.getActiveGatewaySecret().trim();
    if (!secret) throw new Error('Gateway Secret is not available.');
    return secret;
  };

  const saveSyncedMarginDigest = async (
    digest: SyncedMarginDigest,
    revision: number,
    options: MarginDigestRequestOptions = {}
  ): Promise<number> => {
    const secret = requireSecret();
    if (!/^(portfolio|position:[A-Z0-9.^=-]{1,20})$/.test(digest.key)) {
      throw new Error('A valid margin digest key is required.');
    }
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('A valid margin digest revision is required.');
    }

    const encryptedPayload = await dependencies.encryptCloudPayload(JSON.stringify(digest), secret);
    const { response, payload } = await requestJson(
      new URL(MARGIN_DIGEST_PATH, dependencies.workerProxyUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Auth': secret,
          Authorization: `Bearer ${secret}`,
          'If-Match': `"${revision}"`
        },
        // Only the lookup key remains in plaintext; review content is encrypted.
        body: JSON.stringify({ key: digest.key, encryptedPayload }),
        cache: 'no-store'
      },
      options
    );
    if (!response.ok) {
      throw new Error(readPayloadError(payload) || `Could not save synced margin digest (HTTP ${response.status}).`);
    }
    const bodyRevision = payload && typeof payload === 'object'
      ? Number((payload as Record<string, unknown>).revision)
      : Number.NaN;
    const nextRevision = readRevision(response.headers) ?? bodyRevision;
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new Error('Server saved the digest but returned an invalid revision.');
    }
    return nextRevision;
  };

  const loadSyncedMarginDigest = async (
    key: string,
    options: MarginDigestRequestOptions = {}
  ): Promise<LoadedSyncedMarginDigest | null> => {
    const secret = requireSecret();
    const digestUrl = new URL(MARGIN_DIGEST_PATH, dependencies.workerProxyUrl);
    digestUrl.searchParams.set('key', key);
    const { response, payload } = await requestJson(
      digestUrl,
      {
        headers: { 'X-App-Auth': secret, Authorization: `Bearer ${secret}` },
        cache: 'no-store'
      },
      options
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(readPayloadError(payload) || `Could not load synced margin digest (HTTP ${response.status}).`);
    }
    const data = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    if (!data || data.key !== key) return null;

    let digestValue: unknown;
    let requiresEncryptionMigration = false;
    if (typeof data.encryptedPayload === 'string') {
      const decrypted = await dependencies.decryptCloudPayload(data.encryptedPayload, secret);
      try {
        digestValue = JSON.parse(decrypted.plaintext);
      } catch {
        throw new Error('The encrypted margin digest could not be parsed.');
      }
      requiresEncryptionMigration = decrypted.legacy;
    } else {
      // Read legacy plaintext records during rollout and attempt a guarded rewrite.
      digestValue = data;
      requiresEncryptionMigration = true;
    }

    if (!digestValue || typeof digestValue !== 'object' || Array.isArray(digestValue)) return null;
    const candidate = digestValue as Record<string, unknown>;
    if (candidate.key !== key || typeof candidate.analysis !== 'string' ||
        !Array.isArray(candidate.articles) || typeof candidate.syncedAt !== 'string') return null;

    let revision = readRevision(response.headers) ?? 0;
    const digest = candidate as unknown as SyncedMarginDigest;
    let migrationStatus: MarginDigestEncryptionMigrationStatus = 'not-required';
    if (requiresEncryptionMigration) {
      try {
        revision = await saveSyncedMarginDigest(digest, revision, options);
        migrationStatus = 'migrated';
      } catch {
        // Keep the review readable if the compatibility rewrite is unavailable.
        migrationStatus = 'pending';
      }
    }
    return { digest, revision, migrationStatus };
  };

  const marginDigestMigrationRequest = async (
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    options: MarginDigestRequestOptions = {}
  ): Promise<unknown> => {
    const secret = requireSecret();
    const { response, payload } = await requestJson(
      new URL(MARGIN_DIGEST_MIGRATION_PATH, dependencies.workerProxyUrl),
      {
        method,
        headers: {
          'X-App-Auth': secret,
          Authorization: `Bearer ${secret}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store'
      },
      options
    );
    if (!response.ok) {
      throw new Error(readPayloadError(payload) || `Margin digest migration request failed (HTTP ${response.status}).`);
    }
    return payload;
  };

  const fetchMarginDigestMigrationInventory = async (
    options: MarginDigestRequestOptions = {}
  ): Promise<MarginDigestMigrationInventory> => {
    const payload = await marginDigestMigrationRequest('GET', undefined, options);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The Margin Intelligence encryption inventory response was invalid.');
    }
    const value = payload as Record<string, unknown>;
    const countKeys = ['totalRecords', 'plaintextRecords', 'encryptedV2Records', 'legacyEncryptedRecords', 'unreadableRecords'] as const;
    const isCount = (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
    if (countKeys.some((key) => !isCount(value[key])) ||
        typeof value.scannedAt !== 'string' || !Number.isFinite(Date.parse(value.scannedAt)) ||
        typeof value.migrationReady !== 'boolean') {
      throw new Error('The Margin Intelligence encryption inventory response was invalid.');
    }
    const classifiedRecords = countKeys.slice(1).reduce((total, key) => total + (value[key] as number), 0);
    const expectedReady = value.plaintextRecords === 0 &&
      value.legacyEncryptedRecords === 0 && value.unreadableRecords === 0;
    if (classifiedRecords !== value.totalRecords || value.migrationReady !== expectedReady) {
      throw new Error('The Margin Intelligence encryption inventory response was invalid.');
    }
    return {
      totalRecords: value.totalRecords as number,
      plaintextRecords: value.plaintextRecords as number,
      encryptedV2Records: value.encryptedV2Records as number,
      legacyEncryptedRecords: value.legacyEncryptedRecords as number,
      unreadableRecords: value.unreadableRecords as number,
      scannedAt: value.scannedAt as string,
      migrationReady: value.migrationReady as boolean
    };
  };

  const migrateMarginDigestBatch = async (
    input: { cursor?: string | null; limit?: number } = {},
    options: MarginDigestRequestOptions = {}
  ): Promise<MarginDigestMigrationBatchResult> => {
    const limit = input.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
        (input.cursor !== undefined && input.cursor !== null &&
          (typeof input.cursor !== 'string' || !input.cursor.startsWith('marginDigestRecord:') || input.cursor.length > 100))) {
      throw new Error('Margin digest migration batch settings are invalid.');
    }
    const payload = await marginDigestMigrationRequest('POST', {
      limit,
      ...(input.cursor ? { cursor: input.cursor } : {})
    }, options);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The Margin Intelligence encryption batch response was invalid.');
    }
    const value = payload as Record<string, unknown>;
    const countKeys = ['scanned', 'migrated', 'alreadyEncrypted', 'unreadable', 'conflicts'] as const;
    const isCount = (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
    if (countKeys.some((key) => !isCount(value[key])) ||
        (value.nextCursor !== null && (
          typeof value.nextCursor !== 'string' ||
          !value.nextCursor.startsWith('marginDigestRecord:') ||
          value.nextCursor.length > 100
        )) ||
        typeof value.done !== 'boolean') {
      throw new Error('The Margin Intelligence encryption batch response was invalid.');
    }
    const classifiedRecords = countKeys.slice(1).reduce((total, key) => total + (value[key] as number), 0);
    const scanned = value.scanned as number;
    if (scanned > limit || classifiedRecords !== scanned ||
        value.done !== (value.nextCursor === null) ||
        (!value.done && scanned === 0)) {
      throw new Error('The Margin Intelligence encryption batch response was invalid.');
    }
    return {
      scanned,
      migrated: value.migrated as number,
      alreadyEncrypted: value.alreadyEncrypted as number,
      unreadable: value.unreadable as number,
      conflicts: value.conflicts as number,
      nextCursor: value.nextCursor as string | null,
      done: value.done as boolean
    };
  };

  return {
    loadSyncedMarginDigest,
    saveSyncedMarginDigest,
    fetchMarginDigestMigrationInventory,
    migrateMarginDigestBatch
  };
}
