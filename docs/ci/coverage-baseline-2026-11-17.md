# Vitest coverage baseline — 2026-11-17

## Measurement

Captured from GitHub Actions **Coverage baseline and thresholds** on commit `c47be969ceaa68405e58c49ebf197206dbef200c` using Vitest 5.1.0 with the matching `@vitest/coverage-v8@5.1.0` provider.

The scope is deliberately limited to financial-domain, portfolio-store, Worker and Durable Object source files listed in `vitest.config.ts`. The entire Vitest suite runs to collect execution data; only the selected production modules are included in the report.

| Metric | Measured baseline | Enforced aggregate floor |
|---|---:|---:|
| Lines | 84.17% | 80% |
| Statements | 80.91% | 80% |
| Functions | 88.36% | 85% |
| Branches | 75.45% | 70% |

The floor is intentionally below the measured value to allow small legitimate refactors while preventing material coverage regression. Coverage is evaluated over the combined selected source set. Per-file values are recorded below for prioritization, not as independent CI thresholds.

## Per-module baseline

| Module | Lines | Branches | Functions | Statements |
|---|---:|---:|---:|---:|
| `src/domain/accountPermissions.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/domain/brokerTransactionReconciliation.ts` | 95.56% | 77.73% | 95.06% | 92.72% |
| `src/domain/closedHistoryFeeAudit.ts` | 85.56% | 70.52% | 100.00% | 83.25% |
| `src/domain/closedHistoryFees.ts` | 98.78% | 75.08% | 100.00% | 94.21% |
| `src/domain/closedTradeAllocation.ts` | 100.00% | 94.44% | 87.50% | 96.15% |
| `src/domain/closedTradeAttribution.ts` | 95.58% | 78.48% | 96.00% | 95.27% |
| `src/domain/freedomCashflows.ts` | 90.00% | 75.00% | 100.00% | 85.94% |
| `src/domain/guestPortfolio.ts` | 96.49% | 83.16% | 93.75% | 94.65% |
| `src/domain/portfolioLotJournal.ts` | 79.12% | 75.64% | 95.12% | 79.93% |
| `src/domain/portfolioTransactionJournal.ts` | 91.95% | 84.78% | 100.00% | 86.61% |
| `src/domain/portfolioTransactions.ts` | 90.17% | 84.93% | 100.00% | 89.94% |
| `src/domain/saleCostBasis.ts` | 87.87% | 85.14% | 100.00% | 87.50% |
| `src/store/portfolioDefaults.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/store/portfolioMigrations.ts` | 100.00% | 68.18% | 100.00% | 98.41% |
| `src/store/portfolioStore.ts` | 90.71% | 79.66% | 92.02% | 87.27% |
| `src/store/portfolioSubscriptions.ts` | 46.66% | 100.00% | 25.00% | 40.54% |
| `worker.js` | 78.92% | 67.76% | 79.31% | 76.36% |
| `state-store.js` | 77.29% | 71.93% | 81.65% | 72.95% |

## Interpretation and next steps

- The lowest coverage is the store subscription lifecycle. Add focused tests for subscription registration, emission, disposal and edge-case listener behavior.
- Worker and Durable Object coverage remain below 80% lines. Add tests around authorization failures, request validation, durable storage errors and lifecycle recovery without using production credentials.
- Several domain modules already have high coverage. Keep their tests stable; do not add brittle assertions purely to raise percentages.
- Re-run `npm run test:coverage` after each meaningful test addition and inspect both the aggregate thresholds and uncovered branches.

Coverage is evidence about exercised code paths, not proof of financial correctness or live broker compatibility.
