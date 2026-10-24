# Large-scale code audit

**Scope:** client-side portfolio application, financial domain logic, market-data integrations, encrypted cloud sync, Cloudflare Worker, and release validation.

**Audit posture:** prioritize correctness and data preservation. Do not alter financial assumptions or legacy persisted-data semantics without an explicit compatibility decision.

## Step-by-step execution plan

1. **Baseline and change inventory**
   - Inspect the current default branch, active audit work, and existing test/build commands.
   - Avoid duplicating open work; keep the audit changes in one reviewable pull request.
2. **Financial-domain integrity**
   - Trace buy/sell accounting, commission minimums, interest accrual, rollover cutoffs, rounding, cash/debt settlement, and risk calculations.
   - Add regression tests for boundary values and compare equivalent transaction paths.
   - Preserve existing financial outputs unless a discrepancy is proven and its intended behavior agreed.
3. **State and persistence integrity**
   - Test JSON import/export, normalization, local persistence, encrypted Gist/cloud sync, revision conflicts, rollback, and malformed payloads.
   - Verify that stale writes cannot silently replace newer portfolio state.
4. **Security boundaries**
   - Review gateway-secret handling, origin allowlisting, request authentication, payload limits, allowed proxy actions, timeout behavior, and dependency advisories.
   - Treat CORS/origin filtering as defense in depth, not authentication.
5. **Market-data reliability**
   - Verify symbol validation, provider fallback behavior, observation timestamps, stale/unknown quote states, async races, and malformed upstream responses.
   - Never treat an unknown timestamp or failed provider response as a fresh quote.
6. **UI and async behavior**
   - Check mutation confirmation safeguards, error/loading/empty states, keyboard accessibility, and small-screen layouts.
   - Keep scenario previews read-only and avoid changing accounting state before confirmation.
7. **Automated verification and release gates**
   - Run typecheck, tests, production build, dead-code validation, and production dependency audit on pull requests.
   - Record any unavailable or failing check explicitly; do not claim a test passed without a result.
8. **Review and follow-up**
   - Summarize findings by severity, the evidence and tests for each fix, remaining risks, and any compatibility decisions that require maintainer input.

## Confirmed repository observations

- The package exposes typecheck, test, build, and validate:dead-code scripts.
- The deployment workflow runs tests, dead-code validation, a production dependency audit, and a production build when deploying from main.
- The deployment workflow is configured for pushes to main and manual dispatch; it does not itself provide a pull-request validation trigger. This PR adds a dedicated CI workflow for proposed changes.
- The Worker has request-size and ticker-count bounds, upstream timeouts, a configured origin allowlist, and explicit authentication logic. Origin allowlisting is not a substitute for authentication.
- Commission inputs are validated in the financial domain. Date parsing and rollover behavior must remain covered by regression tests.
- The repository's documented financial and cloud-state model is intentionally single-owner. This audit does not introduce multi-user semantics or change persisted state formats.

## Finding addressed in this PR\n\n- **Data integrity — malformed position key can be silently lost during normalization.** Assigning a JSON-provided `__proto__` position key into a normal JavaScript object invokes the legacy prototype setter rather than creating an enumerable position property. That could make a position disappear when the normalized state is serialized.\n- **Fix:** normalized position entries are now created with `Object.defineProperty`, preserving ordinary object behavior while ensuring imported keys become own enumerable data properties.\n- **Regression test:** import a backup containing both a normal position and an explicitly defined `__proto__` position; verify the position survives and the result retains `Object.prototype`.\n- **Severity:** low likelihood / potentially high data-integrity impact for malformed or adversarial backup input. This does not indicate a demonstrated remote exploit; it is a local import/normalization robustness issue.\n## Acceptance criteria

- [ ] Pull requests run typecheck, tests, dead-code validation, production dependency audit, and production build.
- [ ] No financial formula or persisted schema is changed merely to make the audit appear comprehensive.
- [ ] Existing regression coverage remains in place.
- [ ] CI results are reviewed before merge.
- [ ] Any remaining high-risk issue is documented with evidence and an explicit follow-up, rather than silently waived.

## Scope and limitations

This document is an execution plan and records findings confirmed from the repository configuration and reviewed source. It is not a claim that every runtime path, browser interaction, production secret configuration, or external provider has been exhaustively penetration-tested. CI cannot replace manual review of financial semantics, deployment configuration, or live-provider behavior.