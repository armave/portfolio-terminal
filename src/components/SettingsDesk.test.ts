import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBrokerRulesFormValues, toBrokerRulesFormValues } from './SettingsDesk';

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
    expect(source).toContain("account?.role === \"admin\" || account?.role === \"guest\"");
    expect(source).toContain("emitUiEvent('portfolio:sync-request'");
    expect(source).toContain("translateText('Sync portfolio')");
    expect(source).toContain("translateText('Syncing…')");
  });
});

describe('TradeNet OPQ diagnostic panel', () => {
  it('keeps the read-only account overview diagnostic admin-only and avoids claiming mapped margin metrics', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("account?.role === 'admin' && <section class=\"settings-panel space-y-3\"");
    expect(source).toContain("fetchFreedomTradeNetOpq()");
    expect(source).toContain('Response fields are not yet mapped to verified margin metrics.');
    expect(source).toContain('Unmapped provider payload (diagnostic)');
    expect(source).not.toContain('initialMarginRequired: Number(opq');
    expect(source).not.toContain('maintenanceMarginRequired: Number(opq');
  });

  it('keeps the getTradingLimits schema probe admin-only and explicitly sends no guessed instrument parameter', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("account?.role !== 'admin' || tradingLimitsProbeLoading");
    expect(source).toContain('fetchFreedomTradeNetTradingLimitsProbe()');
    expect(source).toContain('Sends an empty read-only getTradingLimits request');
    expect(source).toContain('requestParameters');
    expect(source).toContain('providerError');
  });
});

describe('Device Check placement', () => {
  it('places device diagnostics in Settings instead of the Cash & Non-Margin Holdings desk', () => {
    const settingsSource = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const cashSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

    expect(settingsSource).toContain("import { DeviceCheckSummary } from './DeviceCheckSummary';");
    expect(settingsSource).toContain('<DeviceCheckSummary />');
    expect(cashSource).not.toContain('AccountIntegrityCenter');
    expect(cashSource).not.toContain('BrokerReconciliationPanel');
  });
});


describe('multi-portfolio ownership Settings surface', () => {
  it('loads the tenant directory lazily in Settings and keeps financial tenancy disabled', () => {
    const settingsSource = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const componentSource = readFileSync(new URL('./TenantDirectoryPanel.tsx', import.meta.url), 'utf8');

    expect(settingsSource).toContain("void import('./TenantDirectoryPanel')");
    expect(settingsSource).toContain("if (currentUser?.role !== 'admin')");
    expect(settingsSource).toContain('}, [currentUser?.id, currentUser?.role]);');
    expect(settingsSource).toContain("account?.role === 'admin' && (LoadedTenantDirectoryPanel");
    expect(settingsSource).toContain("useState<typeof import('./TenantDirectoryPanel') | null>(null)");
    expect(settingsSource).toContain('const LoadedTenantDirectoryPanel = tenantDirectoryModule?.TenantDirectoryPanel;');
    expect(settingsSource).toContain('<LoadedTenantDirectoryPanel currentUser={account} />');
    expect(componentSource).toContain("directory.financialDataEnabled === false");
    expect(componentSource).toContain('Directory only — financial storage is not enabled for newly created tenants.');
    expect(componentSource).toContain('Guests receive projection-only access.');
  });
});





describe('broker rules disclosure state', () => {
  it('synchronizes native details toggles with Preact state across controlled form rerenders', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const [brokerRulesOpen, setBrokerRulesOpen] = useState(false);');
    expect(source).toContain('open={brokerRulesOpen}');
    expect(source).toContain('onToggle={(event) => setBrokerRulesOpen((event.currentTarget as HTMLDetailsElement).open)}');
    expect(source).toContain("stopOutInput?.form?.querySelector<HTMLInputElement>('#maintenanceMarginInput')");
    expect(source).toContain('getStopOutValidationMessage(stopOutInput.value, maintenanceInput.value)');
    expect(source).toContain('stopOutInput.setCustomValidity(');
    expect(source).toContain('value={ruleValues.annualRate}');
  });
});

describe('broker rules stop-out validation wiring', () => {
  it('updates custom validity as maintenance or stop-out values change', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain('getStopOutValidationMessage(stopOutInput.value, maintenanceInput.value)');
    expect(source).toContain('updateStopOutValidity();');
    expect(source).toContain('updateStopOutValidity();');
    expect(source).toContain('if (!form.reportValidity()) return;');
  });
});

describe('readBrokerRulesFormValues', () => {
  it('uses the current submitted controls rather than a stale controlled-state snapshot', () => {
    const values: Record<string, string> = {
      '#annualMarginRateInput': '18',
      '#interestDayCountInput': '365',
      '#maintenanceMarginInput': '12.5',
      '#stopOutRatioInput': '3',
      '#rolloverTimeInput': '04:00',
      '#commissionPerShareInput': '0.02',
      '#commissionVolumeInput': '0.15',
      '#minimumCommissionInput': '1.5'
    };
    const form = {
      querySelector: (selector: string) => values[selector] === undefined ? null : { value: values[selector] }
    } as unknown as HTMLFormElement;

    expect(readBrokerRulesFormValues(form, {
      annualRate: '15', dayCountBasis: '360', maintenanceMargin: '10', stopOutRatio: '5',
      rolloverTime: '03:00', commPerShare: '0.01', commVolumePct: '0.1', minCommOrder: '1'
    })).toEqual({
      annualRate: '18', dayCountBasis: '365', maintenanceMargin: '12.5', stopOutRatio: '3',
      rolloverTime: '04:00', commPerShare: '0.02', commVolumePct: '0.15', minCommOrder: '1.5'
    });
  });

  it('falls back to the current state only for missing controls', () => {
    const form = { querySelector: () => null } as unknown as HTMLFormElement;
    const fallback = {
      annualRate: '15', dayCountBasis: '360', maintenanceMargin: '10', stopOutRatio: '5',
      rolloverTime: '03:00', commPerShare: '0.01', commVolumePct: '0.1', minCommOrder: '1'
    };
    expect(readBrokerRulesFormValues(form, fallback)).toEqual(fallback);
  });
});

describe('Margin Intelligence encryption migration controls', () => {
  it('exposes the inventory and migration tool only to administrators', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('./MarginDigestSecurityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain("account?.role === 'admin' && <MarginDigestSecurityPanel");
    expect(panel).toContain('fetchMarginDigestMigrationInventory');
    expect(panel).toContain('const MIGRATION_BATCH_SIZE = 25;');
    expect(panel).toContain('migrateMarginDigestBatch({ cursor, limit: MIGRATION_BATCH_SIZE })');
    expect(panel).toContain('inventory.plaintextRecords === 0');
    expect(panel).toContain('This report does not prove that every active client has stopped sending legacy writes.');
  });
});


describe('guest Settings layout', () => {
  it('uses a single full-width action column for guests instead of leaving an empty second column', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    expect(source).toContain("account?.role === 'guest' ? 'settings-account-actions--guest' : ''");
    expect(styles).toContain('#settingsDesk .settings-account-actions--guest');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
  });

  it('does not mount or load portfolio ownership for guests', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("if (currentUser?.role !== 'admin')");
    expect(source).toContain("account?.role === 'admin' && (LoadedTenantDirectoryPanel");
  });
});
