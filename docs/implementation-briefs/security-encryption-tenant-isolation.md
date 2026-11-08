# Implementation brief — Security, encryption & portfolio isolation

Parent contract: `docs/plans/2026-11-08-portfolio-integrity-reliability-implementation-plan.md`  
Branch: `impl/security-tenant-isolation` · Target: `plan/portfolio-integrity-reliability-2026-11-08` · Status: **partial delivery; release gates remain open**

## Mission

Close the plaintext Margin Intelligence storage gap safely, then establish server-enforced independent portfolio ownership and access isolation. The current branch delivers the encryption migration client slice. It does **not** enable independent financial tenants.

## Delivered client slice

- New/updated synced digests use AES-GCM v2 and send only the lookup key plus ciphertext; new writes do not silently fall back to plaintext.
- Legacy plaintext remains readable during compatibility rollout. A successful read attempts a revision-guarded rewrite; a failed rewrite remains readable and visibly reports `pending`.
- The admin-only Settings panel loads aggregate inventory counts only. It never receives digest content.
- Migration runs are bounded to 20 batches of 25 records (500 records maximum per run), preserve a continuation cursor, and expose an explicit Continue action.
- The client rejects contradictory inventory totals/readiness flags and malformed/impossible batch progress responses.
- UI guidance distinguishes old encrypted records (open through the normal decrypting Margin Intelligence path) from unreadable records (preserved for review/recovery). Compare-and-swap conflicts are shown and can be retried.
- New visible strings are translated to Russian and covered by i18n tests.

## Direct-to-main Worker/server companion

Server changes are committed directly to `main` and deployed separately:

- `618978b82ebc30c19a90aff14953e645b1608e82` — authenticated admin-only count inventory and bounded AES-GCM v2 migration operation; revision/payload compare-and-swap.
- `92a1f78542518d87aa6df9052400860388f8e6d6` — Worker boundary and migration regression tests plus threat-model documentation.
- `a9000f59de3656456bd39b6f8aa78d5a23978f2e` — validate canonical base64, 12-byte nonce, ciphertext/tag length and size before inventory classifies a v2 envelope as encrypted.
- `21ac3e8b15f3f3f1e84ae6ef379ced8885282c63` — added migration pagination, multi-page inventory and concurrent-update regression tests.
- `aeb2431651a8833509b71dee21b8d740733a0590` — one-record look-ahead makes exact-full final pages return a null cursor and `done: true`, avoiding a redundant empty request.

[Cloudflare Worker deployment run](https://github.com/armave/portfolio-terminal/actions/runs/42468975413) — **success** on `aeb2431651a8833509b71dee21b8d740733a0590`; Worker/auth suite: **220 tests passed**; deployed Worker version `c0c1898a-1dbb-40bc-a60d-106722d4c45b`.

## Client validation

Validated PR head: `4a70b5923ed76387b9a308cf1f8ae74e1b9adf92`.

- [x] [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/42468474351) — success; 157 test files / 1,875 tests passed, typecheck, production build, browser smoke, dead-code validation and dependency audits.
- [x] [Operations Browser Journey](https://github.com/armave/portfolio-terminal/actions/runs/42468474583) — success.
- [x] English/Russian migration UI coverage, including resume and legacy/unreadable-record guidance.
- [x] Worker deployment and production version recorded above.
- [ ] Authenticated live production inventory/migration, reviewed manually against actual stored digests.
- [ ] Supported-client compatibility window verified; confirm no old client still writes plaintext before enforcement.

## Rollout gates and limitations

- `MARGIN_DIGEST_ENCRYPTION_REQUIRED` remains `false`. Keep it disabled until production inventory and supported-client/write telemetry justify a staged enforcement release.
- The batch tool migrates valid legacy plaintext only. Older CryptoJS ciphertext is upgraded by opening it through the normal decrypting client. Unreadable/tampered records require explicit recovery or retention/deletion disposition; they are never silently discarded.
- No production inventory count is asserted here. The admin endpoint has not been invoked with an authenticated production admin session in this work session.
- The shared workspace key remains the current digest encryption key; this is not a per-tenant key hierarchy.

## Independent portfolio isolation — not implemented in this PR

The live system is still one shared administrator workspace plus restricted guest projections. The tenant directory is metadata-only (`financialDataEnabled: false`). Independent financial tenant storage/routing, tenant-specific keys and recovery, server-authoritative per-resource grants, tenant-scoped exports/backups, and live-stream isolation are not yet implemented.

This work is gated by the PT-02 transaction/audit ownership contract (issue [#330](https://github.com/armave/portfolio-terminal/issues/330)) and the PT-05 tenancy migration/key-lifecycle plan (issue [#333](https://github.com/armave/portfolio-terminal/issues/333)). The architecture calls for a separate tenant Durable Object boundary, signed Worker-to-DO authorization, per-tenant key lifecycle, migration/rollback, and adversarial tests. Do not route financial data through the metadata-only directory and do not enable independent financial writes until those gates are implemented and validated.

## Acceptance checklist

- [x] Client migration state/failure is visible; new writes use encrypted payloads only.
- [x] Admin aggregate inventory and resumable, bounded migration tooling.
- [x] AES-GCM v2 envelope validation in Worker inventory.
- [x] Compare-and-swap conflict preservation, pagination and exact-final-page tests.
- [x] English/Russian translation and Vitest coverage.
- [x] Direct-to-main Worker tests and deployment recorded.
- [ ] Run production inventory and approve the residual legacy/unreadable record disposition.
- [ ] Verify all supported clients have stopped plaintext writes; then separately deploy and verify strict rejection.
- [ ] Implement tenant-owned financial storage, authorization, keys, recovery, scoped exports/backups/streams and adversarial cross-tenant tests after PT-02/PT-05 prerequisites.
- [ ] Complete authenticated live production and multi-device QA.

**Disposition:** keep PR #396 Draft. The safe encryption-migration slice is implemented and deployed; the broader security/portfolio-isolation acceptance criteria are not complete.
