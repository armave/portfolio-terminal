import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countIntegritySymbols, getAccountIntegrityCounts } from './AccountIntegrityCenter';

describe('Account Integrity Center summary', () => {
  it('counts unique app and broker symbols rather than adding unlike share quantities', () => {
    const appPositions = [
      { ticker: 'GOOGL', quantity: 7, currency: 'USD' },
      { ticker: 'GOOGL.US', quantity: 31, currency: 'USD' },
      { ticker: 'AAPL', quantity: 4, currency: 'USD' }
    ];
    const brokerPositions = [
      { ticker: 'GOOGL.US', quantity: 38, currency: 'USD' },
      { ticker: 'AAPL', quantity: 4, currency: 'USD' }
    ];

    expect(countIntegritySymbols(appPositions)).toBe(2);
    expect(getAccountIntegrityCounts(appPositions, brokerPositions, 0)).toEqual({
      appSymbols: 2,
      brokerSymbols: 2,
      findings: 0
    });
  });

  it('does not turn an unavailable broker snapshot into a verified zero', () => {
    expect(getAccountIntegrityCounts([{ ticker: 'GOOGL', quantity: 38 }], null, 0)).toEqual({
      appSymbols: 1,
      brokerSymbols: null,
      findings: 0
    });
  });

  it('treats a genuinely loaded empty broker snapshot as zero positions', () => {
    expect(getAccountIntegrityCounts([{ ticker: 'GOOGL', quantity: 38 }], [], 1)).toEqual({
      appSymbols: 1,
      brokerSymbols: 0,
      findings: 1
    });
  });

  it('ignores blank symbols and invalid or non-positive quantities', () => {
    expect(countIntegritySymbols([
      { ticker: '', quantity: 10 },
      { ticker: 'AAPL', quantity: 0 },
      { ticker: 'MSFT', quantity: 'not-a-number' },
      { ticker: ' NVDA ', quantity: 3 }
    ])).toBe(1);
  });

  it('renders a compact expandable integrity center and discloses unsupported balance comparison', () => {
    const source = readFileSync(new URL('./AccountIntegrityCenter.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Account Integrity Center');
    expect(source).toContain('<details');
    expect(source).toContain('Cash & margin balances');
    expect(source).toContain('Not independently compared');
    expect(source).toContain('The current comparison covers position quantities only.');
    expect(source).not.toContain('Broker reconciliation');
  });
});
