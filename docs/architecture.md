# Architecture overview and invariants

**Reviewed against:** `dev`, 2026-11-16  
**Authority:** The implementation and its tests are authoritative. This guide describes the current high-level boundaries; it is not a target-state migration plan.

## Runtime composition

- `src/main.ts` is the browser entry point and mounts the Preact application in `src/App.tsx`.
- Root `app.ts` remains the runtime composition/orchestration layer for startup, authentication, navigation, broker and quote refresh, portfolio synchronization, and application workflows. Its size alone is not a reason to remove or rewrite it.
- `src/domain/` owns deterministic portfolio calculations, selectors, normalization, and calendar logic.
- `src/store/` owns canonical portfolio state and validated state transitions.
- `src/services/` owns infrastructure integrations such as persistence, provider access, and synchronization. Device-bound Gateway Secret encryption and recovery live in `src/services/credentialStorage.ts`; `src/services/storage.ts` re-exports the established credential API for existing callers.
- `src/features/` contains cohesive feature logic; `src/components/` and `src/ui/` own presentation and UI behavior.
- `worker.js` is the Cloudflare Worker API boundary. `state-store.js` implements the Portfolio State Durable Object.

## State and responsibility boundaries

1. **Presentation:** render state and emit typed actions or requests. Components should not become alternate owners of financial state or bypass validated store operations.
2. **Application orchestration:** coordinate authentication, lifecycle, provider refresh, command handling, and user confirmation. Keep provider and browser side effects outside deterministic financial calculations.
3. **Portfolio store:** own portfolio mutations, normalization, persistence scheduling, and subscriber publication. Rejected or failed mutations must not publish a partially updated state.
4. **Financial domain:** keep calculations deterministic and independently testable. A formula change requires an explicit contract decision, compatibility analysis, and regression fixtures.
5. **Infrastructure:** isolate browser storage, encryption, cloud revision handling, broker APIs, and market-data providers behind service/Worker boundaries.

`PortfolioState.positions` is the canonical active margin-position collection. The legacy `holdings` shape is a compatibility projection, not an independent source of truth. Preserve that distinction in import, persistence, and UI work.

## Financial and asynchronous safety

- Validate imported or provider-supplied data before it can replace accepted portfolio state.
- Keep cost basis separate from current market price. Never manufacture missing cost basis, margin inputs, FX rates, or quote timestamps.
- Carry source, observation time, receipt time, and completeness/freshness metadata where the relevant contract supports them. A recent receipt is not proof of a fresh provider observation.
- Preserve last-known-good values on transient provider failure and expose stale, provisional, incomplete, or unavailable status rather than silently substituting zero.
- Reject stale/out-of-order asynchronous results when a newer request, account transition, or financial mutation makes them obsolete.
- Keep scenario evaluation read-only. AI-generated financial actions remain behind explicit application confirmation.
- Preserve cloud revision checks and surface conflicts; do not silently overwrite another device's newer financial state.

See [financial calculation contracts](financial-calculation-contracts.md) for detailed accounting and valuation semantics.

## Identity and data boundaries

The current product model is a shared administrator owner workspace plus server-filtered guest projections. Guest access is read-only and account-scoped; it is not an independent editable financial tenant. Worker authorization is the server boundary and must not rely only on client navigation or hidden controls.

The future tenant/workspace model is documented separately in [multi-portfolio tenancy architecture](multi-portfolio-tenancy-architecture.md). That design is not evidence that independent tenant storage, per-tenant keys, migration, or rollback are already implemented.

## Validation expectations

For code changes affecting these boundaries, use the repository's exact-head validation gates:

```sh
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:complexity
npm run build
```

Add or update focused Vitest coverage for the changed lifecycle, persistence, financial, and authorization behavior. `validate:dead-code` runs the pinned Knip analysis and a non-blocking source-complexity report; use the report to prioritize future extraction work, not as permission to delete active ownership boundaries. Keep English/Russian user-facing copy and translation tests aligned when UI behavior changes. Worker/ Durable Object changes use the repository's direct-to-`main` deployment process and must remain backward-compatible with the client rollout.

## Related maintained references

- [Security threat model](security-threat-model-pt-16.md)
- [Reliability and release gates](reliability-release-gates.md)
- [Session-scoped browser storage](session-scoped-browser-storage.md)
- [Account session policy](account-sessions.md)
- [Current architecture review](architecture-review-2026-11-14.md)
