import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toBrokerRulesFormValues } from './SettingsDesk';

describe('toBrokerRulesFormValues', () => {
  it('formats persisted broker rules once for controlled form inputs', () => {
    expect(toBrokerRulesFormValues({
      broker: 'Freedom Broker Armenia (Tradernet)',
      annualBorrowRate: 0.1575, dayCountBasis: 360, rolloverHour: 4, rolloverMinute: 5,
      rolloverTimeZone: 'Asia/Yerevan', maintenanceEquityRatio: 0.125, stopOutRatio: 0.03,
      commissionPerShare: 0.015, commissionRatePct: 0.0015, commissionMin: 1.2
    })).toEqual({
      annualRate: '15.75',
      dayCountBasis: '360',
      maintenanceMargin: '12.50',
      stopOutRatio: '3.00',
      rolloverTime: '04:05',
      commPerShare: '0.015',
      commVolumePct: '0.15',
      minCommOrder: '1.20'
    });
  });
});

describe('automatic update settings', () => {
  it('documents role-specific refresh cadence and immediate resume behavior', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');

    expect(source).toContain('DEFAULT_GUEST_REFRESH_INTERVAL_MS');
    expect(source).toContain('DEFAULT_ADMIN_REFRESH_INTERVAL_MS');
    expect(source).toContain('refreshNow: true');
    expect(source).toContain('Your assigned holdings and LOTS history refresh every 60 seconds.');
    expect(source).toContain('Broker balances, positions, trades and orders refresh every 60 seconds.');
    expect(source).toContain('Automatic updates are paused. Manual Sync remains available.');
  });
});

describe('temporary TradeNet diagnostics controls', () => {
  it('keeps the test controls administrator-only and exposes both read-only probes', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("account?.role === \"admin\" && <section class=\"settings-panel settings-tradenet-diagnostics");
    expect(source).toContain("runTradeNetTest('rest')");
    expect(source).toContain("runTradeNetTest('websocket')");
    expect(source).toContain('testFreedomTradeNetConnection()');
    expect(source).toContain('testFreedomTradeNetOrdersStream()');
    expect(source).toContain("runTradeNetTest('portfolio')");
    expect(source).toContain("runTradeNetTest('markets')");
    expect(source).toContain('testFreedomTradeNetEventStream(kind)');
    expect(source).toContain('Test portfolio updates');
    expect(source).toContain('Test market status updates');
    expect(source).toContain("JSON.stringify(tradeNetTest.result, null, 2)");
    expect(source).toContain('Temporary test controls — remove after verification.');
  });
});
