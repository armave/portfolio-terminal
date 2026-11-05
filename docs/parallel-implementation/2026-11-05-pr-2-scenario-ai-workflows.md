# PR 2 — Complete scenarios, AI confirmation and decision-support workflows

**Status:** Implementation committed in PR #324; focused AI browser journey remains open.  
**Base:** `main` at `056211e03fcc4154538c45f969bc608268120dac` (2026-11-05).  
**Branch:** `work/scenario-ai-workflows-2026-11-05`  
**Priority:** Critical  
**Ownership:** Scenario UI, AI intent/confirmation flows, report dialogs, and localization.

## Goal

Make the decision-support experience dependable from the user's scenario command through read-only projection, comparison/report presentation, and any explicitly confirmed mutation. No preview or AI-generated result may mutate portfolio state before the user accepts a validated action.

## Implementation delivered in PR #324

- Read-only Gemini `simulation`, `comparison`, and `fetch_quote` intents are converted into the existing deterministic terminal command grammar rather than being reported as a generic completed action.
- Portfolio-changing AI intents continue through the existing synchronous confirmation helper; read-only intent routing never mutates portfolio state directly.
- New requests supersede older pending responses. Non-AI terminal commands invalidate pending AI work. A stable in-memory snapshot of positions, selected view, balance, cash cushion and broker assumptions is compared after the provider response; outdated results are discarded.
- AI scenario horizons and labels are validated against the local scenario command constraints.
- Scenario comparison, scenario report and Margin Intelligence labels/statuses are routed explicitly through the English/Russian localization service. Dynamic feed counts, fetched-time labels and source counts have dedicated formatting tests.
- Margin Intelligence refresh/close controls have touch-sized hit areas and visible keyboard focus.
- Focused Vitest coverage is added for command routing, request lifecycle, context freshness, intent validation, localization formatting and application wiring.

## Remaining before ready

- [ ] Add a dedicated authenticated-browser journey that drives deterministic Gemini simulation/comparison/quote responses through the rendered UI and verifies the scenario modal/quote result.
- [ ] Re-run the dedicated journey against the final integrated head after PRs #323 and #325 land.

Current PR head `f7e1911e8090dc4a03fbc08c5c9f5720525c9f6b` passes the repository CI pipeline: typecheck, Vitest, production build, existing Chromium browser smoke, dead-code validation and both dependency audits. The existing browser smoke is not a substitute for the focused AI journey listed above.

## Confirmed baseline

- `src/features/terminal/commandDispatcher.test.ts` already tests read-only scenario inputs, multi-date exit comparisons, and buy-more simulations.
- `src/features/ai/intent.test.ts` tests supported and rejected intent shapes and prompt construction.
- `src/features/ai/confirmedPortfolioAction.test.ts` tests decline, accept, and mutation failure behavior.
- Scenario Comparison, Scenario Report and Margin Intelligence dialogs already exist and use the shared dialog focus/close infrastructure.
- The UI conventions require static application copy to use `src/services/i18n.ts`; English and Russian dictionaries are present.
- Source inspection found static English labels still rendered directly in scenario and Margin Intelligence modals. This conflicts with the documented i18n convention and needs component-level localization coverage, not dictionary-only assertions.

## Implementation scope

### 1. Scenario workflow completeness

- [ ] Add an isolated browser journey for a single-position projection from terminal entry through result review.
- [ ] Exercise multiple exit dates and compare all supported columns/presets without changing portfolio state.
- [ ] Exercise hypothetical buy-more analysis and prove it remains read-only.
- [ ] Verify empty, incomplete, provisional and stale quote inputs produce explicit data-quality disclosures rather than fabricated numeric values.
- [ ] Verify scenario dialog open/close, Escape, backdrop handling, focus entry/restoration, and responsive layout.
- [ ] Ensure the comparison and report views display the same calculated outputs and warning state as the deterministic scenario result.

### 2. AI intent and confirmation safety

- [ ] Exercise valid supported AI actions from prompt to parsed intent to confirmation UI to accepted mutation.
- [ ] Exercise decline and verify byte-for-byte equivalent portfolio state (no mutation, no cloud write).
- [ ] Exercise malformed/unsupported intent fields, missing quantities/prices/dates, non-finite values and unknown actions.
- [ ] Verify accepted action applies exactly once even under repeated clicks or delayed responses.
- [ ] Simulate timeout, provider error, malformed response and late/stale response; preserve state and show retryable or actionable feedback.
- [ ] Verify no path bypasses the existing `confirmedPortfolioAction` validation/confirmation boundary.
- [ ] Verify AI results are not presented as authoritative broker data or personalized financial advice.

### 3. Localization and accessibility corrections

- [ ] Route static labels in `ScenarioComparisonModal.tsx`, `ScenarioReportModal.tsx`, and `MarginIntelligenceModal.tsx` through `translateText` and existing keys/dictionary conventions.
- [ ] Add missing Russian entries only where a corresponding English source string is introduced.
- [ ] Localize button accessible names, subtitles, loading states, stale-data notices, errors, source labels, and completion actions.
- [ ] Preserve provider-supplied article headlines and other dynamic content as data while translating their surrounding labels.
- [ ] Add component-wiring tests proving the rendered call sites use translations; dictionary presence alone is insufficient.
- [ ] Verify focus management, semantic dialog names, keyboard operation and touch targets.

## Likely files and boundaries

Primary ownership:
- `src/features/terminal/`
- `src/features/ai/`
- `src/components/ScenarioComparisonModal.tsx`
- `src/components/ScenarioReportModal.tsx`
- `src/components/MarginIntelligenceModal.tsx`
- `src/services/i18n.ts`, `src/services/i18n-ru.ts`, and their tests
- New isolated Vitest/component/browser tests
- A dedicated browser journey, e.g. `scripts/browser-smoke-scenarios.mjs`
- A dedicated workflow file if required to keep parallel CI edits disjoint

PR 1 owns the trade lifecycle and transaction mutation surfaces. Avoid editing `PortfolioStore` sale methods or its shared persistence boundary. PR 3 owns market-data provider/runtime and settings/account management paths. Do not edit the shared monolithic browser-smoke script during parallel implementation.

## Non-goals

- No financial calculation formula changes.
- No AI execution without explicit user confirmation.
- No new provider, AI model or dependency unless a concrete need is documented.
- No change to Worker authorization or account access.
- No claim that AI analysis is guaranteed correct or constitutes investment advice.
- No broad modal redesign or replacement of shared dialog-focus infrastructure.

## Acceptance criteria

1. Every supported scenario type can be executed and reviewed in the UI.
2. Hypothetical projections and declined AI actions never mutate portfolio state or create cloud writes.
3. Accepted actions are validated and applied at most once.
4. Invalid or late AI results cannot overwrite newer user state.
5. Missing/provisional quote inputs remain clearly disclosed.
6. English and Russian static labels, statuses, errors and accessible names are complete.
7. Scenario and AI dialogs work on phone, tablet and desktop and preserve keyboard focus.
8. Vitest and the dedicated production-browser journey cover normal, failure, cancellation and stale-response paths.

## Validation checklist

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run validate:dead-code`
- [ ] `npm run audit:dependencies`
- [ ] `npm run audit:production`
- [ ] `npm run build`
- [ ] Dedicated production-browser scenario/AI journey
- [ ] English/Russian component-wiring and accessible-name tests
- [ ] Final diff review confirming read-only preview and confirmation safeguards

Do not mark this PR ready or merge it until the code-bearing implementation and all required checks are complete.
