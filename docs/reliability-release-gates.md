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

The PR CI workflow also runs production browser smoke tests for the application shell and complete trade lifecycle. The Operations Browser Journey workflow separately exercises account, settings, guest and accessibility-sensitive journeys.

The PT-17 changes extend this baseline by:
- validating merged `dev` commits as well as pull-request candidates and `main` commits;
- keeping the general CI browser journey focused on the app shell/operations surface while the path-filtered Trade Lifecycle workflow owns the full trade lifecycle journey, avoiding a redundant second run of the same stateful browser script in one job;
- recording the candidate commit, source PR head/base where applicable, workflow run, and each validation step's outcome in the GitHub Actions run summary;
- collecting repeatable desktop/mobile browser-shell performance samples as a CI artifact;
- running the path-filtered trade lifecycle smoke workflow on PRs and merged commits targeting `dev`, as well as `main`.

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

`scripts/browser-performance-baseline.mjs` launches the built production preview, blocks service workers to avoid cross-run cache contamination, and intercepts the Worker API with deterministic fixtures. It captures three cold samples for two scenarios at desktop (1440×900) and mobile (390×844): (1) unauthenticated application shell and (2) authenticated administrator workspace seeded with 100 synthetic positions, 200 tranches, and 200 matching executed-buy rows.

The CI artifact `browser-performance-baseline` (schema version 1) contains the unauthenticated-shell measurements for each viewport. Each sample records:
- first contentful paint (FCP);
- largest contentful paint (LCP), where supported;
- DOMContentLoaded and load event timing;
- response-start timing;
- browser-reported transferred resource bytes and resource count;
- time to render the unauthenticated sign-in/bootstrap shell;
- cumulative layout shift (CLS), where supported;

- browser version, commit SHA, ref, and workflow run ID.

The current fixture does not measure authenticated dashboard hydration, large-portfolio rendering, transaction-history scale, real broker latency, or production network/provider availability. A future authenticated performance fixture must first seed a portfolio through a verified application-supported persistence/import path and prove that the same 100-position/200-tranche state survives authenticated startup and broker reconciliation before its measurements are treated as valid.

### Baseline protocol

1. Collect at least 10 successful workflow runs on the same runner/browser configuration before proposing automated performance thresholds.
2. Separate pull-request merge-candidate runs from post-merge `dev` and production `main` observations.
3. Compare medians and p75/p95 where sample volume permits; do not infer a percentile from three samples in one workflow.
4. Investigate regressions against the same viewport, browser version, build mode, and fixture.
5. Add thresholds only after a documented baseline and a review of normal CI variance. Keep noisy metrics informational until their variance is understood.
6. Add a verified authenticated portfolio fixture, realistic transaction-history tiers, additional portfolio sizes, and slower network profiles before setting SLOs for those journeys.

No numeric production SLO is declared by this PR. The first deliverable is a repeatable, attributable baseline rather than an arbitrary threshold.

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
- [x] Run targeted trade lifecycle browser checks in the dedicated path-filtered workflow for PRs and merges to `dev` as well as `main`; avoid running the same stateful journey twice in general CI.
- [x] Document privacy-safe telemetry dimensions and prohibited portfolio/user fields.
- [x] Document authenticated TradeNet, real Market Depth, responsive/accessibility, recovery, and deployment release gates.
- [ ] Verify an authenticated synthetic-portfolio benchmark using an application-supported seed/restore path; current attempts exposed a state-initialization/reconciliation mismatch, so no authenticated dashboard performance claim is made.
- [ ] Collect the first 10-run baseline set and review variance before setting thresholds.
- [ ] Implement production telemetry only after the PT-16 privacy/security review and event-sink decision.
- [ ] Complete authenticated TradeNet and live Market Depth manual validation; this cannot be certified by mocked CI.
