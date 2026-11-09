# Grand refactor audit and cleanup plan — 2026-11-09

## Executive summary

This compatibility-first audit continues the existing architecture programme. The codebase is already substantially modularized across financial domain logic, the canonical portfolio store, client services, provider runtimes, terminal features, Preact components, and UI primitives. A wholesale rewrite or splitting files by size alone would add regression risk without improving domain boundaries.

This implementation removes a verified legacy mutation fallback and unnecessary type escapes from the terminal command boundary. Financial formulas, accounting paths, persisted fields, APIs, localization keys, and Worker contracts remain unchanged.

## Rebase and branch state

- Repository: armave/portfolio-terminal.
- dev was one merge commit behind main after PR #417 merged dev into main.
- dev was fast-forwarded from 28e8fca168c1de0e9c00c96246739d44621f8b94 to bd2466b712d81c6f11510433948dd2662638b86c using an expected-SHA guard; no history rewrite was performed.
- The feature branch was created from the synchronized dev head. No force-push or destructive rebase was used.

## Audit baseline and observations

### Architecture and ownership
- Active application modules are organized under src/domain, src/store, src/services, src/features, src/components, and src/ui.
- app.ts remains the live runtime composition root; preserve its startup ordering and delegated lifecycle modules.
- worker.js and state-store.js are active Cloudflare Worker and persistence surfaces, not frontend dead code. They are excluded from this client PR absent a demonstrated server defect.
- Large UI and domain files should be split only when cohesive state, event, and lifecycle boundaries can be identified and covered by compatibility tests.
- English/Russian dictionaries and localization tests are present. This change adds no user-facing copy and requires no translation-key changes.

### Existing validation controls
- package scripts expose typecheck, Vitest, production build, Knip dead-code validation, and full/production dependency audits.
- PR CI runs Chromium browser smoke and a browser performance baseline; Operations Browser Journey and Trade Lifecycle Browser Smoke are separate workflows.
- Before this implementation, main commit bd2466b712d81c6f11510433948dd2662638b86c passed Pull Request CI (42616053175), Operations Browser Journey (42616053162), and Trade Lifecycle Browser Smoke (42616053200). These are baseline results, not evidence for the new PR head.
- Existing audit notes identify a remaining low-severity development dependency advisory through deepmerge. No unsafe forced downgrade is included.

### Findings and prioritization
| Priority | Finding | Treatment |
|---|---|---|
| P0 | Financial formulas, FIFO, commission allocation, debt settlement, rollover rounding, journal and backup semantics are compatibility-critical. | Preserve unchanged; characterize and review any future formula changes separately. |
| P1 | Terminal buy command dynamically probes buyStock and falls back to addTranche although PortfolioStore exposes the canonical buyStock method. | Use the canonical typed mutation path only. |
| P1 | Terminal dispatcher uses any casts for store state, tranche reductions, and margin-interest options already covered by domain types. | Remove casts without changing legacy qty/shares fallback behavior or calculation inputs. |
| P1 | Failed buy persistence must not report success or schedule quote refresh. | Add a focused regression test. |
| P2 | Cloud sync retains a broad any compatibility boundary in security- and persistence-sensitive code. | Audit separately with a full snapshot/history payload compatibility matrix. |
| P2 | Desk-level responsive and accessibility review remains open. | Continue by component clusters with i18n parity and browser coverage. |
| P2 | The composition root and large components remain active. | Extract only cohesive responsibilities with explicit dependencies, disposers, tests, and bundle checks. |
| Separate release | Tenant financial isolation and Worker/DO routing are not enabled by directory metadata alone. | Keep authorization, storage topology, key lifecycle, migration, and rollback in a separately reviewed server release; retain PT-02/PT-16 gates. |

## Implementation scope
- [x] Keep PortfolioStore as the sole owner of portfolio mutations.
- [x] Route terminal buys directly through PortfolioStore.buyStock and remove the obsolete dynamic addTranche fallback.
- [x] Remove any casts from terminal store state, tranche aggregation/cost-basis reductions, and calculateMarginInterest options.
- [x] Preserve historical qty ?? shares fallback and numeric normalization.
- [x] Add regression coverage proving a failed buy returns the persistence error and emits no follow-up quote side effect.
- [x] Record prioritized architecture and cleanup follow-ups.

## Follow-up roadmap

### Phase 0 — branch hygiene
- [x] Inspect branch topology, open PRs, commits, workflows, architecture notes, and audit trackers.
- [x] Fast-forward dev to the merged mainline state without rewriting history.
- [x] Create one feature branch from synchronized dev.

### Phase 1 — financial and persistence invariants
- [x] Preserve canonical store mutation path and existing financial formulas in this slice.
- [ ] Continue PT-02 journal parity, reversal, and recovery implementation.
- [ ] Continue cloud import/export, revision conflict, recovery, and serialization review using compatibility fixtures.

### Phase 2 — client architecture and typing
- [x] Remove verified terminal dispatcher compatibility branches and type escapes.
- [ ] Audit cloud-state sync any boundaries only after complete snapshot/history contract tests exist.
- [ ] Review runtime dependencies for duplicate orchestration, global state, and sibling-owned DOM work; retain app.ts as composition root.
- [ ] Split large components only when state ownership, event contracts, and lifecycle ownership can be tested independently.

### Phase 3 — UX, localization, and performance
- [ ] Complete desk-by-desk responsive/accessibility review: keyboard order, focus restoration, semantic tables, touch targets, reduced motion, and narrow-screen overflow.
- [ ] Audit dynamic English/Russian copy, interpolation, and missing-key behavior; add parity tests for each changed cluster.
- [ ] Measure component render cadence and quote event rates before adding memoization; preserve lazy chunks and entry bundle limits.
- [ ] Consolidate CSS only where duplicate or contradictory selectors are confirmed; keep startup-critical CSS separate.

### Phase 4 — server, security, and release
- [ ] Keep Worker, Durable Object, and storage changes out of this client PR unless a demonstrated server defect requires a separately deployed fix.
- [ ] Before tenant financial writes, prove server-authoritative identity, tenant-owned storage, authenticated internal DO calls, tenant key lifecycle, dry-run migration, and rollback.
- [ ] Run adversarial cross-tenant authorization tests and security review before enabling a tenant data plane.
- [ ] Record exact-head release gates and any skipped authenticated-broker/manual-device validation.

## Exact-head validation checklist
- [ ] npm run typecheck
- [ ] npm test (Vitest)
- [ ] npm run build (includes production bundle budget)
- [ ] npm run validate:dead-code
- [ ] npm run audit:dependencies
- [ ] npm run audit:production
- [ ] PR CI: Chromium browser smoke and performance baseline
- [ ] Operations Browser Journey
- [ ] Trade Lifecycle Browser Smoke
- [ ] Final diff review for financial, persistence, i18n, API, and Worker changes

A local clone and local test run are not claimed: this environment could not resolve github.com for Git clone. Exact-head GitHub Actions results will be checked after PR creation.
