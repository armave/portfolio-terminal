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

## Live audit progress

**Overall status: in progress — do not merge until the newest CI run is green and remaining high-risk areas are reviewed.**

- [x] Baseline and repository change inventory.
- [x] PR validation workflow and baseline gates added.
- [x] Backup import rejects malformed top-level containers that could silently drop data.
- [x] Position normalization safely preserves prototype-sensitive keys.
- [x] Upstream timeout remains active through response-body consumption.
- [x] Cloud revision conflict handling reviewed; confirmed a race where a queued stale snapshot could inherit a revision learned by a concurrent pull.
- [x] Cloud write queue now tracks pull-generation changes so a queued snapshot cannot adopt a newer revision from a concurrent pull; queued writes after a successful queued write can still use that write's revision.
- [x] Regression test added for the concurrent-pull/queued-write race.
- [x] Re-run and inspect all CI jobs on the latest code-bearing commit: both Pull Request CI and Validate passed typecheck, tests, build, dead-code validation, and production dependency audit.
- [x] Financial review found a concrete rollover-cutoff mismatch: `processRollovers` honored configured `rolloverHour`/`rolloverMinute`, while accrued-interest projection hard-coded 04:00. Updated `calculateMarginInterest` to use the same validated configurable cutoff (default remains 04:00 Asia/Yerevan) and added before/after-cutoff regression coverage.
- [ ] Continue financial transaction parity and rounding review; change formulas only when a concrete discrepancy and regression evidence justify it.
- [x] Initial market-data provenance review: Yahoo quotes use source observation timestamps; unknown timestamps are not marked fresh, and fallback providers are explicitly marked unknown freshness. No additional confirmed defect found in this pass.
- [x] Reviewed quote-store async protections: updates apply to the latest store snapshot, older request timestamps are ignored, and quotes started before a trade cannot overwrite that trade.
- [x] **Quote-ordering tie fix implemented:** each `fetchLivePriceFromProviders` request receives a time-anchored monotonic sequence, carried with quote provenance and recorded by the store. When request timestamps tie, the store rejects lower-sequence responses for positions and cash holdings. The sequence is time-anchored to remain ordered across ordinary page reloads. Added a regression test covering out-of-order responses started in the same millisecond.
- [x] Inspected latest-head CI failure: typecheck correctly flagged the new quote sequence metadata as missing from the position/cash-holding interfaces. Added optional `quoteRequestSequence` fields to the corresponding types and tightened the request sequence to be strictly monotonic.
- [x] Fixed quote-ordering regression setup after CI identified that `addCashStock` stores holdings in `cashCushion.holdings`; both the same-millisecond test and existing out-of-order test now assert the actual state container.
- [x] Latest code-bearing commit `8cc635f56cef455e4eebdd24ba2a4c2708e576f0` passed Validate end-to-end: typecheck, tests, production build, dead-code validation, and production dependency security audit. The corrected same-millisecond cash-holding regression is included.
- [x] Confirmed Pull Request CI and Validate were green on the previous encryption-only head.
- [x] Rollover-cutoff code commit `a2855b5ea056d63c03ffc501bb9cb728cf749b7f` passed both workflows. The subsequent Gemini timeout fix and regression test are newer and must be validated by both workflows before merge.
- [x] Reviewed quote-store ordering protections: older request sequences and timestamp-only stale responses are rejected, and quote results older than a trade do not overwrite the trade.
- [ ] Complete remaining component-level UI async race review and add stale-request tests where a concrete race is found.
- [x] Implemented versioned authenticated cloud encryption: new writes use Web Crypto AES-GCM with a 96-bit random nonce and 128-bit authentication tag; existing CryptoJS ciphertext remains readable.
- [x] Added regression tests for the AES-GCM envelope, rejecting modified ciphertext before local persistence, and migrating successfully read legacy ciphertext to the versioned format using the existing revision-checked write path.
- [x] Fixed strict TypeScript `BufferSource` compatibility in AES-GCM decryption by passing standalone `ArrayBuffer` copies.
- [x] Updated the concurrent cloud-write regression test to wait for the asynchronous AES-GCM write to actually start before simulating a concurrent pull; fixed the test's former timing assumption.
- [x] Latest head `24ef2f58ea8b76a650e7a0562f48387bf048254e` passed both Pull Request CI and Validate: typecheck, all tests (273 total), production build, dead-code validation, and production dependency audit.

## Confirmed repository observations

- The package exposes typecheck, test, build, and validate:dead-code scripts.
- The deployment workflow runs tests, dead-code validation, a production dependency audit, and a production build when deploying from main.
- The deployment workflow is configured for pushes to main and manual dispatch; it does not itself provide a pull-request validation trigger. This PR adds a dedicated CI workflow for proposed changes.
- The Worker has request-size and ticker-count bounds, upstream timeouts, a configured origin allowlist, and explicit authentication logic. Origin allowlisting is not a substitute for authentication.
- Commission inputs are validated in the financial domain. Date parsing and rollover behavior must remain covered by regression tests.
- The repository's documented financial and cloud-state model is intentionally single-owner. This audit does not introduce multi-user semantics or change persisted state formats.

## Finding addressed in this PR

- **Data integrity — malformed position key can be silently lost during normalization.** Assigning a JSON-provided `__proto__` position key into a normal JavaScript object invokes the legacy prototype setter rather than creating an enumerable position property. That could make a position disappear when the normalized state is serialized.
- **Fix:** normalized position entries are now created with `Object.defineProperty`, preserving ordinary object behavior while ensuring imported keys become own enumerable data properties.
- **Regression test:** import a backup containing both a normal position and an explicitly defined `__proto__` position; verify the position survives and the result retains `Object.prototype`.
- **Severity:** low likelihood / potentially high data-integrity impact for malformed or adversarial backup input. This does not indicate a demonstrated remote exploit; it is a local import/normalization robustness issue.
## Additional reliability finding addressed

- **Upstream timeout ended too early.** The Worker helper originally cleared its abort timer as soon as `fetch()` returned response headers, while callers parsed JSON/text afterward. A stalled upstream response body could therefore outlive the advertised timeout.
- **Fix:** keep timeout and caller cancellation wired through response-body consumption using a forwarding stream; clean up on end, error, or cancellation, and respect already-aborted external signals.
- **Regression test:** simulate an upstream response that stalls after headers and verify body consumption rejects when the timeout aborts it.
## Backup-import integrity finding addressed

- **Potential silent data loss:** when a backup explicitly contained a malformed `positions` field (for example `null` or an array), normalization treated it as an empty map. Because the canonical field existed, legacy holdings migration was skipped; an import could appear successful while positions disappeared.
- **Fix:** backup import now rejects malformed top-level container shapes for `positions`, `holdings`, `cashCushion`, and `closedTrades` instead of silently replacing them with empty defaults.
- **Regression coverage:** tests exercise malformed object/array/null shapes and assert import errors. A genuinely empty `positions: {}` remains valid.
## Cloud-sync concurrency finding addressed

- **Race:** a push queued with a stale local snapshot could execute after a concurrent pull advanced the in-memory cloud revision. Reading the mutable revision only when the queued request ran let that stale snapshot claim the newer revision and overwrite newer cloud state.
- **Fix:** each submitted write records its revision and pull-generation. A queued write may follow the revision advanced by an earlier queued write from the same tab, but if a pull advanced the generation after submission, it uses its original revision and safely receives a conflict instead of overwriting.
- **Regression test:** queue two writes, complete a cloud pull while the second waits, then verify the second write retains its submitted revision and is rejected.

## Security risk retained for a versioned migration

- **Cloud payload confidentiality/integrity format:** `src/services/api.ts` encrypts and decrypts the Worker cloud-state payload using `CryptoJS.AES.encrypt/decrypt` with a passphrase. CryptoJS's passphrase API defaults to CBC mode and does not authenticate ciphertext, unlike AES-GCM. The device Gateway Secret protects access to the Worker, but it is also the encryption passphrase; a modified ciphertext may not be detected cryptographically before parsing.
- **Disposition:** do not silently switch formats in this audit patch because all existing cloud state uses the legacy ciphertext format. A safe remediation should introduce an explicit versioned AES-GCM envelope, preserve legacy decryption, validate decrypted state before persistence, and migrate only after a successful pull and revision-checked write. Add compatibility tests for old payloads, wrong keys, modified ciphertext, and interrupted migration.
- **Severity:** security hardening needed; practical impact depends on the Gateway Secret entropy and the cloud threat model. This audit did not attempt a live cloud-data tampering test.
## Acceptance criteria

- [x] Pull requests run typecheck, tests, dead-code validation, production dependency audit, and production build.
- [x] No financial formula or persisted schema is changed merely to make the audit appear comprehensive.
- [x] Existing regression coverage remains in place, with new regression cases for the identified defects.
- [ ] Latest code-bearing head CI results reviewed: both the new PR workflow and existing validation workflow must pass before merge.
- [x] The remaining cloud encryption integrity risk is documented with a versioned migration plan.

## Scope and limitations

This document is an execution plan and records findings confirmed from the repository configuration and reviewed source. It is not a claim that every runtime path, browser interaction, production secret configuration, or external provider has been exhaustively penetration-tested. CI cannot replace manual review of financial semantics, deployment configuration, or live-provider behavior.