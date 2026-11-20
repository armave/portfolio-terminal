# Remaining work — implementation plan

**Status:** Delivery plan for the active PT-02, PT-04, PT-05, PT-16 and PT-17 issues.  
**Plan date:** 2026-11-17  
**Planning baseline:** `main` and `dev` at `4089d2f7f79f2e66931ca939edcb762e40399257`.  
**Completed issue:** [#553 — financial mutation inventory and replay disposition](https://github.com/armave/portfolio-terminal/issues/553) was closed after its caller-by-caller matrix and exact-head validation evidence were merged.

This plan sequences the remaining work. It does not mark manual, security-reviewed, owner-approved or production-verification gates as complete merely because a design, mock, or CI test exists.

## 1. Delivery rules

1. Keep `PortfolioState.positions` and the existing snapshot fields canonical. No ledger cutover, financial formula/rounding change, automatic broker posting or guessed transaction event is included in this plan.
2. Never turn missing, stale, malformed, partial or unavailable financial observations into zero or current values. Preserve last-known-good data and explicit incomplete/unsupported classifications.
3. Keep backend Worker/Durable Object-only changes separate from frontend/documentation delivery: deploy compatible server functionality to `main` and verify the exact deployment SHA before enabling dependent client behavior through a PR to `dev`.
4. Every implementation PR must contain a concrete, reviewable diff and relevant tests. Use `Refs #N` while an issue has remaining acceptance criteria; use `Closes #N` only when every acceptance criterion and manual gate for that issue is satisfied.
5. Update both English and Russian user-facing copy and locale-parity tests for any UI-facing change. Preserve responsive behavior, accessible journeys, admin/guest permissions and account isolation.
6. Record exact PR head, merge SHA, CI/security workflow links, deployment evidence and remaining manual gates. Mocked CI must never be described as live provider or production-account proof.

## 2. Current issue map

| Area | Active issues | Delivery meaning |
|---|---|---|
| PT-02 transaction integrity | [#507](https://github.com/armave/portfolio-terminal/issues/507), [#554](https://github.com/armave/portfolio-terminal/issues/554), [#555](https://github.com/armave/portfolio-terminal/issues/555) | Complete replay/restore acceptance and authenticated provider/device rehearsals |
| PT-03 / PT-17 live integration | [#562](https://github.com/armave/portfolio-terminal/issues/562) | Authenticated TradeNet account stream, Closed History and Market Depth lifecycle evidence |
| PT-04 reconciliation | [#567](https://github.com/armave/portfolio-terminal/issues/567) | Deterministic transaction matching, discrepancy evidence and reviewed resolution proposals |
| PT-05 tenancy | [#539](https://github.com/armave/portfolio-terminal/issues/539), [#556](https://github.com/armave/portfolio-terminal/issues/556), [#557](https://github.com/armave/portfolio-terminal/issues/557), [#558](https://github.com/armave/portfolio-terminal/issues/558) | Canonical ownership/authorization, isolated data plane, then parity-checked migration |
| PT-16 security/privacy | [#546](https://github.com/armave/portfolio-terminal/issues/546), [#548](https://github.com/armave/portfolio-terminal/issues/548), [#549](https://github.com/armave/portfolio-terminal/issues/549), [#550](https://github.com/armave/portfolio-terminal/issues/550), [#551](https://github.com/armave/portfolio-terminal/issues/551), [#552](https://github.com/armave/portfolio-terminal/issues/552) | Production digest smoke, approved key lifecycle, data lifecycle, browser security and security sign-off |
| PT-17 reliability/release | [#547](https://github.com/armave/portfolio-terminal/issues/547), [#559](https://github.com/armave/portfolio-terminal/issues/559), [#560](https://github.com/armave/portfolio-terminal/issues/560), [#561](https://github.com/armave/portfolio-terminal/issues/561) | Performance fixture/baseline, approved telemetry, effective rulesets and release runbooks |

## 3. Dependency-ordered implementation sequence

### Wave 0 — release controls and reproducible evidence

**#561 — GitHub protection and release rulesets**
- Complete the effective settings audit with a repository administrator: required checks, review requirements, stale approval dismissal, conversation resolution, bypass actors, force-push/deletion restrictions and Cloudflare production environment reviewers/branch restrictions.
- Activate a reviewed `dev` ruleset and require the actual CI/security checks on `main` and `dev`. Do not globally require the path-filtered Financial Integrity Regression check unless unrelated paths report a successful no-op.
- Validate the settings after saving and retain screenshots/exported ruleset evidence. The currently available read-only repository ruleset snapshot is recorded in `docs/ci/github-settings-follow-up.md`; a documentation PR cannot itself enforce settings.

**#559 — desktop/mobile performance**
- Merge the environment metadata/reporting improvement, then manually dispatch Pull Request CI with 10 samples per viewport and retain the exact artifact and SHA.
- Confirm runner/browser/viewport metadata and compare repeated samples on like-for-like runner configurations; treat the 10-sample nearest-rank p95 as descriptive, not a stable production percentile.
- Reuse the existing authenticated synthetic benchmark in `scripts/browser-smoke-operations.mjs`: it already bootstraps an admin through the application flow, seeds local-only synthetic portfolio state, receives a deterministic mocked broker snapshot and captures three desktop plus three mobile samples. It is not a real account or broker test.
- Extend that existing benchmark rather than building a duplicate harness: expand the seed beyond its current single AAPL position (5 shares, one tranche) to representative multi-position, multi-tranche, closed-history and transaction-journal tiers using the supported schema/import path; prove exact seed parity after startup and mocked broker reconciliation before timing.
- Add environment metadata to the authenticated artifact, run at least 10 samples per viewport under a reproducible runner/browser profile, and measure authenticated startup, desk navigation, portfolio calculation/rendering, refresh/reconciliation and memory where available. Keep this artifact separate from the unauthenticated app-shell baseline.

**#560 — privacy-approved telemetry**
- First inventory all browser, Pages, Worker, Durable Object and third-party logging/telemetry sinks.
- Obtain approval for purpose, field allowlist, retention, sampling, access and deletion before enabling new collection.
- Then add bounded error categories and non-identifying correlation IDs; remove raw error/provider payload/URL logging where unsafe, and prove the policy with captured-log tests across success, failure, authentication and provider paths.
- Bounded client-side residual-log remediation is tracked by [#623](https://github.com/armave/portfolio-terminal/issues/623) and implemented in [PR #624](https://github.com/armave/portfolio-terminal/pull/624): guest-directory, market-news/deep-data, broker-runtime fallback, and portfolio-store exception paths now use the existing allowlisted diagnostic helper. This does not enable telemetry collection or satisfy the broader sink inventory, privacy-policy, retention, correlation-ID, or live-log-review gates in #560. A second bounded client slice is included in [PR #641](https://github.com/armave/portfolio-terminal/pull/641): portfolio/closed-history storage, session validation, PWA startup and browser-profile repair exception paths now route through the same allowlisted diagnostic helper, with sentinel-based captured-log and source-boundary regressions. It still does not establish the complete Pages/third-party sink inventory or privacy/retention approval.
- The server provider-metric helper is hardened by [#630](https://github.com/armave/portfolio-terminal/issues/630): Worker commit `613d95a18591683d0b38e3ef228ff256d9e3945e` enforces fixed metric/provider and scalar-field allowlists. Cloudflare deployment succeeded in [run #44508197210](https://github.com/armave/portfolio-terminal/actions/runs/44508197210), publishing Worker version `a7a00111-962b-42f2-9a7b-3a586e8f57e2`. Captured provider success/cache/failure and auth-edge over-limit/limiter-failure tests are included in the test follow-up. [PR #643](https://github.com/armave/portfolio-terminal/pull/643) fixed cross-test contamination from the earlier intentional Finnhub 429 cooldown and merged to `main` at `8d2ffb19ff638eafacea3480e802bcde06bf8825`. Exact-main post-merge Pull Request CI [#44535957644](https://github.com/armave/portfolio-terminal/actions/runs/44535957644), Financial Integrity Regression [#44535957701](https://github.com/armave/portfolio-terminal/actions/runs/44535957701), Security & Workflow Validation [#44535957418](https://github.com/armave/portfolio-terminal/actions/runs/44535957418) and Pages deployment [#44535957385](https://github.com/armave/portfolio-terminal/actions/runs/44535957385) passed. This bounded code/test/deployment slice does not satisfy the remaining #560 privacy approval, retention/access policy, full sink inventory, correlation-ID or live-log-review gates.
- Explicit Manual Sync executed-history catch-up is delivered by [#633](https://github.com/armave/portfolio-terminal/pull/633), merged to `dev` at `f4a43d4187b54b6eb2ecae01009874d4ce2b959a`. Startup and ordinary broker refreshes remain stream-first; only the waitable Manual Sync path performs a bounded, session-scoped REST catch-up after a complete history baseline exists. Newer live execution updates are protected from stale REST results. Full CI, Financial Integrity Regression, production browser smoke and Operations Browser Journey passed on the exact tested PR head.

### Wave 1 — close remaining PT-02 and live provider gates

**#555 and #562 — authenticated TradeNet validation**
- Use an authorized non-sensitive test account; record sanitized UTC timestamps and exact client/Worker SHAs without credentials, account identifiers or raw broker payloads.
- Exercise session refresh/expiry/re-authentication, balances, positions, fills, cashflows, corporate actions, fees, incomplete responses, rate limits, reconnect/recovery and idempotency.
- For #562, separately exercise account-stream startup/reconnect/teardown, Closed History and Market Depth stale, no-data, error, reconnect and unsubscribe states.
- Keep deterministic mocked results distinct from live evidence. Do not infer missing provider amounts, currencies, prices, fees or timestamps.

**#554 — cloud restore and multiple-device recovery**
- Rehearse structured backup export/import, authenticated cloud restore, workspace/account switching, stale revision conflict, two-device disjoint preference changes and conflicting financial changes, network interruption and recovery.
- Verify snapshot/journal/closed-history/FIFO/cash/debt parity and last-known-good preservation using sanitized checksums/revisions.
- Do not proceed with destructive test data or real portfolio replacement; use an isolated test workspace and explicit replacement intent.

**#507 — PT-02 parent**
- After the above, finish remaining supported-path replay and failure-injection gaps and update the PT-02 workstream record.
- Keep unsupported legacy lots, unlinked fee rows, broker evidence and incomplete closed-history replay explicitly incomplete. The already-completed #553 mutation-path inventory is one child deliverable, not proof that #507 is complete.

### Wave 2 — PT-16 design approval and security verification

**#548 — encrypted digest production protocol**
- Run the documented authenticated smoke with a disposable non-sensitive test digest: reject legacy plaintext writes; encrypted write/read succeeds; stale revision returns 409; post-deployment inventory reconciles; cleanup is verified.
- Retain only sanitized status codes, timestamps, Worker version, revisions/ETags and counts. Never attach tokens, cookies, ciphertext or financial content.

**#549 — tenant key architecture**
- Obtain security review and owner decisions on KEK custody/provider, browser DEK grant versus server-mediated encryption, guest projection keys, envelope/AAD format, recovery, backup, revocation and deletion semantics.
- The existing ADR is proposed, not approved. Do not implement key provisioning or migrate production keys until the decision is accepted.

**#551 — retention, export/deletion and AI privacy**
- Obtain data-owner/privacy decisions for each storage surface, backup expiry, export completeness, account/workspace deletion, external Gist copies, AI provider disclosure and prompt minimization.
- Convert approved decisions into explicit contracts and tests. Keep reset distinct from deletion and cryptographic erasure claims bounded by every recoverable copy.

**#552 — browser CSP, XSS and credential exposure**
- Complete source/production-artifact inventory of URL, HTML, navigation, script, style and media sinks; retain the focused article URL regression tests as one bounded slice.
- Resolve the GitHub Pages response-header/CSP rollout mechanism and inline-style constraints before enforcing a policy.
- Add hostile article/import/provider-error fixtures and credential/account-switch browser checks; obtain security review before enforcement or hosting changes.

**#550 — key lifecycle implementation**
- Start only after #549 is approved and the chosen key-management provider/custody owner is available.
- Implement tenant-bound envelopes and server-side authorization, resumable KEK/DEK rotation, revocation, recovery, backup and deletion behavior with wrong-key, stale-version, interruption, concurrency and failed-persistence tests.
- Do not reuse the shared workspace key as a tenant key. Do not rotate or destroy production key material as an ad-hoc test.

**#546 — PT-16 parent**
- Close only after #548 production protocol evidence, #549 accepted architecture, #550 lifecycle implementation/rehearsal, #551 approved privacy lifecycle, #552 security review and any related #560 logging obligations are complete.

### Wave 3 — PT-05 tenant ownership and migration

**#556 — canonical ownership and server authorization**
- Define canonical tenant/workspace/portfolio ownership, immutable ownership rules, principal resolution, grants/capabilities and revocation semantics.
- Add adversarial public Worker tests for guessed IDs, wrong tenant, same-tenant without grant, guest-to-admin escalation, alternate routes, batch requests and revoked active streams.
- Obtain security review before enabling financial routing.

- **Bounded safe-directory hardening delivered on main** at [b97534690cbfd6f3ced577a4db30f437af306d2e](https://github.com/armave/portfolio-terminal/commit/b97534690cbfd6f3ced577a4db30f437af306d2e): persisted tenant metadata now fails closed on duplicate identifiers, broken ownership references, role-capability escalation and stale/duplicate active grants. Corruption tests prove the stored directory is preserved on rejection. [Cloudflare Worker deployment #44688202036](https://github.com/armave/portfolio-terminal/actions/runs/44688202036) and [Financial Integrity Regression #44688202219](https://github.com/armave/portfolio-terminal/actions/runs/44688202219) passed on the exact SHA. This is one metadata-integrity slice, not complete #556 ownership authorization or approval for tenant financial routing.

**#557 — isolated tenant Durable Object**
- Implement only after #556 authorization and #549/#550 key contracts are accepted.
- Add tenant-scoped storage and an authenticated Worker-to-DO trust assertion; reject client-controlled tenant/DO routing and direct invocation.
- Keep `financialDataEnabled=false` until cross-tenant, key-binding, revision, idempotency, atomicity, legacy admin/guest compatibility and public-boundary tests pass.

**#558 — legacy migration and rollback**
- Build a dry-run ownership map; report orphaned and ambiguous records.
- Copy canonical snapshot, append-only journal, closed history, FIFO lots, cashflows, broker evidence, revisions and metadata idempotently.
- Prove record-level financial/journal parity, revision safety and rollback after partial migration before any cutover. Obtain explicit security and owner approval.

**#539 — PT-05 parent**
- Close only after authorization, data-plane isolation, tenant key lifecycle and rehearsed parity/rollback are accepted. Maintain the existing admin/guest behavior until explicit cutover approval.

### Wave 4 — PT-04 broker reconciliation

**#567 — transaction-level reconciliation**
- Begin after PT-02 event identity/correction semantics and #555/#562 live provider evidence are accepted.
- PR A: deterministic execution matching, provider IDs/fallback keys, duplicate/reordered/partial/corrected classification and stable snapshot reproducibility.
- PR B: typed cashflow, dividend, fee, currency, amount, price, freshness and timestamp discrepancy evidence.
- PR C: accessible English/Russian discrepancy drill-down and explicit user-confirmed resolution proposals through audited PT-02 commands.
- Preserve read-only-by-default behavior. Never rewrite app FIFO lots, cash, cost basis, fees or P&L from broker aggregates. Do not create placeholder PRs; each slice needs implementation and tests.

### Wave 5 — PT-17 closeout

**#547 — reliability, performance and observability**
- Close only after #559 representative baseline/fixture, #560 approved and enforced telemetry/redaction, #561 effective release rules and #562 live provider lifecycle evidence are complete.
- Add bounded operational dashboards/alerts and runbook ownership where the deployed platform supports them.
- Link exact manual and automated evidence by SHA; do not treat mocked CI as production service-level evidence.

## 4. PR and release slicing

| Change type | Delivery |
|---|---|
| Frontend, UI, client-side domain and related client docs | Focused feature branch from latest `dev`; PR targets `dev` |
| Worker, Durable Object or server-only code | Focused backend change delivered directly to `main`; verify deployment workflow and exact deployed SHA |
| Mixed server/client dependency | Deliver backward-compatible server boundary first, verify deployment, then enable client behavior in a separate `dev` PR |
| Security/privacy-sensitive or financial mutation changes | Separate contracts, tests and review; no hidden formula, storage, authorization or policy changes |

Every PR should state: linked issue(s), concrete scope, acceptance criteria completed, tests and workflow links, localization parity, security/permission impact, responsive/accessibility evidence, exact base/head SHA, deployment dependency, manual gates and residual risk. An issue stays open until its own complete acceptance criteria are evidenced.

## 5. External inputs required before gated work

| Input | Needed for |
|---|---|
| Authorized non-sensitive TradeNet test account and sanitized operator results | #555, #562 and downstream #567 |
| Isolated test workspace plus two physical/authenticated devices | #554 |
| Repository administrator confirmation of ruleset/environment settings | #561 |
| Data-owner and privacy/security approval of telemetry and retention | #560, #551 |
| Security approval and selected key-management provider/custody owner | #549, #550 and PT-05 tenant storage |
| Explicit owner/security approval of migration and rollback | #558, #539 |

Until these inputs exist, the affected issues remain open with implementation designs and test plans only; no production data, credentials, keys or financial state should be modified to simulate acceptance.
