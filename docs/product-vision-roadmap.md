# Portfolio Terminal — Product Vision & Delivery Roadmap

**Status:** Umbrella product roadmap  
**Target branch for this roadmap PR:** \`dev\`  
**Roadmap branch:** \`docs/portfolio-terminal-product-roadmap\`  
**Product owner intent:** Full investment management in one place, serving multiple investor roles  
**Delivery model:** Small, independently reviewable implementation workstreams tracked by child issues and dedicated branches

---

## 1. Executive product vision

Portfolio Terminal is to become a **comprehensive investment-management and portfolio-intelligence platform**. It must do more than display current holdings: it should explain portfolio condition and performance, project plausible futures, identify and quantify risk, monitor relevant market and account events, and help each user make better-informed decisions.

### Product promise

> From current portfolio state to future portfolio trajectory — with accurate financial data, transparent calculations, proactive risk monitoring, and actionable investment intelligence.

Portfolio Terminal should become the investor's primary source of financial understanding across connected broker accounts, while the assets and any actual order execution may remain at external brokers.

### Product positioning

**An investment operating system, not merely a portfolio dashboard.**

| Traditional portfolio tools | Portfolio Terminal target |
|---|---|
| Display holdings | Explain the complete investment picture |
| Show headline P&L | Explain performance, cash flows, and contribution |
| Display account balance | Explain capital, liquidity, leverage, and financing costs |
| Display current prices | Show source, freshness, and relevant market context |
| Show historical charts | Compare explicit future scenarios and assumptions |
| Offer basic alerts | Monitor portfolio-specific risk and data health |
| Focus on one broker | Consolidate authorized data across multiple accounts/providers |
| Present information | Help users interpret it and decide what to do |

The competitive standard is that Portfolio Terminal should be **more reliable, transparent, comprehensive, and analytically useful than broker-provided portfolio tools**. Reliability is a release gate, not a marketing claim.

---

## 2. Product goals

1. **One trustworthy portfolio view.** Reconcile owned records and broker-reported facts without conflating them.
2. **Complete investment management.** Cover accounts, positions, transactions, cash, performance, risk, projections, research, and reporting.
3. **Forward-looking analysis.** Model possible outcomes and the risk attached to each scenario; never present scenarios as guaranteed forecasts.
4. **Proactive monitoring.** Detect material portfolio, market, broker, and data-quality changes and route useful alerts to the correct user.
5. **AI as an active assistant.** AI may monitor, explain, summarize, compare, and recommend; deterministic engines remain authoritative for numbers and users remain in control of consequential actions.
6. **Role-aware multi-user support.** Provide secure experiences for individual investors, traders, managers, professionals, guests, and platform administrators.
7. **Broker independence.** Keep provider integrations behind adapters so a broker does not define the product's financial model.
8. **Reliability over feature count.** Every material financial number must be reproducible, explainable, and covered by tests.

## 3. Non-goals and explicit guardrails

The initial product evolution does **not** authorize:

- Building a broker, exchange, custody, banking, or payment platform.
- Enabling autonomous order placement or autonomous financial mutations.
- Replacing the current framework or rewriting the application wholesale.
- Introducing microservices before deployment, scale, or isolation requirements justify them.
- Replacing current financial formulas or persisted schemas without an isolated specification, regression fixtures, migration, and rollback plan.
- Treating AI output, analyst targets, delayed quotes, or scenario estimates as verified facts.
- Adding unrelated social/community features or a broad set of non-investment financial products.

Broker order execution, if ever considered, requires a separate product, regulatory, security, broker-contract, and user-authorization decision.

---

## 4. Target users and role model

The product serves multiple user groups through shared financial engines with role-appropriate capabilities and server-enforced permissions.

| Persona / role | Primary job to be done | Expected capabilities |
|---|---|---|
| Individual investor | Understand and manage long-term capital | Holdings, allocation, performance, dividends/flows, risk, projections, reports |
| Active trader | Monitor open exposure and trade lifecycle | Positions, executions, targets, price/context alerts, scenario comparisons |
| Advanced investor | Evaluate risk and strategy | Leverage, concentration, drawdown, stress tests, portfolio what-if analysis |
| Portfolio manager | Oversee several portfolios | Assigned portfolios, consolidated analytics, monitoring, reports, controlled collaboration |
| Investment professional | Analyze and communicate portfolio condition | Research, benchmark comparisons, evidence-backed reporting, approved sharing |
| Guest / viewer | Inspect an explicitly shared portfolio view | Narrow, read-only access to assigned data and reports |
| Portfolio owner | Control their own workspace | Portfolio settings, members, data connections, sharing grants |
| Platform administrator | Operate the platform safely | User/workspace administration, platform health, security and operational controls |

### Permission distinctions

Platform administrator, workspace owner, portfolio manager, investor, and guest are separate concepts. Platform administration must not automatically grant unrestricted access to all private portfolio data.

Permissions are enforced at the server/API and storage boundaries. Hiding a component or button in the client is never an authorization control. A guest may not be treated as a tenant simply because the guest currently has a filtered projection.

---

## 5. Capability map

### A. Portfolio and account management

- Multiple portfolios and broker accounts.
- Positions, tranches/lots, transactions, cash, fees, commissions, dividends, and cashflows.
- Average cost, realized/unrealized P&L, and closed-trade history.
- Margin debit, accrued interest, equity, buying power, and maintenance/stop-out assumptions.
- Imports, exports, backup/restore, and broker synchronization.
- Reconciliation between broker-reported facts and app-owned accounting.

### B. Performance analytics

- Daily, monthly, yearly, and since-inception returns.
- Explicit time-weighted and money-weighted return methodology.
- Cash-flow-adjusted performance.
- Position, asset, sector, currency, and account attribution.
- Benchmark comparisons with aligned currency and measurement windows.
- Historical portfolio and account comparisons.

### C. Risk management

- Position, sector, asset, currency, account, and broker concentration.
- Leverage and margin utilization, maintenance buffer, liquidity, and financing costs.
- Volatility, drawdown, correlation, and downside sensitivity where data permits.
- Configurable risk limits and position-level budgets.
- Stress tests and portfolio-level shocks.
- Transparent data quality, assumptions, and calculation windows for every metric.

### D. Projection and scenario modeling

- Bull/base/bear and user-defined scenarios.
- Position price scenarios and portfolio-level shocks.
- Contributions, withdrawals, dividends, fees, and borrowing costs.
- Staged entries/exits and what-if trades.
- Margin/equity and maintenance-buffer paths under stress.
- Scenario comparison over explicit time horizons.

### E. Market and investment intelligence

- Normalized live/delayed/historical prices with provenance.
- Instrument identity, exchange, currency, and trading calendar.
- Watchlists, news, earnings/dividend calendars, and relevant events.
- Technical/fundamental context and analyst data where available.
- Provider health, cache freshness, and source-quality warnings.

### F. AI assistant and monitoring

- Permission-scoped natural-language portfolio queries.
- Daily/weekly portfolio briefings.
- Event-driven risk and market explanations.
- Materiality-ranked alerts and recommendations.
- Scenario comparisons with stated assumptions and alternatives, including no action.
- User-configurable monitoring, quiet periods, acknowledgement, and feedback.
- Explicit confirmation for all consequential portfolio mutations; no autonomous trading.

### G. User, admin, and reporting capabilities

- Secure workspaces, role/membership management, and portfolio sharing.
- Platform operations, access reviews, audit history, session revocation, and system health.
- Period reports, exports, benchmarks, and controlled read-only sharing.
- Onboarding and metric explanations that distinguish broker facts, app calculations, and scenarios.

---

## 6. Architecture direction

### Recommended approach: modular monolith with explicit domain boundaries

Retain the current Preact + TypeScript + Vite application and Cloudflare Worker/Durable Object deployment model. Evolve the existing domains and services deliberately. Do not start with microservices or a wholesale rewrite.

The target logical domains are:

1. **Portfolio & accounting:** accounts, transactions, positions, cash, cost basis, fees, reconciliation inputs.
2. **Broker integration:** provider adapters, snapshots, executions, orders, cashflows, authentication state.
3. **Performance:** return methodology, contribution, attribution, benchmark calculations.
4. **Risk:** exposure, leverage, drawdown, correlation, stress calculations, risk limits.
5. **Projection:** deterministic what-if calculations and scenario persistence.
6. **Market data & research:** instruments, quote/history normalization, provenance, news and calendars.
7. **Monitoring & alerts:** deterministic rule evaluation, deduplication, acknowledgement, notification delivery.
8. **AI intelligence:** read-only domain tools, narrative synthesis, prioritization, user feedback and approval.
9. **Identity & workspace:** users, tenants, portfolios, roles, memberships, permissions and audit.
10. **Reporting & operations:** exports, reporting, diagnostics, retention and operational health.

### Logical dependency flow

\`\`\`text
Role-specific Preact experiences
            |
     API / authorization boundary
            |
  +---------+---------+----------------------+
  |                   |                      |
Portfolio &       Market data             Identity &
accounting        & research               workspace
  |                   |                      |
  +-----------+-------+----------------------+
              |
     Deterministic domain engines
     Performance | Risk | Projection
              |
      Monitoring / Alerts / AI
              |
  Persistence, audit, cache, integrations
              |
       Brokers and market providers
\`\`\`

### Architecture decisions and constraints

**Financial source of truth**
- Preserve \`PortfolioState.positions\` as the canonical active-position representation during the initial roadmap.
- Continue treating \`holdings\` as a compatibility projection, not an independent source of truth.
- Add auditable transaction/event history incrementally so it can verify/reconstruct state and make mutations traceable.
- A future ledger becoming canonical is a separate, gated migration decision with parity tests, versioning, backup compatibility, and rollback.

**Deterministic calculations**
- Domain calculations must not depend on UI components, browser storage, network calls, or AI.
- The same financial engine must power dashboards, reports, AI tools, and scenario views.
- Never change rounding, commission, rollover, timezone, or margin semantics implicitly.

**Broker and market data provenance**
- Normalize provider payloads at adapter boundaries.
- Track observation time separately from client receipt time.
- Distinguish broker-reported values, app-owned accounting, provider quotes, estimates, and scenarios.
- Stale, delayed, unknown, missing, and unavailable data must be visibly different states.

**Persistence and multi-user authority**
- Keep local persistence/cache for resilience and fast client access.
- For shared multi-user portfolios, server-side ownership and authorization become authoritative.
- Define tenant/portfolio ownership, encryption keys, revision/conflict behavior, migration, deletion, and recovery before enabling independent editing.
- Never assume the existing guest projection model provides full multi-tenant isolation.

**AI boundary**
- AI reads typed, permission-scoped domain tools by default.
- AI may explain data and propose scenarios but must not calculate authoritative financial values itself.
- Financial changes require validated deterministic commands and explicit user confirmation.
- Every material AI claim should be traceable to source records, calculations, and timestamps.

**Scale and deployment**
- Keep a modular monolith initially.
- Extract services only when measured workload, security isolation, reliability, or independent scaling justifies the cost.
- Keep provider adapters replaceable and testable.
- Preserve current deploy/release safeguards and separate client rollout from Worker/server deployment as required by the repository workflow.

---

## 7. Current-state constraints to preserve

The current repository documents the following facts; the roadmap must evolve them deliberately rather than assume they are already solved:

- The application is a Preact 11 / TypeScript / Vite client, with domain, store, service, AI, quote, and terminal feature areas.
- \`PortfolioState.positions\` is the canonical active-position state; \`holdings\` is a compatibility projection.
- Freedom TradeNet account refresh is read-only. Broker aggregate quantities and prices are kept separate from app-owned lots and cost basis; discrepancies are surfaced rather than silently rewritten.
- The application supports administrator and guest accounts. Administrators share the owner workspace; guests receive server-filtered, encrypted, read-only projections and assignment history.
- Current guest projections are **not** independent tenant-isolated portfolios; local offline guest edits do not update the cloud projection.
- Cloud synchronization uses authenticated sessions, encryption, Durable Object revision checks, and conflict handling. Local storage and backup recovery remain important.
- Market providers have different freshness and timestamp capabilities. A received timestamp is not necessarily the market observation timestamp.
- AI-interpreted portfolio mutations already have an explicit confirmation safeguard.
- Existing financial rollover paths have historical timezone/rounding differences documented in the repository. They must not be unified without an explicit calculation-contract decision.
- TradeNet live-session checks and real-browser Market Depth lifecycle checks remain distinct from mocked automated tests and must be tracked as manual release gates.

These are baseline constraints, not claims that every target capability is currently implemented.

---

## 8. Delivery sequence and dependency plan

The roadmap is split into 18 independently scoped workstreams. Child issues hold task-level scope, acceptance criteria, required tests, and the dedicated implementation branch.

### Stage 0 — Baseline and delivery discipline

- **PT-01:** Financial correctness baseline and reconciliation specification.
- **PT-17:** Reliability, performance, observability, and release gates (baseline can run alongside PT-01).

**Exit gate:** Existing financial behavior is characterized, critical invariants have independent fixtures, and the exact-head validation/release checklist is defined.

### Stage 1 — Financial and data foundations

- **PT-02:** Transaction integrity, atomic mutations, and auditable financial history.
- **PT-03:** Broker adapter boundary and normalized account contracts.
- **PT-05:** Multi-portfolio ownership, tenant isolation, and sharing model.
- **PT-07:** Market and instrument data foundation.
- **PT-16:** Security, privacy, and data lifecycle hardening (threat model begins before multi-tenant implementation).

**Exit gate:** Clear ownership, safe mutations, reliable adapters, and data provenance exist before advanced analytics and broad sharing are enabled.

### Stage 2 — Trustworthy portfolio intelligence

- **PT-04:** Broker reconciliation, data provenance, and discrepancy workflows.
- **PT-06:** Portfolio performance and attribution engine.
- **PT-08:** Deterministic portfolio risk engine.

**Exit gate:** Portfolio state, broker state, performance, and risk can be inspected and explained with explicit data-quality status.

### Stage 3 — Forward-looking portfolio management

- **PT-09:** Scenario modeling and forward portfolio projections.
- **PT-15:** Portfolio reporting, export, and benchmark comparisons.

**Exit gate:** Scenarios are deterministic and read-only; reports reconcile to the same engines used in the application.

### Stage 4 — Proactive investment intelligence

- **PT-10:** Rules-based monitoring, alerts, and notification delivery.
- **PT-11:** Grounded AI investment assistant.
- **PT-12:** Proactive AI monitoring and decision-support workflows.

**Exit gate:** Alerts and AI insights are material, permission-scoped, traceable, configurable, and non-executing.

### Stage 5 — Role-specific product experience and operations

- **PT-13:** Role-based investor, trader, manager, and guest experiences.
- **PT-14:** Platform administration, audit trail, and operational controls.
- **PT-18:** Product documentation, onboarding, and investor education.

**Exit gate:** Each supported persona can complete its core workflow securely and understand data sources, calculations, and limitations.

### Dependency overview

- PT-01 precedes financial formula, data-quality, and performance changes.
- PT-02 and PT-03 underpin broker reconciliation; PT-04 depends on normalized broker contracts.
- PT-05 is a prerequisite for independent portfolios, role-specific sharing, alert routing, and AI access control.
- PT-06 and PT-07 underpin PT-08; PT-08 is a prerequisite for risk-aware PT-09 and PT-10.
- PT-09 and PT-08 provide deterministic inputs for PT-11; PT-10 and PT-11 underpin PT-12.
- PT-05, PT-06, PT-08, PT-09, and PT-10 underpin PT-13.
- PT-02, PT-05, and PT-10 underpin PT-14; PT-02/PT-05/PT-06/PT-08/PT-09 underpin PT-15.
- PT-16 is a continuous gate, not a final cleanup; tenant security review is required before independent editable portfolios are enabled.
- PT-17 is continuous and must be updated at every implementation PR.
- PT-18 follows the stable user workflows and metric contracts but should be written alongside implementation rather than postponed to the very end.

---

## 9. Child implementation workstreams

Each child task has a dedicated branch name and issue. Create the implementation branch from the latest \`dev\` when work begins; do not open empty placeholder PRs. Each completed client/frontend task is delivered as a focused PR targeting \`dev\`. The child issue is closed only after the implementation PR is merged and its acceptance criteria are met.

| ID | Workstream | Tracking issue | Dedicated branch | Depends on |
|---|---|---:|---|---|
| PT-01 | Financial correctness baseline | [#329](https://github.com/armave/portfolio-terminal/issues/329) | \`feat/pt-01-financial-baseline\` | — |
| PT-02 | Transaction integrity & audit history | [#330](https://github.com/armave/portfolio-terminal/issues/330) | \`feat/pt-02-transaction-integrity\` | PT-01 |
| PT-03 | Broker adapters & normalized contracts | [#331](https://github.com/armave/portfolio-terminal/issues/331) | \`feat/pt-03-broker-adapters\` | PT-01; PT-02 semantics |
| PT-04 | Broker reconciliation & provenance | [#332](https://github.com/armave/portfolio-terminal/issues/332) | \`feat/pt-04-broker-reconciliation\` | PT-01, PT-03 |
| PT-05 | Multi-portfolio tenancy & sharing | [#333](https://github.com/armave/portfolio-terminal/issues/333) | \`feat/pt-05-portfolio-tenancy\` | PT-01, PT-02 |
| PT-06 | Performance & attribution | [#334](https://github.com/armave/portfolio-terminal/issues/334) | \`feat/pt-06-performance-analytics\` | PT-01, PT-02 |
| PT-07 | Market/instrument data foundation | [#335](https://github.com/armave/portfolio-terminal/issues/335) | \`feat/pt-07-market-data-foundation\` | PT-01, PT-03 |
| PT-08 | Portfolio risk engine | [#336](https://github.com/armave/portfolio-terminal/issues/336) | \`feat/pt-08-portfolio-risk\` | PT-01, PT-06, PT-07 |
| PT-09 | Scenario & projection engine | [#337](https://github.com/armave/portfolio-terminal/issues/337) | \`feat/pt-09-projection-engine\` | PT-02, PT-06, PT-07, PT-08 |
| PT-10 | Rules-based alerts & monitoring | [#338](https://github.com/armave/portfolio-terminal/issues/338) | \`feat/pt-10-alerts-monitoring\` | PT-05, PT-07, PT-08, PT-09 |
| PT-11 | Grounded AI assistant | [#339](https://github.com/armave/portfolio-terminal/issues/339) | \`feat/pt-11-grounded-ai\` | PT-05, PT-06, PT-08, PT-09 |
| PT-12 | Proactive AI monitoring | [#340](https://github.com/armave/portfolio-terminal/issues/340) | \`feat/pt-12-proactive-ai\` | PT-10, PT-11 |
| PT-13 | Role-specific workspaces | [#341](https://github.com/armave/portfolio-terminal/issues/341) | \`feat/pt-13-role-based-workspaces\` | PT-05, PT-06, PT-08, PT-09, PT-10 |
| PT-14 | Platform administration & audit | [#342](https://github.com/armave/portfolio-terminal/issues/342) | \`feat/pt-14-admin-operations\` | PT-02, PT-05, PT-10 |
| PT-15 | Reporting, exports & benchmarks | [#343](https://github.com/armave/portfolio-terminal/issues/343) | \`feat/pt-15-reporting-benchmarks\` | PT-02, PT-05, PT-06, PT-08, PT-09 |
| PT-16 | Security, privacy & lifecycle | [#344](https://github.com/armave/portfolio-terminal/issues/344) | \`feat/pt-16-security-privacy\` | PT-05; continuous review |
| PT-17 | Reliability, performance & release gates | [#345](https://github.com/armave/portfolio-terminal/issues/345) | \`feat/pt-17-reliability-release-gates\` | Continuous; starts PT-01 |
| PT-18 | Onboarding & investor education | [#346](https://github.com/armave/portfolio-terminal/issues/346) | \`feat/pt-18-product-onboarding\` | PT-05, PT-06, PT-08, PT-09, PT-13 |

### Child PR completion protocol

For each implementation workstream:

1. Create the named branch from the latest \`dev\` when the task starts.
2. Keep the PR limited to that workstream; split unrelated work.
3. State which acceptance criteria are completed and which remain open.
4. Include tests for important logic and user workflows.
5. Preserve English/Russian localization; add translation parity tests for user-facing changes.
6. Include exact-head CI links and the commit SHA that was validated.
7. Record real-browser, authenticated broker, and manual security checks separately from automated/mocked coverage.
8. Link the implementation PR in the child issue and update this roadmap's progress table/checklist.

**Repository deployment policy:** Client/frontend work is submitted as PRs against \`dev\`. Worker/server-only changes are committed and pushed directly to \`main\` for immediate deployment per the repository workflow. For mixed features, separate the server deployment slice from the client PR; keep interfaces compatible and record the paired commits/PRs in the child issue and parent roadmap. Do not route a Worker-only production fix through an unmerged \`dev\` PR.

---

## 10. Cross-cutting engineering standards

### Financial correctness
- Preserve current financial semantics unless a defect is reproduced and a dedicated change is approved.
- Use deterministic domain calculations and explicit monetary precision/rounding.
- Distinguish broker facts, app-maintained accounting, provider market observations, derived metrics, and scenario assumptions.
- No silent mutation, guessing, or fallback that turns missing data into a plausible-looking number.

### Localization and accessibility
- English and Russian remain supported languages.
- Every new visible string must be added to both locale dictionaries.
- Tests must detect missing keys and verify relevant localized UI wiring.
- Tables, dialogs, navigation, alerts, and chart summaries must be keyboard and screen-reader usable.
- Preserve reduced-motion support and responsive behavior.

### Testing and merge gates
Run the repository's actual scripts against the exact final candidate commit:

\`\`\`sh
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:production
npm run build
\`\`\`

Also:
- Use independent expected-value fixtures for important financial calculations.
- Test failed persistence, concurrent/stale requests, cloud revision conflicts, retry/idempotency, and reload recovery.
- Test role/tenant isolation at the Worker/server boundary, not only in component state.
- Use browser journeys for critical persona and responsive workflows.
- Validate a real authenticated TradeNet session and Market Depth reconnect/failure/no-data behavior when a change touches those paths.
- Keep mocks clearly identified as mocks; they do not prove live broker behavior.

### Observability and privacy
- Monitor provider failure, stale data, reconciliation exceptions, cloud conflicts, alert processing, and client errors.
- Do not log raw portfolios, account identifiers, credentials, tokens, encryption keys, or full broker payloads.
- Any telemetry must be purposeful, minimal, and privacy-reviewed.

---

## 11. Product-level success criteria

The product is moving toward its target when these can be demonstrated:

| Dimension | Acceptance standard |
|---|---|
| Financial truth | Key balances, positions, cashflows, fees, and P&L reconcile to validated source records within documented tolerances |
| Explainability | Users can inspect the source, formula, timestamp, currency, and assumptions behind material values |
| Recovery | Failed writes, refreshes, imports, or sync conflicts never silently destroy the last valid state |
| Performance | Portfolio returns and attribution reconcile to known-answer datasets and properly account for external cashflows |
| Risk | Exposure, leverage, and stress results are reproducible and disclose missing/stale input data |
| Projections | Every scenario is reproducible, read-only, assumption-labelled, and distinct from a prediction or guarantee |
| Monitoring | Alerts are relevant, deduplicated, timely, acknowledged, and correctly scoped to the recipient |
| AI | Numerical claims are grounded in domain outputs; recommendations are explainable and never execute |
| Multi-user security | No cross-tenant access; authorization is enforced server-side and independently tested |
| Usability | Each supported persona can complete core workflows on mobile and desktop with localization/accessibility intact |
| Reliability | Exact-head CI and manual release gates are recorded before deployment |

These are intended acceptance targets. Do not claim they are already met by the current application.

---

## 12. Umbrella roadmap progress

The roadmap PR is a planning and coordination artifact. Its merge records the product direction and implementation breakdown; it does not mean all product capabilities are implemented.

- [x] Product intent translated into vision, positioning, user groups, capabilities, and principles.
- [x] Current repository constraints documented from the checked-in README and architecture/audit documents.
- [x] Eighteen implementation workstreams created as individually scoped GitHub issues.
- [x] Dedicated implementation branch names and dependencies assigned to every workstream.
- [ ] PT-01 financial baseline and PT-17 release-gate baseline completed.
- [ ] Foundation and data integrity workstreams completed.
- [ ] Performance, risk, projection, and market intelligence workstreams completed.
- [ ] Monitoring and grounded/proactive AI workstreams completed.
- [ ] Multi-user, role-specific, admin, reporting, and onboarding workstreams completed.
- [ ] Product-level success criteria demonstrated and release evidence recorded.

### Progress update format

Update this document as tasks finish. For every PT item, record: issue link, implementation PR (or server deployment commit), merged commit, validation workflow links, manual QA status, and any accepted follow-up. Do not mark a task complete merely because its branch or PR exists.

---

## 13. Definition of done for the product vision

Portfolio Terminal has reached the intended product state when an authorized user can connect or maintain one or more investment accounts, understand current and historical portfolio condition, reconcile app and broker data, evaluate performance and risk, model future scenarios, receive proactive and explainable alerts, query the same trusted data through AI, and generate reports — all within role-appropriate workspaces and without compromising financial integrity, privacy, or user control.

That is the long-term definition of **Portfolio Terminal as the complete investment-management and intelligence platform**.
