import { describe, expect, it } from 'vitest';
import { toBrokerRulesFormValues } from './SettingsDesk';

describe('toBrokerRulesFormValues', () => {
  it('formats persisted broker rules once for controlled form inputs', () => {
    expect(toBrokerRulesFormValues({
      annualRate: 0.1575,
      dayCountBasis: 360,
      rolloverHour: 4,
      rolloverMinute: 5,
      maintenanceMarginRatio: 0.125,
      stopOutRatio: 0.03,
      commPerShare: 0.015,
      commVolumePct: 0.0015,
      minCommOrder: 1.2
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
