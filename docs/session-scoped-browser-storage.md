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

Snapshots, broker rules, and the broker-execution/cashflow history sidecar use the active scope. Portfolio snapshot recovery and closed history share the same account-scoped IndexedDB database but use separate records. The compact active portfolio snapshot remains in localStorage for the synchronous PortfolioStore commit boundary; its full last-known-good copy is stored in IndexedDB rather than duplicated in localStorage. The first administrator migration also moves retained pre-scope copies into that same IndexedDB database before reclaiming their old localStorage keys. The broker-execution/cashflow history sidecar also uses IndexedDB, with its existing bounded localStorage fallback using the same namespace.

Device-level preferences such as the selected desk and the administrator/guest quote-refresh interval remain device preferences. The Gateway Secret remains in its existing device-secure credential store; it is not copied into portfolio workspace snapshots.

## Identity transition

1. Cancel pending provider reads and pending cloud writes for the previous session.
2. Update the account identity and temporarily disable cloud writes.
3. Activate the role-specific storage namespace.
4. On first administrator activation, copy the legacy snapshot, broker rules, and broker history into the owner namespace. The legacy source is retained for recovery.
5. Load the new scope's snapshot and history and replace the in-memory workspace without writing the unchanged snapshot back to localStorage.
6. Enable administrator cloud writes only after the owner workspace has loaded; guests remain read-only to the shared cloud workspace.
7. Publish the authenticated identity to the UI.

A successfully validated /api/auth/me response is not enough to publish the session: account-scoped workspace activation must also complete. If activation fails, sign-in remains visible and startup fails closed; it must not continue as an offline administrator or publish an empty workspace. Startup hydration is read-only with respect to the compact portfolio snapshot. It must not require spare localStorage quota merely to re-save data that has just been read successfully. A subsequent actual portfolio mutation owns the next local checkpoint.

A failed identity lookup invalidates the session, moves to the offline namespace when storage is available, and clears the in-memory workspace. The failed identity is never allowed to continue using the previous workspace.

## Import and replacement semantics

- `PortfolioStore.importState()` remains the same-workspace merge/restore path for backups and imports that are explicitly intended to preserve local append-only journals. It rejects conflicting event identities and invalid linked history.
- `PortfolioStore.replaceWorkspace()` is reserved for switching authenticated local storage scopes. It replaces the in-memory state and its journals instead of merging events from the previous identity.
- `PortfolioStore.replaceFromConfirmedCloudPull()` remains the separate, user-confirmed Settings recovery boundary. Settings shows the backup warning/confirmation before invoking it.
- `PortfolioStore.replaceFromAuthoritativeCloudSnapshot()` is used only after the authenticated cloud record has been decrypted, schema-validated and accepted at its current revision. Startup hydration and automatic 409 recovery replace the same-scope snapshot and journals with that exact cloud state; they do not merge stale local financial fields, append local journal rows, or synthesize reconciliation events from the replaced snapshot. Fields intentionally excluded from `/api/state`—the device Gateway Secret, legacy `marginBalance`, and the separate broker-execution/cashflow/Closed History sidecar—remain on their existing account-scoped storage and history-sync paths and are not blanked by portfolio snapshot adoption. The separate history sync gives authenticated cloud records precedence over duplicate local sidecar IDs while retaining local-only rows and applying fresh provider cashflow corrections last.
- The normal storage commit queues the previous same-scope local snapshot into the account-scoped last-known-good recovery mirror alongside the active snapshot update. A rejected local commit leaves the prior in-memory and persisted state intact.
- Portfolio reset semantics are unchanged: reset within a workspace retains that workspace's append-only transaction journal and writes its reset marker. The IndexedDB portfolio recovery row advances to the reset generation so damaged data cannot resurrect pre-reset positions.
- Pending history writes retain their captured storage scope and are drained before the active scope changes. They cannot be redirected into the next account's history database.
- Concurrent storage activations are serialized; an older authentication response cannot reactivate a prior workspace or re-enable administrator cloud writes after a newer login.
- If localStorage is unavailable, the browser starts or switches to an in-memory offline scope rather than falling back to unscoped legacy data.

## Legacy migration and recovery

The first administrator activation imports the unscoped legacy active/recovery snapshots directly into the owner-scoped IndexedDB database, together with any existing owner-scoped records. It keeps the two newest complete snapshots by their persisted lastUpdated values. Only after both IndexedDB records commit does it remove the unscoped legacy state/recovery keys and the redundant scoped local recovery key, then repair the single scoped active localStorage snapshot. If IndexedDB is unavailable or the transaction fails, every original local/legacy source remains untouched and the selected portfolio remains available from the in-memory cache for that session. Guests and offline workspaces never inspect or remove the administrator legacy keys.

After the scope marker is set, a page reload starts in `offline`; it never automatically reads unscoped legacy data. An authenticated administrator activation selects `owner`, while a guest activation selects only that guest's namespace.

## Slow or unavailable IndexedDB

Startup resolves the account identity before initializing the history cache for the selected namespace. Authenticated workspace activation hydrates that account's history; only unauthenticated startup initializes the offline namespace. The application no longer performs an unrelated pre-authentication history-database read and then repeats it after `/me` selects the owner or guest scope.

Once the authenticated local workspace and required cloud/guest snapshot are ready, the saved view is shown immediately. The first quote batch and pending cloud-write recovery run in the background; a 15-second quote-refresh deadline releases the initial-refresh coordination flag without keeping the startup shell visible. A delayed provider response can still update prices later, but cannot block navigation.

Closed-history IndexedDB opens and reads are bounded to two seconds so slow startup recovery cannot consume the full app-shell watchdog window. Ordinary closed-history writes have a separate 20-second maximum: large broker execution/cashflow snapshots may require more time for browser structured cloning and commit than a small read, while a hard deadline still prevents indefinite waits. If a write does not complete, the cache falls back to the same account-scoped localStorage sidecar when it fits the existing 512 KiB limit; larger history remains dependent on IndexedDB and the encrypted cloud copy, and the app never truncates it to make the fallback fit. A later save/page load retries IndexedDB persistence. The matching Worker-side fix is deployed from `main` commit `d50725e82c824b0a15db27fd8a583e2ffba3958e` (Cloudflare Worker deployment run [#44738221698](https://github.com/armave/portfolio-terminal/actions/runs/44738221698)); it stores large encrypted state/history payloads as bounded Durable Object chunks while preserving the public request and revision contract.

A timeout does not delete the legacy migration source or replace the portfolio snapshot. If cached history cannot be read from either IndexedDB or the scoped localStorage fallback, the in-memory history cache starts empty for that session; the persisted source remains available for a later retry or recovery.

## Automatic browser app-shell repair

The app checks its service worker for updates on each page load. Detection only stages a waiting worker; it does not force activation or reload the current page during startup or while a workspace is open. The browser can activate the waiting worker after all tabs controlled by the older worker have been closed, and the next app launch uses the updated shell. A first controller acquisition does not interrupt account creation or sign-in.

After the account-scoped workspace has been activated, the full-screen startup overlay waits up to 12 seconds for the selected desk's initial render. If an optional lazy-loaded panel, font, or image remains pending, the shell is released and the affected desk keeps its own local loading fallback; navigation and recovery controls remain available. The startup watchdog stays armed until the overlay is actually removed, rather than being cancelled when dismissal is merely requested.

If startup remains pending for 30 seconds before the overlay is dismissed, a watchdog automatically unregisters only a service worker whose scope exactly matches this application and removes only this application's Workbox precache, then reloads with a cache-busting URL. A one-shot URL marker prevents repeated automatic reloads. If the next startup also stalls, the app displays the manual recovery controls instead of looping.

This repair does not sign the user out and does not clear localStorage, sessionStorage, IndexedDB, portfolio snapshots, broker assumptions, closed history, encrypted Gateway credentials, or caches belonging to another app. It is a shell/cache repair only; existing portfolio recovery remains governed by the account-scoped last-known-good rules below.

## Local recovery copies

Portfolio snapshot recovery is account-scoped in IndexedDB. On workspace activation, the app migrates any existing localStorage last-known-good snapshot into the same scoped IndexedDB database used by closed history. The local duplicate is removed only after both IndexedDB snapshot records commit successfully. If IndexedDB is blocked or unavailable, the local recovery copy is retained and remains readable. New portfolio saves synchronously replace only the active localStorage snapshot, then queue an atomic IndexedDB update that retains the previous valid snapshot as the recovery row. This keeps the existing synchronous PortfolioStore commit boundary without requiring two full portfolio JSON copies in localStorage.

Broker assumptions and the closed-history cache also retain scoped recovery data. Startup validates each active record before use; malformed snapshots restore from the matching account namespace. Closed history keeps its recovery row in the same scoped database, with the existing bounded localStorage recovery copy when IndexedDB is unavailable.

Recovery copies are not merged into financial records. They restore one complete prior valid version only; they do not infer missing trades, combine divergent positions, or reconcile independently edited offline tabs. An explicit portfolio reset writes a blank recovery baseline so a later repair cannot resurrect pre-reset holdings or history. Clearing local data removes the corresponding portfolio and broker-rule recovery copies.

Authenticated application sync treats the latest valid cloud revision as authoritative on startup and after a revision-conflict response. It adopts the current cloud snapshot instead of merging stale local financial state back into the shared record. If the cloud record is missing after a previously accepted populated revision, the request is unauthorized/unavailable, ciphertext or payload validation fails, or the local commit fails, the device keeps its last-known-good workspace and does not treat the failure as an empty portfolio. The conservative three-way reconciler remains available to non-authoritative runtime callers that explicitly do not select the cloud-first policy.

## Automatic device-local recovery

The active storage namespace keeps best-effort last-known-good copies of the compact portfolio snapshot and broker assumptions. A malformed or missing active record is repaired from a valid recovery copy in the same namespace; recovery never reads another account's records. Normal saves advance the recovery copy only from a parseable prior record.

Closed trade and cashflow history remains an atomic snapshot, not a mergeable event list. The scoped IndexedDB store retains its previous valid row before replacing the active row. After a successful IndexedDB write, the current valid history is also mirrored to the scoped localStorage recovery key only when it fits the existing 512 KiB fallback limit; an identical mirror is not rewritten. Startup checks IndexedDB first and reads localStorage history only when IndexedDB has no usable snapshot or cannot be opened/read. A local recovery-copy read is non-destructive: it does not copy the recovery value back into the active sidecar on every startup. If IndexedDB is unavailable, the scoped local copy is used in memory without requiring a write. When a larger history cannot fit, recovery relies on the IndexedDB recovery row and the user's exported JSON backup.

The encrypted device Gateway Secret is handled separately. Secure-key IndexedDB opens and transactions are bounded; restoring ciphertext never creates a new device key. Temporary key-store failures and decryption failures preserve the ciphertext for a later retry. If the original non-extractable device key is permanently lost, the saved session secret cannot be decrypted and the user must sign in again; local recovery does not bypass that device binding.

An explicit `portfolio.reset` is treated as a new recovery baseline. The blank portfolio and empty history replace both active and recovery copies, so a later repair cannot resurrect pre-reset holdings or history. If the combined local reset fails, the previous in-memory snapshot and history are restored.

Recovery writes are best-effort and use the same browser storage origin as the active data. Browser quota/security restrictions can prevent creating or repairing a recovery copy; the app does not delete unrelated records to make room. The existing localStorage multi-key rollback remains best-effort, not a native browser transaction. Keep a current JSON export in a trusted location for recovery from device loss, quota exhaustion, or irrecoverable corruption.

These local repairs do **not** reconcile divergent financial changes between devices. Cloud reconciliation still merges only the explicit non-financial UI preference allowlist; divergent financial/account snapshots, lots, journal arrays, balances, broker history, and unknown fields remain blocked for export/manual recovery. Arrays are never concatenated or guessed.

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
- startup recovery when IndexedDB open requests or read transactions stall, including a quota-limited recovery-copy read that performs no sidecar rewrite;
- authenticated workspace hydration without redundant local snapshot writes, and a fail-closed sign-in when identity activation cannot complete;
- same-scope last-known-good recovery for corrupted/missing portfolio snapshots, broker assumptions, and closed-history storage;
- explicit reset replacing recovery baselines so pre-reset financial records cannot reappear;
- bounded secure device-key access and preservation of encrypted credentials when the original key is temporarily unavailable;
- same-workspace backup/cloud journal merging remaining append-only.

The exact PR head must pass repository CI, including TypeScript, Vitest, production build, dead-code/dependency audits, and the production browser journey. Manual authenticated account-switch and multi-device checks remain separate release evidence.
