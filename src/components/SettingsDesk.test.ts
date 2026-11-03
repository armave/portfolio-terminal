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
    expect(source).toContain('Your assigned holdings, LOTS history and their market quotes refresh at the selected interval.');
    expect(source).toContain('Quotes, portfolio cloud state, broker recovery data, trades, orders, cashflows and Closed History refresh on the selected interval.');
    expect(source).toContain('Mandatory Sync Interval');
    expect(source).not.toContain('<option value="0">');
    expect(source).not.toContain('Automatic updates are paused. Manual Sync remains available.');
    expect(source).toContain('<option value="15000">');
    expect(source).toContain('<option value="30000">');
    expect(source).toContain('<option value="60000">');
  });
});

describe('manual sync in Settings', () => {
  it('exposes the same full role-specific manual sync action to admins and guests', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain('id="settingsSyncPortfolioButton"');
    expect(source).toContain("account?.role === \"admin\" || account?.role === \"guest\"");
    expect(source).toContain("emitUiEvent('portfolio:sync-request'");
    expect(source).toContain("translateText('Sync portfolio')");
    expect(source).toContain("translateText('Syncing…')");
  });
});

describe('integrated market status', () => {
  it('removes the temporary TradeNet market probe from Settings', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('TradeNet market status probe');
    expect(source).not.toContain('testFreedomTradeNetEventStream');
    expect(source).not.toContain('Test market status updates');
    expect(source).not.toContain('marketStatusTest');
  });
});
