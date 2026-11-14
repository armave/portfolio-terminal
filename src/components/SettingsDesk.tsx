import { useState, useEffect, useRef } from 'preact/hooks';
import { emitUiEvent } from '../ui/uiEventBus';
import { getQuoteRefreshInterval } from '../services/storage';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  DEFAULT_GUEST_REFRESH_INTERVAL_MS
} from '../services/portfolioAutoRefresh';
import type { BrokerAssumptions } from '../types/portfolio';
import { usePortfolio } from '../store/portfolioStore';
import { listUsers, createUser, updateUser, updateMyLanguage, deleteUser, type AuthUser } from '../services/api';
import { getAccountPermissions } from '../domain/accountPermissions';
import { translateText, type AppLanguage } from '../services/i18n';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import { TableScrollRegion } from './TableScrollRegion';
import { TablePagination } from './TablePagination';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { PortfolioMethodologyPanel } from './PortfolioMethodologyPanel';
import { getStopOutValidationMessage } from '../domain/brokerRulesValidation';
import { DeviceCheckSummary } from './DeviceCheckSummary';
import { MarginDigestSecurityPanel } from './MarginDigestSecurityPanel';


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
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersError, setUsersError] = useState("");
  const [initialUsersLoading, setInitialUsersLoading] = useState(currentUser?.role === 'admin');
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"guest" | "admin">("guest");
  const [newLanguage, setNewLanguage] = useState<AppLanguage>("en");
  const [savingUser, setSavingUser] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [syncingPortfolio, setSyncingPortfolio] = useState(false);
  const [brokerRulesOpen, setBrokerRulesOpen] = useState(false);
  const portfolioSyncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { name: string; role: "guest" | "admin"; language: AppLanguage; password: string }>>({});
  const usersPagination = useTablePagination('settings-users', users.length, 10);
  const visibleUsers = sliceTablePage(users, usersPagination.currentPage, usersPagination.pageSize);

  const refreshUsers = async () => {
    // The application already owns the verified session identity. Refresh only
    // the admin directory here; a transient directory error must not sign out
    // the active user or erase their account details from Settings.
    if (currentUser?.role !== "admin") {
      setUsers([]);
      setEditValues({});
      setUsersError("");
      return;
    }
    try {
      const records = await listUsers();
      setUsers(records);
      setEditValues(Object.fromEntries(records.map((user) => [user.id, { name: user.name, role: user.role, language: user.language ?? "en", password: "" }])));
      setUsersError("");
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not load users.");
    }
  };
  useEffect(() => {
    setAccount(currentUser);
  }, [currentUser]);

  useEffect(() => {
    setInitialUsersLoading(currentUser?.role === 'admin');
    void refreshUsers().finally(() => setInitialUsersLoading(false));
  }, [currentUser?.id, currentUser?.role]);

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
    const values = editValues[userId];
    if (!values || savingUser) return;
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
      await request;
    } finally {
      if (portfolioSyncPromise.current === request) portfolioSyncPromise.current = null;
      setSyncingPortfolio(false);
    }
  };

  return (
    <div id="settingsDesk" class="settings-desk min-w-0 space-y-4">
      <div class="settings-header border-b border-slate-800 pb-3">
        <h1 class="text-lg font-black text-slate-200 tracking-wide">
          TERMINAL SETTINGS &amp; SYNC
        </h1>
        <p class="text-xs text-slate-400">
          {account?.role === 'guest'
            ? 'Manage your account and mandatory portfolio sync preferences.'
            : 'Configure broker assumptions, mandatory portfolio synchronization, and account access.'}
        </p>
      </div>

      <div class="settings-toolbar settings-toolbar settings-toolbar--organized w-full py-1">
        <div class="settings-toolbar__card settings-account-card flex flex-col gap-3" role="group" aria-label={translateText('Account actions')}>
          <div class="settings-account-summary flex flex-wrap items-center justify-between gap-3">
            <div class="settings-account-identity flex min-w-0 flex-wrap items-center gap-2">
              <span class="text-sm font-bold text-slate-200">{account?.name || translateText('Account information unavailable')}</span>
              {account && <span class="rounded bg-slate-800 px-2 py-1 uppercase text-[10px] font-bold text-cyan-300">{account.role}</span>}
            </div>
            {account && <label class="settings-account-language flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
              {translateText('Language')}
              <select aria-label={translateText('Account language')} value={account.language ?? "en"} disabled={savingLanguage} onChange={(event) => void handleLanguageChange(event)} class="h-8 rounded border border-slate-700 bg-slate-900 text-center px-2 text-xs text-slate-300">
                <option value="en" class="text-center">English</option>
                <option value="ru" class="text-center">Russian</option>
              </select>
            </label>}
          </div>
          {languageError && <span role="alert" class="text-[10px] text-rose-300">{languageError}</span>}
          <div class={'settings-account-actions grid grid-cols-2 gap-2 ' + (account?.role === 'guest' ? 'settings-account-actions--guest' : '')}>
            {account?.role === "admin" && <button type="button" onClick={() => emitUiEvent("settings:pull-cloud-state")} title={translateText("Pull cloud replaces this device's local portfolio with the shared KV cloud snapshot. Changes that have not synced can be lost.")} aria-label={translateText('Replace local portfolio from KV cloud')} class="h-9 rounded border border-purple-600 bg-slate-800 px-2.5 text-xs font-bold text-purple-300 hover:bg-slate-700">{translateText('Pull cloud')}</button>}
            {(account?.role === "admin" || account?.role === "guest") && <button
              type="button"
              onClick={() => void handleManualPortfolioSync()}
              disabled={syncingPortfolio}
              aria-busy={syncingPortfolio}
              aria-label={translateText('Sync portfolio')}
              title={translateText('Sync portfolio')}
              class="settings-sync-button h-9 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs font-bold text-cyan-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >{syncingPortfolio ? translateText('Syncing…') : translateText('Sync portfolio')}</button>}
            <button type="button" onClick={() => emitUiEvent("auth:logout")} class="h-9 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">{translateText('Sign out')}</button>
          </div>
        </div>

        <div class="settings-toolbar__card settings-refresh-card flex flex-col gap-3" role="group" aria-label={translateText('Portfolio data refresh and backup controls')}>
          <div class="settings-refresh-heading flex flex-wrap items-center justify-between gap-2">
            <label class="settings-refresh-interval flex min-w-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
              {translateText('Mandatory Sync Interval')}
              <select
                id="quoteRefreshInterval"
                value={refreshInterval}
                onChange={handleIntervalChange}
                aria-label={translateText('Mandatory automatic portfolio sync interval')}
                title={translateText(account?.role === 'guest'
                  ? 'Your assigned holdings, LOTS history and their market quotes refresh at the selected interval. Returning to the app refreshes them immediately.'
                  : 'Quotes, portfolio cloud state, broker recovery data, trades, orders, cashflows and Closed History refresh on the selected interval. Returning to the app refreshes all data immediately.')}
                class="h-9 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="15000">{translateText('15 sec')}</option>
                <option value="30000">{translateText('30 sec')}</option>
                <option value="60000">{translateText('1 min')}</option>
              </select>
            </label>
          </div>
          <p class="settings-refresh-description text-left text-[10px] leading-relaxed text-slate-500">
            {translateText(account?.role === 'guest'
              ? 'Your assigned holdings, LOTS history and their market quotes refresh at the selected interval. Returning to the app refreshes them immediately.'
              : 'Quotes, portfolio cloud state, broker recovery data, trades, orders, cashflows and Closed History refresh on the selected interval. Returning to the app refreshes all data immediately.')}
          </p>
          {permissions.canManageBackups && <div class="settings-backup-actions grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => emitUiEvent('settings:export-backup')}
              aria-label="Export portfolio backup as JSON"
              title="Export portfolio state to JSON file"
              class="h-9 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
            >{translateText('Export')}</button>
            <button
              type="button"
              onClick={() => emitUiEvent('settings:backup-import-request')}
              title="Validate and confirm a portfolio backup import; cloud sync depends on KV configuration"
              aria-label="Import portfolio backup from JSON"
              class="h-9 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer flex items-center justify-center text-center"
            >{translateText('Import')}</button>
            <button
              type="button"
              onClick={() => emitUiEvent('settings:reset-to-blank-state')}
              title={translateText("Reset deletes saved portfolio and history data from this device and KV cloud. TradeNet records held by the broker are not deleted.")}
              aria-label={translateText('Reset local and cloud portfolio data')}
              class="h-9 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
            >{translateText('Reset')}</button>
          </div>}
        </div>
      </div>

      {permissions.canManageBackups && <div class="settings-data-safety-note flex w-full items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-3 text-[10px] leading-relaxed text-amber-100/90" role="note" aria-label={translateText('Portfolio data safety warning')}>
        <span aria-hidden="true" class="shrink-0 text-sm text-amber-300">⚠</span>
        <p class="min-w-0 font-semibold text-left text-amber-200">{translateText("Export a JSON backup before pulling cloud state or resetting the portfolio.")}</p>
      </div>}

      {account?.role === "admin" && <section class="settings-panel settings-user-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" aria-labelledby="userManagementTitle">
        <div class="settings-user-heading flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 id="userManagementTitle" class="text-sm font-bold text-slate-200">User management</h3>
            <p class="mt-1 max-w-prose text-[10px] leading-relaxed text-slate-500">Admins share the owner workspace. Guests see only assigned read-only projections; they do not have independent portfolios.</p>
          </div>
          {account?.role === "admin" && <span class="shrink-0 rounded border border-emerald-900/50 bg-emerald-950/30 px-2 py-1 text-[10px] uppercase tracking-wider text-emerald-400">Admin controls</span>}
        </div>
        {account?.role === "admin" ? <>
          <form onSubmit={handleCreateUser} class="settings-user-form grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_110px_120px_auto]">
            <input type="text" aria-label="User name" minLength={2} maxLength={60} required value={newName} onInput={(event) => setNewName((event.target as HTMLInputElement).value)} placeholder="User name" class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <input type="password" aria-label="Password (6+ characters)" minLength={6} maxLength={128} required value={newPassword} onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)} placeholder="Password (6+ characters)" autoComplete="new-password" class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <select value={newRole} onChange={(event) => setNewRole((event.target as HTMLSelectElement).value as "guest" | "admin")} aria-label="New user role" class="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-white"><option class="text-center" value="guest">Guest</option><option class="text-center" value="admin">Admin</option></select>
            <select value={newLanguage} onChange={(event) => setNewLanguage((event.target as HTMLSelectElement).value as AppLanguage)} aria-label="New user language" class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-2 text-xs text-white"><option class="text-center" value="en">English</option><option class="text-center" value="ru">Russian</option></select>
            <button type="submit" disabled={savingUser} class="min-h-11 min-w-11 rounded bg-cyan-800 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-700 disabled:opacity-50">Add user</button>
          </form>
          <TableScrollRegion label="User management table" className="table-scroll-wrapper settings-table-scroll"><table class="w-full min-w-[790px] text-left text-xs">
            <caption class="sr-only">User management table</caption>
            <thead class="text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" class="p-2">Name</th><th scope="col" class="p-2">Role</th><th scope="col" class="p-2">Language</th><th scope="col" class="p-2">New password</th><th scope="col" class="p-2">Actions</th></tr></thead>
            <tbody id="settingsUsersTableBody">
              {initialUsersLoading && <tr><td colSpan={5} class="p-3 text-center text-xs text-slate-500" role="status">{translateText('Loading users…')}</td></tr>}
              {visibleUsers.map((user) => <tr key={user.id} class="border-t border-slate-800">
                <td class="p-2"><input aria-label={`Name for ${user.name}`} value={editValues[user.id]?.name ?? user.name} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], name: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" /></td>
                <td class="p-2"><select aria-label={`Role for ${user.name}`} value={editValues[user.id]?.role ?? user.role} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], role: (event.target as HTMLSelectElement).value as "guest" | "admin" } }))} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-center text-white"><option class="text-center" value="guest">Guest</option><option class="text-center" value="admin">Admin</option></select></td>
                <td class="p-2"><select aria-label={`Language for ${user.name}`} value={editValues[user.id]?.language ?? user.language ?? "en"} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], language: (event.target as HTMLSelectElement).value as AppLanguage } }))} class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-1.5 text-white"><option class="text-center" value="en">English</option><option class="text-center" value="ru">Russian</option></select></td>
                <td class="p-2"><input aria-label={`New password for ${user.name}`} type="password" minLength={6} maxLength={128} autoComplete="new-password" placeholder="Leave blank to keep" value={editValues[user.id]?.password ?? ""} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], password: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" /></td>
                <td class="whitespace-nowrap p-2"><button type="button" disabled={savingUser} onClick={() => void handleUpdateUser(user.id)} class="mr-2 min-h-11 min-w-11 rounded bg-slate-800 px-2 py-1.5 text-cyan-300 disabled:opacity-50">Save</button>
                  {user.id !== account.id && <button type="button" disabled={savingUser} onClick={() => void handleDeleteUser(user)} class="min-h-11 min-w-11 rounded bg-rose-950 px-2 py-1.5 text-rose-300 disabled:opacity-50">Delete</button>}</td>
              </tr>)}</tbody>
          </table></TableScrollRegion>
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
            controlsId="settingsUsersTableBody"
          />
        </> : <p class="text-xs text-slate-400">Only administrators can view or manage the user list.</p>}
        {usersError && <p class="text-xs text-rose-300" role="alert">{usersError}</p>}
      </section>}

      

      <DeviceCheckSummary />
      {account?.role === 'admin' && <MarginDigestSecurityPanel currentUserId={account.id} />}
      {account?.role === 'admin' && (LoadedTenantDirectoryPanel ? (
        <LoadedTenantDirectoryPanel currentUser={account} />
      ) : (
        <div class="settings-panel text-xs text-slate-500" role="status">
          {tenantDirectoryLoadFailed
            ? translateText('Portfolio ownership could not be loaded.')
            : translateText('Loading portfolio ownership…')}
        </div>
      ))}

      {permissions.canEditBrokerRules && <details
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
            <p class="text-[10px] uppercase tracking-wider text-slate-500">
              Margin and commission rules (USD)
            </p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                Rollover time (ARM)
                <input
                  id="rolloverTimeInput"
                  type="time"
                  required
                  value={ruleValues.rolloverTime}
                  onInput={(e) => updateRuleValue('rolloverTime', (e.target as HTMLInputElement).value)}
                  class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                />
              </label>
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
      </details>}

      <PortfolioMethodologyPanel />
    </div>
  );
}
