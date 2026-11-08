# Portfolio Terminal — Portfolio Integrity & Reliability Implementation Plan

**Status:** Proposed for implementation  
**Prepared:** 2026-11-08  
**Coordination target:** `dev`  
**Implementation topology:** five independent workstream branches based on this plan branch

## 1. Objective

Raise confidence in Portfolio Terminal as an investment-management system by closing the highest-risk gaps in:

1. Position-data integrity and safe long-only accounting; full short-position lifecycle remains gated on broker-confirmed position semantics.
2. Margin exposure, collateral and risk calculations.
3. Transaction lifecycle, execution idempotency and broker reconciliation.
4. Encryption, authorization and independent portfolio ownership.
5. Market-data provenance, corporate actions and history reliability.

The goal is not to add more dashboard features. It is to ensure that holdings, cash, debt, equity, P&L, margin risk and access boundaries remain explainable and correct under real broker data, corrections, stale prices, and multiple users.

## 2. Guardrails and current repository context

- PR #391 ("Prevent false performance from cash-holding tracking changes") was merged into `dev` on 2026-11-08. Preserve its behavior and regression coverage; do not duplicate or overwrite its changes to `portfolioPerformanceIntegration.ts` or its tests.
- Do not infer TradeNet short-position sign conventions from a field name or from a negative sample alone. Obtain anonymized fixtures from the actual Freedom/TradeNet endpoints and record the observed semantics before mapping them.
- The existing application contains long-oriented position and valuation assumptions that require a full-path audit. A holding that cannot be classified must be marked unsupported/reconciliation-required; it must never disappear silently or be valued as zero.
- The existing margin model contains application-level assumptions. Keep broker-reported requirements, user-configured assumptions and estimates clearly separated. Do not present a default as a confirmed broker maintenance requirement.
- Margin Intelligence has a legacy plaintext compatibility path. Complete migration and validation before making strict encrypted-write enforcement irreversible.
- The current ownership model includes an owner workspace and restricted guest projections. Do not call that independent multi-tenant portfolio ownership. Server-side authorization must derive the principal from the authenticated session, not trust a client-supplied owner or tenant identifier.
- This is a plan and workstream contract, not evidence that any of the five implementation scopes are already fixed.

## 3. Non-negotiable financial and data invariants

### 3.1 Position and valuation invariants

- Every supported position has an explicit direction: `long` or `short`. The chosen canonical quantity representation must be documented once, with conversion at broker boundaries. Until TradeNet documents how current short positions are represented, the app must not create a canonical short direction from portfolio fields `t` or `k`.
- Preserve raw broker side, quantity, instrument identifier and source payload/metadata needed for audit. Normalize separately; do not discard the original evidence.
- Long market value, short liability/exposure, short-sale proceeds, cash balance, collateral and margin debit are distinct concepts.
- Do not subtract margin debt twice or count short-sale proceeds as free cash without broker evidence.
- Unknown side, invalid quantity, missing multiplier or unsupported instrument status must produce a visible incomplete/reconciliation state, not a fabricated position or zero value.
- Currency amounts retain their currency identity. Convert to a reporting currency only through a timestamped, sourced FX rate.

### 3.2 Margin and risk invariants

- Publish one typed risk-input contract consumed by summary cards, margin gauges, portfolio risk and stress scenarios.
- Keep total account equity distinct from eligible collateral and margin buying power.
- Keep initial margin, maintenance margin, concentration add-ons, borrow availability/fees and financing rate distinct.
- A missing broker requirement is **unknown**, not zero. Label estimates and configured assumptions as such.
- A risk result must include its input timestamp, quote/FX freshness and completeness status. Stale or incomplete inputs must reduce confidence or make the metric unavailable.

### 3.3 Transaction invariants

- Distinguish orders, executions/fills, cash movements and broker balance snapshots.
- Stable broker execution IDs and revision/correction identifiers must make imports idempotent.
- Partial fills remain separate executions or are aggregated only through an explicit deterministic rule; never assume an order equals one fill.
- A correction, cancel/replace or broker revision supersedes the correct prior record; it must not be counted as a second trade.
- Commissions, regulatory/exchange fees, taxes, dividends, interest, deposits and withdrawals have explicit event types and signs.
- Do not silently auto-correct positions or cash when broker reconciliation differs. Present a reviewable discrepancy and proposed resolution.

### 3.4 Security and tenancy invariants

- Authenticated identity and portfolio ownership are established server-side.
- Every read, write, export, backup and live update is scoped to the authorized portfolio/tenant.
- Client-supplied tenant/account IDs are selectors only; they are never authorization evidence.
- No new plaintext Margin Intelligence digest writes after the enforcement gate is enabled.
- Migration failure is visible and actionable; it must not silently downgrade to plaintext.
- Secrets, tokens, raw account payloads and decrypted digests must not appear in logs or error telemetry.

### 3.5 Market-data and history invariants

- Store price, quote timestamp, provider, market/session status, currency and stale/quality flags together.
- Never label a delayed or stale quote as live.
- Corporate actions adjust quantity and cost basis through explicit auditable events, not unexplained P&L.
- A missing FX rate or corporate-action mapping must be visible and must not silently produce a zero or a misleading return.
- Historical performance can be recalculated deterministically from preserved source events and valuation snapshots.

## 4. Six-PR delivery structure

The plan is PR 0. Five implementation PRs are child branches from the exact plan commit. Each child PR targets the plan branch, not `dev`, while the plan PR targets `dev`. This gives five workers a common contract and a single integration point.

| PR | Workstream | Branch | Primary outcome |
|---|---|---|---|
| #0 | Coordination plan | `plan/portfolio-integrity-reliability-2026-11-08` | Shared contracts, file ownership, dependencies and acceptance gates |
| #1 | Position integrity guard (long-only; short accounting gated) | `impl/position-integrity-short-support` | Preserve raw broker evidence and fail closed when current position direction or execution history is unsupported |
| #2 | Margin risk engine | `impl/margin-risk-engine` | One transparent, broker-aware risk model with explicit collateral semantics |
| #3 | Transaction integrity & reconciliation | `impl/transaction-reconciliation` | Idempotent fill history, corrections, fees and explainable broker differences |
| #4 | Security & portfolio isolation | `impl/security-tenant-isolation` | Complete encryption migration path and server-enforced portfolio boundaries |
| #5 | Market data, corporate actions & history | `impl/market-data-corporate-actions` | Quote/FX provenance, corporate-action accounting and reliable historical data |

### PR #1 — Position-data integrity guard (short accounting gated)

**Scope**
- Trace the existing TradeNet portfolio path from REST/WebSocket adapters through domain normalization, store state, valuation gates, persistence and backup/restore.
- Preserve the raw position row, quantity/sign, supplied side fields and instrument identifier separately from normalized values.
- Keep the existing positive-quantity long compatibility path; mark negative quantities, explicit short sides, unknown side codes, malformed positions and incomplete execution evidence as unresolved rather than guessing.
- Decode documented fields only in their correct context: `getTradesHistory.type` uses 1=Buy and 2=Sell; order-action `action_id` values are documented for order submission; undocumented numeric aliases are not mapped. `notifyPortfolio.t` is security type and `k` is security kind, not position direction.
- Detect explicit short-sale and cover evidence as unsupported activity in the long-only ledger; do not calculate short liabilities, proceeds, average cost or P&L.
- Retain the last accepted account/cash values for unresolved symbols; suppress margin/performance/guest projections that would otherwise treat unknown exposure as zero.
- Preserve the integrity evidence through local storage, backup import/restore and localized admin review.

**Out of scope / deferred**
- Canonical long/short position accounting and direction-aware short valuation. The published portfolio schema does not document a current-position side/sign field; no safe mapping can be established from `t`/`k`.
- Broker maintenance-margin policy and collateral haircuts (PR #2).
- Transaction revision/deduplication and correction semantics (PR #3), beyond recognizing available execution evidence.
- Corporate actions (PR #5).

**Acceptance**
- Positive long fixture remains compatible and raw broker evidence is retained.
- Negative/malformed/unknown-side position rows and explicit short/cover executions become visible unresolved findings; they are not applied as ordinary long holdings.
- Account balance, cash, margin-risk valuation, performance capture and guest publication fail closed while affected broker data remains unresolved.
- Local persistence and backup import/restore preserve position evidence and integrity findings.
- Vitest, i18n, typecheck, build and browser checks pass on the exact integration head.
- Short accounting remains explicitly deferred until authoritative current-position direction/sign semantics and independent hand-calculated fixtures are available; no test short trade is required.

### PR #2 — Margin risk engine

**Scope**
- Specify a typed risk-input model that separates long exposure, short exposure, cash by currency, margin debit, equity, eligible collateral and broker margin requirements.
- Audit every consumer of margin/equity: summary metrics, risk gauge, account overview, alerts, stress tools and any AI prompt/context.
- Route all consumers through one calculation boundary. Remove duplicated formulas and document which values are estimates versus broker-reported values.
- Add per-instrument or per-position requirements only where a verified broker field/contract supports them. Keep initial and maintenance margin distinct.
- Model financing interest separately from maintenance requirements; do not use an annual interest rate as a maintenance-margin proxy.
- Add stress scenarios and liquidation-distance/buffer outputs with freshness/completeness labels.
- Handle missing, stale, conflicting or currency-incompatible inputs as unknown/incomplete, never as zero.
- Consume the canonical position-exposure contract defined in PR #1 through a narrow adapter; do not edit PR #1's broker normalizer files.

**Out of scope**
- Changing how raw broker positions are classified (PR #1).
- Transaction ingestion or fee matching (PR #3).
- Worker tenancy/security changes (PR #4).

**Acceptance**
- Golden fixtures cover positive/negative cash, margin debit, long and short exposure, collateral haircuts, concentration, multiple currencies and missing requirements.
- Stress tests cover at least 10%, 20% and 30% adverse underlying moves and FX shocks where relevant.
- Dashboard, gauge and risk outputs use the same inputs and reconcile numerically.
- Every output identifies source timestamp, quote freshness, requirement provenance and whether it is broker-reported or estimated.
- Property tests assert no double subtraction of margin debit and no conversion of unknown requirements to zero.

### PR #3 — Transaction integrity & broker reconciliation

**Scope**
- Inventory order, execution/fill, cashflow, dividend, fee, financing and manual-adjustment paths.
- Define stable source keys using broker/account/execution identity plus revision/correction semantics. Avoid ticker/date/price-only identity where broker IDs exist.
- Correctly ingest multiple partial fills per order and preserve order ID separately from execution ID.
- Make import/replay idempotent; handle corrections and cancel/replace sequences without retaining superseded fills as active.
- Normalize commissions, regulatory/exchange fees, taxes, dividends, interest, deposits and withdrawals to explicit event types and signed amounts.
- Compare broker positions, cash/balances and execution history with app projections. Produce a discrepancy report with evidence and proposed actions.
- Require user review for state-changing reconciliation; keep raw broker evidence and audit trail.
- Keep the new behavior compatible with the performance-history availability rules from PR #391; do not reimplement that PR's cash-holding fix.

**Out of scope**
- Long/short valuation policy (PR #1).
- Margin requirement formulas (PR #2).
- Corporate-action mapping and historical quote backfill (PR #5).

**Acceptance**
- Fixtures cover duplicate sync, partial fill, correction, cancel/replace, same-day same-symbol executions, fee revisions, dividends and cash movements.
- Replaying an identical broker response produces no additional executions, cashflows or P&L.
- A corrected execution supersedes the old revision exactly once.
- Reconciliation explains each difference and never silently rewrites user state.
- Transaction history and resulting positions/cash reconcile with known expected balances.

### PR #4 — Security & portfolio isolation

**Scope**
- Threat-model current auth/session, guest projection, API, Worker, persistence, export/backup and live-stream boundaries.
- Inventory legacy plaintext Margin Intelligence records, determine a safe complete migration or deletion policy, and report migration completion without exposing contents.
- Make client migration failures visible; remove silent plaintext fallback behavior for new/updated records.
- Prepare strict encrypted-write compatibility in the client and tests. Enable strict Worker enforcement only after migration is proven complete.
- Implement independent portfolio/tenant authorization so the authenticated server-side principal controls access. Enforce tenant scoping for reads, writes, exports, backups and live subscriptions.
- Review session expiry/revocation, token rotation, origin/CSRF protections, security headers, error messages and secret redaction.
- Add cross-tenant negative tests (tenant A must never read, mutate, export or receive updates for tenant B).
- Preserve current owner/guest behavior only as an explicit compatibility mode during migration; document deprecation/upgrade path.

**Required deployment handling**
- This repository's standing instruction is to commit and push server-side and Cloudflare Worker changes directly to `main` for immediate deployment. Therefore the child PR contains client-side changes, domain contracts, migration tooling that is client-safe, tests and documentation. Any Worker/server authorization or enforcement code must be separately committed directly to `main`, with its production commit SHA, test results and rollout/rollback evidence recorded in this PR. Do not smuggle Worker changes through a `dev` PR.
- Do not flip strict encryption enforcement until migration inventory proves no supported active plaintext record would become unreadable. Roll out with a documented rollback switch that does not re-enable plaintext writes.

**Acceptance**
- Plaintext writes are rejected after the enforcement gate; legacy records are migrated or explicitly expired/deleted.
- Migration is idempotent and recoverable; failure is observable and never downgrades security.
- Cross-tenant API, storage, export and websocket/live-stream tests prove isolation.
- Session revocation takes effect for subsequent protected requests.
- Worker tests and production smoke pass before/after each enforcement step; deployment commit SHA is linked.

### PR #5 — Market data, corporate actions & history reliability

**Scope**
- Define market-data provenance: provider, instrument identity, currency, exchange, quote/last-trade timestamp, session status, delay flag and freshness state.
- Standardize quote freshness policy. Show stale/delayed/closed-market values accurately and prevent stale values from silently feeding live risk alerts.
- Audit FX conversion, rate timestamp, currency pair direction, fallback provider and missing-rate behavior.
- Add an auditable corporate-action event model for splits/reverse splits, dividends, symbol changes, mergers, spin-offs and other supported adjustments.
- Adjust quantity and cost basis deterministically and keep economic cash distributions separate from price/quantity adjustments.
- Make price and FX history corrections reproducible; keep source snapshots needed to explain prior P&L.
- Add data-health indicators and a recovery path for gaps without treating missing data as zero.
- Exercise backup/restore and multi-device sync against quote/history updates and conflict conditions without changing tenant authorization (PR #4).

**Out of scope**
- Broker fill deduplication and correction identity (PR #3).
- Position-side classification (PR #1).
- Margin policy/calculation (PR #2).

**Acceptance**
- Tests cover delayed/stale/market-closed quotes, provider outage/failover, missing FX and FX direction, split/reverse split, dividend, symbol change and correction/replay.
- Corporate actions preserve economic value in hand-calculated fixtures, except for legitimate market movement, fees and cash distributions.
- Replaying a corporate action or history correction is idempotent.
- Historical reports disclose gaps and do not invent prices or exchange rates.
- Backup/restore and multi-device conflict tests preserve event order and deterministic history.

## 5. Parallel implementation rules

The five workstreams have dedicated source ownership to minimize conflicts:

| Workstream | Primary ownership | Avoid editing |
|---|---|---|
| PR #1 | Broker position contracts, position normalization, position valuation and position fixtures | Margin UI/calculator; transaction reconciliation engine |
| PR #2 | Margin-risk domain, risk input adapter, summary/gauge consumers and risk tests | Broker position normalization; transaction journal ingestion |
| PR #3 | Transaction journal, broker execution reconciliation, fee/cashflow mapping and fixtures | Position classification; margin formulas |
| PR #4 | Client encryption/migration UI, auth contracts and client tests; Worker/server companion commits go directly to `main` | Financial valuation and quote pipelines |
| PR #5 | Market-data contracts, quote/FX freshness, corporate-action domain, history and restore tests | Broker execution matching; tenant authorization |

Rules:
- Each worker starts from its named branch, whose parent is the plan commit. Do not cherry-pick another workstream's in-progress commits.
- Honor the interfaces in this document. If an interface must change, update the plan contract first and notify all owners before coding.
- Keep common files and shared UI edits to the workstream owner shown above. Cross-workstream edits require explicit coordination.
- Add Vitest coverage for every important financial/security behavior. Add/maintain i18n keys for every user-visible string; never hardcode English-only errors.
- Do not use live broker credentials in CI. Use anonymized fixtures and clearly identify manual live-account verification still outstanding.
- Do not auto-merge a workstream solely because its code compiles.

## 6. Integration and merge order

Recommended integration order into the plan branch:

1. PR #1 establishes the fail-closed position-integrity boundary and records the provider's documented field limitations; it does not claim short-accounting support.
2. PR #3 establishes transaction identity/reconciliation and can proceed independently; reconcile its event model with the position contract before final merge.
3. PR #2 consumes PR #1's completeness/integrity status and must keep unsupported short exposure unavailable rather than estimating it.
4. PR #5 integrates corporate-action/history events against the position and transaction contracts.
5. PR #4's client-side branch merges when ready. Its Worker/server companion commits deploy to `main` only after migration and isolation gates pass.

All branches may be developed in parallel. The order above is an integration order, not a requirement to wait before beginning work.

PR #391 is already merged into `dev`. This plan branch was opened from the pre-merge `dev` head; GitHub's PR base tracks the updated `dev`. Before final promotion, verify the merge base and exact-head CI, and resolve any new `dev` changes without force-overwriting them.

## 7. Global verification and release gates

Required for each client/domain PR:
- Focused Vitest tests and the full relevant test suite.
- TypeScript typecheck, lint/static checks and production build.
- Browser smoke for changed user flows.
- i18n integrity checks for all supported locales.
- Performance/dead-code/dependency gates where configured.
- Regression tests proving pre-existing long-only workflows remain correct.
- PR checklist lists changed contracts, tests run, unverified assumptions and manual checks outstanding.

Required for financial workstreams:
- Hand-calculated golden fixtures independent from the implementation.
- Decimal/rounding and currency behavior reviewed.
- Unknown/stale/unsupported input tests.
- No false precision: show unavailable/incomplete rather than manufacturing a result.

Required before release:
- Exact-head CI green for all five PRs after integration.
- Worker tests and deployment smoke for direct-to-main server changes.
- Anonymized Freedom/TradeNet fixture review; manual authenticated broker validation documented separately.
- Backup/restore drill and multi-device validation.
- Final comparison of `main` and `dev`; reconcile branch drift intentionally, never by force-pushing or silently overwriting a branch.
- Rollback plan for each schema, crypto, or production behavior change.

## 8. Definition of done

The plan is complete only when:
- All five implementation PRs are merged into this plan branch and then promoted through the agreed `dev` → `main` path, except server/Worker companion changes which follow the direct-to-`main` rule.
- Financial invariants above are encoded in tests.
- Unsupported broker data is visible and explainable.
- Broker reconciliation can account for every difference without silent mutation.
- Margin outputs disclose source and confidence.
- Tenant boundaries and encryption enforcement pass negative tests.
- Quote, FX and corporate-action gaps are visible and historical calculations replay deterministically.
- Outstanding manual verification is explicitly recorded; no mocked test is represented as live broker proof.
