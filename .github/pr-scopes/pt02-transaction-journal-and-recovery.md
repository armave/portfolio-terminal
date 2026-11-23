# PT-02 — Transaction journal and recovery implementation

**Status: implementation PR; acceptance remains gated.**
**Issues:** [#686 — transaction integrity, replay and authenticated acceptance](https://github.com/armave/portfolio-terminal/issues/686), [#685 — authenticated cloud restore and multi-device recovery](https://github.com/armave/portfolio-terminal/issues/685)

## Scope delivered by this PR

This PR replaces the original scope-reservation charter with the implementation and acceptance record for the current PT-02 workstream. It is deliberately incremental: earlier accepted journal/store/recovery slices are already in `dev`; this PR must not duplicate them or claim that the whole PT-02 program is complete.

- Retain `PortfolioState.positions` and the existing snapshot fields as canonical.
- Keep `transactionEvents` append-only, schema-validated and additive.
- Preserve source/actor, effective/recorded timestamps, event IDs, idempotency keys and request fingerprints where supported.
- Keep broker executions/cashflows as evidence unless a distinct app-owned posting contract exists.
- Keep incomplete/unsupported legacy and ambiguous histories incomplete; never invent missing amounts, lots, cost basis, fees, chronology or realized P&L.
- Preserve atomic persistence: failed writes do not publish candidate state, journal rows or subscriber notifications.
- Keep imports and same-workspace cloud merge/replacement validated before commit; account/workspace switching remains a separate authenticated scope boundary.

## Existing implementation already present on `dev`

The following are **not new claims for this PR**; they are already implemented and recorded in the PT-02 workstream and issue #686:

- Journal event schema, duplicate event/idempotency rejection and import validation.
- Store-level atomic financial mutations and persistence-failure rollback.
- Backup/import journal preservation, same-workspace cloud merge/replacement validation and cloud revision conflict safeguards.
- Read-only broker execution/cashflow evidence, typed cashflow categories and source-reference revisions.
- Linked closed-history fee corrections and generic closed-history write guards.
- Cash-holding FIFO lot journal and supported corporate-action split lineage.
- Canonical snapshot quantity/balance reconciliation plus same-quantity accounting-detail observation.
- Reset and balance-setter failure-injection coverage.

See [PT-02 workstream record](../../docs/wave-3/workstreams/PT-02-transaction-integrity-completion.md) and [issue #686](https://github.com/armave/portfolio-terminal/issues/686) for prior slice SHAs and CI evidence.

## Current PR implementation and test evidence

This commit replaces the temporary reservation document with a current-state acceptance record. No financial formula, rounding, persisted accounting meaning, Worker route, Durable Object behavior, or deployment configuration is changed by this documentation update.

| Area | Current status | Evidence boundary |
|---|---|---|
| Mutation-path inventory | Implemented in prior merged slices and documented in the PT-02 workstream matrix | Store command/API boundaries are distinguished from actual production callers; unconnected APIs are not described as live UI flows |
| Duplicate identity and import validation | Implemented in prior merged slices | Duplicate IDs/keys and conflicting event histories fail closed before commit |
| Local transaction/state atomicity | Implemented in prior merged slices | Vitest failure-injection covers relevant store commits and subscriber behavior |
| Journal quantity/cash/debt replay | Existing additive replay/parity implementation | Replay is shadow/read-only; canonical snapshot stays authoritative |
| FIFO lot and closed-history parity | Partial by explicit source evidence | Legacy/unmapped lots, missing source allocations and incomplete history remain incomplete |
| Broker executions and external cashflows | Evidence-only unless separately supported app-owned posting exists | Refresh does not double-post aggregate broker facts into local balances or positions |
| Backup JSON export/import and local reload | Existing deterministic tests and prior accepted slices | Does not prove an authenticated production cloud restore |
| Cloud revision conflict handling | Existing client/Worker fixture coverage and prior accepted slices | Does not prove an actual two-device production recovery |
| Authenticated cloud restore | **Manual release gate — outstanding** | Requires owner-provided isolated test workspace and authenticated test session |
| Physical multi-device conflict/recovery | **Manual release gate — outstanding** | Requires two real authenticated devices; mocks and browser fixtures are not equivalent |
| Live TradeNet refresh after corporate actions/fee corrections | **Manual release gate — outstanding** | Requires authorized non-sensitive account and sanitized operator evidence |

## Exact-head validation for this PR

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:financial`
- [ ] `npm run validate:dead-code`
- [ ] `npm run audit:dependencies`
- [ ] `npm run audit:production`
- [ ] `npm run build`
- [ ] GitHub Actions PR CI and workflow-security checks on exact final head
- [ ] Review final diff for unintended financial/persisted-data/security/Worker changes

These checks are not marked complete until GitHub Actions reports results for the exact final PR head.

## Manual release gates — not completed by this PR's mocked tests

1. Rehearse backup export/import, authenticated cloud restore, reset and reload in an isolated non-sensitive test workspace.
2. On two authenticated physical devices, verify disjoint preference changes, conflicting financial changes, stale revisions, network interruption and recovery.
3. Verify snapshot/journal/closed-history/FIFO/cash/debt parity and last-known-good preservation using sanitized revision/checksum/count evidence.
4. Keep tested client/Worker SHAs and sanitized timestamps; do not attach credentials, account identifiers, tokens, ciphertext or financial payloads.

## Non-negotiable invariants

- `PortfolioState.positions` remains canonical; no ledger cutover is part of this PR.
- Missing, stale, malformed, partial or unavailable financial data is never converted to zero or treated as current.
- No inferred broker executions, synthetic acquisition lots, or guessed trade/fee/corporate-action event types.
- No generic trade/lot/corporate-action reversal until inverse quantity, FIFO cost basis, fees, cash/debt and realized-P&L semantics are specified and independently tested.
- Preserve account scoping, revision checks, atomic persistence, admin/guest permissions, and last-known-good recovery.
- No Worker/server-only changes are included; there is no backend deployment dependency.

## PR handoff checklist

- [ ] Objectives and implementation scope reviewed.
- [ ] Exact final-head CI links and SHA recorded.
- [ ] Localization: no user-facing strings changed.
- [ ] Security/permissions: no authorization or server boundary changes.
- [ ] Responsive/accessibility: no UI changes.
- [ ] Authenticated cloud restore manual evidence attached.
- [ ] Physical two-device recovery evidence attached.
- [ ] Owner review of remaining PT-02 unsupported/incomplete findings.
- [ ] #686 and #685 remain open until their individual acceptance gates are complete.
