/**
 * Creates a fresh opaque identifier for a guest tranche assignment.
 * This ID is persisted with the active assignment and its durable ledger row.
 */
export function createGuestTrancheAssignmentId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a local non-secret identifier if the runtime lacks randomUUID.
  }
  return `assignment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Creates a stable opaque identifier when migrating a legacy assignment that
 * predates persisted assignment IDs. Do not change the hash inputs or format:
 * existing records rely on this ID remaining deterministic.
 */
export function createLegacyGuestTrancheAssignmentId(guestId: string, trancheId: string): string {
  const source = `${guestId}|${trancheId}`;
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `legacy-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
