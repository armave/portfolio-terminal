# Combined acceptance record — PT-02, TradeNet, reconciliation and performance

**Review baseline:** `dev` `f243e7a1f40710a9a53300919d9f6db1315c4b29`  
**Delivery:** one client/domain/documentation PR targeting `dev`  
**Issues:** [#685](https://github.com/armave/portfolio-terminal/issues/685), [#686](https://github.com/armave/portfolio-terminal/issues/686), [#687](https://github.com/armave/portfolio-terminal/issues/687), [#688](https://github.com/armave/portfolio-terminal/issues/688), [#689](https://github.com/armave/portfolio-terminal/issues/689)

## Acceptance rule

This document separates implementation evidence from authenticated operator evidence. Passing deterministic unit, Worker-mock or browser-fixture tests is not a PASS for physical-device, live TradeNet, cloud restore on an authenticated workspace, or real-provider lifecycle requirements. Each manual scenario must be recorded as PASS, FAIL, BLOCKED or NOT APPLICABLE with UTC time, exact client SHA, deployed Worker SHA/version, environment and sanitized evidence. No issue is closed by this PR alone.

## Current implementation evidence

| Issue | Existing implementation and automated evidence | Remaining acceptance |
|---|---|---|
| #685 — recovery/two devices | Backup normalization and atomic import tests, local persistence rollback tests, cloud snapshot conflict tests, explicit backup export and conflict recovery in the Operations Browser Journey. Cross-account and stale-session guards are exercised by deterministic tests. | **BLOCKED — external:** one isolated administrator workspace, two separate authenticated physical devices, real cloud revision/ETag evidence and deployed Worker identity/version. Rehearse export/import, replace-from-cloud, reset/reload, interrupted network and conflicting financial edits. |
| #686 — transaction integrity | The maintained PT-02 workstream includes a caller-by-caller mutation inventory, atomic snapshot/journal commit tests, idempotency/conflict tests, backup/import/reset failure injection, cloud revision conflict protections and shadow journal/lot/closed-history parity. Unsupported/legacy histories remain explicitly incomplete. | **BLOCKED — review and external:** owner review of the inventory against the final candidate, followed by #685 recovery acceptance and authenticated TradeNet refresh. No ledger cutover, guessed lot, cost basis, chronology, fee or P&L. |
| #687 — live TradeNet | Deterministic account-stream tests cover ticketed startup, channel forwarding, session isolation, heartbeat, reconnect and teardown; health tests gate fallback by account session and stream recovery; Market Depth tests cover first-book timeout, timestamps, ticker binding, error and unsubscribe. Manual Sync history catch-up is bounded and session-scoped. | **BLOCKED — external:** authorized non-sensitive TradeNet test account and exact deployed Worker version. Verify account/history/cashflow rows, stream lifecycle, stale/error/rate-limit behavior, real bid/ask observations and repeated Market Depth open/close. Mocked provider responses are not live evidence. |
| #688 — reconciliation | Deterministic read-only engine tests cover stable IDs, fallback/ambiguity, duplicates/revisions, partial fills, timing, fees/currencies/cashflows and incomplete evidence. Discrepancy UI has source drill-down, review notes and localized type-specific review guidance. This PR adds a separate localized read-only resolution proposal for each supported activity finding. | **BLOCKED — external/dependent:** compare against accepted PT-02 semantics and live #687 data; browser-review proposals against actual provider discrepancies. Any later writeback requires a distinct explicit PT-02 command, confirmation and audit evidence. |
| #689 — representative performance | The authenticated synthetic fixture is deterministic: 100 positions, 200 stable lots, 10 linked closed trades and 220 journal events; Vitest checks event schema, snapshot and FIFO/closed-history parity. The authenticated Operations Journey captures desktop/mobile stage, resource, DOM, optional heap, environment and distribution data; missing metrics remain null. CI manual dispatch accepts 10 samples per viewport by default. | **BLOCKED — workflow evidence:** manually dispatch Pull Request CI at the chosen candidate SHA, retain both artifacts, and compare at least 10 successful same-runner/browser workflow runs. Review variance/outliers before suggesting thresholds; no live broker or real-user performance claim. |

## Changes in the consolidated PR

1. **PT-04:** add a distinct `Resolution proposal (read-only)` for every supported broker execution/cashflow activity finding. Proposals describe evidence gates and safe next steps; they do not select candidates, invoke store mutations, post corrections or change financial state. English/Russian parity and no-writeback behavior are tested.
2. **PT-17:** isolate manual `workflow_dispatch` runs with a unique run-ID concurrency suffix. Repeated ten-sample benchmark runs on the same candidate no longer cancel each other. PR/push cancellation behavior remains unchanged.
3. **Evidence/docs:** refresh the stale performance fixture plan, document all five issue gates and link this durable acceptance record from the documentation index and Wave 3 map.

## Required operator evidence before closure

- **#685:** sanitized export/import and cloud-replace checksums/counts/revisions, plus Device A/B browser/OS/version and scenario results. No customer portfolio, credentials, tokens or ciphertext.
- **#686:** signed owner review of supported/unsupported mutation matrix and replay disposition, exact release SHA and financial/security CI.
- **#687:** authorized non-sensitive test account, exact Worker SHA/version, UTC times and sanitized provider observation/receipt metadata. Exclude account ID, SID, session token and raw financial payload.
- **#688:** exact matching examples from complete source feeds, reviewed proposal outcome and evidence that no silent write occurred.
- **#689:** two artifacts from a single manual dispatch with ten desktop and ten mobile samples each, plus at least ten comparable successful runs and a variance/outlier review.

## Safety and release boundaries

- `PortfolioState.positions` remains canonical; no journal-ledger cutover.
- Missing, stale, partial, malformed or unavailable values remain unknown/incomplete, never zero or implicitly current.
- Broker aggregates stay evidence-only. No automatic change to positions, FIFO lots, cash, debt, fee allocations, cost basis or realized P&L.
- No Worker, Durable Object, authorization, encryption/key, persistence-schema or production deployment change is included in this client PR.
- All external scenarios remain explicitly BLOCKED until their required authorized workspace, account, devices, Worker version and operator evidence are supplied and reviewed.
