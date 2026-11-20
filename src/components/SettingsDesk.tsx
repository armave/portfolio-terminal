import { useState, useEffect, useRef } from 'preact/hooks';
import { emitUiEvent } from '../ui/uiEventBus';
import { getQuoteRefreshInterval } from '../services/storage';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  DEFAULT_GUEST_REFRESH_INTERVAL_MS
} from '../services/portfolioAutoRefresh';
import type { BrokerAssumptions } from '../types/portfolio';
import { normalizePortfolioSettings, type PortfolioSettings } from '../domain/portfolioSettings';
import { usePortfolio } from '../store/portfolioStore';
import { listUsers, createUser, updateUser, updateMyLanguage, deleteUser, type AuthUser } from '../services/api';
import { getAccountPermissions } from '../domain/accountPermissions';
import { getAppLanguage, translateText, type AppLanguage } from '../services/i18n';
import { useCloudSyncStatus } from '../ui/uiStateStore';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import { TableScrollRegion } from './TableScrollRegion';
import { DeskPageHeader } from './DeskPageHeader';
import { TablePagination } from './TablePagination';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { PortfolioMethodologyPanel } from './PortfolioMethodologyPanel';
import { getStopOutValidationMessage } from '../domain/brokerRulesValidation';
import { DeviceCheckSummary } from './DeviceCheckSummary';
import { PwaUpdateStatus } from './PwaUpdateStatus';
import { MarginDigestSecurityPanel } from './MarginDigestSecurityPanel';


const SETTINGS_SECTION_IDS = [
  'settings-account-section',
  'settings-data-section',
  'settings-recovery-section',
  'settings-access-section',
  'settings-portfolio-section',
  'settings-broker-section',
  'settings-maintenance-section',
  'settings-help-section'
] as const;

type PortfolioSettingsFormValues = {
  breakevenMinimumRemainingBalanceUsd: string;
  buyMoreMinimumEquityPercent: string;
  buyMoreMaintenanceReservePercent: string;
  accountEquityHealthReferencePercent: string;
  defaultMarginTargetUpsidePercent: string;
  defaultActiveTrancheType: 'cash' | 'margin';
};

function toPortfolioSettingsFormValues(value: unknown): PortfolioSettingsFormValues {
  const settings = normalizePortfolioSettings(value);
  return {
    breakevenMinimumRemainingBalanceUsd: String(settings.breakevenMinimumRemainingBalanceUsd),
    buyMoreMinimumEquityPercent: String(settings.buyMoreMinimumEquityRatio * 100),
    buyMoreMaintenanceReservePercent: String(settings.buyMoreMaintenanceReserveRatio * 100),
    accountEquityHealthReferencePercent: String(settings.accountEquityHealthReferenceRatio * 100),
    defaultMarginTargetUpsidePercent: String(settings.defaultMarginTargetUpsideRatio * 100),
    defaultActiveTrancheType: settings.defaultActiveTrancheType
  };
}

function toPortfolioSettings(value: PortfolioSettingsFormValues): PortfolioSettings {
  return normalizePortfolioSettings({
    breakevenMinimumRemainingBalanceUsd: Number(value.breakevenMinimumRemainingBalanceUsd),
    buyMoreMinimumEquityRatio: Number(value.buyMoreMinimumEquityPercent) / 100,
    buyMoreMaintenanceReserveRatio: Number(value.buyMoreMaintenanceReservePercent) / 100,
    accountEquityHealthReferenceRatio: Number(value.accountEquityHealthReferencePercent) / 100,
    defaultMarginTargetUpsideRatio: Number(value.defaultMarginTargetUpsidePercent) / 100,
    defaultActiveTrancheType: value.defaultActiveTrancheType
  });
}

export interface BrokerRulesFormValues {
  annualRate: string;
  dayCountBasis: string;
  maintenanceMargin: string;
  stopOutRatio: string;
  rolloverTime: string;
  commPerShare: string;
  commVolumePct: string;
  minCommOrder: string;
}

/** Converts persisted numeric rules into the strings controlled form inputs require. */
/** Reads the values the user actually submitted, falling back only when a control is absent. */
export function readBrokerRulesFormValues(
  form: HTMLFormElement,
  fallback: BrokerRulesFormValues
): BrokerRulesFormValues {
  const read = (id: string, defaultValue: string): string =>
    form.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? defaultValue;

  return {
    annualRate: read('annualMarginRateInput', fallback.annualRate),
    dayCountBasis: read('interestDayCountInput', fallback.dayCountBasis),
    maintenanceMargin: read('maintenanceMarginInput', fallback.maintenanceMargin),
    stopOutRatio: read('stopOutRatioInput', fallback.stopOutRatio),
    rolloverTime: read('rolloverTimeInput', fallback.rolloverTime),
    commPerShare: read('commissionPerShareInput', fallback.commPerShare),
    commVolumePct: read('commissionVolumeInput', fallback.commVolumePct),
    minCommOrder: read('minimumCommissionInput', fallback.minCommOrder)
  };
}

export function toBrokerRulesFormValues(rules: BrokerAssumptions): BrokerRulesFormValues {
  const hours = String(rules.rolloverHour ?? 4).padStart(2, '0');
  const minutes = String(rules.rolloverMinute ?? 0).padStart(2, '0');

  return {
    annualRate: (rules.annualBorrowRate * 100).toFixed(2),
    dayCountBasis: String(rules.dayCountBasis),
    maintenanceMargin: (rules.maintenanceEquityRatio * 100).toFixed(2),
    stopOutRatio: (rules.stopOutRatio * 100).toFixed(2),
    rolloverTime: `${hours}:${minutes}`,
    commPerShare: String(rules.commissionPerShare),
    commVolumePct: (rules.commissionRatePct * 100).toFixed(2),
    minCommOrder: rules.commissionMin.toFixed(2)
  };
}

interface SettingsDeskProps {
  currentUser: AuthUser | null;
}

function formatSettingsTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return translateText('Never confirmed');
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function getManualSyncSourceResults(result: ManualPortfolioSyncResult): Array<{ label: string; succeeded: boolean }> {
  if (result.role === 'admin') {
    return [
      { label: 'Broker account', succeeded: result.brokerAccount === true },
      { label: 'Executed trades', succeeded: result.executedTrades === true },
      { label: 'Active orders', succeeded: result.activeOrders === true },
      { label: 'Market quotes', succeeded: result.quotes },
      { label: 'Closed history', succeeded: result.cloudHistory === true },
      { label: 'Cloud portfolio', succeeded: result.cloud === true }
    ];
  }
  if (result.role === 'guest') {
    return [
      { label: 'Assigned portfolio', succeeded: result.guestSnapshot === true },
      { label: 'Market quotes', succeeded: result.quotes }
    ];
  }
  return [{ label: 'Portfolio sync', succeeded: result.success }];
}

function isUserEditDirty(
  user: AuthUser,
  values: { name: string; role: 'guest' | 'admin'; language: AppLanguage; password: string } | undefined
): boolean {
  return Boolean(values && (
    values.name !== user.name ||
    values.role !== user.role ||
    values.language !== (user.language ?? 'en') ||
    values.password.length > 0
  ));
}

export function SettingsDesk({ currentUser }: SettingsDeskProps) {
  const portfolio = usePortfolio();
  const rules = portfolio.brokerAssumptions;
  const [account, setAccount] = useState<AuthUser | null>(currentUser);
  const [tenantDirectoryModule, setTenantDirectoryModule] = useState<typeof import('./TenantDirectoryPanel') | null>(null);
  const [tenantDirectoryLoadFailed, setTenantDirectoryLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (currentUser?.role !== 'admin') {
      setTenantDirectoryModule(null);
      setTenantDirectoryLoadFailed(false);
      return () => { cancelled = true; };
    }
    void import('./TenantDirectoryPanel').then((module) => {
      if (!cancelled) setTenantDirectoryModule(() => module);
    }).catch(() => {
      if (!cancelled) setTenantDirectoryLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.role]);
  const LoadedTenantDirectoryPanel = tenantDirectoryModule?.TenantDirectoryPanel;
  const permissions = getAccountPermissions(account?.role);
  const cloudSyncStatus = useCloudSyncStatus();
  const hasCloudConflict = account?.role === 'admin' && cloudSyncStatus.status === 'conflict';
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersError, setUsersError] = useState("");
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [initialUsersLoading, setInitialUsersLoading] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const usersLoadGenerationRef = useRef(0);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"guest" | "admin">("guest");
  const [newLanguage, setNewLanguage] = useState<AppLanguage>("en");
  const [savingUser, setSavingUser] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [syncingPortfolio, setSyncingPortfolio] = useState(false);
  const [brokerRulesOpen, setBrokerRulesOpen] = useState(false);
  const [tenantDirectoryOpen, setTenantDirectoryOpen] = useState(false);
  const [advancedMaintenanceOpen, setAdvancedMaintenanceOpen] = useState(false);
  const [manualSyncResult, setManualSyncResult] = useState<ManualPortfolioSyncResult | null>(null);
  const [manualSyncCompletedAt, setManualSyncCompletedAt] = useState<number | null>(null);
  const [activeSettingsSection, setActiveSettingsSection] = useState<string>('settings-account-section');
  const portfolioSyncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { name: string; role: "guest" | "admin"; language: AppLanguage; password: string }>>({});
  const usersPagination = useTablePagination('settings-users', users.length, 10);
  const visibleUsers = sliceTablePage(users, usersPagination.currentPage, usersPagination.pageSize);

  const refreshUsers = async () => {
    // Only request the admin directory while its disclosure panel is open.
    // Ignore late responses after collapse or an account/role transition.
    const generation = ++usersLoadGenerationRef.current;
    if (currentUser?.role !== "admin" || !userManagementOpen) {
      setUsers([]);
      setEditValues({});
      setUsersError("");
      return;
    }
    try {
      const records = await listUsers();
      if (generation !== usersLoadGenerationRef.current) return;
      setUsers(records);
      setEditValues(Object.fromEntries(records.map((user) => [user.id, { name: user.name, role: user.role, language: user.language ?? "en", password: "" }])));
      setUsersError("");
    } catch (error) {
      if (generation !== usersLoadGenerationRef.current) return;
      setUsersError(error instanceof Error ? error.message : "Could not load users.");
    }
  };
  useEffect(() => {
    setAccount(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = SETTINGS_SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    const visibleSections = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleSections.add(entry.target);
        else visibleSections.delete(entry.target);
      }
      const current = [...visibleSections]
        .map((section) => ({
          id: (section as HTMLElement).id,
          top: section.getBoundingClientRect().top
        }))
        .sort((left, right) => left.top - right.top)[0];
      if (current) setActiveSettingsSection(current.id);
    }, {
      root: null,
      rootMargin: '-14% 0px -68% 0px',
      threshold: 0
    });
    sections.forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      visibleSections.clear();
    };
  }, [account?.role]);

  useEffect(() => {
    if (currentUser?.role !== 'admin') {
      usersLoadGenerationRef.current += 1;
      setInitialUsersLoading(false);
      setUsers([]);
      setEditValues({});
      setUsersError("");
      return;
    }
    if (!userManagementOpen) {
      usersLoadGenerationRef.current += 1;
      setInitialUsersLoading(false);
      return;
    }

    setInitialUsersLoading(true);
    const request = refreshUsers();
    const generation = usersLoadGenerationRef.current;
    void request.finally(() => {
      if (usersLoadGenerationRef.current === generation) setInitialUsersLoading(false);
    });
    return () => {
      if (usersLoadGenerationRef.current === generation) usersLoadGenerationRef.current += 1;
    };
  }, [currentUser?.id, currentUser?.role, userManagementOpen]);

  const handleCreateUser = async (event: Event) => {
    event.preventDefault();
    if (savingUser) return;
    setSavingUser(true);
    setUsersError("");
    try {
      await createUser({ name: newName.trim(), password: newPassword, role: newRole, language: newLanguage });
      setNewName("");
      setNewPassword("");
      setNewRole("guest");
      setNewLanguage("en");
      await refreshUsers();
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not create user.");
    } finally {
      setSavingUser(false);
    }
  };

  const handleUpdateUser = async (userId: string) => {
    const user = users.find((record) => record.id === userId);
    const values = editValues[userId];
    if (!user || !values || savingUser) return;
    if (
      values.role !== user.role &&
      !window.confirm(translateText("Changing a user's role immediately changes their access and may revoke their sessions. Continue?"))
    ) return;
    setSavingUser(true);
    setUsersError("");
    try {
      const updated = await updateUser(userId, {
        name: values.name.trim(),
        role: values.role,
        language: values.language,
        ...(values.password ? { password: values.password } : {})
      });
      if (updated.id === account?.id) {
        setAccount(updated);
        emitUiEvent('auth:user-changed', { user: updated });
      }
      await refreshUsers();
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not update user.");
    } finally {
      setSavingUser(false);
    }
  };

  const handleLanguageChange = async (event: Event) => {
    const language = (event.currentTarget as HTMLSelectElement).value as AppLanguage;
    if (!account || savingLanguage || language === account.language) return;
    setSavingLanguage(true);
    setLanguageError("");
    try {
      const updated = await updateMyLanguage(language);
      setAccount(updated);
      emitUiEvent('auth:user-changed', { user: updated });
    } catch (error) {
      setLanguageError(error instanceof Error ? error.message : "Could not update language.");
    } finally {
      setSavingLanguage(false);
    }
  };

  const handleViewAsUser = async (user: AuthUser) => {
    if (savingUser || viewingUserId || account?.role !== 'admin' || user.role !== 'guest') return;
    setViewingUserId(user.id);
    setUsersError("");
    try {
      const error = await new Promise<string | undefined>((resolve) => {
        emitUiEvent('auth:admin-preview-start', { userId: user.id, resolve });
      });
      if (error) setUsersError(error);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not open guest preview.");
    } finally {
      setViewingUserId(null);
    }
  };

  const handleDeleteUser = async (user: AuthUser) => {
    if (savingUser || !window.confirm(`${translateText('Delete account')} "${user.name}"?`)) return;
    setSavingUser(true);
    setUsersError("");
    try {
      await deleteUser(user.id);
      await refreshUsers();
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not delete user.");
    } finally {
      setSavingUser(false);
    }
  };

  const initialRefreshScope = currentUser?.role === 'guest' ? 'guest' : 'admin';
  const initialRefreshFallback = initialRefreshScope === 'guest'
    ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
    : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
  const [refreshInterval, setRefreshInterval] = useState<string>(() =>
    String(getQuoteRefreshInterval(initialRefreshFallback, initialRefreshScope))
  );

  // Load the current role's own preference. An unset guest preference defaults
  // to 15 seconds regardless of any interval previously saved by an admin.
  useEffect(() => {
    if (account?.role !== 'admin' && account?.role !== 'guest') return;
    const scope = account.role;
    const fallback = scope === 'guest' ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
    const interval = String(getQuoteRefreshInterval(fallback, scope));
    setRefreshInterval(interval);
    emitUiEvent('settings:change-refresh-interval', { intervalMs: interval });
  }, [account?.role]);

  const [ruleValues, setRuleValues] = useState<BrokerRulesFormValues>(() =>
    toBrokerRulesFormValues(rules)
  );
  const persistedRuleValues = toBrokerRulesFormValues(rules);
  const brokerRulesDirty = (Object.keys(persistedRuleValues) as Array<keyof BrokerRulesFormValues>)
    .some((field) => ruleValues[field] !== persistedRuleValues[field]);

  const persistedPortfolioSettings = normalizePortfolioSettings(portfolio.portfolioSettings);
  const [portfolioSettingValues, setPortfolioSettingValues] = useState<PortfolioSettingsFormValues>(() =>
    toPortfolioSettingsFormValues(persistedPortfolioSettings)
  );
  const persistedPortfolioSettingForm = toPortfolioSettingsFormValues(persistedPortfolioSettings);
  const portfolioSettingsDirty = (Object.keys(portfolioSettingValues) as Array<keyof PortfolioSettingsFormValues>)
    .some((field) => portfolioSettingValues[field] !== persistedPortfolioSettingForm[field]);
  useEffect(() => {
    setPortfolioSettingValues(toPortfolioSettingsFormValues(portfolio.portfolioSettings));
  }, [
    portfolio.portfolioSettings?.breakevenMinimumRemainingBalanceUsd,
    portfolio.portfolioSettings?.buyMoreMinimumEquityRatio,
    portfolio.portfolioSettings?.buyMoreMaintenanceReserveRatio,
    portfolio.portfolioSettings?.accountEquityHealthReferenceRatio,
    portfolio.portfolioSettings?.defaultMarginTargetUpsideRatio,
    portfolio.portfolioSettings?.defaultActiveTrancheType
  ]);

  const stopOutInputRef = useRef<HTMLInputElement | null>(null);

  const updateStopOutValidity = () => {
    const stopOutInput = stopOutInputRef.current;
    const maintenanceInput = stopOutInput?.form?.querySelector<HTMLInputElement>('#maintenanceMarginInput');
    if (!stopOutInput || !maintenanceInput) return;
    stopOutInput.setCustomValidity(
      getStopOutValidationMessage(stopOutInput.value, maintenanceInput.value) || ''
    );
  };

  // Sync local form values whenever rules prop updates (e.g. Restore defaults)
  useEffect(() => {
    setRuleValues(toBrokerRulesFormValues(rules));
    stopOutInputRef.current?.setCustomValidity('');
  }, [
    rules.annualBorrowRate,
    rules.dayCountBasis,
    rules.maintenanceEquityRatio,
    rules.stopOutRatio,
    rules.rolloverHour,
    rules.rolloverMinute,
    rules.commissionPerShare,
    rules.commissionRatePct,
    rules.commissionMin
  ]);

  const updateRuleValue = (field: keyof BrokerRulesFormValues, value: string) => {
    setRuleValues((current) => ({ ...current, [field]: value }));
  };

  const handleIntervalChange = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    setRefreshInterval(val);
    emitUiEvent('settings:change-refresh-interval', { intervalMs: val, refreshNow: true });
  };

  const handleManualPortfolioSync = async (): Promise<void> => {
    if (portfolioSyncPromise.current) {
      await portfolioSyncPromise.current;
      return;
    }

    setSyncingPortfolio(true);
    const request = new Promise<ManualPortfolioSyncResult>((resolve) => {
      emitUiEvent('portfolio:sync-request', { resolve });
    });
    portfolioSyncPromise.current = request;
    try {
      const result = await request;
      setManualSyncResult(result);
      setManualSyncCompletedAt(Date.now());
    } finally {
      if (portfolioSyncPromise.current === request) portfolioSyncPromise.current = null;
      setSyncingPortfolio(false);
    }
  };

  const navigateToSettingsSection = (sectionId: string) => {
    if (!SETTINGS_SECTION_IDS.includes(sectionId as (typeof SETTINGS_SECTION_IDS)[number])) return;
    const target = document.getElementById(sectionId);
    if (!target) return;

    setActiveSettingsSection(sectionId);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });

    const nextHash = `#${sectionId}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(window.history.state, '', nextHash);
    }
  };

  const handleSettingsSectionLinkClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.currentTarget as HTMLAnchorElement;
    const sectionId = link.hash.slice(1);
    if (!sectionId) return;
    event.preventDefault();
    navigateToSettingsSection(sectionId);
  };

  const renderSettingsSectionLink = (
    sectionId: (typeof SETTINGS_SECTION_IDS)[number],
    title: string,
    description: string
  ) => (
    <a
      href={`#${sectionId}`}
      class={activeSettingsSection === sectionId ? 'is-active' : undefined}
      aria-current={activeSettingsSection === sectionId ? 'location' : undefined}
      onClick={handleSettingsSectionLinkClick}
    >
      <span>{translateText(title)}</span>
      <small>{translateText(description)}</small>
    </a>
  );

  return (
    <div id="settingsDesk" class="settings-desk min-w-0">
      <DeskPageHeader
        title={translateText('Settings', getAppLanguage())}
        description={translateText('Manage account, data, and application preferences.', getAppLanguage())}
      />

      <nav class="settings-section-nav" aria-label={translateText('Settings sections')}>
        <div class={`settings-section-nav-groups ${account?.role === 'guest' ? 'settings-section-nav-groups--guest' : ''}`}>
          <div class="settings-section-nav-group" role="group" aria-label={translateText('Workspace')}>
            <h3>{translateText('Workspace')}</h3>
            <div class="settings-section-nav-links">
              {renderSettingsSectionLink('settings-account-section', 'Account', 'Profile & language')}
              {renderSettingsSectionLink('settings-data-section', 'Data & Sync', 'Live status & cadence')}
            </div>
          </div>
          {(permissions.canManageBackups || permissions.canEditPortfolioSettings || permissions.canEditBrokerRules) && <div class="settings-section-nav-group" role="group" aria-label={translateText('Portfolio')}>
            <h3>{translateText('Portfolio')}</h3>
            <div class="settings-section-nav-links">
              {permissions.canManageBackups && renderSettingsSectionLink('settings-recovery-section', 'Backup & recovery', 'Export, import & restore')}
              {permissions.canEditPortfolioSettings && renderSettingsSectionLink('settings-portfolio-section', 'Portfolio planning settings', 'Planning defaults')}
              {permissions.canEditBrokerRules && renderSettingsSectionLink('settings-broker-section', 'Broker & Trading', 'Financing & commissions')}
            </div>
          </div>}
          <div class="settings-section-nav-group" role="group" aria-label={translateText('Management & help')}>
            <h3>{translateText('Management & help')}</h3>
            <div class="settings-section-nav-links">
              {account?.role === 'admin' && renderSettingsSectionLink('settings-access-section', 'Access management', 'Users & roles')}
              {renderSettingsSectionLink('settings-maintenance-section', 'Diagnostics & Security', 'Device & application health')}
              {renderSettingsSectionLink('settings-help-section', 'Methodology & Help', 'Calculations & guidance')}
            </div>
          </div>
        </div>
        <label class="settings-section-nav-mobile">
          <span>{translateText('Jump to section')}</span>
          <select
            aria-label={translateText('Jump to Settings section')}
            value={activeSettingsSection}
            onChange={(event) => navigateToSettingsSection((event.currentTarget as HTMLSelectElement).value)}
          >
            <optgroup label={translateText('Workspace')}>
              <option value="settings-account-section">{translateText('Account')} — {translateText('Profile & language')}</option>
              <option value="settings-data-section">{translateText('Data & Sync')} — {translateText('Live status & cadence')}</option>
            </optgroup>
            {(permissions.canManageBackups || permissions.canEditPortfolioSettings || permissions.canEditBrokerRules) && <optgroup label={translateText('Portfolio')}>
              {permissions.canManageBackups && <option value="settings-recovery-section">{translateText('Backup & recovery')} — {translateText('Export, import & restore')}</option>}
              {permissions.canEditPortfolioSettings && <option value="settings-portfolio-section">{translateText('Portfolio planning settings')} — {translateText('Planning defaults')}</option>}
              {permissions.canEditBrokerRules && <option value="settings-broker-section">{translateText('Broker & Trading')} — {translateText('Financing & commissions')}</option>}
            </optgroup>}
            <optgroup label={translateText('Management & help')}>
              {account?.role === 'admin' && <option value="settings-access-section">{translateText('Access management')} — {translateText('Users & roles')}</option>}
              <option value="settings-maintenance-section">{translateText('Diagnostics & Security')} — {translateText('Device & application health')}</option>
              <option value="settings-help-section">{translateText('Methodology & Help')} — {translateText('Calculations & guidance')}</option>
            </optgroup>
          </select>
        </label>
      </nav>

      <section id="settings-account-section" class="settings-section" aria-labelledby="settingsAccountTitle">
        <div class="settings-section-heading">
          <h2 id="settingsAccountTitle">{translateText('Account & Preferences')}</h2>
          <p>{translateText('Manage your sign-in identity and language preference.')}</p>
        </div>
        <div class="settings-toolbar settings-toolbar--organized w-full py-1">
          <div class="settings-toolbar__card settings-account-card flex flex-col gap-3" role="group" aria-label={translateText('Account actions')}>
            <div class="settings-account-summary flex flex-wrap items-center justify-between gap-3">
              <div class="settings-account-identity flex min-w-0 flex-wrap items-center gap-2">
                <span class="text-sm font-bold text-slate-200">{account?.name || translateText('Account information unavailable')}</span>
                {account && <span class="rounded bg-slate-800 px-2 py-1 uppercase text-[10px] font-bold text-cyan-300">{account.role}</span>}
              </div>
              {account && <label class="settings-account-language flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                {translateText('Language')}
                <select aria-label={translateText('Account language')} value={account.language ?? "en"} disabled={savingLanguage} onChange={(event) => void handleLanguageChange(event)} class="h-8 rounded border border-slate-700 bg-slate-900 text-center px-2 text-xs text-slate-300">
                  <option value="en">English</option>
                  <option value="ru">Russian</option>
                </select>
              </label>}
            </div>
            {languageError && <span role="alert" class="text-[10px] text-rose-300">{languageError}</span>}
            {!account?.isImpersonating && <div class={'settings-account-actions grid grid-cols-1 gap-2 ' + (account?.role === 'guest' ? 'settings-account-actions--guest' : '')}>
              <button type="button" onClick={() => emitUiEvent("auth:logout")} class="h-9 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">{translateText('Sign out')}</button>
            </div>}
          </div>
        </div>
      </section>

      <section id="settings-data-section" class="settings-section" aria-labelledby="settingsDataTitle">
        <div class="settings-section-heading">
          <h2 id="settingsDataTitle">{translateText('Data & synchronization')}</h2>
          <p>{translateText('Manage automatic refresh preferences and review the last confirmed workspace synchronization.')}</p>
        </div>
        <div class="settings-data-grid">
          <div class="settings-toolbar__card settings-refresh-card flex flex-col gap-3">
            <div class="settings-refresh-heading flex flex-wrap items-center justify-between gap-2">
              <label class="settings-refresh-interval flex min-w-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 md:justify-start justify-center">
                {translateText('Automatic refresh interval')}
                <select
                  id="quoteRefreshInterval"
                  value={refreshInterval}
                  onChange={handleIntervalChange}
                  aria-label={translateText('Automatic portfolio refresh interval')}
                  title={translateText(account?.role === 'guest'
                    ? 'Assigned-stock quotes follow the selected interval. Your assigned holdings and LOTS history refresh independently every 60 seconds. Returning to the app triggers a fresh role-scoped refresh.'
                    : 'Market quotes and administrator workspace checkpoints follow the selected interval. Broker REST fallback, executed-trade and active-order catch-up, Closed History and cashflows use separate refresh paths; healthy TradeNet streams update from events. Returning to the app triggers a fresh role-scoped refresh.')}
                  class="h-9 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500"
                >
                  <option value="15000">{translateText('15 sec')}</option>
                  <option value="30000">{translateText('30 sec')}</option>
                  <option value="60000">{translateText('1 min')}</option>
                </select>
              </label>
            </div>
            <p class="settings-refresh-description text-left text-[11px] leading-relaxed text-slate-400">
              {translateText(account?.role === 'guest'
                ? 'Assigned-stock quotes follow the selected interval. Your assigned holdings and LOTS history refresh independently every 60 seconds. Returning to the app triggers a fresh role-scoped refresh.'
                : 'Market quotes and administrator workspace checkpoints follow the selected interval. Broker REST fallback, executed-trade and active-order catch-up, Closed History and cashflows use separate refresh paths; healthy TradeNet streams update from events. Returning to the app triggers a fresh role-scoped refresh.')}
            </p>
            <div class="settings-cadence-grid" aria-label={translateText('Synchronization cadence')}>
              {account?.role === 'guest' ? <>
                <div><span>{translateText('Assigned-stock quotes')}</span><strong>{translateText('Selected interval')}</strong></div>
                <div><span>{translateText('Assigned holdings & LOTS history')}</span><strong>{translateText('Fixed 60-second cadence')}</strong></div>
                <div><span>{translateText('Manual refresh')}</span><strong>{translateText('Available on demand')}</strong></div>
              </> : <>
                <div><span>{translateText('Market quotes & workspace checkpoints')}</span><strong>{translateText('Selected interval')}</strong></div>
                <div><span>{translateText('Broker fallback & closed history')}</span><strong>{translateText('Independent 60-second cadence')}</strong></div>
                <div><span>{translateText('TradeNet account streams')}</span><strong>{translateText('Event-driven when healthy')}</strong></div>
              </>}
            </div>
            <div class="settings-sync-status flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2" role="status" aria-live="polite">
              <span class="text-[11px] font-semibold text-slate-300">{translateText(account?.role === 'guest' ? 'Assigned portfolio refresh status' : 'Cloud workspace status')}</span>
              <span class={hasCloudConflict ? 'text-[11px] font-semibold text-amber-200' : cloudSyncStatus.status === 'synced' ? 'text-[11px] font-semibold text-emerald-300' : cloudSyncStatus.status === 'error' ? 'text-[11px] font-semibold text-rose-300' : 'text-[11px] font-semibold text-amber-200'}>
                {translateText(account?.role === 'guest'
                  ? cloudSyncStatus.status === 'synced' ? 'Assigned data refresh confirmed' : cloudSyncStatus.status === 'syncing' ? 'Assigned data refresh in progress' : cloudSyncStatus.status === 'error' ? 'Assigned data refresh failed' : 'Assigned data refresh status not checked'
                  : hasCloudConflict ? 'Cloud sync needs recovery' : cloudSyncStatus.status === 'synced' ? 'Cloud sync confirmed' : cloudSyncStatus.status === 'syncing' ? 'Cloud sync in progress' : cloudSyncStatus.status === 'error' ? 'Cloud sync failed' : 'Cloud sync status not checked')}
              </span>
              <span class="w-full text-[10px] text-slate-500">
                {translateText(account?.role === 'guest' ? 'Last successful assigned-data refresh' : 'Last successful cloud sync')}: {formatSettingsTimestamp(cloudSyncStatus.lastSyncedAt)}
              </span>
            </div>

            <div class="settings-data-actions flex flex-wrap items-center gap-2">
              {(account?.role === "admin" || account?.role === "guest") && <button
                type="button"
                onClick={() => void handleManualPortfolioSync()}
                disabled={syncingPortfolio || hasCloudConflict}
                aria-busy={syncingPortfolio}
                aria-label={translateText('Sync portfolio')}
                title={translateText(hasCloudConflict ? 'Resolve the cloud conflict before syncing' : 'Sync portfolio')}
                class="settings-sync-button h-10 rounded border border-cyan-700 bg-cyan-950/40 px-3 text-xs font-bold text-cyan-200 hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              >{syncingPortfolio ? translateText('Syncing…') : translateText('Sync portfolio now')}</button>}

            </div>
            {manualSyncResult && <section class="settings-manual-sync-results" role="status" aria-live="polite" aria-label={translateText('Last manual sync')}>
              <div class="settings-manual-sync-heading">
                <div>
                  <h3>{translateText('Last manual sync')}</h3>
                  <p>{translateText(manualSyncResult.success ? 'Completed' : 'Completed with issues')} · {formatSettingsTimestamp(manualSyncCompletedAt)}</p>
                </div>
                <span class={manualSyncResult.success ? 'is-success' : 'is-warning'}>{translateText(manualSyncResult.success ? 'Succeeded' : 'Completed with issues')}</span>
              </div>
              <ul>
                {getManualSyncSourceResults(manualSyncResult).map((source) => <li key={source.label}>
                  <span>{translateText(source.label)}</span>
                  <strong class={source.succeeded ? 'is-success' : 'is-warning'}>{translateText(source.succeeded ? 'Succeeded' : 'Unavailable')}</strong>
                </li>)}
              </ul>
              <p class="settings-manual-sync-footnote">{translateText('Manual sync reports the result of that request only; it is not a live connection monitor.')}</p>
            </section>}


          </div>
        </div>
      </section>

      {permissions.canManageBackups && <section id="settings-recovery-section" class="settings-section" aria-labelledby="settingsRecoveryTitle">
        <div class="settings-section-heading">
          <h2 id="settingsRecoveryTitle">{translateText('Backup & recovery')}</h2>
          <p>{translateText('Export a JSON snapshot or validate and import a previous backup. Recovery actions that replace local data are clearly separated from routine synchronization.')}</p>
        </div>
                    {hasCloudConflict && <section
              id="settingsCloudConflictRecovery"
              aria-labelledby="settingsCloudConflictTitle"
              role="alert"
              class="settings-cloud-conflict flex flex-col gap-3 rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-3"
            >
              <div class="flex items-start gap-2">
                <span aria-hidden="true" class="mt-0.5 shrink-0 text-amber-300">⚠</span>
                <div class="min-w-0">
                  <h3 id="settingsCloudConflictTitle" class="text-xs font-bold text-amber-200">{translateText('Cloud data changed elsewhere')}</h3>
                  <p class="mt-1 text-[11px] leading-relaxed text-slate-200">
                    {translateText('The shared portfolio has a newer revision. Local changes on this device have not been confirmed as saved to the cloud.')}
                  </p>
                  <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {translateText("Export a JSON backup before pulling. Pulling replaces this device's local portfolio; reconcile any needed changes from the backup afterward. No financial changes are merged automatically.")}
                  </p>
                </div>
              </div>
              <p class="text-[11px] text-amber-100">{translateText("Pull cloud replaces this device's local portfolio with the shared KV cloud snapshot. Changes that have not synced can be lost.")}</p>
              <p class="text-[11px] text-amber-100">{translateText('Export a JSON backup before pulling cloud state or resetting the portfolio.')}</p>

            </section>}
        <div class="settings-panel settings-cloud-recovery-panel space-y-3">
          <div class="settings-subsection-heading">
            <h3>{translateText('Cloud recovery')}</h3>
            <p>{translateText("Replace this device's local portfolio with the latest shared cloud snapshot. Unsynced local changes can be lost; export a JSON backup first. The app will ask for confirmation before replacing data.")}</p>
          </div>
          <button
            type="button"
            onClick={() => emitUiEvent('settings:pull-cloud-state')}
            aria-label={translateText('Replace local portfolio from cloud')}
            class="min-h-11 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/60"
          >{translateText('Replace local portfolio from cloud')}</button>
        </div>
        <div class="settings-panel settings-recovery-panel space-y-3">
          <div class="settings-subsection-heading">
            <h3>{translateText('Backup & import')}</h3>
            <p>{translateText('Export a portable snapshot, or import a validated backup after reviewing its preview and confirming the replacement.')}</p>
          </div>
                      {permissions.canManageBackups && <div class="settings-backup-actions grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => emitUiEvent('settings:export-backup')}
                aria-label={translateText('Export portfolio backup as JSON')}
                title={translateText('Export portfolio state to JSON file')}
                class="h-10 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
              >{translateText('Export')}</button>
              <button
                type="button"
                onClick={() => emitUiEvent('settings:backup-import-request')}
                title={translateText('Validate and confirm a portfolio backup import; cloud sync depends on KV configuration')}
                aria-label={translateText('Import portfolio backup from JSON')}
                class="h-10 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
              >{translateText('Import')}</button>

            </div>}
                      {permissions.canManageBackups && <div class="settings-data-safety-note flex w-full items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-3 text-[10px] leading-relaxed text-amber-100/90" role="note" aria-label={translateText('Portfolio data safety warning')}>
              <span aria-hidden="true" class="shrink-0 text-sm text-amber-300">⚠</span>
              <p class="min-w-0 font-semibold text-left text-amber-200">{translateText("Export a JSON backup before pulling cloud state or resetting the portfolio.")}</p>
            </div>}
        </div>
        <details class="settings-danger-zone">
          <summary>{translateText('Danger zone')}</summary>
          <div class="settings-danger-zone-content">
            <div>
              <h3>{translateText('Reset portfolio data')}</h3>
              <p>{translateText('Reset removes saved portfolio and history data locally and in cloud storage. Broker-held TradeNet records are not deleted and may reappear after refresh.')}</p>
            </div>
                          <button
                type="button"
                onClick={() => emitUiEvent('settings:reset-to-blank-state')}
                title={translateText("Reset deletes saved portfolio and history data from this device and KV cloud. TradeNet records held by the broker are not deleted.")}
                aria-label={translateText('Reset local and cloud portfolio data')}
                class="h-10 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
              >{translateText('Reset')}</button>
          </div>
        </details>
      </section>}

{account?.role === "admin" && <section id="settings-access-section" class="settings-section" aria-labelledby="settingsAccessTitle">
        <div class="settings-section-heading">
          <h2 id="settingsAccessTitle">{translateText('Access management')}</h2>
          <p>{translateText('Manage administrator and guest accounts, roles, and portfolio access.')}</p>
        </div>
              <details
        id="settingsUserManagement"
        class="group settings-panel settings-user-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
        aria-labelledby="userManagementTitle"
        open={userManagementOpen}
        onToggle={(event) => setUserManagementOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary class="settings-user-heading flex cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500">
          <span class="min-w-0">
            <span id="userManagementTitle" class="block text-sm font-bold text-slate-200">{translateText('User management')}</span>
            <span class="mt-1 block max-w-prose text-[10px] leading-relaxed text-slate-500">{translateText('Admins share the owner workspace. Guests see only assigned read-only projections; they do not have independent portfolios.')}</span>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            {account?.role === "admin" && <span class="rounded border border-emerald-900/50 bg-emerald-950/30 px-2 py-1 text-[10px] uppercase tracking-wider text-emerald-400">{translateText('Admin controls')}</span>}
            <span aria-hidden="true" class="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
          </span>
        </summary>
        <div class="space-y-3 pt-2">
        <div class="settings-subsection-heading">
          <h3>{translateText('Create account')}</h3>
          <p>{translateText('Administrators share one owner workspace. Guests receive read-only projections for holdings explicitly assigned to them.')}</p>
        </div>
        {account?.role === "admin" ? <>
          <form onSubmit={handleCreateUser} class="settings-user-form grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_110px_120px_auto]">
            <input type="text" aria-label={translateText('User name')} minLength={2} maxLength={60} required value={newName} onInput={(event) => setNewName((event.target as HTMLInputElement).value)} placeholder={translateText('User name')} class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <input type="password" aria-label={translateText('Password (6+ characters)')} minLength={6} maxLength={128} required value={newPassword} onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)} placeholder={translateText('Password (6+ characters)')} autoComplete="new-password" class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <select value={newRole} onChange={(event) => setNewRole((event.target as HTMLSelectElement).value as "guest" | "admin")} aria-label={translateText('New user role')} class="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-white"><option class="text-center" value="guest">{translateText('Guest')}</option><option class="text-center" value="admin">{translateText('Admin')}</option></select>
            <select value={newLanguage} onChange={(event) => setNewLanguage((event.target as HTMLSelectElement).value as AppLanguage)} aria-label={translateText('New user language')} class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-2 text-xs text-white"><option class="text-center" value="en">{translateText('English')}</option><option class="text-center" value="ru">{translateText('Russian')}</option></select>
            <button type="submit" disabled={savingUser} class="min-h-11 min-w-11 rounded bg-cyan-800 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-700 disabled:opacity-50">{translateText('Add user')}</button>
          </form>
          <div class="settings-subsection-heading settings-existing-users-heading">
            <h3>{translateText('Existing accounts')}</h3>
            <p>{translateText('Review access, language, and account changes. Save is enabled only when a row has pending edits.')}</p>
          </div>
          <div id="settingsUsersCollection" class="min-w-0">
            <div class="settings-user-cards grid grid-cols-1 gap-3 md:hidden" aria-label={translateText('User management table')}>
              {initialUsersLoading && <p class="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-center text-xs text-slate-500" role="status">{translateText('Loading users…')}</p>}
              {visibleUsers.map((user) => <article key={user.id} class="settings-user-card rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                <div class="settings-user-card-heading">
                  <span class="min-w-0 break-words font-semibold text-slate-100">{editValues[user.id]?.name || user.name}</span>
                  {isUserEditDirty(user, editValues[user.id]) && <span class="settings-user-dirty">{translateText('Unsaved changes')}</span>}
                  <span class="shrink-0 rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {translateText((editValues[user.id]?.role ?? user.role) === 'admin' ? 'Admin' : 'Guest')}
                  </span>
                </div>
                <div class="settings-user-card-fields grid grid-cols-1 gap-2">
                  <label>
                    <span>{translateText('Name')}</span>
                    <input aria-label={translateText('Name for ') + user.name} value={editValues[user.id]?.name ?? user.name} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], name: (event.target as HTMLInputElement).value } }))} />
                  </label>
                  <label>
                    <span>{translateText('Role')}</span>
                    <select aria-label={translateText('Role for ') + user.name} value={editValues[user.id]?.role ?? user.role} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], role: (event.target as HTMLSelectElement).value as "guest" | "admin" } }))}>
                      <option value="guest">{translateText('Guest')}</option>
                      <option value="admin">{translateText('Admin')}</option>
                    </select>
                  </label>
                  <label>
                    <span>{translateText('Language')}</span>
                    <select aria-label={translateText('Language for ') + user.name} value={editValues[user.id]?.language ?? user.language ?? "en"} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], language: (event.target as HTMLSelectElement).value as AppLanguage } }))}>
                      <option value="en">{translateText('English')}</option>
                      <option value="ru">{translateText('Russian')}</option>
                    </select>
                  </label>
                  <label>
                    <span>{translateText('New password')}</span>
                    <input aria-label={translateText('New password for ') + user.name} type="password" minLength={6} maxLength={128} autoComplete="new-password" placeholder={translateText('Leave blank to keep')} value={editValues[user.id]?.password ?? ""} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], password: (event.target as HTMLInputElement).value } }))} />
                  </label>
                </div>
                <div class="settings-user-card-actions">
                  {user.role === 'guest'
                    ? <button
                        type="button"
                        aria-label={translateText('View as') + ' ' + user.name}
                        disabled={savingUser || viewingUserId !== null}
                        onClick={() => void handleViewAsUser(user)}
                        class="min-h-11 rounded border border-cyan-900/70 bg-cyan-950/60 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50"
                      >{viewingUserId === user.id ? translateText('Opening…') : translateText('View as')}</button>
                    : <span class="self-center text-[10px] text-slate-500" title={translateText('Admin accounts share the same owner workspace.')}>{translateText('Shared workspace')}</span>}
                  <button type="button" disabled={savingUser || viewingUserId !== null || !isUserEditDirty(user, editValues[user.id])} onClick={() => void handleUpdateUser(user.id)} class="min-h-11 rounded bg-slate-800 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-50">{translateText('Save')}</button>
                  {user.id !== account.id && <button type="button" disabled={savingUser || viewingUserId !== null} onClick={() => void handleDeleteUser(user)} class="min-h-11 rounded bg-rose-950 px-3 py-2 text-xs font-semibold text-rose-300 disabled:opacity-50">{translateText('Delete')}</button>}
                </div>
              </article>)}
            </div>
            <div class="hidden min-w-0 md:block">
              <TableScrollRegion label={translateText('User management table')} className="table-scroll-wrapper settings-table-scroll"><table class="w-full min-w-[790px] text-left text-xs">
                <caption class="sr-only">{translateText('User management table')}</caption>
                <thead class="text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" class="p-2">{translateText('Name')}</th><th scope="col" class="p-2">{translateText('Role')}</th><th scope="col" class="p-2">{translateText('Language')}</th><th scope="col" class="p-2">{translateText('New password')}</th><th scope="col" class="p-2">{translateText('Actions')}</th></tr></thead>
                <tbody id="settingsUsersTableBody">
                  {initialUsersLoading && <tr><td colSpan={5} class="p-3 text-center text-xs text-slate-500" role="status">{translateText('Loading users…')}</td></tr>}
                  {visibleUsers.map((user) => <tr key={user.id} class="border-t border-slate-800">
                    <td class="p-2">
                      <input aria-label={translateText('Name for ') + user.name} value={editValues[user.id]?.name ?? user.name} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], name: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" />
                      {isUserEditDirty(user, editValues[user.id]) && <small class="settings-user-dirty">{translateText('Unsaved changes')}</small>}
                    </td>
                    <td class="p-2"><select aria-label={translateText('Role for ') + user.name} value={editValues[user.id]?.role ?? user.role} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], role: (event.target as HTMLSelectElement).value as "guest" | "admin" } }))} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-center text-white"><option class="text-center" value="guest">{translateText('Guest')}</option><option class="text-center" value="admin">{translateText('Admin')}</option></select></td>
                    <td class="p-2"><select aria-label={translateText('Language for ') + user.name} value={editValues[user.id]?.language ?? user.language ?? "en"} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], language: (event.target as HTMLSelectElement).value as AppLanguage } }))} class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-1.5 text-white"><option class="text-center" value="en">{translateText('English')}</option><option class="text-center" value="ru">{translateText('Russian')}</option></select></td>
                    <td class="p-2"><input aria-label={translateText('New password for ') + user.name} type="password" minLength={6} maxLength={128} autoComplete="new-password" placeholder={translateText('Leave blank to keep')} value={editValues[user.id]?.password ?? ""} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], password: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" /></td>
                    <td class="whitespace-nowrap p-2">
                      {user.role === 'guest'
                        ? <button type="button" aria-label={translateText('View as') + ' ' + user.name} disabled={savingUser || viewingUserId !== null} onClick={() => void handleViewAsUser(user)} class="mr-2 min-h-11 rounded border border-cyan-900/70 bg-cyan-950/60 px-2 py-1.5 text-cyan-200 disabled:opacity-50">{viewingUserId === user.id ? translateText('Opening…') : translateText('View as')}</button>
                        : <span class="mr-2 text-[10px] text-slate-500" title={translateText('Admin accounts share the same owner workspace.')}>{translateText('Shared workspace')}</span>}
                      <button type="button" disabled={savingUser || viewingUserId !== null || !isUserEditDirty(user, editValues[user.id])} onClick={() => void handleUpdateUser(user.id)} class="mr-2 min-h-11 min-w-11 rounded bg-slate-800 px-2 py-1.5 text-cyan-300 disabled:opacity-50">{translateText('Save')}</button>
                      {user.id !== account.id && <button type="button" disabled={savingUser || viewingUserId !== null} onClick={() => void handleDeleteUser(user)} class="min-h-11 min-w-11 rounded bg-rose-950 px-2 py-1.5 text-rose-300 disabled:opacity-50">{translateText('Delete')}</button>}
                    </td>
                  </tr>)}</tbody>
              </table></TableScrollRegion>
            </div>
          </div>
          <TablePagination
            tableLabel={translateText('User management table')}
            page={usersPagination.currentPage}
            pageCount={usersPagination.pageCount}
            pageSize={usersPagination.pageSize}
            start={usersPagination.start}
            end={usersPagination.end}
            total={users.length}
            onPageChange={usersPagination.setPage}
            onPageSizeChange={usersPagination.setPageSize}
            controlsId="settingsUsersCollection"
            className="settings-user-pagination"
          />
        </> : <p class="text-xs text-slate-400">{translateText('Only administrators can view or manage the user list.')}</p>}
        {usersError && <p class="text-xs text-rose-300" role="alert">{usersError}</p>}
      </div>
      </details>
              {account?.role === 'admin' && <details
        class="settings-subsection"
        open={tenantDirectoryOpen}
        onToggle={(event) => setTenantDirectoryOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{translateText('Portfolio ownership')}</summary>
        {tenantDirectoryOpen && (LoadedTenantDirectoryPanel ? (
          <LoadedTenantDirectoryPanel currentUser={account} />
        ) : (
          <div class="settings-panel text-xs text-slate-500" role="status">
            {tenantDirectoryLoadFailed
              ? translateText('Portfolio ownership could not be loaded.')
              : translateText('Loading portfolio ownership…')}
          </div>
        ))}
      </details>}
      </section>}

      {permissions.canEditPortfolioSettings && <section id="settings-portfolio-section" class="settings-section" aria-labelledby="settingsPortfolioTitle">
        <div class="settings-section-heading">
          <h2 id="settingsPortfolioTitle">{translateText('Portfolio planning settings')}</h2>
          <p>{translateText('Configure app-side planning guardrails and defaults for newly observed broker positions.')}</p>
        </div>
        <div class="settings-panel space-y-3">
          <div class="space-y-1">
            <p class="text-xs leading-relaxed text-slate-400">{translateText('These are application planning settings, not broker-reported limits or liquidation guarantees. Broker rules remain separate below.')}</p>
            <p class="settings-form-helper">{translateText('Planning defaults do not modify existing lots, cost basis, journal entries, or broker records.')}</p>
          </div>
          <form id="portfolioSettingsForm" class="settings-rules-form space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            if (!form.reportValidity()) return;
            emitUiEvent('settings:save-portfolio-settings', { settings: toPortfolioSettings(portfolioSettingValues) });
          }}>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="settings-field-group-heading">{translateText('Portfolio risk guardrails')}</div>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('Minimum post-sale account balance (USD)')}
                <input type="number" step="1" min="-1000000" max="1000000" required value={portfolioSettingValues.breakevenMinimumRemainingBalanceUsd}
                  onInput={(event) => setPortfolioSettingValues(current => ({ ...current, breakevenMinimumRemainingBalanceUsd: (event.currentTarget as HTMLInputElement).value }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100" />
                <span class="text-[11px] leading-relaxed text-slate-500">{translateText('The horizon uses your PT, net sale proceeds after sell commission, and daily margin interest—not net-P&L breakeven.')}</span>
              </label>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('Buy More minimum equity (%)')}
                <input type="number" step="0.5" min="0" max="100" required value={portfolioSettingValues.buyMoreMinimumEquityPercent}
                  onInput={(event) => setPortfolioSettingValues(current => ({ ...current, buyMoreMinimumEquityPercent: (event.currentTarget as HTMLInputElement).value }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100" />
              </label>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('Buy More maintenance reserve (percentage points)')}
                <input type="number" step="0.5" min="0" max="100" required value={portfolioSettingValues.buyMoreMaintenanceReservePercent}
                  onInput={(event) => setPortfolioSettingValues(current => ({ ...current, buyMoreMaintenanceReservePercent: (event.currentTarget as HTMLInputElement).value }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100" />
              </label>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('Account equity health reference (%)')}
                <input type="number" step="0.5" min="1" max="100" required value={portfolioSettingValues.accountEquityHealthReferencePercent}
                  onInput={(event) => setPortfolioSettingValues(current => ({ ...current, accountEquityHealthReferencePercent: (event.currentTarget as HTMLInputElement).value }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100" />
              </label>
              <div class="settings-field-group-heading">{translateText('New-position defaults')}</div>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('New margin-position target uplift (%)')}
                <input type="number" step="0.5" min="0" max="200" required value={portfolioSettingValues.defaultMarginTargetUpsidePercent}
                  onInput={(event) => setPortfolioSettingValues(current => ({ ...current, defaultMarginTargetUpsidePercent: (event.currentTarget as HTMLInputElement).value }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100" />
              </label>
              <label class="flex flex-col gap-1 text-xs text-slate-300">
                {translateText('Default funding for new broker positions')}
                <select value={portfolioSettingValues.defaultActiveTrancheType}
                  onChange={(event) => setPortfolioSettingValues(current => ({ ...current, defaultActiveTrancheType: (event.currentTarget as HTMLSelectElement).value as 'cash' | 'margin' }))}
                  class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100">
                  <option value="margin">{translateText('Margin')}</option>
                  <option value="cash">{translateText('Cash')}</option>
                </select>
              </label>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
              <span class={portfolioSettingsDirty ? 'text-xs font-semibold text-amber-200' : 'text-xs font-semibold text-emerald-300'} role="status">
                {translateText(portfolioSettingsDirty ? 'Unsaved changes' : 'All portfolio settings saved.')}
              </span>
              <div class="flex flex-wrap gap-2">
                <button type="button" disabled={!portfolioSettingsDirty} onClick={() => emitUiEvent('settings:reset-portfolio-settings')} class="h-9 rounded border border-slate-700 px-3 text-xs text-slate-300 disabled:opacity-40">
                  {translateText('Restore portfolio defaults')}
                </button>
                <button type="submit" disabled={!portfolioSettingsDirty} class="h-9 rounded bg-cyan-700 px-3 text-xs font-semibold text-white disabled:opacity-40">
                  {translateText('Save portfolio settings')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>}

      {permissions.canEditBrokerRules && <section id="settings-broker-section" class="settings-section" aria-labelledby="settingsBrokerSectionTitle">
        <div class="settings-section-heading">
          <h2 id="settingsBrokerSectionTitle">{translateText('Broker & Trading Model')}</h2>
          <p>{translateText('These assumptions affect modeled financing, margin thresholds, and commissions. Confirm values with your broker.')}</p>
        </div>
              <details
        class="settings-panel settings-broker-rules space-y-3"
        open={brokerRulesOpen}
        onToggle={(event) => setBrokerRulesOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary class="cursor-pointer justify-center text-xs font-bold text-slate-300 hover:text-cyan-300">
          Broker Rules
        </summary>
        <div class="mt-3">
          <form id="brokerRulesForm" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            updateStopOutValidity();
            if (!form.reportValidity()) return;
            const values = readBrokerRulesFormValues(form, ruleValues);
            emitUiEvent('settings:save-broker-rules', { values });
          }} class="settings-rules-form space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2" role="status" aria-live="polite">
              <span class={brokerRulesDirty ? 'text-[11px] font-semibold text-amber-200' : 'text-[11px] font-semibold text-emerald-300'}>
                {translateText(brokerRulesDirty ? 'Unsaved changes' : 'All broker assumptions saved.')}
              </span>
              <span class="text-[10px] text-slate-500">
                {translateText(brokerRulesDirty ? 'Save to apply these assumptions.' : 'Broker assumptions are saved in this browser.')}
              </span>
            </div>
            <p class="text-[11px] leading-relaxed text-slate-400">{translateText('These browser-stored assumptions affect modeled financing and transaction costs. Confirm every value with your broker; they are not live broker-reported requirements.')}</p>
            <p class="text-[10px] uppercase tracking-wider text-slate-500">
              Margin and commission rules (USD)
            </p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <div class="settings-field-group-heading">{translateText('Broker financing & rollover')}</div>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Annual margin rate (%)
                <input
                  id="annualMarginRateInput"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={ruleValues.annualRate}
                  onInput={(e) => updateRuleValue('annualRate', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Interest day-count
                <select
                  id="interestDayCountInput"
                  value={ruleValues.dayCountBasis}
                  onChange={(e) => updateRuleValue('dayCountBasis', (e.target as HTMLSelectElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                >
                  <option value="365">365 days</option>
                  <option value="360">360 days</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Rollover time (Asia/Yerevan)
                <input
                  id="rolloverTimeInput"
                  type="time"
                  required
                  value={ruleValues.rolloverTime}
                  onInput={(e) => updateRuleValue('rolloverTime', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
              <div class="settings-field-group-heading">{translateText('Margin risk thresholds')}</div>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Maintenance equity (%)
                <input
                  id="maintenanceMarginInput"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={ruleValues.maintenanceMargin}
                  onInput={(e) => {
                    updateRuleValue('maintenanceMargin', (e.target as HTMLInputElement).value);
                    updateStopOutValidity();
                  }}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Stop-out equity (%)
                <input
                  ref={stopOutInputRef}
                  id="stopOutRatioInput"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={ruleValues.stopOutRatio}
                  onInput={(e) => {
                    updateRuleValue('stopOutRatio', (e.target as HTMLInputElement).value);
                    updateStopOutValidity();
                  }}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>

              <div class="settings-field-group-heading">{translateText('Trading commissions')}</div>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Commission / share ($)
                <input
                  id="commissionPerShareInput"
                  type="number"
                  min="0"
                  step="0.001"
                  required
                  inputMode="decimal"
                  value={ruleValues.commPerShare}
                  onInput={(e) => updateRuleValue('commPerShare', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Commission by value (%)
                <input
                  id="commissionVolumeInput"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={ruleValues.commVolumePct}
                  onInput={(e) => updateRuleValue('commVolumePct', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Min comm. / order ($)
                <input
                  id="minimumCommissionInput"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  inputMode="decimal"
                  value={ruleValues.minCommOrder}
                  onInput={(e) => updateRuleValue('minCommOrder', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                class="min-h-11 min-w-11 rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-700"
              >
                Save rules
              </button>
              <button
                id="resetBrokerRulesButton"
                type="button"
                onClick={() => emitUiEvent('settings:reset-broker-rules')}
                class="min-h-11 min-w-11 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Restore defaults
              </button>
              <span class="text-[10px] text-slate-500">
                Saved in this browser. Confirm rates with your broker.
              </span>
            </div>
          </form>
        </div>
      </details>
      </section>}

      <section id="settings-maintenance-section" class="settings-section" aria-labelledby="settingsMaintenanceTitle">
        <div class="settings-section-heading">
          <h2 id="settingsMaintenanceTitle">{translateText('Diagnostics & Maintenance')}</h2>
          <p>{translateText('Check device health and application updates. Advanced encryption maintenance remains administrator-only.')}</p>
        </div>
        <PwaUpdateStatus />
        <DeviceCheckSummary />
        {account?.role === 'admin' && <details
          class="settings-subsection settings-maintenance-advanced"
          open={advancedMaintenanceOpen}
          onToggle={(event) => setAdvancedMaintenanceOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{translateText('Advanced maintenance')}</summary>
          <div class="pt-3">
            {advancedMaintenanceOpen && <MarginDigestSecurityPanel currentUserId={account.id} />}
          </div>
        </details>}
      </section>

      <section id="settings-help-section" class="settings-section" aria-labelledby="settingsHelpTitle">
        <div class="settings-section-heading">
          <h2 id="settingsHelpTitle">{translateText('Methodology & Help')}</h2>
          <p>{translateText('Understand how portfolio metrics are calculated, what data sources support them, and where model limitations apply.')}</p>
        </div>
        <details class="settings-subsection">
          <summary>{translateText('Metric methodology and data notes')}</summary>
          <div class="pt-3"><PortfolioMethodologyPanel /></div>
        </details>
      </section>
    </div>
  );
}
