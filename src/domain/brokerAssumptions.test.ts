import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS, normalizeBrokerAssumptions } from './brokerAssumptions';

describe('broker assumption normalization', () => {
  it('uses established defaults for missing and non-object input', () => {
    expect(normalizeBrokerAssumptions(undefined)).toEqual(DEFAULT_BROKER_ASSUMPTIONS);
    expect(normalizeBrokerAssumptions(null)).toEqual(DEFAULT_BROKER_ASSUMPTIONS);
    expect(normalizeBrokerAssumptions([])).toEqual(DEFAULT_BROKER_ASSUMPTIONS);
    expect(normalizeBrokerAssumptions('invalid')).toEqual(DEFAULT_BROKER_ASSUMPTIONS);
  });
  it('uses a supplied fallback for fields missing from a partial record', () => {
    const fallback = { ...DEFAULT_BROKER_ASSUMPTIONS, annualBorrowRate: 0.12, rolloverHour: 6, commissionMin: 2 };
    expect(normalizeBrokerAssumptions({ dayCountBasis: 360 }, fallback)).toEqual({ ...fallback, dayCountBasis: 360 });
  });
  it('normalizes legacy aliases and the Armenia rollover cutoff', () => {
    expect(normalizeBrokerAssumptions({
      annualRate: '0.12', dayCountBasis: '360', dailyRolloverCutoffArmenia: '05:30',
      maintenanceMarginRatio: '0.2', commPerShare: '0.02', commVolumePct: '0.003', minCommOrder: '2.5'
    })).toEqual({
      ...DEFAULT_BROKER_ASSUMPTIONS, annualBorrowRate: 0.12, dayCountBasis: 360,
      rolloverHour: 5, rolloverMinute: 30, maintenanceEquityRatio: 0.2,
      commissionPerShare: 0.02, commissionRatePct: 0.003, commissionMin: 2.5
    });
  });
  it('retains valid rollover timezone overrides and rejects invalid zones', () => {
    expect(normalizeBrokerAssumptions({ rolloverHour: 7, rolloverMinute: 15, rolloverTimeZone: 'Europe/London' }))
      .toMatchObject({ rolloverHour: 7, rolloverMinute: 15, rolloverTimeZone: 'Europe/London' });
    expect(normalizeBrokerAssumptions({ rolloverTimeZone: 'Not/A_Timezone' }).rolloverTimeZone)
      .toBe(DEFAULT_BROKER_ASSUMPTIONS.rolloverTimeZone);
  });
  it('preserves the historical runtime-field precedence when both aliases are stored', () => {
    expect(normalizeBrokerAssumptions({
      annualBorrowRate: 0.3, annualRate: 0.11, maintenanceEquityRatio: 0.4, maintenanceMarginRatio: 0.15,
      commissionPerShare: 0.04, commPerShare: 0.02, commissionRatePct: 0.04, commVolumePct: 0.002,
      commissionMin: 4, minCommOrder: 2
    })).toMatchObject({
      annualBorrowRate: 0.11, maintenanceEquityRatio: 0.15, commissionPerShare: 0.02,
      commissionRatePct: 0.002, commissionMin: 2
    });
  });
  it('accepts canonical-only fields when no legacy alias is present', () => {
    expect(normalizeBrokerAssumptions({
      annualBorrowRate: 0.13, maintenanceEquityRatio: 0.17, commissionPerShare: 0.025,
      commissionRatePct: 0.0025, commissionMin: 2.25
    })).toMatchObject({
      annualBorrowRate: 0.13, maintenanceEquityRatio: 0.17, commissionPerShare: 0.025,
      commissionRatePct: 0.0025, commissionMin: 2.25
    });
  });
  it('preserves zeros and falls back for malformed and out-of-range values', () => {
    expect(normalizeBrokerAssumptions({
      annualRate: 0, maintenanceMarginRatio: 0, stopOutRatio: 0, commPerShare: 0, commVolumePct: 0, minCommOrder: 0
    })).toMatchObject({
      annualBorrowRate: 0, maintenanceEquityRatio: 0, stopOutRatio: 0,
      commissionPerShare: 0, commissionRatePct: 0, commissionMin: 0
    });
    expect(normalizeBrokerAssumptions({
      annualRate: true, dayCountBasis: 400, rolloverHour: '24', rolloverMinute: -1,
      maintenanceMarginRatio: 1, stopOutRatio: 0.5, commPerShare: '',
      commVolumePct: 2, minCommOrder: 'not-a-number'
    })).toEqual(DEFAULT_BROKER_ASSUMPTIONS);
  });
  it('does not fall through an invalid legacy alias to a canonical value', () => {
    expect(normalizeBrokerAssumptions({ annualRate: 'bad', annualBorrowRate: 0.2 }).annualBorrowRate)
      .toBe(DEFAULT_BROKER_ASSUMPTIONS.annualBorrowRate);
  });
});
