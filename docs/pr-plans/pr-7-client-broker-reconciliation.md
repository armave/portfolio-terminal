# PR 7 — Client-side broker reconciliation and data-quality states

**Status:** Implemented; final combined-tree verification against the post-#313 `main` is in progress.

**PR:** [#315](https://github.com/armave/portfolio-terminal/pull/315)  
**Branch:** `fix/broker-client-reconciliation-2026-11-05`  
**Base:** `main`  
**Related merged work:** #313 (margin-risk validation). The changes are independent; only localization files were shared and are combined on the final branch.

## Implemented

- [x] Trade-history and active-order contracts distinguish an authoritative empty collection from a missing or malformed collection.
- [x] Loaded USD portfolio snapshots reject missing balance/position arrays, malformed rows, missing currencies, and invalid required USD amounts/quantities instead of silently dropping rows or coercing values to zero.
- [x] Optional embedded fills are validated independently from active orders. Valid orders can publish while malformed fills mark execution history unavailable.
- [x] Rejected trade-history snapshots cannot replace saved history or establish a baseline.
- [x] Concurrent live execution updates are preserved when an earlier REST history request completes.
- [x] Active-order REST results superseded by a newer live snapshot are discarded before validation/publication.
- [x] Live-fill events carry their originating session; the listener checks the current admin session and is removed when the stream stops or moves to a non-admin session.
- [x] New execution-history warnings are localized in English and Russian.
- [x] Worker/shared-server modules, persistence contracts, cloud revision/encryption, and financial formulas remain unchanged.

## Regression coverage

- [x] Missing, malformed, and explicit-empty trade-history envelopes.
- [x] Incomplete execution rows and malformed optional order fills.
- [x] Missing/malformed active-order collections and unidentified rows.
- [x] Incomplete portfolio arrays, malformed rows, and invalid USD amounts/quantities.
- [x] Live execution updates arriving during an older REST history request.
- [x] Superseded REST order snapshots, malformed stream snapshots, previous-session fills, and listener cleanup.
- [x] Russian localization parity for the new execution-history warning.

## Deferred or manually unverified

- Live authorized Freedom/TradeNet traffic was not available in CI. Confirm active-order and execution-history payload shapes against sanitized production responses before relying on strict validation for unrepresented provider variants.
- Cashflow-history baseline behavior, quote-provenance rules, persistence/cloud coordination, and financial accounting were not redesigned by this PR.
- Existing reconnect/retry behavior was retained rather than reworked.

## Validation

The earlier pre-#313 exact-head run passed TypeScript, 1,490 Vitest tests across 124 files, production build, Chromium production smoke, dead-code validation, and both dependency audits. The final combined tree is being revalidated after #313 merged to `main`.
