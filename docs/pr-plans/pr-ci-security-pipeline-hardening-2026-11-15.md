# PR Plan — CI Security & Pipeline Hardening

**Target branch:** `dev`  
**Implementation branch:** `ci/security-pipeline-hardening-2026-11-15`  
**Scope:** GitHub Actions, security scanning, dependency update policy, release gates, and CI documentation only.

## Scope boundaries

- No portfolio UI, financial formula, persisted schema, broker API, authentication logic, or Cloudflare Worker business-logic changes.
- Preserve the existing deterministic browser journeys and exact-head evidence.
- Keep Worker deployment on its existing direct-to-`main` lane.
- No English/Russian UI copy changed; application localization dictionaries and localization tests remain untouched.

## Implementation checklist

- [x] Split PR validation into independent quality and production-build jobs.
- [x] Reuse the same exact production artifact for the application-shell and Operations browser journeys.
- [x] Keep Operations Browser Journey manually runnable without repeating PR unit/static validation.
- [x] Add CodeQL JavaScript/TypeScript analysis.
- [x] Add blocking Gitleaks scanning for commits introduced by each PR/push, with redacted output and sanitized finding metadata.
- [x] Retain a scheduled/manual full-history Gitleaks audit as advisory, without ignoring legacy findings.
- [x] Add actionlint and zizmor workflow-security analysis.
- [x] Pin referenced GitHub Actions to immutable commit SHAs.
- [x] Add weekly grouped Dependabot updates for npm and GitHub Actions.
- [x] Add production Chromium smoke validation before GitHub Pages publication.
- [x] Add TypeScript validation, focused Worker/authentication tests, and dependency audits before Worker deployment.
- [x] Document required status checks and the branch-protection settings that must be enabled in GitHub.
- [x] Document the CI security and deployment model and preserve the live-broker manual QA boundary.

## Validation checklist

- [ ] actionlint passes for all checked-in workflows.
- [ ] zizmor reports no medium-or-higher severity/confidence findings.
- [ ] New-commit Gitleaks scan passes on the exact PR head.
- [ ] Scheduled/manual historical Gitleaks audit reports only the documented legacy findings or any newly discovered exposure.
- [ ] CodeQL completes successfully for JavaScript/TypeScript.
- [ ] Pull Request CI quality and unit-test job passes.
- [ ] Production build and artifact job passes.
- [ ] Production browser smoke and performance job passes.
- [ ] Operations Browser Journey passes using the artifact produced by the same CI run.
- [ ] Pages deployment workflow passes on the resulting main-branch candidate.
- [ ] Worker deployment preflight typecheck, tests, and audits pass on a Worker change before deployment.
- [ ] Confirm English/Russian localization suites still pass as part of the full Vitest suite.
- [ ] Confirm each successful workflow summary identifies the tested commit SHA.

## Explicit follow-ups

- [ ] Enable required branch-protection checks for `dev` (and `main` where applicable) in GitHub repository settings. Workflow YAML cannot enforce this setting.
- [x] Inspect and document the nine pre-existing historical Gitleaks false positives; keep the full-history audit visible without weakening the new-commit gate.
- [ ] Add Vitest coverage reporting and measured module-level thresholds after introducing a version-matched coverage provider and updating `package.json` and `package-lock.json` together. No arbitrary global coverage threshold is introduced here.
- [ ] Authenticated TradeNet, live Market Depth, and live provider verification remain manual release gates; mocked CI does not certify those integrations.

## Evidence policy

Do not mark CI validation complete until the new workflows finish on the exact PR head. Do not claim successful browser, security, typecheck, test, build, or deployment results from source inspection alone.