# fix: reject sales with missing or inconsistent cost basis

## Purpose
Prevent realized P&L, debt settlement, and closed-trade history from being generated using an invented purchase price.

## Confirmed starting point
- `src/store/portfolioStore.ts`: `applyMarginSale()` falls back from missing tranches to a synthetic lot priced at `pos.currentPrice`.
- An empty `pos.tranches` array is truthy, so it reaches `allocateFifoSaleTranches()`; if that yields zero basis, the method falls back to `actualSold * pos.currentPrice`.
- `src/domain/portfolio.ts` already has strict lot validation in `realizeClosedTrade()`, but the regular `applyMarginSale()` path does not share that contract.
- `src/domain/portfolioTransactions.ts`: `allocateFifoSaleTranches()` currently allocates through tranches without enforcing that tranche quantity equals recorded open shares.

## Implementation scope
- Own the `applyMarginSale()` sale-accounting region and relevant domain helpers/tests.
- Remove market-price-as-purchase-price fallback; a live quote is not an acquisition record.
- Require a non-empty set of valid lots before any sale mutation.
- Validate finite positive tranche quantities/prices, finite non-negative commissions, and aggregate tranche quantity equal to open shares within documented floating tolerance.
- Reject missing, malformed, under-allocated, or over-allocated lots before changing shares, debt, cash, margins, commissions, or closed history.
- Reuse/unify the stricter `realizeClosedTrade()` invariants so standard and AI-confirmed sale paths cannot diverge.
- Reconcile legacy positions only from trustworthy recorded execution/acquisition data. Otherwise block sale with an actionable recovery message.
- Keep persistence transaction changes out of this PR.

## Required tests
- Missing and empty tranche arrays.
- Tranche total below/above position shares.
- Zero, negative, NaN, and infinite quantity, price, or commission.
- Valid FIFO partial sale and full close.
- Correct remaining lot quantities and commissions.
- All sale entry points use the same accounting contract.
- Rejected sale leaves complete portfolio state and saved snapshot unchanged.
- Legacy positions with valid historical lots remain sellable.

## Acceptance
- [ ] No realized P&L uses current quote as cost basis.
- [ ] Invalid sale is rejected before any financial mutation.
- [ ] One canonical validated cost-basis contract is shared by sale paths.
- [ ] Valid FIFO and fail-closed regressions pass.
- [ ] Full Vitest, typecheck, production build, dead-code/dependency audits, and browser smoke tests pass.

## Parallel ownership
PR #1 owns `notify()/update()` persistence publication. This PR owns sale methods/accounting only; avoid modifying the persistence commit boundary.

