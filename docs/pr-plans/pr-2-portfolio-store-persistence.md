# PR 2 — Portfolio store atomicity and persistence boundaries

**Status:** Implementation and audit completed on the PR branch. The final exact-head CI run is the release gate; this branch remains a draft until that run and the PR dependency sequence are confirmed.

**Proposed PR title:** `refactor(store): harden portfolio mutations and persistence boundaries`

**Branch:** `refactor/portfolio-store-atomicity-2026-11`  
**Base:** `main` after PR 1 is merged. Until then, this draft may remain targeted at `main`, but implementation must not assume unmerged PR 1 changes are present.  
**Dependency:** PR 1 — financial-domain invariants and accounting parity.  
**Priority:** High. This PR protects portfolio data and state transitions.

## Goal

Improve maintainability and reliability of portfolio state transitions while preserving one canonical state owner, existing persisted formats, account/session behavior, quote-ordering safeguards, and rollback guarantees.

`PortfolioStore` remains the sole owner of portfolio state. This PR may extract cohesive pure validation, normalization, or transaction-preparation helpers, but must not create a second store or move ownership into components or services.

## Audit findings and ownership decisions

The public store surface was reviewed against its callers, storage helpers, and existing tests. The state-transition ownership remains intentionally centralized; domain accounting and compatibility migration remain in their existing focused modules.

| Mutation family | Canonical owner and durability contract | Regression coverage |
| --- | --- | --- |
| `update`, `setState`, `importState` | PortfolioStore commits a normalized candidate through `saveState` before publishing it; malformed imports are rejected before update. | Persistence rollback, publication order, partial imports, malformed containers, subscriber isolation. |
| Buy, tranche, margin-sale, closed-trade operations | PortfolioStore owns the position, cash/debt, tranche, and closed-trade transition; FIFO and sale accounting remain in `portfolioTransactions` and `saleCostBasis`. | Buy, tranche add/remove, partial/full sale, invalid cost basis, confirmed-sale parity, persistence failure. |
| Cash-cushion holdings and cash/debt | PortfolioStore owns cash holdings, free cash, and debt; rejected input/removal requests do not commit. | Cash/debt mutations, atomic cash sale, invalid cash values, invalid removals. |
| Rollover and broker assumptions | Rollover fields commit together; broker assumptions and their separately preferred settings record now commit in one rollback-capable storage transaction. | Rollover atomicity, assumptions persistence failure/rollback. |
| Live/manual quote updates | Quote updates run against the latest state without durable persistence; request ordering, source timestamps, WebSocket arrival order, and post-trade protections stay in the store. | Stale response, sequence tie-break, source-time regression, closed-position, and no-op quote tests. |
| Reset and device navigation | Reset preparation remains in the store; the application-level reset commits portfolio, explicit empty history, and device view together. Desk navigation remains device-local. | Reset preservation, storage multi-key rollback, reset orchestration checks, device-view tests. |
| Subscriptions and transient UI state | Subscription cleanup stays with subscription helpers; listener failures are isolated. Pending confirmation state is published as derived/transient and is not serialized. | Immediate subscription, selector filtering, unsubscribe, listener failure, and transient-write tests. |

**Compatibility decisions:** `positions` remains canonical; `holdings` is rebuilt as a compatibility projection. Legacy local/cloud holdings migration and public compatibility exports remain in their existing migration module. Snapshot and history-sidecar formats are unchanged. Prototype-sensitive JSON ticker keys are normalized as ordinary uppercase own-properties. Device navigation, provider keys, broker assumptions, and session credentials retain their existing ownership boundaries.

**No additional extraction was justified:** after reviewing the mutation surface, remaining methods coordinate store commit/publication semantics while accounting and migration logic already have typed domain/module owners. Splitting those orchestration methods further would add indirection without a stable new boundary.

## Scope

- `src/store/portfolioStore.ts`
- Directly related existing store modules for defaults, migrations, subscriptions, selectors, and normalization, where present and verified.
- `src/services/storage.ts` and its tests only for directly related persistence-boundary work.
- Existing PortfolioStore, migration, defaults, subscription, and storage tests; add focused Vitest tests for uncovered cases.
- `src/types/portfolio.ts` only for necessary backward-compatible state contract changes.
- A focused store/persistence audit note and refinement-tracker update.

Do not modify Cloudflare Worker routes, Durable Object storage, encrypted cloud envelopes, or revision protocol in this PR.

## Implementation checklist

- [x] Map every public store mutation to fields owned, validation rules, persistence behavior, and subscriber notifications (see the ownership matrix above).
- [x] Review cohesive responsibilities; retain PortfolioStore as the commit/publication orchestrator and keep accounting/migration logic in existing typed modules.
- [x] Keep `positions` authoritative and `holdings` a derived compatibility projection.
- [x] Preserve existing migration helpers and compatibility exports.
- [x] Verify buy, tranche add/remove, partial sale, full liquidation, cash holding, cash/debt update, and closed-trade deletion for all-or-nothing mutation behavior.
- [x] Ensure rejected operations do not partially mutate quantity, cash, debt, tranche data, closed history, timestamps, or persistence state; invalid cash values and invalid removal identifiers now leave the committed snapshot unchanged.
- [x] Ensure persistence failures are observable and do not leave in-memory state falsely marked as durably saved; broker assumptions now share the rollback-capable snapshot transaction.
- [x] Verify notification behavior: durable mutations notify with the correct source; rejected/no-op operations and stale quotes do not publish unnecessary updates.
- [x] Verify quote updates apply to the latest state and reject stale request sequences/timestamps; a quote cannot recreate a closed position or overwrite a later trade.
- [x] Validate import containers before committing; malformed collection/object containers are rejected without replacing the committed snapshot, and valid partial imports retain omitted fields.
- [x] Verify reset preserves established device/account configuration and role-specific settings while clearing portfolio-owned fields; the app reset coordinator commits empty broker history and device view with the portfolio snapshot.
- [x] Verify legacy snapshot migrations and current exports remain compatible, including the `holdings` alias, credential/history separation, and prototype-sensitive position keys.
- [x] Add focused failure/edge-case regression coverage for malformed imports, subscriber exceptions, invalid/no-op mutations, broker-rule sidecar rollback, and successful recovery after a failed write.
- [x] Verify subscription cleanup and selector behavior remain covered; transient pending-confirmation changes are published as derived state without portfolio persistence.
- [x] Keep cloud revision coordination, encryption, guest/admin authorization, and session identity in their existing service/runtime owners.
- [x] Record compatibility decisions, mutation ownership, and remaining limitations in this audit note and the PR description.

## Non-goals and guardrails

- Do not introduce a second portfolio store or independent `holdings` source of truth.
- Do not alter financial formulas or domain semantics established and tested by PR 1.
- Do not change backup schema or silently discard recoverable data.
- Do not move credentials, device-only preferences, or account/session identity into ordinary portfolio serialization.
- Do not change Worker routes, Durable Object storage, cloud encryption envelopes, or revision headers.
- Do not split methods just to reduce file size; each extraction requires a clear owner, typed inputs/outputs, and focused tests.

## Acceptance criteria

- [x] All portfolio mutations remain routed through the canonical store.
- [x] Invalid or failed operations cannot partially mutate portfolio state.
- [x] `positions` remains canonical and `holdings` remains a compatibility projection.
- [x] Existing persisted snapshots, exports, legacy migrations, and device/account settings remain compatible.
- [x] Quote ordering and closed-position protections remain intact.
- [x] Persistence failures are observable and recoverable; storage rollback remains best-effort if the browser itself also rejects rollback writes.
- [x] No extraction was required; existing domain/migration helpers retain focused contracts and compatibility wrappers remain in place.
- [x] TypeScript, Vitest, dead-code validation, full and production dependency audits, Chromium production browser smoke test, and production build pass on the implementation head; the final documentation-only commit is rechecked by CI.

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


## Remaining limitations

- Browser `localStorage` does not provide native multi-key transactions. The storage service snapshots prior values and attempts reverse-order rollback; if the browser also rejects rollback writes, it logs the error and cannot guarantee repair.
- This PR does not change cloud revision coordination, encrypted envelopes, Durable Objects, authorization, or Worker behavior.
- The final branch must still be reconciled with the merged PR #303 domain contract before merge; PR #305 remains a separate frontend workstream.


## Exact-head validation record

- Implementation head: `8c41439857731ce6fecd3406cde577fe2dd5d348`
- GitHub Actions: [run 41773576184](https://github.com/armave/portfolio-terminal/actions/runs/41773576184) — **success**
- Passed steps: dependency installation, TypeScript typecheck, full Vitest suite, production build, Playwright runner setup, Chromium installation, production browser smoke test, dead-code validation, full dependency audit, production dependency audit.
- The only subsequent source change is this documentation record; CI is rerun against the new final head.
