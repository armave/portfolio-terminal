import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker.test.js', 'user-auth.test.js'],
    silent: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/domain/accountPermissions.ts',
        'src/domain/brokerTransactionReconciliation.ts',
        'src/domain/closedHistoryFeeAudit.ts',
        'src/domain/closedHistoryFees.ts',
        'src/domain/closedTradeAllocation.ts',
        'src/domain/closedTradeAttribution.ts',
        'src/domain/freedomCashflows.ts',
        'src/domain/guestPortfolio.ts',
        'src/domain/portfolioLotJournal.ts',
        'src/domain/portfolioTransactionJournal.ts',
        'src/domain/portfolioTransactions.ts',
        'src/domain/saleCostBasis.ts',
        'src/store/portfolioDefaults.ts',
        'src/store/portfolioMigrations.ts',
        'src/store/portfolioStore.ts',
        'src/store/portfolioSubscriptions.ts',
        'worker.js',
        'state-store.js'
      ],
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 85,
        branches: 70
      }
    }
  },
  server: {
    hmr: {
      protocol: 'ws',
      host: 'localhost',
    }
  }
});
