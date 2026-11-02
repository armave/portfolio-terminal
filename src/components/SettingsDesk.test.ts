import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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


describe('Settings account-session safety', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');

  it('remounts Settings with the account identity and generation', () => {
    expect(appSource).toContain('key={`settings-${accountSession?.identity ?? \'none\'}-${accountSession?.generation ?? -1}`}');
    expect(appSource).toContain('isSessionCurrent={isAccountSessionCurrent}');
  });

  it('ignores stale user-directory responses and errors after an account switch', () => {
    expect(settingsSource).toContain('if (!isSessionCurrent()) return;');
    expect(settingsSource).toContain('if (!isSessionCurrent() || requestId !== usersRequestIdRef.current) return;');
  });

  it('does not publish a late self-update or language result into a different session', () => {
    expect(settingsSource).toContain('if (!isSessionCurrent()) return;\n      if (updated.id === account?.id)');
    expect(settingsSource).toContain('if (!isSessionCurrent()) return;\n      setAccount(updated);\n      emitUiEvent(\'auth:user-changed\', { user: updated });');
  });
});
