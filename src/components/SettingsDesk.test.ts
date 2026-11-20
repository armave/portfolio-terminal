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

describe('expandable user management and guest preview actions', () => {
  it('keeps user management collapsed by default and provides guest-only preview actions', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');

    expect(source).toContain('id="settingsUserManagement"');
    expect(source).toContain('open={userManagementOpen}');
    expect(source).toContain("onToggle={(event) => setUserManagementOpen");
    expect(source).toContain('if (currentUser?.role !== "admin" || !userManagementOpen)');
    expect(source).toContain("emitUiEvent('auth:admin-preview-start'");
    expect(source).toContain("user.role === 'guest'");
    expect(source).toContain("translateText('View as')");
    expect(source).toContain("translateText('Shared workspace')");
    expect(source).toContain("!account?.isImpersonating &&");
  });
});

describe('automatic update settings', () => {
  it('documents role-specific refresh cadence and immediate resume behavior', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');

    expect(source).toContain('DEFAULT_GUEST_REFRESH_INTERVAL_MS');
    expect(source).toContain('DEFAULT_ADMIN_REFRESH_INTERVAL_MS');
    expect(source).toContain('refreshNow: true');
    expect(source).toContain('Assigned-stock quotes follow the selected interval. Your assigned holdings and LOTS history refresh independently every 60 seconds. Returning to the app triggers a fresh role-scoped refresh.');
    expect(source).toContain('Market quotes and administrator workspace checkpoints follow the selected interval.');
    expect(source).toContain('Automatic refresh interval');
    expect(source).toContain('md:justify-start justify-center');
    expect(source).not.toContain('md:justify-left');
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

describe('TradeNet Settings surface', () => {
  it('does not expose raw OPQ payload or unverified trading-limit diagnostic probes', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('tradeNetOpqTitle');
    expect(source).not.toContain('Unmapped provider payload (diagnostic)');
    expect(source).not.toContain('fetchFreedomTradeNetOpq');
    expect(source).not.toContain('Trading limits schema probe');
    expect(source).not.toContain('fetchFreedomTradeNetTradingLimitsProbe');
  });
});

describe('PWA update status placement', () => {
  it('shows app update checks and waiting status in Settings diagnostics', () => {
    const settingsSource = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(settingsSource).toContain("import { PwaUpdateStatus } from './PwaUpdateStatus';");
    expect(settingsSource).toContain('<PwaUpdateStatus />');
    expect(settingsSource.indexOf('<PwaUpdateStatus />')).toBeLessThan(
      settingsSource.indexOf('<DeviceCheckSummary />')
    );
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
    expect(settingsSource).toContain("tenantDirectoryOpen && (LoadedTenantDirectoryPanel");
    expect(settingsSource).toContain("onToggle={(event) => setTenantDirectoryOpen");
    expect(settingsSource).toContain("useState<typeof import('./TenantDirectoryPanel') | null>(null)");
    expect(settingsSource).toContain('const LoadedTenantDirectoryPanel = tenantDirectoryModule?.TenantDirectoryPanel;');
    expect(settingsSource).toContain('<LoadedTenantDirectoryPanel currentUser={account} />');
    expect(componentSource).toContain("directory.financialDataEnabled === false");
    expect(componentSource).toContain('Directory only — financial storage is not enabled for newly created tenants.');
    expect(componentSource).toContain('Guests receive projection-only access.');
  });
});





describe('portfolio planning settings', () => {
  it('exposes app-side planning guardrails only through the admin capability and saves through a guarded runtime event', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');
    expect(source).toContain('permissions.canEditPortfolioSettings');
    expect(source).toContain('settings-portfolio-section');
    expect(source).toContain('Minimum post-sale account balance (USD)');
    expect(source).toContain('Buy More minimum equity (%)');
    expect(source).toContain('Buy More maintenance reserve (percentage points)');
    expect(source).toContain('Default funding for new broker positions');
    expect(source).toContain("emitUiEvent('settings:save-portfolio-settings'");
    expect(appSource).toContain("requireAdmin('change portfolio planning settings')");
    expect(appSource).toContain("requireAdmin('reset portfolio planning settings')");
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
    expect(source).toContain('brokerRulesDirty');
    expect(source).toContain('All broker assumptions saved.');
    expect(source).toContain('Rollover time (Asia/Yerevan)');
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
    expect(source).toContain("advancedMaintenanceOpen && <MarginDigestSecurityPanel currentUserId={account.id} />");
    expect(source).toContain("onToggle={(event) => setAdvancedMaintenanceOpen");
    expect(panel).toContain('fetchMarginDigestMigrationInventory');
    expect(panel).toContain('const MIGRATION_BATCH_SIZE = 25;');
    expect(panel).toContain('migrateMarginDigestBatch({ cursor, limit: MIGRATION_BATCH_SIZE })');
    expect(panel).toContain('inventory.plaintextRecords === 0');
    expect(panel).toContain("}, [currentUserId]);");
    expect(panel).toContain("setInventory(null);");
    expect(panel).toContain("setMigrationCursor(null);");
    expect(panel).toContain("if (!isCurrentSession()) return;");
    expect(panel).not.toContain("void refresh();");
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
    expect(source).toContain("tenantDirectoryOpen && (LoadedTenantDirectoryPanel");
  });
});


describe('Settings section navigation layout', () => {
  it('keeps each section label informative with a compact supporting description', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<nav class="settings-section-nav"');
    for (const label of [
      'Profile & language',
      'Live status & cadence',
      'Users & roles',
      'Planning defaults',
      'Financing & commissions',
      'Device & application health',
      'Calculations & guidance'
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('<small>{translateText(');
  });

  it('uses grouped desktop navigation and a compact native section picker on mobile', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    expect(source).toContain('settings-section-nav-groups');
    expect(source).toContain('settings-section-nav-mobile');
    expect(source).toContain('<optgroup label={translateText(\'Workspace\')}>');
    expect(source).toContain('<optgroup label={translateText(\'Portfolio\')}>');
    expect(source).toContain('<optgroup label={translateText(\'Management & help\')}>');
    expect(styles).toContain('#settingsDesk .settings-section-nav-group');
    expect(styles).toContain('#settingsDesk .settings-section-nav-mobile select');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).not.toContain('flex-wrap: nowrap;\\n    overflow-x: auto;\\n    overscroll-behavior-inline: contain;');
  });

  it('smooth-scrolls to selected sections while respecting reduced-motion preferences', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(source).toContain("behavior: prefersReducedMotion ? 'auto' : 'smooth'");
    expect(source).toContain("block: 'start'");
    expect(source).toContain("window.history.replaceState(window.history.state, '', nextHash);");
    expect(source).toContain('target.scrollIntoView({');
  });

  it('adds consistent inner padding and sticky-nav-aware anchor spacing to Settings sections', () => {
    const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/#settingsDesk \\.settings-section\\s*\\{[^}]*padding:\\s*clamp\\(/s);
    expect(styles).toMatch(/#settingsDesk \\.settings-section-nav-groups\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(3,\\s*minmax\\(0,\\s*1fr\\)\\)/s);
    expect(styles).toMatch(/@media\\s*\\(max-width:\\s*767px\\)[\\s\\S]*?#settingsDesk \\.settings-section\\s*\\{[^}]*padding:\\s*0\\.8rem;[^}]*scroll-margin-top:\\s*6\\.5rem;/s);
  });
});

describe('Settings information architecture', () => {
  it('provides role-aware section navigation and separates high-risk maintenance', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    for (const section of [
      'settings-account-section',
      'settings-data-section',
      'settings-recovery-section',
      'settings-access-section',
      'settings-portfolio-section',
      'settings-broker-section',
      'settings-maintenance-section',
      'settings-help-section'
    ]) {
      expect(source).toContain(section);
    }
    expect(source).toContain("translateText('Sync portfolio now')");
    expect(source).toContain("account?.role === 'guest' ? 'Last successful assigned-data refresh' : 'Last successful cloud sync'");
    expect(source).toContain("'Assigned data refresh confirmed'");
    expect(source).toContain("'Last successful assigned-data refresh'");
    expect(source).toContain("account?.role === 'guest' ? 'Assigned portfolio refresh status' : 'Cloud workspace status'");
  });
});


describe('cloud conflict recovery in Settings', () => {
  it('shows administrator recovery actions and blocks ordinary stale sync', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("const hasCloudConflict = account?.role === 'admin' && cloudSyncStatus.status === 'conflict';");
    expect(source).toContain('settingsCloudConflictRecovery');
    expect(source).toContain("emitUiEvent('settings:export-backup')");
    expect(source).toContain("emitUiEvent('settings:pull-cloud-state')");
    expect(source).toContain("disabled={syncingPortfolio || hasCloudConflict}");
    expect(source).toContain("translateText('Export portfolio backup as JSON')");
    expect(source).toContain("translateText('Replace local portfolio from cloud')");
    expect(source).toContain("The shared portfolio has a newer revision.");
    expect(source).toContain('No financial changes are merged automatically.');
  });
});


describe('Settings synchronization and recovery experience', () => {
  const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
  it('describes quote and supplemental refresh cadences separately for each role', () => {
    expect(source).toContain('Market quotes & workspace checkpoints');
    expect(source).toContain('Broker fallback & closed history');
    expect(source).toContain('Assigned holdings & LOTS history');
    expect(source).toContain('Fixed 60-second cadence');
    expect(source).toContain('Event-driven when healthy');
    expect(source).not.toContain('Quotes, portfolio cloud state, broker recovery data, trades, orders, cashflows and Closed History refresh on the selected interval.');
  });
  it('shows manual-sync source results without presenting them as live connection telemetry', () => {
    expect(source).toContain('getManualSyncSourceResults(manualSyncResult)');
    expect(source).toContain('Manual sync reports the result of that request only; it is not a live connection monitor.');
    expect(source).toContain('settings-manual-sync-results');
  });
  it('keeps cloud replacement in recovery and reset isolated in the collapsed danger zone', () => {
    expect(source).toContain('settings-recovery-section');
    expect(source).toContain('settings-danger-zone');
    expect(source).toContain('settings-cloud-recovery-panel');
    expect(source).toContain("emitUiEvent('settings:pull-cloud-state')");
    expect(source).toContain("emitUiEvent('settings:reset-to-blank-state')");
    expect(source).not.toContain("translateText('Pull cloud')");
    expect(source).toContain("translateText('Replace local portfolio from cloud')");
    expect(source).toContain('disabled={syncingPortfolio || hasCloudConflict}');
  });
  it('keeps Settings navigation active-state aware and section visibility role-scoped', () => {
    expect(source).toContain('new IntersectionObserver');
    expect(source).toContain('aria-current={activeSettingsSection');
    expect(source).toContain('permissions.canManageBackups && <a href="#settings-recovery-section"');
    expect(source).toContain('account?.role === \'admin\' && <a href="#settings-access-section"');
  });
  it('requires explicit confirmation before changing an existing account role and indicates unsaved rows', () => {
    expect(source).toContain("Changing a user's role immediately changes their access and may revoke their sessions. Continue?");
    expect(source).toContain('isUserEditDirty(user, editValues[user.id])');
    expect(source).toContain('settings-user-dirty');
  });
  it('groups portfolio and broker assumptions without changing persisted field identifiers', () => {
    expect(source).toContain('Portfolio risk guardrails');
    expect(source).toContain('New-position defaults');
    expect(source).toContain('Broker financing & rollover');
    expect(source).toContain('Margin risk thresholds');
    expect(source).toContain('Trading commissions');
    expect(source).toContain('id="maintenanceMarginInput"');
    expect(source).toContain('id="stopOutRatioInput"');
    expect(source).toContain('id="annualMarginRateInput"');
  });
});


describe('Settings semantic markup', () => {
  it('does not nest paragraph elements in Settings content', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/<p\b[^>]*>(?:(?!<\/p\s*>)[\s\S])*?<p\b/);
  });
});
