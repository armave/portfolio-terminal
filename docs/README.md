# Project documentation

This directory contains maintained product and engineering references, current operational policies, and multi-PR workstream contracts. It is not an archive of completed pull-request plans or dated audit snapshots.

## Product and architecture

- [Product vision and delivery roadmap](product-vision-roadmap.md) — product direction, capability map, and delivery dependencies.
- [Architecture overview and invariants](architecture.md) — runtime composition, state ownership, and engineering boundaries.
- [Architecture review — 2026-11-14](architecture-review-2026-11-14.md) — a dated code-informed review and its prioritized findings; treat it as a review snapshot, not a security certification.
- [Financial calculation contracts](financial-calculation-contracts.md) — observed financial semantics and compatibility constraints. Update this before changing formulas.
- [Multi-portfolio tenancy architecture](multi-portfolio-tenancy-architecture.md) — proposed future ownership and isolation design. It is not an implemented independent-tenant capability.

## Accounts, broker integrations, and UI patterns

- [Account sessions](account-sessions.md) — server-enforced session expiry, per-account session cap, and revocation behavior.
- [Portfolio planning settings](portfolio-settings.md) — admin-managed app guardrails, defaults, scope, and validation boundaries.
- [Role-based portfolio synchronization](ROLE_SYNC_POLICY.md) — role-specific refresh policy and data visibility.
- [Settings information architecture and safety UX](settings-ux.md) — role-aware navigation, synchronization-status semantics, backup/recovery separation, and financial-setting presentation.
- [Session-scoped browser storage](session-scoped-browser-storage.md) — local storage namespaces and authenticated workspace transitions.
- [Progressive Web App](pwa.md) — install metadata, safe app-shell caching, offline limitations, reconnect checks and production smoke coverage.
- [Freedom TradeNet market-data integration](FREEDOM_MARKET_DATA.md) — Worker-backed read-only quote, market-status, order, and depth paths.
- [TradeNet account risk controls](TRADE_NET_ACCOUNT_CONTROLS_IMPLEMENTATION.md) — read-only integration specification for account and instrument constraints.
- [REST and socket request audit](request-optimization-audit-2026-11-12.md) — request families and startup/refresh behavior.
- [Request orchestration R03–R05](request-orchestration-r03-r05-2026-11-13.md) — shared request lifecycle and regression gates.
- [Shared table pagination](table-pagination-pattern.md) — the supported reusable pagination pattern.
- [Combined Margin workspace UX](combined-workspace-ux.md) — KPI hierarchy, position comparison, risk data quality, research context and disclosures.

## Security and release quality

- [Picomatch ReDoS backport](ci/picomatch-redos-backport.md) — temporary, source-attributed v2/v4 backports, dependency resolution, regression evidence and retirement conditions.
- [Tenant KMS operations](tenant-kms-operations.md) — AWS KMS / IAM Roles Anywhere setup, Worker secret configuration, key provisioning and operational gates.

- [Tenant KMS operations](tenant-kms-operations.md) — AWS KMS / IAM Roles Anywhere setup, Worker secret configuration, key provisioning and operational gates.
- [PT-16 tenant-key lifecycle ADR](pt16-tenant-key-lifecycle-adr.md) — proposed DEK/KEK ownership, versioned envelopes, unwrap boundary and rotation/recovery state machine.
- [PT-16 data lifecycle inventory](pt16-data-lifecycle-inventory.md) — observed financial-data storage surfaces and proposed retention/export/deletion controls.
- [PT-16 browser security review](pt16-browser-security-review.md) — GitHub Pages CSP boundary, XSS surfaces and credential-exposure test plan.

- [PT-16 security and data-lifecycle threat model](security-threat-model-pt-16.md) — observed controls and residual risks; not a penetration test.
- [Reliability, performance, observability, and release gates](reliability-release-gates.md) — exact-head CI, authenticated synthetic portfolio/Trades performance evidence, and operational limits.
- [CI coverage baseline — 2026-11-17](ci/coverage-baseline-2026-11-17.md) — measured V8 coverage, selected financial/store/Worker modules, and aggregate regression floors.
- [GitHub repository settings follow-up](ci/github-settings-follow-up.md) — manual branch-ruleset and Cloudflare production-environment steps that cannot be represented by workflow files.

## Delivery workstreams

- [Remaining work implementation plan](remaining-work-implementation-plan.md) — dependency-ordered plan for active PT-02, PT-04, PT-05, PT-16 and PT-17 issues, including manual approval and production-verification gates.

- [Wave 2 delivery record](wave-2/README.md) — completed foundation streams and their integration history.
- [Wave 2 performance methodology](wave-2/performance-methodology.md) — deterministic performance-calculation input and quality contract.
- [Wave 2.5 transparency slice](wave-2.5/README.md) — investor-facing explanations of existing calculations and data quality.
- [Wave 3 roadmap and implementation model](wave-3/README.md) — current ownership, transaction-trust, and integrated-intelligence workstreams.
- [Wave 3 current-state audit](wave-3/current-state-audit.md) — code-informed baseline for the active Wave 3 work.
- The [Wave 3 workstreams](wave-3/workstreams/) contain the detailed PT-02, PT-04, PT-05, PT-06, and PT-07 contracts and acceptance gates.

## Documentation maintenance

- Keep implementation claims synchronized with code and tests. The source and exact-head CI results take precedence when a document disagrees with the repository.
- Mark proposed, partial, and implemented work distinctly. Do not describe a design or mock-based test as deployed or production-verified behavior.
- Keep durable contracts, operational policies, and active cross-PR workstreams here.
- Track temporary audit findings and completed PR checklists in the relevant issue or pull request. Remove branch-specific plans and completed snapshots after their actionable content has been incorporated into maintained references or issues.
- Add links to this index when introducing a new long-lived document; avoid creating a separate dated audit file for a completed change unless it records a lasting contract or unresolved release gate.
