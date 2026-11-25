# Cash Activity ledger

## Status

**Production release verified — 2026-11-24.** The Cash Activity feature was merged through [PR #720](https://github.com/armave/portfolio-terminal/pull/720) to `dev`, then promoted through [PR #721](https://github.com/armave/portfolio-terminal/pull/721) to `main`. Production `main` is at `2cad42ae551ff192d34e409258b1d0baa1e25698`. The same-run GitHub Pages artifact passed provenance validation, same-commit security validation, deployment and the published-site HTTP smoke check at [the production app](https://armave.github.io/portfolio-terminal/).

This confirms the application release path and published shell. CI browser journeys use deterministic fixtures; it does not certify live authenticated TradeNet behavior, live Market Depth, or broker-side transaction submission.

## User experience

The administrator Trades desk contains **Closed trades** and **Cash Activity** views. Cash Activity displays source broker cashflows and app-owned journal entries in one chronological ledger with search, category and period filters. Summary values include current available USD cash, margin debt, and verified USD inflows/outflows. The UI is responsive and uses the existing English/Russian localization system.

The manual-entry form supports deposit, withdrawal, dividend, credited interest, commission, fee, tax, transfer and margin interest. Transfers require an explicit inflow/outflow direction. The form is administrator-only in the current application; guest users continue to receive their server-filtered holdings/LOTS projection and do not load administrator Closed History.

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

## Manual posting command

The form calls `PortfolioStore.postCashActivity`. The command validates a finite positive magnitude, USD currency, valid effective timestamp and idempotency key. It uses the existing `updateFinancialMutation` boundary to prepare the canonical balance change and append the corresponding journal event in the same state commit.

The mutation is persisted before state publication, as with other audited financial commands. A request fingerprint makes an identical idempotency-key retry a successful no-op and rejects reuse of the same key for different facts.

Cash outflows require existing app free cash. If the proposed movement would make `cashCushion.freeCash` negative, the command rejects without changing state or journal history. It never converts a withdrawal, fee, tax, commission or transfer-out into margin borrowing. A positive signed broker/account cash balance remains a separate valuation bucket and does not block non-margin activity or get silently netted into app free cash. Non-USD manual postings are rejected because the current canonical cash/debt fields are USD-denominated; no FX rate or second cash subledger is inferred.

Manual margin interest is a deliberate exception to cash-paid costs: it does not reduce free cash and capitalizes only when the signed broker/account balance is zero or negative. It is rejected while that balance is positive cash, rather than silently reducing broker cash or fabricating margin debt. Its realized-charge delta follows the existing rollover rule: it is added to `realizedMarginCharged` only when there are no position tickers or invested cost basis is zero; otherwise it remains capitalized in debt for the open-position financing calculation. The journal records the explicit realized-charge delta, including zero.

## Reconciliation and performance

Broker cashflow reconciliation compares both journal event type and the shared category. That prevents two records that both use the generic `fee` event type (for example, tax vs. commission) from being treated as the same cashflow solely because their amount/date/currency happen to match.

The income/cost summary reads normalized broker cashflows plus app/system-owned income/cost events. It skips broker journal copies to avoid duplicates. When a broker row uniquely matches an app-owned manual Cash Activity posting by event type/category, currency, signed amount (within USD 0.01), and timestamp (within 24 hours), the broker row is preferred and the manual copy is omitted. Equally close manual candidates or a category/type conflict with a matching manual posting withhold the income/cost summary rather than guessing. Identical normalized facts under one stable broker cashflow ID are counted once; conflicting facts under that ID make the summary unavailable. Fallback identities remain distinct and provisional rather than being collapsed by appearance.

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

Tests cover shared classification and sign normalization, ambiguous-margin fail-closed behavior, duplicate-looking fallback-ID preservation, broker evidence-only journal behavior, category-aware reconciliation, manual-post idempotency and outflow rejection, separation of positive broker cash from app free cash, manual credited-interest replay, margin-interest debt capitalization (including the existing open-position realized-charge rule), income-cost reporting, and Russian translation parity.

## Production validation evidence

- **Feature PR #720 head:** `e962a62b57db485e931518229f53f5abe75c73a9`; [Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/45386375741) and [Security & Workflow Validation](https://github.com/armave/portfolio-terminal/actions/runs/45386375513) passed before merge.
- **Production main commit:** `2cad42ae551ff192d34e409258b1d0baa1e25698`; [main-push Pull Request CI](https://github.com/armave/portfolio-terminal/actions/runs/45387805304) and [same-commit Security & Workflow Validation](https://github.com/armave/portfolio-terminal/actions/runs/45387807799) completed successfully.
- The production-main quality job passed typecheck, Oxlint, the full Vitest suite (**218 files, 2,879 tests**), Vite development-server smoke, dead-code validation, and full plus production dependency audits. Aggregate coverage was 81.99% statements, 76.25% branches, 88.08% functions and 85.31% lines; the coverage-threshold job passed.
- The production build, desktop/mobile browser smoke and performance baseline, and Operations Browser Journey (account, settings and guest) passed. Gitleaks, actionlint, zizmor and CodeQL passed on the production commit.
- The GitHub Pages staging job verified the build artifact's embedded commit and source run ID, then required successful security validation for the same `main` SHA. Pages deployment and its post-publish HTTP smoke both passed. The exact deployment run is [45387805304](https://github.com/armave/portfolio-terminal/actions/runs/45387805304); the published URL is [armave.github.io/portfolio-terminal](https://armave.github.io/portfolio-terminal/).

These checks establish the deployed application artifact and deterministic regression coverage, not live broker connectivity or live Market Depth behavior.
