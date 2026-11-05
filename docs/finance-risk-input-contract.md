# Margin-risk input and result contract

This document describes the application-side margin-risk estimate. It does not define or claim to reproduce live Freedom Broker maintenance, liquidation, or collateral rules.

## Accepted inputs

The margin-risk calculator accepts:

- Margin debt: a finite, non-negative number.
- Position market value: a finite, non-negative number.
- Eligible collateral amount supplied by the caller: a finite, non-negative number.
- Configured maintenance-equity ratio: a finite number in the inclusive range `[0, 1)`.
- Configured stop-out ratio: a finite number in the inclusive range `[0, maintenanceEquityRatio]`.

A negative amount, non-finite amount, missing assumption, maintenance ratio of one or greater, negative ratio, or stop-out ratio above maintenance is not normalized to zero by the risk calculator. It returns an explicit unavailable result.

Only the two threshold ratios are validated by this calculation. Commission, annual-borrow-rate, rollover, and day-count settings belong to other calculations and are not margin-risk inputs.

## Result states

The calculator returns one of two result states:

- `status: available`: all input and derived monetary values are finite and within the supported numeric range.
- `status: unavailable`: input values are invalid, configured thresholds are invalid, or a finite input combination overflows during calculation.

Unavailable results include a reason code: `invalid-financial-inputs`, `invalid-broker-assumptions`, or `calculation-overflow`.

## Undefined ratios

A zero denominator is not represented by infinity or NaN:

- When total assets are zero, `equityRatio` is `null`.
- When position value is zero, margin-call and stop-out position buffer percentages are `null`.

A missing position buffer does not suppress an otherwise active margin-call risk trigger. The UI labels an unavailable equity ratio as unavailable rather than classifying it as healthy.

## Compatibility and interpretation

For valid inputs with positive denominators, the existing formulas and configured threshold semantics are preserved. The values remain application estimates based on user-configured assumptions; they are not broker-confirmed margin or liquidation indicators.

This contract intentionally does not change margin-interest accrual, rollover, commission, FIFO allocation, realized P/L, debt settlement, portfolio persistence, or broker integration semantics.
