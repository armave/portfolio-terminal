# Reliability, Performance, Observability & Release Gates

**Workstream:** PT-17  
**Tracking issue:** [#345](https://github.com/armave/portfolio-terminal/issues/345)  
**Implementation branch:** `feat/pt-17-reliability-release-gates`  
**Scope:** Release engineering, measurable reliability, browser performance baselines, privacy-safe operational signals, and repeatable manual release checks.

This document defines a measurable operating model. It does not claim that production SLOs or live-broker verification are already established.

## 1. Current automated validation

The repository currently provides these scripts:

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript static checks |
| `npm test` | Full Vitest suite, including Worker tests |
| `npm run build` | Typecheck and production build |
| `npm run validate:dead-code` | Knip-based dead-code/dependency validation |
| `npm run audit:dependencies` | Full dependency audit, including tooling; blocks high and critical advisories |
| `npm run audit:production` | Production dependency audit; blocks high and critical advisories |

The quality job runs the full and production-only audits independently after dependency installation. Each result is recorded separately and a final enforcement step fails the job if either audit fails; a full-tooling advisory therefore cannot silently skip the production-only audit.

The primary PR CI workflow runs the production browser smoke for the application shell. Dependabot npm and GitHub Actions version-update PRs target `dev`; security-update PRs remain on the default `main` branch. The path-filtered Financial Integrity Regression workflow runs focused deterministic reference-fixture, transaction-journal, cost-basis, portfolio-store, backup/reconciliation, and Worker/authentication tests when financial, persistence, or authorization paths change. The Operations Browser Journey workflow separately exercises account, settings, guest and accessibility-sensitive journeys.

The PT-17 changes extend this baseline by:
- validating merged `dev` commits as well as pull-request candidates and `main` commits;
- keeping the general CI browser journey focused on the app shell/operations surface while adding a targeted Vitest financial-integrity gate for financial, persistence, and authorization changes;
- recording the candidate commit, source PR head/base where applicable, workflow run, and each validation step's outcome in the GitHub Actions run summary;
- collecting repeatable desktop/mobile browser-shell performance samples as a CI artifact;
- running the path-filtered Financial Integrity Regression workflow on PRs and merged commits targeting `dev` and `main` when its high-risk paths change.

These automated journeys use deterministic mocked API responses. They do not prove authenticated production TradeNet behavior or live Market Depth behavior.

## 2. Exact-head release evidence

Every PR and release candidate should provide:
- tested commit SHA (for a PR, include PR head SHA and GitHub's tested merge SHA);
- workflow run URL and event/ref;
- typecheck, Vitest, build, dead-code and dependency-audit outcomes;
- browser smoke and operations-browser outcomes where applicable;
- any skipped check and the reason it was skipped;
- manual broker, Market Depth, responsive, accessibility, and recovery checks that apply to the touched paths.

A green result from an earlier commit is not evidence for a later candidate. Re-run required checks after any code change that affects the candidate.

### Required CI commands

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
```

The CI workflows execute these commands on pull requests. The main validation workflow also runs after merges to `dev` and `main`; deployment remains a separate `main`-branch responsibility.

## 3. Browser performance baseline

### Scope and limitations

`scripts/browser-performance-baseline.mjs` launches the built production preview, blocks service workers to avoid cross-run cache contamination, and intercepts the Worker API with deterministic unauthenticated fixtures. It captures three cold samples of the unauthenticated application shell at desktop (1440×900) and mobile (390×844) during routine PR/push CI. Manual Pull Request CI dispatch accepts 1–20 samples per viewport and defaults to 10.

The CI artifact `browser-performance-baseline` (schema version 2) contains the unauthenticated-shell measurements for each viewport. The report also records the aggregate byte size of the exact production `dist/` build artifact separately from browser resource-transfer bytes. This is a raw file-size total, not a compressed network bundle-size estimate. The report also records reproducibility metadata: OS platform and release, architecture, Node.js version, CPU model and logical processor count, GitHub runner image identifiers when provided by the runner, Chromium name/version, headless mode, and exact viewport dimensions. Unavailable environment properties remain `null`; they are not replaced with guessed defaults. Each sample records:
- first contentful paint (FCP);
- largest contentful paint (LCP), where supported;
- DOMContentLoaded and load event timing;
- response-start timing;
- browser-reported transferred resource bytes and resource count;
- time to render the unauthenticated sign-in/bootstrap shell (`authShellReadyMs`);
- cumulative layout shift (CLS), where supported;
- browser version, commit SHA, ref, and workflow run ID.

Initial application startup also has a bounded page-readiness gate: the full-screen overlay waits at most 12 seconds for the active desk. A timed-out lazy panel retains its local `DeskLoading` fallback, and the app-shell watchdog remains active until the overlay is actually removed. Vitest covers both readiness completion and timeout release.

The Operations Browser Journey captures an authenticated synthetic-portfolio artifact through the application bootstrap flow. Its local-only fixture contains 100 active positions with 200 stable open lots, 10 linked closed trades and 220 transaction-journal events. Before browser use, Vitest validates the event schema, snapshot replay parity, lot-level FIFO parity and closed-history linkage. The browser journey confirms the seeded portfolio counts survive startup and mocked broker refresh, and that each original fixture journal event ID remains present exactly once. Startup may append additional audit/reconciliation events, so the browser does not incorrectly require the total journal count to remain frozen; it does require all fixture events to remain intact. In this isolated performance context, cloud-state reads intentionally return “no saved cloud workspace” so a prior startup snapshot cannot replace the local benchmark seed. Its mocked historical execution response is generated from the same 220 journal events, using the documented TradeNet history side field (1=Buy, 2=Sell), so app-owned active lots, completed sales and broker quantities reconcile to the same 100-position fixture. The separate account/Settings Operations journey retains its original mock response and continues to exercise cloud synchronization and conflict recovery. Position quotes are explicitly synthetic/indicative, not live market observations. The Worker/broker responses remain mocks and do not prove authenticated production connectivity. Manual Operations Browser Journey dispatch supports 1–20 authenticated samples per viewport (default 10). Pull Request CI now forwards its selected count to the reusable authenticated workflow (manual default 10); ordinary PR/push runs retain three. The authenticated report adds per-stage bootstrap/authentication/fixture/mock-refresh/portfolio/Trades timings, DOM/resource/heap metrics where available, per-viewport distribution and Tukey-outlier summaries, plus commit/ref/run metadata. Unavailable measurements remain null. The authenticated artifact records the same OS/runner/Node/CPU/Chromium/viewport environment metadata as the app-shell report, with unavailable values left null.

The fixture now exercises 100-position/200-lot rendering, linked closed history and journal replay at that synthetic scale. It does **not** measure live broker latency, quote freshness, provider availability, or validate cash, margin, equity or account-level return calculations: the fixture is a deterministic performance/replay input, not an accounting oracle or a trading simulation. Use the separate financial-integrity and live-provider acceptance gates for those claims. Before establishing performance thresholds, dispatch Pull Request CI with `performance_baseline_runs=10` and require exactly ten successful samples for each viewport in one artifact. Review median/p95/variance/outliers, browser resource-transfer bytes, raw `dist/` artifact bytes, and environment metadata. Do not set thresholds from one run or from the three-sample PR smoke.

### Extended sample collection

The regular PR browser job keeps a short three-sample-per-viewport run to limit feedback time. A manual `workflow_dispatch` run of Pull Request CI passes its selected sample count to the app-shell browser baseline (default 10 per viewport); the input may be set from 1 to 20. The same input also reaches the separate authenticated synthetic portfolio/Trades benchmark. The script records sample count and per-metric minimum, median, nearest-rank p95, maximum, mean, population variance, and standard deviation in the JSON artifact.

A 10-sample p95 is descriptive (nearest-rank p95 is the maximum at this sample size), not a statistically stable production percentile. Compare the resulting artifact across at least 10 successful workflow runs on the same runner/browser profile before setting performance thresholds. These runs still measure the unauthenticated app shell with mocked Worker responses; they do not satisfy the authenticated large-portfolio fixture requirement in issue #559.

### Baseline protocol

1. Collect at least 10 successful workflow runs on the same runner/browser configuration before proposing automated performance thresholds.
2. Separate pull-request merge-candidate runs from post-merge `dev` and production `main` observations.
3. Compare medians and p75/p95 where sample volume permits; do not infer a percentile from three samples in one workflow.
4. Investigate regressions against the same viewport, browser version, build mode, and fixture.
5. Add thresholds only after a documented baseline and a review of normal CI variance. Keep noisy metrics informational until their variance is understood.
6. Add a verified authenticated portfolio fixture, realistic transaction-history tiers, additional portfolio sizes, and slower network profiles before setting SLOs for those journeys.

No numeric production SLO is declared by this PR. The first deliverable is a repeatable, attributable baseline rather than an arbitrary threshold.

### Desktop interaction responsiveness

The navigation path should acknowledge pointer and keyboard intent without adding a visible motion wait:

- Generic button feedback is limited to short color, background and border transitions (at most 100 ms); it does not animate brightness filters, transforms or shadows by default.
- Switching an already-mounted desk does not replay a parent-section entrance animation or wait for smooth scrolling. The workspace is positioned immediately after the active-view state changes.
- Lazy desk chunks are preloaded only when the matching navigation destination receives pointer hover or keyboard focus. This reduces first-open code-fetch latency without eagerly loading every desk during startup.
- The Operations Browser Journey checks the built app's computed navigation transition and desk-container animation. Unit tests cover role-aware prefetch mapping, duplicate intent coalescing and retry after a failed preload.

This is a UI behavior contract, not a production performance SLO. Browser timing observations remain environment-dependent and must not be reported as live-broker or user-device performance guarantees.

### Candidate service-level indicators

| Indicator | Definition | Evidence source |
|---|---|---|
| Shell readiness | Time from navigation start until the auth shell is visible | Browser baseline artifact |
| Initial visual rendering | FCP and LCP | Browser baseline artifact |
| Layout stability | CLS during initial shell load | Browser baseline artifact |
| Client runtime health | Uncaught page errors on critical browser journeys | Browser smoke workflows |
| Portfolio sync reliability | Successful sync attempts / eligible sync attempts, split by conflict, auth, network, and provider failure | Future privacy-safe operational events |
| Market data freshness | Age between provider observation and display/processing time, by provider and data type | Existing provenance fields plus future aggregate telemetry |
| Reconciliation health | Count/rate of unresolved discrepancies by safe discrepancy category | Reconciliation domain events |
| Alert processing | Trigger-to-delivery latency, failures, retries, and duplicate suppression | Future alert-processing events |
| Recovery success | Successful validated backup restores and sync-conflict recovery journeys | Browser and Worker regression tests |

Targets must be decided after the relevant data is collected. A missing observation must remain missing; it must not be converted to a zero-latency or healthy reading.

## 4. Privacy-safe operational observability

Operational telemetry should describe service behavior, not expose users' investments.

### Allowed aggregate dimensions

- event category (for example, provider request, stale-data detection, reconciliation result, sync conflict, alert evaluation, client runtime error);
- provider family or integration name when it does not reveal account identity;
- coarse success/failure outcome and normalized error class;
- duration and age buckets rather than full high-resolution traces where possible;
- application version, environment, release SHA, and workflow/run correlation;
- counts of retries, stale results, duplicate suppression, or validation failures.

### Prohibited by default

Do not emit:
- user, guest, workspace, portfolio, or account IDs;
- tickers, instrument identifiers, quantities, prices, balances, P&L, order details, or transaction payloads;
- broker credentials, session IDs, access tokens, encryption keys, or raw authorization headers;
- raw prompts, AI conversations, user notes, or full provider/broker responses.

If troubleshooting requires user-specific evidence, use an explicit, time-limited, user-authorized diagnostic flow with redaction and access audit—not general analytics telemetry.

Telemetry collection, retention, sampling, and export must be documented and reviewed with the security/privacy workstream (PT-16) before enabling a new production sink. This PR defines the event contract and does not add a third-party analytics service or transmit portfolio data.

## Stuck profile and service-worker recovery

The app checks its registered service worker for updates on each page load and reloads only when an existing controller is replaced. If startup remains pending for 30 seconds, the watchdog automatically removes only the app-scoped service worker and Workbox precache, then reloads with a cache-busting URL and a one-shot marker. The marker suppresses another automatic repair on the next load; if that load also stalls for 30 seconds, the manual recovery UI is shown instead of an automatic reload loop.

Portfolio localStorage, IndexedDB, device credentials, account sessions, and other apps' caches are preserved. This is not a logout or portfolio reset.

## Cloud-sync diagnostic retention and activity indication

The Settings diagnostics panel keeps only the three newest cloud-sync events in the current browser tab's `sessionStorage`. Entries contain allowlisted operation/outcome/reason values and optional HTTP/revision metadata only; credentials, URLs, encrypted payloads, and portfolio data are excluded. New entries are prepended and replace the oldest entry, and previously stored longer lists are truncated when loaded. This is a troubleshooting view, not an audit ledger or a cross-session history.

The header's pending activity state is signaled only when a changed portfolio snapshot is ready for an actual cloud write. Unchanged checkpoints do not flash the pending indicator. The header uses the shared delayed-activity controller: pending work is shown only after 700 ms, then remains visually continuous for at least 650 ms once shown. A new pending operation during that hold cancels the pending hide rather than restarting the show delay. The minimum duration is presentation-only; warning, error, and revision-conflict states override it immediately, while the underlying write cadence, revision checks, encryption, and conflict handling remain unchanged.

## Browser cloud-sync request deadlines

Cloud state and closed-history requests are part of authenticated workspace startup. Each cloud request has a 15-second default deadline that covers both response headers and JSON body consumption. A timeout aborts the request; a cloud-state pull then retains the already recovered local workspace and reports sync unavailable rather than leaving the startup overlay pending indefinitely. Idempotent writes retain their existing bounded retry behavior, with each network attempt subject to the same request deadline.

A failed or conflicted initial admin/guest pull is not considered a revision baseline: pending local cloud writes remain suppressed rather than being pushed with the last revision persisted on this browser. An accepted empty-cloud 404 (revision 0) is a valid baseline for first-time sync, while a missing record after a known populated revision remains a conflict. A successful startup pull may release deferred writes because it reconciles the current local snapshot against the accepted remote baseline. By contrast, an explicit user-confirmed **replace local from cloud** pull must cancel any debounced local checkpoint, wait for an already-running state write to settle before fetching, suppress new writes during replacement, and discard deferred pre-pull writes only after the cloud snapshot is successfully applied. If that replacement fails, the previous suppression state and any deferred local write are restored. This prevents a stale startup checkpoint from immediately overwriting the snapshot the user just chose. Authenticated portfolio-state and closed-history GET requests explicitly bypass the browser HTTP cache. The Worker and Durable Object also return `Cache-Control: no-store` for cloud-state responses, including revision-bearing success, missing-record and stale-write responses. A cached body paired with an outdated ETag can make a single browser session submit a stale `If-Match` revision and repeatedly trigger recovery on app open; cache bypass is therefore part of the revision-concurrency contract, not merely a performance preference.

The role-based automatic refresh scheduler is configured before that first workspace pull completes. Timer-triggered, manual scheduler, and visibility-triggered quote/broker/history refresh work must remain gated until the initial authenticated workspace pull has settled. Otherwise a routine local refresh can mutate the startup snapshot while the protected cloud reconciliation is still comparing local and remote state, producing a false overlapping-change conflict. The gate is released after the initial admin or guest pull settles, including a failed pull; the existing unavailable/conflict state and revision protections remain authoritative. Already-initialized authentication transitions must also close the same gate before publishing a new account and release it after that account's admin/guest pull settles. The asynchronous daily performance-valuation capture follows the same readiness boundary: it must not change protected `performanceValuations` after the cloud pull has captured its comparison baseline. Startup mutations are coalesced and the latest local valuation is captured after the account pull settles; any resulting cloud write remains subject to the existing startup-write suppression and revision checks. The Trades desk may hydrate its separate broker/cloud-history sidecar while the portfolio pull is in flight, but its cashflow fee-allocation pass must wait until that same workspace-sync boundary settles before committing changes to canonical positions, closed trades, or the transaction journal. This prevents desk startup reconciliation from changing the protected snapshot while the cloud pull is comparing revisions.

## 5. Manual release verification gates

Automated mocks are necessary but not sufficient. Mark each gate **PASS**, **FAIL**, **BLOCKED**, or **NOT APPLICABLE**, with date, candidate SHA, environment, and evidence. Never mark a gate passed if only a mocked test ran.

### A. Authenticated TradeNet account refresh

- [ ] Run against an authorized real TradeNet session in a controlled environment.
- [ ] Verify the authenticated portfolio snapshot is loaded and normalized.
- [ ] Compare broker-reported USD balance and aggregate quantities with the app's displayed broker snapshot.
- [ ] Verify app-owned lots and cost basis are not silently rewritten by aggregate broker data.
- [ ] Verify incomplete/invalid snapshots and failed authentication retain last-known-good data and show stale/unavailable status.
- [ ] Verify the REST fallback and failure path where safe and available.
- [ ] Confirm logs and browser payloads do not expose credentials, account identifiers, raw broker payloads, or the TradeNet session ID.
- [ ] Record whether an additional SMS/verification challenge blocks the current read-only flow.

### B. Market Depth real-browser lifecycle

- [ ] Open Market Depth from an authorized admin margin-position card.
- [ ] Verify the requested ticker is bound to the live stream and displayed instrument.
- [ ] Verify live bid/ask rows are rendered from the actual authorized stream; never infer live behavior from fixtures.
- [ ] Verify empty/no-data and upstream error states are clearly distinguishable.
- [ ] Verify transient disconnect, reconnect, timeout, and modal close behavior.
- [ ] Verify closing the modal closes both browser and upstream sockets.
- [ ] Verify repeated open/close does not leak sockets or duplicate streams.
- [ ] Verify the browser never receives TradeNet credentials or SID and the stream remains read-only.

### C. Responsive and accessibility journey

- [ ] Run production browser journeys at 320, 360, 390, 768, 1024, and 1440 CSS pixels where relevant.
- [ ] Check horizontal overflow, clipping, table readability, modal sizing, and touch targets.
- [ ] Check that visible controls have accessible names.
- [ ] Check keyboard navigation, focus order, dialog focus trapping, Escape handling, and focus restoration.
- [ ] Check that background content is inert/hidden when a modal requires isolation.
- [ ] Check English and Russian copy for clipping, missing translations, and layout regressions.
- [ ] Check reduced-motion preferences and screen-reader semantics for modified components.

### D. Persistence, backup, and recovery

- [ ] Validate JSON import before replacement and confirm the user is shown a preview/confirmation.
- [ ] Verify malformed, unsupported, oversized, or partial backups do not mutate current state.
- [ ] Restore a valid backup and compare important positions, cash, closed history, and settings.
- [ ] Exercise cloud revision conflict and recover without blindly retrying stale writes.
- [ ] Verify reload/restart recovery preserves committed changes and does not duplicate them.
- [ ] Keep a known-good backup before destructive migration or reset tests.

### E. Release and rollback

- [ ] Confirm all required exact-candidate CI checks passed.
- [ ] Review dependency audit results; document accepted exceptions and remediation issues.
- [ ] Review changed files for secrets, raw financial data, and unintended schema changes.
- [ ] Confirm any Worker/server-only change follows the repository's direct-to-`main` deployment lane.
- [ ] Confirm the deployment artifact is from the intended commit and environment.
- [ ] Keep the prior known-good deployment and backup/recovery procedure available.
- [ ] Record a rollback decision/owner and verify the application remains usable if an external provider is unavailable.

## 6. PR checklist

Use the repository PR template to record:
- workstream and related issue;
- files/areas changed;
- financial/persistence/schema impact;
- test commands and results;
- exact candidate SHA;
- English/Russian localization and accessibility impact;
- browser and manual checks;
- known limitations, skipped checks, and follow-up issues.

## 7. Completion status for PT-17

- [x] Define reliability indicators and a baseline-collection protocol without inventing SLO thresholds.
- [x] Add repeatable desktop/mobile unauthenticated-shell performance sampling with commit-attributed CI artifact output.
- [x] Run the primary validation workflow on pull requests and merged `dev`/ `main` commits.
- [x] Record exact candidate SHA, PR head/base, workflow URL, and individual check outcomes in the CI summary.
- [x] Run the production app-shell and Operations Browser Journey checks using the same production build artifact; retain deterministic mock limitations.
- [x] Document privacy-safe telemetry dimensions and prohibited portfolio/user fields.
- [x] Document authenticated TradeNet, real Market Depth, responsive/accessibility, recovery, and deployment release gates.
- [x] Add an authenticated synthetic-portfolio browser benchmark using the application's bootstrap flow and local-only Quick Buy paper-trade seed; CI records three cold samples each at desktop and mobile with mocked Worker/broker responses. This does not certify live broker behavior.
- [ ] Collect the first 10-run baseline set and review variance before setting thresholds. This PR leaves this limitation explicit.
- [ ] Collect the first 10-run baseline set and review variance before setting thresholds.
- [ ] Implement production telemetry only after the PT-16 privacy/security review and event-sink decision.
- [ ] Complete authenticated TradeNet and live Market Depth manual validation; this cannot be certified by mocked CI.
## 8. CI security and pipeline hardening — 2026-11-15

### PR validation layout

`Pull Request CI` is the single PR entry point. The `Static validation and unit tests` and `Production build and artifact` jobs run independently. The production build is uploaded once and reused by the `Production browser smoke and performance` job and the reusable `Operations Browser Journey` workflow. This removes repeated typecheck, Vitest, dead-code, dependency-audit, and production-build execution from the Operations workflow while retaining its independent account/Settings/guest browser journey.

The Operations Browser Journey remains manually runnable. A manual run builds the production site itself; a run invoked by PR CI consumes the exact build artifact from that workflow run. Both browser journeys remain deterministic and mocked; neither is evidence of live broker connectivity.

### Security and supply-chain checks

`Security & Workflow Validation` runs on pull requests, pushes to `dev` and `main`, manual dispatch, and a weekly schedule:

- CodeQL analysis for JavaScript and TypeScript.
- Gitleaks against commits introduced by the PR/push as a blocking gate, with secret contents redacted and only finding metadata reported. A separate scheduled/manual full-history audit is advisory so previously committed legacy matches remain visible without blocking unrelated PRs.
- actionlint validation for all checked-in GitHub Actions workflows.
- zizmor analysis for GitHub Actions security patterns, with medium-or-higher severity and confidence findings treated as failures.
- Dependabot weekly grouped updates for npm production/development dependencies and GitHub Actions.

All third-party Actions referenced by the PR, security, operations, and Pages workflows are pinned to immutable commit SHAs. The Cloudflare Wrangler action was already SHA-pinned and remains so. Dependabot monitors the pinned Actions for updates.

### Deployment validation

The Pages workflow now runs the production browser smoke against the exact build before uploading the Pages artifact. The Worker deployment remains restricted to `main` and now adds TypeScript validation, focused Worker/authentication tests, and both full and production dependency audits before deploying the pinned Wrangler action.

### Required checks and repository settings

Configure branch protection for `dev` (and `main`, if direct PRs are permitted) to require the PR validation jobs and security jobs. Expected PR checks are `Static validation and unit tests`, `Production build and artifact`, `Production browser smoke and performance`, `Operations Browser Journey / Account, Settings and guest browser journey`, `Workflow lint and security analysis`, `New-commit secret scan`, and `CodeQL JavaScript and TypeScript`. The scheduled/manual `Full-history secret audit (advisory)` is intentionally not a required PR check. GitHub branch-protection settings are repository configuration and cannot be set by committed workflow files.

### Historical Gitleaks baseline review

The first full-history scan reported nine historic matches. Source inspection found seven matches on legacy Finnhub credential-field/variable references in `app.js` and two matches on synthetic idempotency-key test strings in `src/store/portfolioStore.test.ts`; the cited source lines contained no hardcoded credential assignments. These historic matches are retained in the scheduled/manual advisory audit. The blocking PR/push scan checks only newly introduced commits, so new secrets remain merge-blocking without adding a broad ignore list.

### Coverage status

Vitest uses the version-matched V8 provider and uploads JSON/JSON-summary reports as a CI artifact. Coverage is scoped to selected financial-domain, portfolio-store, Worker and Durable Object modules rather than UI files or generated code. The measured aggregate baseline is 84.17% lines, 80.91% statements, 88.36% functions and 75.45% branches. Enforced floors are 80%, 80%, 85% and 70%, respectively. The detailed per-module baseline and measurement method are recorded in `docs/ci/coverage-baseline-2026-11-17.md`. Raise these floors only after reviewing the report and adding tests; do not lower them to mask a regression.

### Lint status

Oxlint is integrated into PR CI and `npm run ci:local`. The initial enforced policy deliberately covers a small set of correctness defects (duplicate object keys, unreachable code, constant binary expressions and unsafe `finally` control flow). Test files are excluded because the repository's existing Vitest patterns use conditional assertions and flexible mock signatures that are validated by Vitest and TypeScript instead. Expand the lint rules in small, reviewed increments; do not enable broad style/pedantic presets without first auditing their impact.


## 9. CI and configuration refinements — 2026-11-17

- `.nvmrc` is the shared Node.js 22 version source for GitHub Actions; `package.json` and the lockfile declare Node.js 22.x and npm 10.x as the supported runtime.
- The path-filtered **Financial Integrity Regression** workflow gives transaction, financial-domain, persistence, backup/reconciliation, and Worker/authentication tests a dedicated status and exact-head evidence when relevant paths change. The standard PR workflow continues to run the complete Vitest suite on every PR.
- Localization tests now validate that every Russian dictionary value is non-empty and that interpolation placeholders match the corresponding English key. Unknown dynamic copy continues to use the established fallback behavior.
- The weekly security workflow runs full and production-only npm dependency audits on scheduled and manual runs, in addition to per-PR audits.
- Cloudflare Worker deployment rejects non-main refs, serializes production deployments without canceling an in-progress deployment, validates the Wrangler bundle with a dry run, and targets the `cloudflare-production` GitHub environment before deploying.

### Repository settings still required

Committed workflow files cannot configure GitHub branch rules or environment protection. In repository settings:

1. Add required status checks to the active `main` ruleset (including existing CI quality, build, browser, operations, workflow-security, secret-scan, and CodeQL checks).
2. Add a corresponding `dev` ruleset requiring pull requests and the appropriate CI/security checks. The Financial Integrity Regression workflow is path-filtered, so do not make it a globally required check unless it is changed to report a successful no-op for unrelated paths.
3. Configure `cloudflare-production` with the intended deployment branch restriction (`main`) and required reviewer(s); keep the Cloudflare API token and account ID in the protected secret scope used by the deployment.

At the time this section was written, a coverage provider, measured baseline and lint framework were deferred. Those items have since been implemented and verified as described in section 10 below.


## 10. Coverage, lint and repository protection follow-up — 2026-11-17

The CI baseline is now measured and enforced. GitHub rulesets and environment-review configuration remain repository-administration settings, not file-level workflow configuration. Importable ruleset payload examples are stored in `docs/ci/github-rulesets/`; review the exact check contexts in GitHub's ruleset editor before saving.

Production coverage is intentionally separated from test-file lint. Coverage thresholds use aggregate coverage across the explicit financial/store/Worker source set; individual module percentages are reported for prioritization, not yet independently gated. The weakest measured selected module is `src/store/portfolioSubscriptions.ts` at 46.66% lines, followed by `state-store.js` at 77.29% and `worker.js` at 78.92%. Improve those with focused tests rather than lowering the aggregate floors.

### Authenticated fixture integrity

The benchmark fixture is generated by `scripts/authenticated-portfolio-fixture.mjs` and tested in `scripts/authenticated-portfolio-fixture.test.mjs`. Its 100 active positions have two stable acquisition lots each; ten separate fully closed synthetic positions have linked buy/sale journal rows. All fixture observations are labelled synthetic/indicative. The fixture test must pass exact transaction-journal balance parity and complete lot/closed-history parity before the benchmark can use it. The browser artifact records the fixture counts and continues to set `liveBrokerVerification=false`.
