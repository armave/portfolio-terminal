# Cash Activity ledger

## Status

**Production release verified — 2026-11-24.** The Cash Activity feature was merged through [PR #720](https://github.com/armave/portfolio-terminal/pull/720) to `dev`, then promoted through [PR #721](https://github.com/armave/portfolio-terminal/pull/721) to `main`. Production `main` is at `2cad42ae551ff192d34e409258b1d0baa1e25698`. The same-run GitHub Pages artifact passed provenance validation, same-commit security validation, deployment and the published-site HTTP smoke check at [the production app](https://armave.github.io/portfolio-terminal/).

This confirms the application release path and published shell. CI browser journeys use deterministic fixtures; it does not certify live authenticated TradeNet behavior, live Market Depth, or broker-side transaction submission.

## User experience

The administrator Trades desk contains **Closed trades** and **Cash Activity** views. Cash Activity is a read-only chronological ledger of broker cashflows and existing app-owned journal events. It supports search across descriptions and source IDs, category, period, source and data-quality filters. The responsive UI uses the existing English/Russian localization system.

The summary deliberately separates account state from filtered history: current available USD cash and current margin debt are read from canonical state, while verified USD inflows, outflows and net movement are calculated across all rows matching the current filters (not just the visible page). The current margin-debt card follows the signed-balance contract: negative `balance` is debt; positive values are not shown as debt.

There is no manual cash activity form or manual posting action. Previously saved app-owned cash activity remains visible as historical journal evidence. Rows created by the former manual-entry command are marked provisional and excluded from verified USD flow summaries; they are not deleted, rewritten or replayed. The administrator-only visibility boundary remains unchanged; guest users continue to receive their server-filtered holdings/LOTS projection and do not load administrator Closed History.

## Ownership and persisted state

There is one canonical state owner: `PortfolioStore`. Cash Activity does not create another store or mutate positions.

- Available USD cash: `PortfolioState.cashCushion.freeCash` (with the existing `cashBalance` compatibility projection).
- Signed margin balance: `PortfolioState.balance`; negative values represent margin debt.
- Broker history: `PortfolioState.cashflows`, retained as normalized source records.
- Auditable commands and broker evidence: append-only `PortfolioState.transactionEvents`.

The ledger combines broker source rows with app-owned events. Broker-authored journal copies are excluded from the app-owned event projection so a broker cashflow is not displayed twice.

## Classification contract

`src/domain/cashflowClassification.ts` is shared by broker journal ingestion, broker cashflow reconciliation, performance income/cost reporting and the Cash Activity ledger.

| Category | Journal event | USD cash behavior for a manual posting |
|---|---|---|
| Deposit | `cash.deposit` | Increase available cash |
| Withdrawal | `cash.withdrawal` | Decrease available cash |
| Dividend | `dividend` | Increase available cash |
| Credited interest | `interest.income` | Increase available cash |
| Commission / fee / tax | `fee` | Decrease available cash |
| Margin interest | `margin.interest` | Increase margin debt; leave cash unchanged |
| Transfer | `cash.transfer` | Direction-selected increase or decrease |
| Ambiguous adjustment / unknown label | Not guessed | No automatic posting |

Corporate actions, corrections and other non-cash records are classified for audit/display but do not become manual cash postings. A generic margin adjustment or margin-call label is not assumed to be interest. Dividend reinvestment is not assumed to be a cash dividend.

## Broker import is evidence-only

Broker refresh merges cashflow rows into the existing history through the app-owned reconciliation coordinator. Journal copies are attributed to the broker, carry their external reference and signed external amount, and deliberately omit local `cashDelta` and `marginDebtDelta`. Import/replay does not post to the cash balance or margin debt.

Provider IDs are preferred. Rows without a provider operation ID get a deterministic fallback display identity and are marked provisional. Duplicate-looking rows in a single provider response are retained as separate rows rather than silently collapsed. Fallback IDs do not qualify as verified broker fee inputs or confirmed reconciliation matches. Same-ID changed records continue through the existing revision/conflict rules.

## Read-only history and legacy data

The former `PortfolioStore.postCashActivity` command and its entry form have been removed. New cash activity can enter this ledger only through broker history or existing system-owned journal events. Broker imports remain evidence-only: normalized source rows and broker-authored journal copies do not mutate `cashCushion.freeCash` or signed `balance`.

Persisted transaction events are not migrated or deleted. Earlier `manual-cash-activity` rows, along with older manual cash/margin adjustment events, remain visible as app-sourced historical records and are marked provisional. They are excluded from verified USD cashflow totals so user-entered historical data is not presented as broker-verified activity. Current balances are not automatically reversed or recomputed from these historical rows.

## Reconciliation and performance

Broker cashflow reconciliation compares both journal event type and the shared category. That prevents two records that both use the generic `fee` event type (for example, tax vs. commission) from being treated as the same cashflow solely because their amount/date/currency happen to match.

The income/cost summary reads normalized broker cashflows plus app/system-owned income/cost events and skips broker journal copies to avoid duplicates. Its existing matching rules for persisted legacy manual Cash Activity events are retained: when a broker row uniquely matches an older app-owned manual event by event type/category, currency, signed amount (within USD 0.01), and timestamp (within 24 hours), the broker row is preferred and the manual copy is omitted. Equally close legacy candidates, a category/type conflict, or an opposite signed movement withhold the income/cost summary rather than guessing. These compatibility rules protect historical performance reports; they do not provide a new manual-entry path. Identical normalized facts under one stable broker cashflow ID are counted once; conflicting facts under that ID make the summary unavailable. Fallback identities remain distinct and provisional rather than being collapsed by appearance.

Credited interest is shown separately from margin interest. For margin-interest reconciliation, the comparison uses financing/debt capitalization evidence rather than the intentionally zero account-cash delta. These figures are explanatory and are not added a second time to TWR/MWR. Deposits and withdrawals remain the external performance flows consumed by the existing performance adapter.

## Data quality and limitations

- Unknown classifications remain visible and are excluded from verified totals.
- Missing/null, blank, boolean or malformed amounts, currencies, dates and provisional source identities remain visible and are excluded from verified USD summary values. Performance income/cost reporting and reconciliation also reject malformed amount fields instead of coercing them to numeric zero.
- Foreign-currency rows are displayed but excluded from USD totals; the UI does not convert currencies.
- Current available cash and margin debt are shown from canonical state, not reconstructed from broker rows.
- The feature does not edit open positions, closed-trade cost basis, lots, commissions allocated to past trades, or broker records.
- No broker order, transfer or account-write API is added. All broker reads retain the existing read-only adapter and synchronization owner.
- Guest visibility and writes remain bounded by the existing role-specific application/server sync policy; this feature does not introduce a new server endpoint or server-side cash-posting command.

## Validation to retain

Tests cover shared classification and sign normalization, ambiguous-margin fail-closed behavior, duplicate-looking fallback-ID preservation, broker evidence-only journal behavior, category-aware reconciliation, read-only ledger rendering, source/data-quality filters, legacy manual-row visibility and exclusion from verified summaries, separation of current balances from filtered flow summaries, margin-interest debt-only presentation, income-cost reporting and Russian translation parity.

## Production validation evidence

- **Feature PR #720 head:** `e962a62b57db485e931518229f53f5abe75c73a9`; [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/45386375741) and [Security & Workflow Validation](https://github.com/armave/portfolio-terminal/actions/runs/45386375513) passed before merge.
- **Production main commit:** `2cad42ae551ff192d34e409258b1d0baa1e25698`; [main-push Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/45387805304) and [same-commit Security & Workflow Validation](https://github.com/armave/portfolio-terminal/actions/runs/45387807799) completed successfully.
- The production-main quality job passed typecheck, Oxlint, the full Vitest suite (**218 files, 2,879 tests**), Vite development-server smoke, dead-code validation, and full plus production dependency audits. Aggregate coverage was 81.99% statements, 76.25% branches, 88.08% functions and 85.31% lines; the coverage-threshold job passed.
- The production build, desktop/mobile browser smoke and performance baseline, and Operations Browser Journey (account, settings and guest) passed. Gitleaks, actionlint, zizmor and CodeQL passed on the production commit.
- The GitHub Pages staging job verified the build artifact's embedded commit and source run ID, then required successful security validation for the same `main` SHA. Pages deployment and its post-publish HTTP smoke both passed. The exact deployment run is [45387805304](https://github.com/armave/portfolio-terminal/actions/runs/45387805304); the published URL is [armave.github.io/portfolio-terminal](https://armave.github.io/portfolio-terminal/).

These checks establish the deployed application artifact and deterministic regression coverage, not live broker connectivity or live Market Depth behavior.
