/**
 * Tracks the newest async request so older responses cannot overwrite newer UI state.
 * Call begin() as soon as an event arrives, before validation or any awaited work.
 */
export interface LatestRequestGuard {
  begin(): number;
  isCurrent(requestId: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let latestRequestId = 0;

  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent(requestId) {
      return requestId === latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    }
  };
}
