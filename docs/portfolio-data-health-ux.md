# Portfolio Data Health UX

## Purpose and placement

The shared workspace header shows one compact Portfolio status control. Its status combines the applicable role's portfolio-data health with the current cloud-sync or assigned-data refresh state; the separate Market Status control continues to represent the market session only. The combined control is not a new portfolio desk, broker reconciliation card, or source of financial calculations.

The collapsed control reports one of three attention states:

- **Data current** only when the applicable role-specific sources meet the current/verified contract below.
- **Needs review** when a source explicitly reports stale, incomplete, delayed, unavailable, failed, or conflict state.
- **Checking data status** when the evidence is missing, unknown, not yet synchronized, or insufficient to establish freshness.

Clicking the control opens a viewport-bounded modal with the role-scoped detail rows and existing sync/recovery actions. The shared ModalFrame and dialog-focus utilities provide focus containment, Escape/backdrop dismissal, background isolation, scroll locking, and focus restoration. The workspace bottom-navigation dock remains independently positioned.

## Data ownership and role boundaries

The presentation derives its data through the pure selector in `src/ui/portfolioDataHealth.ts`.

### Administrator

The administrator panel may read:

- `PortfolioState.brokerAccountInfo` metadata, including status, quality, provider, source, observation time, and position-integrity issue count;
- canonical margin positions from `PortfolioState.positions`;
- positive-share cash holdings from `cashCushion.holdings`;
- the existing administrator quote-freshness summary;
- existing cloud connectivity/synchronization status.

It does not expose raw broker rows, payloads, credentials, session identifiers, balance figures, account identifiers, or new reconciliation findings.

### Guest

The guest selector returns only `guestPortfolioSnapshot`, the server-filtered projection for the authenticated guest. Quote freshness is summarized only across that projection's assigned tranches. Guest UI does not select administrator `brokerAccountInfo`, owner `positions`, cash holdings, or owner cloud-sync state.

The application remains a shared administrator owner workspace with guest projections; this UI does not introduce independent editable tenant portfolios or relax Worker authorization.

## Status interpretation

### Broker snapshot

- `current` requires a loaded snapshot, explicit current status, complete quality, no unresolved position-integrity issues, and a valid provider observation timestamp.
- `partial` includes incomplete snapshots and snapshots with unresolved position-integrity issues.
- `empty` is distinct from a complete non-empty snapshot; absence is not promoted to a verified empty portfolio.
- `stale` and `unavailable` remain explicit states.
- Missing status, quality, or observation-time evidence is `unknown`.

The broker's receive time is not substituted for its provider observation time.

### Quotes

The panel reuses `getQuoteFreshness`, `summarizeQuoteFreshness`, and `formatQuoteFreshnessSummary` from `src/utils/formatters.ts`. It follows the role-specific refresh interval already used by the application. Missing prices remain unavailable/not fetched; unknown observation times remain unknown. Delayed and stale classifications are not promoted to fresh.

For administrators, the summary covers margin positions and positive-share cash holdings, matching the existing Margin summary's quote-coverage inputs. For guests, it covers only the assigned tranche projection.

### Synchronization

Administrators see existing cloud connectivity and sync state through the current cloud status helpers. Guests see only the existing assigned-data refresh state. These role-appropriate sync signals contribute to the same collapsed attention state as broker and quote health. Pending sync is shown as in progress; failures and conflicts require review; offline, unknown, and missing evidence are never promoted to current. The modal does not perform network calls of its own.

## Recovery actions

- **Sync portfolio** in the modal invokes the established `portfolio:sync-request` event and its role-specific runtime. Duplicate clicks are coalesced while a request is active.
- During an administrator cloud conflict, ordinary sync is not offered from the modal. **Review in Settings** opens the existing export-first, confirmation-protected recovery surface.
- The panel never pulls cloud data, merges financial arrays, changes portfolio state, or writes broker/account data.
- The empty Combined Margin state uses the same health classification to distinguish no tracked positions from stale, partial, empty, unavailable, or unverified broker evidence. It reuses the existing sync, backup-import, and Balance navigation actions. Conflict state routes to Settings instead of retrying a stale cloud write.

## Boundaries

This feature is presentation-only. It adds no backend endpoint, Worker/ Durable Object change, persisted field, preference, accounting formula, valuation, risk estimate, reconciliation logic, or transaction mutation. Existing market-session calculation and Market Status UI remain unchanged. It does not reintroduce the large portfolio-desk reconciliation card explicitly excluded by the Wave 3 PT-04 workstream.

## Validation

Vitest covers broker snapshot classification, timestamp and missing-data behavior, quote freshness, role-scoped data selection, overall attention-state derivation, single-entry-point/modal action wiring, dialog focus restoration, responsive modal bounds, and English/Russian copy parity.

The production browser smoke verifies the administrator detail rows and responsive containment. The Operations Browser Journey verifies that a guest sees only the assigned snapshot and assigned-data refresh status, not administrator broker or cloud details. Browser fixtures are deterministic mocks and do not establish live TradeNet or production-provider availability.
