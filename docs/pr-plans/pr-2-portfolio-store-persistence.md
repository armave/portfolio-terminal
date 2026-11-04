# PR 2 — Portfolio store atomicity and persistence boundaries

**Status:** Draft implementation in progress. The branch now includes portfolio import-container validation and subscriber-notification isolation, with focused Vitest regression tests. The remaining audit and validation checklist is still open.

**Proposed PR title:** `refactor(store): harden portfolio mutations and persistence boundaries`

**Branch:** `refactor/portfolio-store-atomicity-2026-11`  
**Base:** `main` after PR 1 is merged. Until then, this draft may remain targeted at `main`, but implementation must not assume unmerged PR 1 changes are present.  
**Dependency:** PR 1 — financial-domain invariants and accounting parity.  
**Priority:** High. This PR protects portfolio data and state transitions.

## Goal

Improve maintainability and reliability of portfolio state transitions while preserving one canonical state owner, existing persisted formats, account/session behavior, quote-ordering safeguards, and rollback guarantees.

`PortfolioStore` remains the sole owner of portfolio state. This PR may extract cohesive pure validation, normalization, or transaction-preparation helpers, but must not create a second store or move ownership into components or services.

## Scope

- `src/store/portfolioStore.ts`
- Directly related existing store modules for defaults, migrations, subscriptions, selectors, and normalization, where present and verified.
- `src/services/storage.ts` and its tests only for directly related persistence-boundary work.
- Existing PortfolioStore, migration, defaults, subscription, and storage tests; add focused Vitest tests for uncovered cases.
- `src/types/portfolio.ts` only for necessary backward-compatible state contract changes.
- A focused store/persistence audit note and refinement-tracker update.

Do not modify Cloudflare Worker routes, Durable Object storage, encrypted cloud envelopes, or revision protocol in this PR.

## Implementation checklist

- [ ] Map every public store mutation to fields owned, validation rules, persistence behavior, and subscriber notifications.
- [ ] Identify remaining cohesive responsibilities coupled inside PortfolioStore; extract only where stable typed boundaries are demonstrated.
- [ ] Keep `positions` authoritative and `holdings` a derived compatibility projection.
- [ ] Preserve existing migration helpers and compatibility exports.
- [ ] Verify buy, tranche add/remove, partial sale, full liquidation, cash holding, cash/debt update, and closed-trade deletion for all-or-nothing mutation behavior.
- [ ] Ensure rejected operations do not partially mutate quantity, cash, debt, tranche data, closed history, timestamps, or persistence state.
- [ ] Ensure persistence failures are observable and do not leave in-memory state falsely marked as durably saved.
- [ ] Verify notification behavior: durable mutations notify with the correct source; rejected/no-op quote updates do not persist or notify unnecessarily.
- [ ] Verify quote updates apply to the latest state and reject stale request sequences/timestamps; a quote must not recreate a closed position or overwrite a later trade.
- [x] Validate import top-level containers before committing; malformed collection/object containers are rejected without replacing the committed snapshot. Focused tests cover malformed positions, cash holdings, history arrays, API-key maps, guest snapshots, and broker-account containers.
- [ ] Verify reset preserves established device/account configuration and role-specific settings while clearing only intended portfolio-owned fields.
- [ ] Verify legacy snapshot migrations and current exports remain compatible, including aliases and prototype-sensitive position keys.
- [x] Add focused failure/edge-case regression coverage for malformed imports and subscriber exceptions; existing atomic-persistence tests already cover storage write failures and closed-history sidecar rollback.
- [ ] Extend any remaining uncovered failure-injection cases for subscription cleanup and recovery after failure.
- [ ] Keep cloud revision coordination, encryption, guest/admin authorization, and session identity in their existing service/runtime owners.
- [ ] Record compatibility decisions and migration scenarios in the PR description and architecture tracker.

## Non-goals and guardrails

- Do not introduce a second portfolio store or independent `holdings` source of truth.
- Do not alter financial formulas or domain semantics established and tested by PR 1.
- Do not change backup schema or silently discard recoverable data.
- Do not move credentials, device-only preferences, or account/session identity into ordinary portfolio serialization.
- Do not change Worker routes, Durable Object storage, cloud encryption envelopes, or revision headers.
- Do not split methods just to reduce file size; each extraction requires a clear owner, typed inputs/outputs, and focused tests.

## Acceptance criteria

- [ ] All portfolio mutations remain routed through the canonical store.
- [ ] Invalid or failed operations cannot partially mutate portfolio state.
- [ ] `positions` remains canonical and `holdings` remains a compatibility projection.
- [ ] Existing persisted snapshots, exports, legacy migrations, and device/account settings remain compatible.
- [ ] Quote ordering and closed-position protections remain intact.
- [ ] Persistence failures are observable and recoverable; no silent data loss is introduced.
- [ ] Extracted helpers have stable contracts and focused tests; compatibility wrappers remain where required.
- [ ] TypeScript, Vitest, dead-code validation, audits, and production build pass on the exact PR head.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
```

Also verify existing browser journeys for backup import/export/reset, account switching, quote refresh ordering, and cloud conflict behavior. Report a journey as passed only when the relevant workflow actually ran against the exact PR head.

## Suggested commit sequence

```text
test(store): characterize atomic mutation and persistence failure behavior
refactor(store): isolate validated state-transition helpers
refactor(storage): preserve migration and rollback contracts
test(store): cover quote ordering and malformed import recovery
docs: record store and persistence boundary decisions
```

## Dependency and merge protocol

PR 1 must be merged first. After that, update/rebase this branch on the latest `main`, resolve conflicts semantically, rerun all validation, and only then request review/merge.

Do not stack this branch on a stale copy of main or silently reimplement domain behavior.
