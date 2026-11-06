# Financial Calculation Contracts — PT-01 Baseline

**Status:** Baseline specification  
**Implementation workstream:** PT-01 — Financial correctness baseline  
**Tracking issue:** [#329](https://github.com/armave/portfolio-terminal/issues/329)  
**Implementation branch:** `feat/pt-01-financial-baseline`  
**Baseline commit:** `cf7526c96eb768eaba9b8e5240b18d9d929f3716` (`dev`, 2026-11-05)

This document characterizes the behavior observed in the current code. It is not a proposal to change formulas, infer missing values, or migrate persisted state. A future formula change must name the contract being changed, explain compatibility impact, and add independent before/after fixtures.

## 1. Authoritative state and source boundaries

| Concern | Current authority / boundary | Contract |
|---|---|---|
| Active positions | `PortfolioState.positions` | Canonical active-position map. |
| Legacy board holdings | `PortfolioState.holdings` | Compatibility projection; regenerated from canonical positions during normalization and not an independent source of truth. |
| Acquisition cost basis | Position `tranches` | FIFO acquisition lots with quantity, entry price, date/acquired timestamp, and optional per-lot buy commission. |
| Aggregate purchase commission | Position `commBuy` | Aggregate compatibility/accounting amount; per-lot values may be incomplete, so unassigned aggregate commission can remain. |
| Signed account balance | `PortfolioState.balance` / valuation input | Positive means cash; negative means margin debt. It is not itself portfolio equity. |
| Unallocated app cash | `cashCushion.freeCash` | Added to positive account cash in the valuation function; kept separate from negative account debt. |
| Market quote | Position/cash-holding current price and quote metadata | Price and freshness are separate facts. A finite price is not evidence of a fresh quote. |
| Broker account snapshot | `brokerAccountInfo` and normalized Freedom data | Broker-reported balances/positions are kept separate from app-owned lots and funding classifications. |
| Closed history | `closedTrades` / broker execution and cashflow snapshots | App-calculated closed-trade accounting and broker-reported execution/cashflow records have distinct origins and must not be conflated. |
| Backup/import | `normalizePortfolioBackup` and `normalizePortfolioState` | Explicit user-import normalization; malformed financial containers and invalid canonical lots fail closed. Runtime credentials are excluded. |

### Rules

1. Never derive cost basis from the current market quote.
2. Never silently replace app-owned lots, cash/margin classifications, or cost basis with a broker aggregate.
3. Never treat a compatibility projection as a second source of truth.
4. Preserve the difference between missing, invalid, zero, stale, delayed, unknown, and unavailable values.
5. Treat imported user data as untrusted input; validate before replacing the current portfolio.

## 2. Portfolio valuation contract

**Source:** `src/domain/portfolioValuation.ts`  
**Primary function:** `calculatePortfolioValuation(input)`

Inputs:
- `signedAccountBalance`: signed account cash/debt amount.
- `freeCash`: separately tracked unallocated cash.
- `marginPositions`: quantities and current market prices for margin holdings.
- `cashHoldings`: quantities and current market price, with `price` as a fallback.

For finite signed balance (B) and finite free cash (F):

- Positive cash is `max(0, B) + max(0, F)`.
- Margin debt is `max(0, -B)`.
- Each holding's market value is quantity × selected positive market price.
- Total holdings value is margin holdings value + cash holdings value.
- Equity is cash balance + total holdings value − margin debt.

Price selection is the first finite positive price. Margin holdings use `currentPrice`; cash holdings prefer `currentPrice` and fall back to `price`. Invalid, missing, zero, and negative prices are not invented. Positive-quantity holdings with no valid price are counted as unpriced.

The function returns finite numeric fallback values, but also returns `accountBalanceAvailable`, `pricedHoldings`, and `unpricedHoldings`. Callers must use the reliability classification before presenting the fallback as a complete value.

### Reliability contract

**Source:** `getPortfolioValuationReliability` in `src/domain/portfolioValuation.ts`

- `incomplete`: account balance is unavailable/invalid or one or more positive-quantity holdings are unpriced.
- `provisional`: otherwise complete inputs have a stale account balance or stale, delayed, unknown-timestamp, or unavailable quote observations.
- `current`: account balance is available, all holdings are priced, and none of the stale/delayed/unknown/unavailable indicators is present.

Precedence matters: `incomplete` wins over `provisional`.

Quote metadata contract in `src/types/portfolio.ts`:
- `sourceTimestamp` is provider observation time when available.
- `receivedAt` is client receipt time and is not an observation timestamp.
- `freshness` is one of `fresh | stale | delayed | unknown`.
- Broker account status is `current | stale | unavailable`; `receivedAt` records receipt time.

A quote with unknown observation time must not be silently labelled fresh merely because it was recently received.

### Currency limitation

The current portfolio valuation input does not carry currency codes or an FX conversion table. It therefore has no explicit cross-currency conversion contract. The formula is valid only when the supplied balances, cash, holdings prices, and quantities are already denominated in a common reporting currency. Do not sum unlike currencies or invent an exchange rate. Multi-currency consolidated valuation is a future feature requiring explicit FX source, timestamp, base currency, conversion direction, and stale-rate behavior.

## 3. Commission contract

**Sources:** `resolveCommissionConfig`, `calculateCommission`, and `calculateTrancheCommissions` in `src/domain/portfolio.ts`; `calculateSaleCommission` in `src/domain/portfolioTransactions.ts`.

Commission configuration is normalized from canonical/legacy aliases. Existing defaults are:
- per-share fee: 0.012
- trade-value rate: 0.0012
- minimum per order: 1.2

For a positive finite share quantity (q), non-negative finite transaction value (V), per-share rate (c_s), value rate (c_v), and minimum (m):

`commission = max(m, c_s × q + c_v × V)`

- The rate is a decimal multiplier, not a percentage-point number.
- A non-positive/invalid quantity is a no-op in the low-level `calculateCommission` compatibility boundary.
- A positive-quantity transaction with invalid/negative proceeds throws.
- Invalid/negative/non-finite commission configuration throws.
- `calculateTrancheCommissions` applies the minimum independently to each tranche/order, then sums those commissions.
- `calculateSaleCommission` uses the shared formula and rounds the returned sale commission to two decimal places.
- Do not assume all commission call sites have the same rounding point; preserve their existing caller contract.

## 4. FIFO cost-basis and partial-sale contract

**Source:** `allocateFifoSaleTranches` in `src/domain/portfolioTransactions.ts`; validation in `src/domain/saleCostBasis.ts`.

Before allocation:
- Sale quantity must be finite and positive.
- Acquisition lots must exist and pass cost-basis validation.
- Sum of lot quantities must explain the recorded open position within the validator's tolerance.
- Entry prices and commissions must be valid; aggregate entry commission must not be understated by explicit lot commission.

Allocation:
- Sell oldest acquisition lots first (FIFO).
- Sold cost basis is the sum of sold quantity × each lot's entry price.
- Explicit per-lot buy commission is allocated proportionally to the quantity removed from that lot; the allocated/remnant fee is rounded to cents per lot.
- If lot commissions are absent/incomplete, the unassigned aggregate buy commission is allocated proportionally by sold quantity.
- Sold cost basis is returned to eight decimal places; allocated commission uses two-decimal precision.
- Remaining tranches are returned without mutating the input tranches.

A materially inconsistent/missing lot ledger blocks the sale calculation; it must not silently fall back to current quote × shares.

## 5. Sale accounting and proceeds settlement contract

**Source:** `calculateSaleAccounting`, `calculateSaleCommission`, `settleSaleProceeds`, and `createClosedTradeRecord` in `src/domain/portfolioTransactions.ts`.

### Realized sale accounting

Inputs include validated open quantity, sold quantity, signed portfolio balance, selected position tranches, all portfolio positions/tranches, broker borrow assumptions, allocated buy commission, sell commission, sale proceeds, sold cost basis, and optional deterministic clock.

- Selected position investment = sum of each selected tranche's quantity × entry price.
- Total portfolio investment = sum of the same measure across positions that have tranches.
- Position weighting is bounded by 1: selected position investment / total portfolio investment (or 1 when the portfolio total is zero and selected position investment is zero).
- The absolute signed balance is allocated using that investment weight.
- Daily borrow rate = annual borrow rate / configured day-count basis (360 or 365).
- Accrued interest uses the existing daily compounding and rollover-date calculation. Any already-recorded position margin charge is a floor; current accrual may not reduce the recorded charge.
- The sale's allocated margin interest is position interest × sold quantity / open quantity, rounded to cents.
- Total commissions = allocated buy commission + sell commission, rounded to cents.
- Gross realized profit = sale proceeds − FIFO cost basis, rounded to cents.
- Net realized profit = gross realized profit − total commissions − allocated margin interest, rounded to cents.
- Net cash proceeds = sale proceeds − sell commission, rounded to cents. Margin rollover interest is already reflected in signed balance and is not deducted from cash proceeds again.

### Debt-first settlement

`settleSaleProceeds(debt, freeCash, netProceeds)` clamps negative legacy debt/cash/proceeds to zero, but rejects non-finite inputs. It repays debt first; any remainder increases free cash. Existing free cash is unchanged when proceeds do not exceed debt. It does not itself impose a new currency conversion or interest calculation.

### Closed-trade compatibility record

`createClosedTradeRecord` writes the legacy aliases (`avgBuyPrice`/`entryPrice`, `sellPrice`/`exitPrice`, date aliases, commission aliases, and net-profit aliases) alongside the canonical values. Holding days are computed from the date interval using rounded calendar-duration days in this helper. Preserve these persisted aliases unless a separately approved schema migration changes them.

## 6. Margin interest, projection, and rollover contracts

**Sources:** `calculateMarginInterest`, `calculateProjectedDebt`, `calculateAccruedFees`, `findProjectionBreakevenDay`, `calculateBreakevenDays`, and `processRollovers` in `src/domain/portfolio.ts`.

- Annual borrow rate is divided by day-count basis (default 365 at these helper boundaries); configured values are validated at the relevant caller.
- Margin interest compounds daily against the eligible tranche principal and margin utilization ratio.
- Position-level calculations can use an allocated debt/total debt ratio; do not charge the full portfolio debt against every position.
- When explicit day counts are not supplied, tranche dates and configured rollover time are used.
- The configured rollover time defaults to 04:00 in `Asia/Yerevan`; tests must pin the clock and not depend on the host timezone.
- The `processRollovers` path stores the actual last processed rollover boundary and rounds the debt to cents after each daily cycle.
- `calculateProjectedDebt` mirrors per-cycle cent rounding for each full day; a final fractional day is compounded and rounded at the end.
- `calculateSaleAccounting` rounds allocated interest to cents. Lower-level `calculateMarginInterest` returns a floating-point result and should not be assumed to have already been rounded to cents.
- `calculateAccruedFees` normalizes non-finite fee inputs to zero and rounds the aggregate to cents; this is an existing compatibility behavior, not a blanket rule for all financial helpers.

**Known compatibility boundary:** repository architecture/audit notes distinguish the active runtime rollover/accrual calculation from the legacy cloud-import `processRollovers` path. Their time-boundary and rounding history must remain separately covered until explicitly reconciled. Do not unify, re-timezone, or re-round them as part of PT-01 or a cleanup-only change.

## 7. Freedom financing-fee allocation and currency boundary

**Sources:** `calculateFreedomMarginFeeAllocations` in `src/domain/freedomMarginFees.ts`; row provenance in `src/domain/freedomCashflows.ts`.

- Only rows identified as Freedom API rows (IDs beginning `freedom-`) are eligible.
- Financing-fee text is matched against the existing financing patterns and excludes trade-commission rows.
- Current implementation allocates USD financing rows to FIFO-matched buy-to-sell exposure segments.
- Allocation weights are exposure quantity × buy price and allocations are performed in integer cents using largest-remainder distribution, preserving the input fee's cents.
- If broker executions exist, the broker-execution allocation path is selected; app closed trades are a fallback only when broker executions are absent.
- Known non-USD cashflows and known non-USD executions are excluded from USD allocation.
- **Legacy compatibility:** missing/blank currency is currently treated as USD. This should be made explicit and reviewed before tightening the behavior, because changing it can alter historical fee attribution.

The fee allocator does not convert EUR/AMD/other currencies to USD. A foreign-currency fee must not be mixed into USD realized P&L without a separately specified and timestamped FX conversion.

## 8. Funding classification contract

**Sources:** `normalizeActiveTrancheMix` and `resolveActiveTrancheMixInput` in `src/domain/freedomPortfolio.ts`; `resolveClosedTradeAllocation` in `src/domain/closedTradeAllocation.ts`.

- Funding classification is `cash`, `margin`, or `mix`.
- A mixed allocation preserves the relative cash/margin ratio when total quantity changes.
- Invalid/missing allocations fall back to the current normalizer's cash-only default; do not silently reinterpret those values as broker-confirmed funding facts.
- Closed-history allocation prefers explicit saved user/admin classification; otherwise it uses inferred FIFO attribution.
- For a mix row, cash quantity is bounded by total closed quantity and margin quantity is the remainder.
- Guest attribution may only be assigned to the cash-funded share quantity.

Funding classification is app-owned metadata, separate from broker position quantity and market value.

## 9. Backup/import validation boundary

**Source:** `normalizePortfolioBackup` and `normalizePortfolioState` in `src/domain/portfolio.ts`.

- A backup must be a recognized object and present top-level containers must have the expected shape.
- If canonical `positions` exists, legacy `holdings` must not be used to conceal a malformed canonical position container.
- Canonical share quantities and tranche quantities/prices are validated as finite, positive/non-negative values according to field semantics.
- When a position has canonical tranches, their total quantity must agree with recorded shares.
- Legacy `holdings` migrate into canonical `positions` only when the `positions` property is absent.
- Runtime credential fields such as `gatewaySecret` and legacy `marginBalance` are excluded from normalized/imported state and backup exports.
- Current state is not to be replaced until import validation has succeeded and the user confirms the import.

## 10. Independent reference fixtures

The PT-01 test file `src/domain/financialReferenceFixtures.test.ts` pins independent expected values across representative paths:

| Fixture | Input summary | Expected reference result |
|---|---|---|
| Valuation with cash and margin | signed balance -1,200; free cash 250; margin holdings 10 × 105; cash holdings 2 × 55 | cash 250; debt 1,200; holdings 1,160; equity 210 |
| Mixed funding | total 10 shares; cash 4; margin 6 | cash quantity 4; margin quantity 6 |
| Partial FIFO sale | 5 × 10 + 5 × 20, buy fees 1 + 2; sell 6 | basis 70; allocated buy fee 1.40; remaining 4 × 20 with fee 1.60 |
| Partial sale accounting | proceeds 150; basis 70; buy fee 1.40; sell fee 0.50; recorded financing charge 5; sell 6/10 | gross 80; allocated financing 3; total commission 1.90; net realized 75.10; net cash proceeds 149.50 |
| Full liquidation of remaining lot | proceeds 120; basis 80; buy fee 1.60; sell fee 0.50; financing charge 2 | gross 40; total commission 2.10; net realized 35.90; net cash proceeds 119.50 |
| Debt-first proceeds | debt 80; cash 5; net proceeds 100 | debt 0; cash 25 |
| USD fee allocation | USD and EUR trades/fees with equal exposure | only USD fee is allocated to USD trade; EUR fee/exposure is excluded |
| Stale data | complete fresh, delayed/stale/unknown, missing balance, unpriced position | current, provisional, or incomplete according to precedence |
| Rollover | $1,000 debt; 36.5% annual rate; 365-day basis; one 04:00 Yerevan rollover | debt becomes $1,001.00 |

These fixtures are reference examples, not a complete proof of every broker/provider's behavior. Existing focused domain tests remain part of the baseline and should not be duplicated or weakened.

## 11. Known gaps and follow-up decisions

1. **Consolidated FX valuation is not implemented by the current valuation API.** PT-01 records this limitation; a future FX workstream must define currency conversion before cross-currency totals are shown.
2. **Rollover histories are intentionally distinct.** A separate compatibility investigation is required before any unification or formula change.
3. **Commission call sites have different rounding points.** Future changes must name the call site and order/minimum semantics being altered.
4. **Missing balance fallback is finite but not authoritative.** Consumers must respect `accountBalanceAvailable` and reliability status.
5. **Blank currency is accepted as USD by the legacy Freedom fee allocator.** Tightening that behavior requires historical impact analysis.
6. **Market price freshness is metadata separate from price arithmetic.** A new valuation policy must not infer observation time from receipt time.
7. **Broker reconciliation and live authenticated verification are not proven by fixtures alone.** Keep authenticated TradeNet/browser validation as release gates.

## 12. Change-control checklist for future financial work

Before changing a contract:
- Identify the source function, every caller, persisted field, and UI/report consumer.
- Add an independent known-answer fixture before changing the formula.
- Record currency, units, sign convention, time zone, timestamp semantics, rounding point, and missing-data behavior.
- Compare old/new behavior on real historical snapshots with private identifiers redacted.
- Test partial/full close, cash/debt, fees, interest, backups, cloud restore, and broker reconciliation as applicable.
- Include migration and rollback notes for persisted data changes.
- Update this document and the roadmap issue/PR with the explicit accepted contract change.
- Never label a mock result as authenticated broker or production verification.
