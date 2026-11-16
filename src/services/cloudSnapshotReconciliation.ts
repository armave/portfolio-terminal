type Snapshot = Record<string, unknown>;

const AUTO_MERGE_FIELDS = new Set([
  // Navigation and refresh cadence are device/workspace preferences, not
  // accounting inputs or transaction records.
  'activeView',
  'selectedTicker',
  'autoRefreshInterval'
]);
const MISSING = Symbol('missing snapshot field');

function isRecord(value: unknown): value is Snapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value: unknown): string {
  if (value === MISSING) return '"<missing>"';
  if (value === undefined) return '"<undefined>"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value as Snapshot).sort().map((key) =>
    `${JSON.stringify(key)}:${stableValue((value as Snapshot)[key])}`
  ).join(',')}}`;
}

function equal(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

function project(snapshot: Snapshot, includeAutoMergeFields: boolean): Snapshot {
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) =>
    AUTO_MERGE_FIELDS.has(key) === includeAutoMergeFields && key !== 'lastUpdated'
  ));
}

interface MergeResult {
  ok: boolean;
  value?: unknown;
}

/**
 * Three-way merge for non-financial metadata. Arrays are intentionally atomic:
 * journal, history, lots and other ordered collections are never concatenated.
 */
function mergeMetadata(base: unknown, local: unknown, remote: unknown): MergeResult {
  if (equal(local, remote)) return { ok: true, value: cloneValue(local) };
  if (equal(local, base)) return { ok: true, value: cloneValue(remote) };
  if (equal(remote, base)) return { ok: true, value: cloneValue(local) };

  const baseRecord = isRecord(base) ? base : {};
  if (isRecord(local) && isRecord(remote) && (isRecord(base) || base === MISSING)) {
    const merged: Snapshot = {};
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(local),
      ...Object.keys(remote)
    ]);
    for (const key of keys) {
      const next = mergeMetadata(
        Object.prototype.hasOwnProperty.call(baseRecord, key) ? baseRecord[key] : MISSING,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
        Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING
      );
      if (!next.ok) return { ok: false };
      if (next.value !== MISSING) merged[key] = next.value;
    }
    return { ok: true, value: merged };
  }
  return { ok: false };
}

/**
 * Conservatively reconcile whole-portfolio snapshots.
 *
 * Only the explicit UI preference allowlist is field-merged. Every other field
 * (including unknown fields) is protected as financial/account state. If both
 * devices changed that protected projection differently, reconciliation fails.
 */
export function reconcileCloudStateSnapshots(
  base: Snapshot,
  local: Snapshot,
  remote: Snapshot
): Snapshot | null {
  const baseProtected = project(base, false);
  const localProtected = project(local, false);
  const remoteProtected = project(remote, false);
  const localProtectedChanged = !equal(localProtected, baseProtected);
  const remoteProtectedChanged = !equal(remoteProtected, baseProtected);

  if (
    localProtectedChanged &&
    remoteProtectedChanged &&
    !equal(localProtected, remoteProtected)
  ) {
    return null;
  }

  const baseMetadata = project(base, true);
  const localMetadata = project(local, true);
  const remoteMetadata = project(remote, true);
  const metadata = mergeMetadata(baseMetadata, localMetadata, remoteMetadata);
  if (!metadata.ok || !isRecord(metadata.value)) return null;

  const protectedSource = localProtectedChanged
    ? localProtected
    : remoteProtectedChanged
      ? remoteProtected
      : baseProtected;
  const merged: Snapshot = { ...cloneValue(protectedSource), ...metadata.value };
  const timestamps = [base.lastUpdated, local.lastUpdated, remote.lastUpdated]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (timestamps.length) merged.lastUpdated = Math.max(...timestamps);
  return merged;
}
