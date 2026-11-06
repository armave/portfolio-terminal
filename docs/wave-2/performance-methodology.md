# PT-06 — Performance calculation methodology

**Status:** Initial deterministic calculation contract  
**Implementation:** `src/domain/portfolioPerformance.ts`  
**Tests:** `src/domain/portfolioPerformance.test.ts`  
**Wave 2 stream:** [PT-06 PR #359](https://github.com/armave/portfolio-terminal/pull/359)

## 1. Input contract

All timestamps are UTC epoch milliseconds. Valuation observations and all cash values in one calculation must use the same three-letter currency code. The engine does not perform currency conversion.

A valuation observation contains:
- `timestamp`: UTC epoch milliseconds, unique within the series.
- `equity`: finite, non-negative portfolio equity.
- `currency`: three-letter currency code.
- `quality`: `current`, `provisional`, or `incomplete`.

At least two valuation observations are required. The engine sorts a copied array by timestamp; it does not mutate caller data. Duplicate timestamps, invalid values, mixed currencies, and incomplete quality cause an unavailable result.

External cash flows use a positive magnitude and an explicit type:
- `contribution`: capital enters the portfolio and is a positive portfolio flow.
- `withdrawal`: capital leaves the portfolio and is a negative portfolio flow.

Valuation at the opening timestamp is assumed to already include flows at or before that timestamp. A flow is included in the measured interval only when `startAt < flow.timestamp <= endAt`. Flows after the final valuation belong to a later measurement window.

## 2. Time-weighted return — linked Modified Dietz

For an interval with opening value (B), closing value (E), signed external flows (CF_j), and interval duration (T):

[
w_j = \frac{t_{end}-t_j}{T}
]

[
R_{MD} = \frac{E-B-\sum_j CF_j}{B+\sum_j(w_j CF_j)}
]

The flow weight is the fraction of the interval remaining after the flow. Contributions are positive from the portfolio's perspective; withdrawals are negative.

The engine calculates Modified Dietz return between each pair of supplied valuation observations and links those subperiod returns:

[
R_{linked}=\prod_i(1+R_{MD,i})-1
]

The output method is explicitly `linked-modified-dietz`. It is a flow-weighted approximation when pre-flow and post-flow valuations are unavailable; it must not be described as exact subperiod TWR. Exact TWR requires reliable valuations around each external flow and can be added when the upstream transaction/history contracts can supply them.

Opening equity and the Modified Dietz capital base must be positive. A return below -100%, invalid timing, or non-finite result is unavailable rather than clamped into a plausible number (apart from a tiny floating-point tolerance at -100%).

## 3. Money-weighted return — XIRR

Investor-perspective cash flows are constructed as:
- Opening portfolio equity: negative investment.
- External contribution: negative investor cash flow.
- External withdrawal: positive investor cash flow.
- Closing portfolio equity: positive terminal value.

Year fractions use actual elapsed milliseconds divided by 365 days (ACT/365). The solver uses a bracketed bisection method and a normalized NPV sign calculation to avoid avoidable overflow.

The engine only reports a result when the dated investor cash-flow series has exactly one sign change. Multiple or zero sign changes can produce ambiguous or nonexistent IRR roots; those cases are returned as unavailable rather than selecting a root based on an arbitrary initial guess.

The output method is explicitly `xirr-act-365` and the result is annualized.

## 4. Daily, monthly, and yearly series

The engine groups linked subperiod returns by the UTC calendar date, month, or year of each subperiod's ending valuation. Returns within a bucket are linked geometrically. The result includes:
- period return,
- cumulative return since the start of the supplied series,
- bucket start/end timestamps,
- input quality state.

The bucket frequency does not invent observations. The actual time resolution is limited by the supplied valuation cadence. For example, monthly snapshots cannot produce reliable daily performance.

## 5. Benchmark comparison

Benchmark comparison requires a dividend-reinvested total-return index. A price-only index is rejected because omitted distributions would make the comparison inconsistent with portfolio total return.

Portfolio and benchmark must use the same currency and exactly matching opening and closing UTC timestamps. The engine does not interpolate trading calendars, resample histories, or convert currencies. PT-07 must provide validated total-return index levels and market/FX provenance before the UI exposes production benchmark comparisons.

The benchmark return is the closing total-return index level divided by its opening level, minus one. The portfolio return is the flow-adjusted linked Modified Dietz result over the same endpoints. The output includes:

- arithmetic active return: portfolio return minus benchmark return;
- relative wealth return: (1 + portfolio return) / (1 + benchmark return) - 1.

Relative return is unavailable (represented as `null`) when benchmark wealth falls to zero; the arithmetic active return remains available. Provisional benchmark observations produce a provisional comparison and warning.

## 6. Attribution

One-period attribution accepts generic keyed buckets such as positions, accounts, cash, or liabilities.

For each item:
[
P_i = E_i-B_i-\sum_j F_{i,j}
]

[
C_i = \frac{P_i}{\text{portfolio Modified Dietz capital base}}
]

Item opening values must sum to opening portfolio equity. Item closing values must sum to closing portfolio equity. The signed item capital movements (including internal transfers between buckets) must net to the portfolio's external cash flows. Item profits must reconcile to portfolio profit within the configured absolute/relative tolerance.

The contribution percentages therefore reconcile to the period's Modified Dietz return. The engine intentionally does not infer security/account allocations from aggregate broker positions; PT-02 transaction and PT-07 instrument contracts must provide those mappings.

## 7. Dividends, fees, commissions, and financing costs

Dividends, fees, commissions, and interest are summarized separately as positive magnitudes. Net income/cost is:

[
\text{dividends}-\text{fees}-\text{commissions}-\text{interest}
]

This summary is explanatory only. These amounts must already be represented in the valuation observations (dividend cash/investment value, and paid/accrued fees or financing costs). The income/cost summary must **not** be added to or deducted from TWR/MWR again, which would double-count them.

External contributions and withdrawals are the only cash-flow types used to adjust performance in this calculation kernel.

## 8. Data quality and currency rules

- `current`: all required observations are current.
- `provisional`: inputs are usable but one or more observations/flows are provisional; the calculation remains labelled provisional and carries warnings.
- `incomplete`: required inputs are incomplete; the calculation is unavailable.

Mixed currencies are rejected. No current FX rate is substituted for historical FX. Historical FX pair/direction/source/time/freshness semantics belong to PT-07 and must be integrated before multi-currency consolidated returns or attribution are enabled.

The engine never interprets an absent/malformed value as zero. Callers must provide a valid observation or an explicit quality state.

## 9. Integration boundaries and known omissions

This initial implementation is a pure domain calculation foundation. It does not yet:
- read portfolio persistence or the future PT-02 transaction ledger;
- ingest real valuation history from PT-04/TradeNet or PT-07 market providers;
- derive position/account attribution buckets from actual trades, holdings, cash, or liabilities;
- compare benchmark series;
- provide dashboard UI or reports;
- perform historical FX conversion.

These are intentional integration gates while the other Wave 2 streams run in parallel. Until those contracts land, the calculation APIs are exercised with typed observations and independent known-answer fixtures only. No production/live broker performance result is claimed.
