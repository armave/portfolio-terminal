# Cash Activity ledger

## Status

Implemented in the client feature branch; exact-head GitHub Actions, PR review and release verification are still pending. This document describes the code path being delivered, not a production deployment certification.

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

Cash outflows require existing available cash. If the proposed movement would make free cash negative, the command rejects without changing state or journal history. It never converts a withdrawal, fee, tax, commission or transfer-out into margin borrowing. Non-USD manual postings are rejected because the current canonical cash/debt fields are USD-denominated; no FX rate or second cash subledger is inferred.

Manual margin interest is a deliberate exception to cash-paid costs: it does not reduce free cash and increases the magnitude of signed debt. Its realized-charge delta follows the existing rollover rule: it is added to `realizedMarginCharged` only when there are no position tickers or invested cost basis is zero; otherwise it remains capitalized in debt for the open-position financing calculation. The journal records the explicit realized-charge delta, including zero.

## Reconciliation and performance

Broker cashflow reconciliation compares both journal event type and the shared category. That prevents two records that both use the generic `fee` event type (for example, tax vs. commission) from being treated as the same cashflow solely because their amount/date/currency happen to match.

The income/cost summary reads normalized broker cashflows plus app/system-owned income/cost events. It skips broker journal copies to avoid duplicates. Credited interest is shown separately from margin interest. These figures are explanatory and are not added a second time to TWR/MWR. Deposits and withdrawals remain the external performance flows consumed by the existing performance adapter.

## Data quality and limitations

- Unknown classifications remain visible and are excluded from verified totals.
- Missing/invalid amounts, currencies, dates and provisional source identities remain visible and are excluded from verified USD summary values.
- Foreign-currency rows are displayed but excluded from USD totals; the UI does not convert currencies.
- Current available cash and margin debt are shown from canonical state, not reconstructed from broker rows.
- The feature does not edit open positions, closed-trade cost basis, lots, commissions allocated to past trades, or broker records.
- No broker order, transfer or account-write API is added. All broker reads retain the existing read-only adapter and synchronization owner.
- Guest visibility and writes remain bounded by the existing role-specific application/server sync policy; this feature does not introduce a new server endpoint or server-side cash-posting command.

## Validation to retain

Tests cover shared classification and sign normalization, ambiguous-margin fail-closed behavior, duplicate-looking fallback-ID preservation, broker evidence-only journal behavior, category-aware reconciliation, manual-post idempotency and outflow rejection, margin-interest debt capitalization (including the existing open-position realized-charge rule), income-cost reporting, and Russian translation parity. PR/Actions evidence must be recorded against the final feature-branch commit before release.
