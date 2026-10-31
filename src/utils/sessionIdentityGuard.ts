export interface SessionIdentityToken {
  readonly identity: string;
  readonly generation: number;
}

export interface SessionIdentityGuard {
  setIdentity(identity: string | null): void;
  capture(): SessionIdentityToken | null;
  isCurrent(token: SessionIdentityToken | null): boolean;
}

/**
 * Binds async work to one authenticated account identity. The generation also
 * changes when an account switches away and later switches back, so old work
 * from a previous session cannot become current again.
 */
export function createSessionIdentityGuard(initialIdentity: string | null = null): SessionIdentityGuard {
  let activeIdentity = initialIdentity;
  let generation = 0;

  return {
    setIdentity(identity) {
      if (identity === activeIdentity) return;
      activeIdentity = identity;
      generation += 1;
    },
    capture() {
      return activeIdentity === null ? null : { identity: activeIdentity, generation };
    },
    isCurrent(token) {
      return token !== null &&
        token.identity === activeIdentity &&
        token.generation === generation;
    }
  };
}

/** Stable in-flight key that changes even when an identity signs out and back in. */
export function getSessionIdentityRequestKey(token: SessionIdentityToken): string {
  return `${token.identity}\u0000${token.generation}`;
}
