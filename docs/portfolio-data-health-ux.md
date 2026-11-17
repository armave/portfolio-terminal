# Portfolio Data Health UX

## Purpose and placement

The shared workspace header shows one compact Portfolio status control for administrators only. It combines the administrator portfolio-data health with cloud-sync state; the separate Market Status control continues to represent the market session. Guests do not see the Data & sync control. The combined control is not a new portfolio desk, broker reconciliation card, or source of financial calculations. When all tracked administrator inputs are healthy, the control is hidden rather than occupying header space.

The collapsed control reports one of three attention states:

- **Up to date** is an internal healthy state; the control is hidden while this state holds.
- **Needs review** appears when a source explicitly reports stale, incomplete, delayed, unavailable, failed, or conflict state.
- **Check data** appears when evidence is unknown, not yet synchronized, or insufficient to establish freshness; it does not imply that data is current.

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

The guest data-health selector continues to return only `guestPortfolioSnapshot`, the server-filtered projection for the authenticated guest. It never selects administrator `brokerAccountInfo`, owner `positions`, cash holdings, or owner cloud-sync state. The Data & sync control and modal are not rendered for guests.

The application remains a shared administrator owner workspace with guest projections; this UI does not introduce independent editable tenant portfolios or relax Worker authorization.

## Status interpretation

### Broker snapshot

- `current` requires a loaded snapshot, explicit current status, complete quality, no unresolved position-integrity issues, and a valid provider observation timestamp.
- `received` means a complete, loaded, current snapshot with no provider observation timestamp but a valid client receipt time. It is shown as **Snapshot received** and is not represented as a provider-time-verified observation.
- `partial` includes incomplete snapshots and snapshots with unresolved position-integrity issues.
- `empty` is distinct from a complete non-empty portfolio; absence is not promoted to a verified empty portfolio.
- `stale` and `unavailable` remain explicit states.
- Missing status, quality, observation time, and receipt time are `unknown`.

TradeNet's documented portfolio event returns the account `acc` and position `pos` arrays but does not define a provider observation timestamp for the whole snapshot. The client receipt time is therefore displayed only as **Received**; it is never substituted into the provider observation-time field. A complete `received` snapshot is not itself a health issue, but its missing provider timestamp remains visible in the provenance detail.

### Quotes

The panel reuses `getQuoteFreshness`, `summarizeQuoteFreshness`, and `formatQuoteFreshnessSummary` from `src/utils/formatters.ts`. TradeNet local ISO `ltt` values are converted only when the quote includes a valid `UTCOffset`; explicit timezone suffixes are used directly. Finnhub Unix-second `t` and Twelve Data Unix-second `timestamp` values are preserved as provider observation times by the fallback quote path. Date-only/local-time labels are not converted without a verifiable zone. Missing offsets and provider timestamps remain unknown; missing prices remain unavailable. Delayed and stale classifications are not promoted to fresh.

For administrators, the summary covers margin positions and positive-share cash holdings, matching the existing Margin summary's quote-coverage inputs. For guests, it covers only the assigned tranche projection.

### Synchronization

Administrators see existing cloud connectivity and sync state through the current cloud status helpers. These signals contribute to the same attention state as broker and quote health. Pending sync is shown as in progress; failures and conflicts require review; offline and unknown evidence are never promoted to current. The modal does not perform network calls of its own.

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
