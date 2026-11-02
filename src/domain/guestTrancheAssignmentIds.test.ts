import { describe, expect, it } from 'vitest';
import {
  createGuestTrancheAssignmentId,
  createLegacyGuestTrancheAssignmentId
} from './guestTrancheAssignmentIds';

describe('guest tranche assignment identifiers', () => {
  it('creates a fresh non-empty identifier for each new assignment', () => {
    const first = createGuestTrancheAssignmentId();
    const second = createGuestTrancheAssignmentId();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('creates stable IDs for legacy assignments using the same guest and tranche pair', () => {
    const first = createLegacyGuestTrancheAssignmentId('guest-1', 'tranche-1');
    const second = createLegacyGuestTrancheAssignmentId('guest-1', 'tranche-1');

    expect(first).toBe(second);
    expect(first).toMatch(/^legacy-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('keeps different legacy guest/tranche pairs separate', () => {
    const first = createLegacyGuestTrancheAssignmentId('guest-1', 'tranche-1');

    expect(createLegacyGuestTrancheAssignmentId('guest-2', 'tranche-1')).not.toBe(first);
    expect(createLegacyGuestTrancheAssignmentId('guest-1', 'tranche-2')).not.toBe(first);
  });
});
