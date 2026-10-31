# Guest tranche assignment history

Date: 2026-10-31

## Problem

The shared portfolio persisted the current tranche-to-guest assignment map, and the Durable Object persisted an encrypted guest holdings projection. The projection was replaced on refresh and included only open tranches. Once a tranche was sold or unassigned, the guest projection no longer contained that row, so a guest dashboard had no durable source for assignment history or lifecycle filters.

## Storage model

The existing `guest-portfolio:<guestId>` Durable Object record now keeps two separately encrypted payloads:

- `encryptedSnapshot`: the backward-compatible live holdings projection used by the Balance dashboard.
- `encryptedLedger`: durable assignment records keyed by a unique `assignmentId`.

The workspace encryption key and existing AES-GCM envelope format are reused. Guests can GET only the record bound to their authenticated session. Administrators publish snapshots and ledger changes in a batch. The server validates guest roles, validates every record, rechecks revisions inside the storage transaction, and preserves ledger data when an older client posts only a live snapshot.

Each ledger row stores the tranche and assignment IDs, ticker/name, originally assigned shares, currently open assigned shares, average purchase price when available, purchase/assignment timestamps, last update time, end time, and lifecycle status:

- `active`: the assigned cash-funded shares remain open.
- `closed`: the assignment remains linked, but the broker trade history no longer reports an open quantity for that tranche.
- `unassigned`: the administrator removed the guest link or changed the tranche to a non-cash allocation.

Reassignment creates a new assignment ID, preserving the previous guest's row as unassigned instead of rewriting the original guest's ownership history. The shared portfolio stores only the active assignment metadata needed to reconcile future updates. The full historical ledger remains in the guest-scoped encrypted Durable Object record.

## Dashboard and filtering

The guest Balance dashboard now reads the ledger and offers filters for ticker, lifecycle status, and assignment date range. Its summary reports active/closed/unassigned assignment counts, historic assigned cost basis, current open cost basis, and open market value when a current quote is available. The report joins active ledger rows to the guest's current snapshot by tranche ID, so another guest's positions and prices are never needed.

## Compatibility and limitations

- Existing live projection fields and the previous single-snapshot POST shape remain supported.
- Old clients that do not send ledger fields do not erase or mutate existing history.
- Existing still-open assignments without assignment metadata receive a stable legacy assignment ID on the next successful administrator sync. Their assignment date is the first successful backfill time, because the old state did not store the actual assignment date.
- Closed pre-feature tranches cannot be backfilled reliably because the previous database projection did not retain their assignment quantity/timestamp history. They are not fabricated.
- Realized P/L is intentionally not reported: the current FIFO broker parser does not attribute sell execution proceeds to each guest assignment record. Closed rows therefore represent lifecycle history, not a realized-return calculation.
- The ledger is capped at 5,000 records per guest. Publishing is skipped when broker data is stale or trade history has not completed loading.

## Validation

Regression coverage includes encrypted guest-only reads, active quantity refresh, closed/unassigned transitions, malformed-record rejection, legacy-client compatibility, API payload/deduplication behavior, store persistence, and dashboard filters/report summaries. GitHub CI on the PR is the authoritative typecheck, test, and build result; a local clone/browser run was not available in the current environment because GitHub DNS resolution failed.

## Navigation relocation

The guest assignment ledger is exposed as a standalone guest-only workspace destination labelled **LOTS**. It is no longer embedded in the Balance desk. The route is persisted as a supported local view, and the access guard allows it only for an authenticated guest session. Administrators continue to manage assignments from the Balance desk and do not receive the private guest ledger route.