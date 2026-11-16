# Session-scoped browser portfolio storage

## Purpose

The browser may be used by an administrator, multiple guests, or before authentication. Portfolio snapshots and broker-history caches must not be reused across those authenticated identities.

This contract scopes browser-local portfolio data. It does **not** create independent server-side financial tenants or change the existing administrator/guest authorization model.

## Storage namespaces

| Scope | Owner | Behavior |
|---|---|---|
| `owner` | Shared administrator workspace | All authenticated administrator identities use the same local owner workspace, matching the current shared-owner product model |
| `guest:<account-id>` | One guest identity | Each guest identity has a separate local snapshot, journal, broker-history cache, and broker-rules record |
| `offline` | Unauthenticated use after scoped storage has been activated | Starts empty and cannot fall back to the previous authenticated workspace |
| `legacy` | Pre-migration browser data | Used only before scoped storage has been activated; copied into `owner` on the first administrator activation |

Snapshots, broker rules, and the broker-execution/cashflow history sidecar use the active scope. The history sidecar has a separate IndexedDB database per scope, with the bounded localStorage fallback using the same namespace.

Device-level preferences such as the selected desk and the administrator/guest quote-refresh interval remain device preferences. The Gateway Secret remains in its existing device-secure credential store; it is not copied into portfolio workspace snapshots.

## Identity transition

1. Cancel pending provider reads and pending cloud writes for the previous session.
2. Update the account identity and temporarily disable cloud writes.
3. Activate the role-specific storage namespace.
4. On first administrator activation, copy the legacy snapshot, broker rules, and broker history into the owner namespace. The legacy source is retained for recovery.
5. Load the new scope's snapshot and history and replace the in-memory workspace.
6. Enable administrator cloud writes only after the owner workspace has loaded; guests remain read-only to the shared cloud workspace.
7. Publish the authenticated identity to the UI.

A failed identity lookup invalidates the session, moves to the offline namespace when storage is available, and clears the in-memory workspace. The failed identity is never allowed to continue using the previous workspace.

## Import and replacement semantics

- `PortfolioStore.importState()` remains the same-workspace restore path. It preserves append-only transaction, corporate-action, and market-history journals and rejects conflicting history.
- `PortfolioStore.replaceWorkspace()` is reserved for switching authenticated local storage scopes. It replaces the in-memory state and its journals instead of merging events from the previous identity.
- Portfolio reset semantics are unchanged: reset within a workspace retains that workspace's append-only transaction journal and writes its reset marker.
- Pending history writes retain their captured storage scope and are drained before the active scope changes. They cannot be redirected into the next account's history database.
- Concurrent storage activations are serialized; an older authentication response cannot reactivate a prior workspace or re-enable administrator cloud writes after a newer login.
- If localStorage is unavailable, the browser starts or switches to an in-memory offline scope rather than falling back to unscoped legacy data.

## Legacy migration and recovery

The first administrator activation copies the existing unscoped state and history into the owner namespace only when the corresponding owner record is absent. The source legacy records are not deleted, so migration can be inspected or recovered if a later step fails.

After the scope marker is set, a page reload starts in `offline`; it never automatically reads unscoped legacy data. An authenticated administrator activation selects `owner`, while a guest activation selects only that guest's namespace.

## Slow or unavailable IndexedDB

Each closed-history IndexedDB open and transaction is bounded to five seconds. If a browser never completes one of those operations, the cache read/write falls back to the scoped localStorage sidecar when possible, and the application can continue without waiting indefinitely. A later page load retries IndexedDB initialization.

A timeout does not delete the legacy migration source or replace the portfolio snapshot. If cached history cannot be read from either IndexedDB or the scoped localStorage fallback, the in-memory history cache starts empty for that session; the persisted source remains available for a later retry or recovery.

## Security boundary and limitations

This is browser-local data isolation for normal account switching. It is not a substitute for server-enforced tenant authorization, tenant-specific Durable Objects, tenant key management, migration/rollback review, or adversarial cross-tenant server tests. The current guest server projection remains read-only and the shared administrator workspace remains the authoritative server workspace.

The scope keys are localStorage/IndexedDB namespace identifiers, not encryption keys or authorization credentials. Same-origin script compromise can still access browser data available to that origin.

## Validation

Automated coverage verifies:
- first-owner migration from the legacy local snapshot, rules, and broker-history cache;
- separation between owner, guest A, guest B, and offline snapshots/history;
- delayed history writes completing in the scope where they were started;
- workspace replacement clearing previous journals;
- authenticated session transition ordering, concurrent authentication checks, and cloud-write gating;
- fail-closed offline activation when localStorage is unavailable;
- startup recovery when IndexedDB open requests or read transactions stall;
- same-workspace backup/cloud journal merging remaining append-only.

The exact PR head must pass repository CI, including TypeScript, Vitest, production build, dead-code/dependency audits, and the production browser journey. Manual authenticated account-switch and multi-device checks remain separate release evidence.
