import { describe, expect, it } from 'vitest';
import { capturePortfolioPerformanceValuation } from './portfolioPerformanceCapture';
import type { PortfolioState } from '../types/portfolio';

const TIMESTAMP = 1_800_000_000_000;

function stateWithBrokerIntegrity(overrides: Record<string, unknown>): PortfolioState {
  return {
    balance: 1_000,
    positions: {},
    cashCushion: { freeCash: 1_000, holdings: [] },
    brokerAccountInfo: {
      loaded: true,
      status: 'current',
      quality: 'partial',
      receivedAt: TIMESTAMP,
      observedAt: TIMESTAMP,
      balances: [{
        currency: 'USD', amount: 1_000,
        forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0
      }],
      positions: [],
      ...overrides
    }
  } as unknown as PortfolioState;
}

describe('capturePortfolioPerformanceValuation position integrity', () => {
  it('does not create a provisional return from a partial broker position snapshot', () => {
    expect(capturePortfolioPerformanceValuation(
      stateWithBrokerIntegrity({ quality: 'partial' }),
      TIMESTAMP,
      true
    )).toBeNull();
  });

  it('does not create a return when a last-known-good snapshot has unresolved position diagnostics', () => {
    expect(capturePortfolioPerformanceValuation(
      stateWithBrokerIntegrity({
        quality: 'complete',
        positionIntegrityIssues: [{
          ticker: 'GOOGL',
          code: 'negative_quantity_sign_unverified',
          source: 'account_snapshot'
        }]
      }),
      TIMESTAMP,
      true
    )).toBeNull();
  });

  it('does not create a return when the latest rejected broker refresh contains position diagnostics', () => {
    expect(capturePortfolioPerformanceValuation(
      stateWithBrokerIntegrity({
        quality: 'complete',
        lastRefreshIssue: {
          provider: 'freedom-tradenet',
          quality: 'partial',
          source: 'rest',
          receivedAt: TIMESTAMP,
          warnings: [],
          positionIntegrityIssues: [{
            ticker: 'GOOGL',
            code: 'negative_quantity_sign_unverified',
            source: 'account_snapshot'
          }]
        }
      }),
      TIMESTAMP,
      true
    )).toBeNull();
  });
});
