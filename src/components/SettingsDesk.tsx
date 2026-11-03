import { useState, useEffect, useRef } from 'preact/hooks';
import { emitUiEvent } from '../ui/uiEventBus';
import { getQuoteRefreshInterval } from '../services/storage';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  DEFAULT_GUEST_REFRESH_INTERVAL_MS
} from '../services/portfolioAutoRefresh';
import type { BrokerAssumptions } from '../types/portfolio';
import { usePortfolio } from '../store/portfolioStore';
import { listUsers, createUser, updateUser, updateMyLanguage, deleteUser, testFreedomTradeNetConnection, testFreedomTradeNetOrdersStream, testFreedomTradeNetEventStream, testFreedomTradeNetPortfolioReconciliation, testFreedomTradeNetQuoteStream, compareFreedomPortfolioSnapshots, type AuthUser } from '../services/api';
import { getAccountPermissions } from '../domain/accountPermissions';
import { translateText, type AppLanguage } from '../services/i18n';
import { fetchFreedomQuote, normalizeFreedomQuote } from '../services/freedomMarketData';
import { DeskLoading } from './DeskLoading';
import { TableScrollRegion } from './TableScrollRegion';


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
  const [tradeNetTest, setTradeNetTest] = useState<{ kind: 'rest' | 'websocket' | 'portfolio' | 'markets' | 'reconciliation' | 'quotes' | 'quote-comparison'; loading: boolean; result?: unknown; error?: string } | null>(null);
  const [tradeNetQuoteSymbol, setTradeNetQuoteSymbol] = useState('GOOGL.US');
  const [editValues, setEditValues] = useState<Record<string, { name: string; role: "guest" | "admin"; language: AppLanguage; password: string }>>({});

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

  const compareTradeNetQuotes = async (symbol: string) => {
    const normalizedSymbol = symbol.trim().toUpperCase().includes('.')
      ? symbol.trim().toUpperCase()
      : `${symbol.trim().toUpperCase()}.US`;
    const [websocketResult, restResult] = await Promise.allSettled([
      testFreedomTradeNetQuoteStream(normalizedSymbol),
      fetchFreedomQuote(normalizedSymbol, true)
    ]);
    const websocketPayload = websocketResult.status === 'fulfilled'
      ? websocketResult.value
      : null;
    const websocketQuote = websocketPayload
      ? normalizeFreedomQuote(websocketPayload?.data, normalizedSymbol)
      : null;
    const websocketRow = websocketPayload?.data?.q?.[0] ?? null;
    const restQuote = restResult.status === 'fulfilled' ? restResult.value : null;
    const delta = (left: number | null | undefined, right: number | null | undefined) =>
      typeof left === 'number' && Number.isFinite(left) &&
      typeof right === 'number' && Number.isFinite(right)
        ? Number((left - right).toFixed(6))
        : null;
    const lastPriceDelta = delta(websocketQuote?.price, restQuote?.price);
    const previousCloseDelta = delta(websocketQuote?.previousClose, restQuote?.previousClose);
    const changeDelta = delta(websocketQuote?.change, restQuote?.change);
    const changePercentDelta = delta(websocketQuote?.changePercent, restQuote?.changePercent);

    return {
      symbol: normalizedSymbol,
      comparedAt: new Date().toISOString(),
      websocket: websocketQuote ? {
        price: websocketQuote.price,
        previousClose: websocketQuote.previousClose,
        change: websocketQuote.change,
        changePercent: websocketQuote.changePercent,
        bid: typeof websocketRow?.bbp === 'number' ? websocketRow.bbp : null,
        ask: typeof websocketRow?.bap === 'number' ? websocketRow.bap : null,
        volume: typeof websocketRow?.vol === 'number' ? websocketRow.vol : null,
        lastTradeTime: typeof websocketRow?.ltt === 'string' ? websocketRow.ltt : null,
        utcOffset: websocketRow?.UTCOffset ?? null,
        serverTime: websocketRow?.acc_srv_tm ?? null,
        sourceTimestamp: websocketQuote.sourceTimestamp
      } : {
        error: websocketResult.status === 'rejected'
          ? (websocketResult.reason instanceof Error ? websocketResult.reason.message : 'WebSocket quote unavailable.')
          : 'WebSocket quote returned an unsupported payload.'
      },
      rest: restQuote ? {
        price: restQuote.price,
        previousClose: restQuote.previousClose,
        change: restQuote.change,
        changePercent: restQuote.changePercent,
        sourceTimestamp: restQuote.sourceTimestamp
      } : {
        error: restResult.status === 'rejected'
          ? (restResult.reason instanceof Error ? restResult.reason.message : 'REST quote unavailable.')
          : 'REST quote returned no data.'
      },
      comparison: {
        lastPriceDelta,
        previousCloseDelta,
        changeDelta,
        changePercentDelta,
        lastPriceWithinOneCent: lastPriceDelta === null ? null : Math.abs(lastPriceDelta) <= 0.01,
        previousCloseWithinOneCent: previousCloseDelta === null ? null : Math.abs(previousCloseDelta) <= 0.01
      }
    };
  };

  const runTradeNetTest = async (kind: 'rest' | 'websocket' | 'portfolio' | 'markets' | 'reconciliation' | 'quotes' | 'quote-comparison') => {
    if (tradeNetTest?.loading) return;
    setTradeNetTest({ kind, loading: true });
    try {
      const result = kind === 'rest'
        ? await testFreedomTradeNetConnection()
        : kind === 'websocket'
          ? await testFreedomTradeNetOrdersStream()
          : kind === 'reconciliation'
          ? await testFreedomTradeNetPortfolioReconciliation().then((snapshots) =>
              compareFreedomPortfolioSnapshots(snapshots.websocket, snapshots.rest))
          : kind === 'quotes'
            ? await testFreedomTradeNetQuoteStream(tradeNetQuoteSymbol)
            : kind === 'quote-comparison'
              ? await compareTradeNetQuotes(tradeNetQuoteSymbol)
              : await testFreedomTradeNetEventStream(kind);
      setTradeNetTest({ kind, loading: false, result });
    } catch (error) {
      setTradeNetTest({
        kind,
        loading: false,
        error: error instanceof Error ? error.message : translateText('TradeNet diagnostic failed.')
      });
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

  if (initialUsersLoading) {
    return <DeskLoading
      title="Preparing settings"
      message="Loading account access, preferences and workspace settings…"
      accent="blue"
    />;
  }

  return (
    <div id="settingsDesk" class="settings-desk min-w-0 space-y-4">
      <div class="settings-header border-b border-slate-800 pb-3">
        <h2 class="text-lg font-black text-slate-200 tracking-wide">
          TERMINAL SETTINGS &amp; SYNC
        </h2>
        <p class="text-xs text-slate-400">
          {account?.role === 'guest'
            ? 'Manage your account and quote refresh preferences.'
            : 'Configure broker assumptions, cloud synchronization, quote polling, and account access.'}
        </p>
      </div>

      <div class="terminal-toolbar settings-toolbar flex flex-col lg:flex-row w-full items-center lg:divide-x divide-slate-700 gap-y-3 lg:gap-y-0 py-1">
        <div class="flex-1 w-full flex flex-wrap items-center justify-center gap-2 lg:px-2">
          <div class="text-xs text-slate-300">
            {account ? <><span class="font-bold text-white">{account.name}</span><span class="ml-2 rounded bg-slate-800 px-2 py-1 uppercase text-[10px] text-cyan-300">{account.role}</span></> : "Account information unavailable"}
          </div>
          {account && <label class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            Language
            <select aria-label="Account language" value={account.language ?? "en"} disabled={savingLanguage} onChange={(event) => void handleLanguageChange(event)} class="h-8 rounded border border-slate-700 bg-slate-900 text-center px-2 text-xs text-slate-300">
              <option value="en" class="text-center">English</option>
              <option value="ru" class="text-center">Russian</option>
            </select>
          </label>}
          {languageError && <span role="alert" class="text-[10px] text-rose-300">{languageError}</span>}
          <button type="button" onClick={() => emitUiEvent("auth:logout")} class="h-8 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Sign out</button>
          {account?.role === "admin" && <button type="button" onClick={() => emitUiEvent("settings:pull-cloud-state")} title={translateText("Pull cloud replaces this device's local portfolio with the shared KV cloud snapshot. Changes that have not synced can be lost.")} aria-label={translateText('Replace local portfolio from KV cloud')} class="h-8 rounded border border-purple-600 bg-slate-800 px-2.5 text-xs font-bold text-purple-300 hover:bg-slate-700">Pull cloud</button>}
        </div>

        {/* Cluster 2: Polling & Backups */}
        <div class="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2" aria-label="Portfolio data refresh and backup controls">
          <label class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            {translateText('Update Interval')}
            <select
              id="quoteRefreshInterval"
              value={refreshInterval}
              onChange={handleIntervalChange}
              aria-label="Automatic portfolio data refresh interval"
              title={translateText(account?.role === 'guest'
                ? 'Live quotes update at the selected interval. Your assigned holdings and LOTS history refresh every 60 seconds. Returning to the app refreshes both.'
                : 'Live quotes update at the selected interval. Broker balances, positions, trades and orders refresh every 60 seconds. Returning to the app refreshes both.')}
              class="h-8 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="0">{translateText('Off')}</option>
              <option value="15000">{translateText('15 sec')}</option>
              <option value="30000">{translateText('30 sec')}</option>
              <option value="60000">{translateText('1 min')}</option>
            </select>
          </label>
          <p class="basis-full text-center text-[10px] leading-relaxed text-slate-500">
            {refreshInterval === '0'
              ? translateText('Automatic updates are paused. Manual Sync remains available.')
              : translateText(account?.role === 'guest'
                ? 'Live quotes update at the selected interval. Your assigned holdings and LOTS history refresh every 60 seconds. Returning to the app refreshes both.'
                : 'Live quotes update at the selected interval. Broker balances, positions, trades and orders refresh every 60 seconds. Returning to the app refreshes both.')}
          </p>
          {permissions.canManageBackups && <>
            <button
              type="button"
              onClick={() => emitUiEvent('settings:export-backup')}
              aria-label="Export portfolio backup as JSON"
              title="Export portfolio state to JSON file"
              class="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => emitUiEvent('terminal:backup-import-request')}
              title="Validate and confirm a portfolio backup import; cloud sync depends on KV configuration"
              aria-label="Import portfolio backup from JSON"
              class="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer flex items-center justify-center text-center"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => emitUiEvent('settings:reset-to-blank-state')}
              title={translateText("Reset deletes saved portfolio and history data from this device and KV cloud. TradeNet records held by the broker are not deleted.")}
              aria-label={translateText('Reset local and cloud portfolio data')}
              class="h-8 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
            >
              Reset
            </button>
          </>}
        </div>
      </div>

      {permissions.canManageBackups && <div class="settings-data-safety-note w-full rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[10px] leading-relaxed text-amber-100/90" role="note" aria-label={translateText('Portfolio data safety warning')}>
        <p class="mt-1 font-semibold text-amber-200 text-center">{translateText("Export a JSON backup before pulling cloud state or resetting the portfolio.")}</p>
      </div>}

      {account?.role === "admin" && <section class="settings-panel settings-tradenet-diagnostics space-y-3 rounded-lg border border-cyan-900/60 bg-slate-950/40 p-3" aria-labelledby="tradeNetDiagnosticsTitle">
        <div>
          <h3 id="tradeNetDiagnosticsTitle" class="text-sm font-bold text-slate-200">{translateText('Temporary TradeNet diagnostics')}</h3>
          <p class="text-[10px] leading-relaxed text-slate-500">{translateText('Run read-only authenticated TradeNet checks. Portfolio reconciliation compares normalized WebSocket and REST snapshots without changing saved holdings.')}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(tradeNetTest?.loading)} onClick={() => void runTradeNetTest('rest')} class="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'rest' ? translateText('Testing REST…') : translateText('Test REST connection')}
          </button>
          <button type="button" disabled={Boolean(tradeNetTest?.loading)} onClick={() => void runTradeNetTest('websocket')} class="rounded border border-cyan-800 bg-cyan-950/60 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'websocket' ? translateText('Testing WebSocket…') : translateText('Test authenticated WebSocket')}
          </button>
          <button type="button" disabled={Boolean(tradeNetTest?.loading)} onClick={() => void runTradeNetTest('portfolio')} class="rounded border border-violet-800 bg-violet-950/50 px-3 py-2 text-xs font-bold text-violet-200 hover:bg-violet-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'portfolio' ? translateText('Testing portfolio event…') : translateText('Test portfolio updates')}
          </button>
          <button type="button" disabled={Boolean(tradeNetTest?.loading)} onClick={() => void runTradeNetTest('markets')} class="rounded border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'markets' ? translateText('Testing market event…') : translateText('Test market status updates')}
          </button>
          <label class="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
            <span>{translateText('Quote symbol')}</span>
            <input
              type="text"
              value={tradeNetQuoteSymbol}
              onInput={(event) => setTradeNetQuoteSymbol((event.currentTarget as HTMLInputElement).value)}
              disabled={Boolean(tradeNetTest?.loading)}
              maxlength={32}
              aria-label={translateText('Quote symbol')}
              class="w-28 bg-transparent px-1 py-1 font-mono text-slate-100 outline-none"
            />
          </label>
          <button type="button" disabled={Boolean(tradeNetTest?.loading) || !tradeNetQuoteSymbol.trim()} onClick={() => void runTradeNetTest('quotes')} class="rounded border border-sky-800 bg-sky-950/50 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'quotes' ? translateText('Testing live quote…') : translateText('Test live quote stream')}
          </button>
          <button type="button" disabled={Boolean(tradeNetTest?.loading) || !tradeNetQuoteSymbol.trim()} onClick={() => void runTradeNetTest('quote-comparison')} class="rounded border border-cyan-800 bg-cyan-950/50 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'quote-comparison' ? translateText('Comparing quote sources…') : translateText('Compare quote WebSocket vs REST')}
          </button>
          <button type="button" disabled={Boolean(tradeNetTest?.loading)} onClick={() => void runTradeNetTest('reconciliation')} class="rounded border border-amber-800 bg-amber-950/50 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-900 disabled:cursor-wait disabled:opacity-50">
            {tradeNetTest?.loading && tradeNetTest.kind === 'reconciliation' ? translateText('Comparing portfolio snapshots…') : translateText('Compare WebSocket vs REST portfolio')}
          </button>
        </div>
        {tradeNetTest?.loading && <p class="text-xs text-cyan-300" role="status">{translateText('Contacting TradeNet. Please wait…')}</p>}
        {tradeNetTest?.error && <p class="rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300" role="alert">{tradeNetTest.error}</p>}
        {tradeNetTest?.result !== undefined && <div class="space-y-1">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400" role="status">{translateText('Diagnostic result')} · {tradeNetTest.kind === 'rest' ? 'REST' : tradeNetTest.kind === 'websocket' ? 'WebSocket' : tradeNetTest.kind === 'portfolio' ? 'Portfolio' : tradeNetTest.kind === 'markets' ? 'Markets' : tradeNetTest.kind === 'quotes' ? 'Live quote' : tradeNetTest.kind === 'quote-comparison' ? 'Quote comparison' : 'Reconciliation'}</p>
          <pre class="max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all" aria-label={translateText('TradeNet diagnostic response')}>{JSON.stringify(tradeNetTest.result, null, 2)}</pre>
        </div>}
        <p class="text-[10px] text-slate-500">{translateText('Temporary test controls — remove after verification.')}</p>
      </section>}

      {account?.role === "admin" && <section class="settings-panel settings-user-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" aria-labelledby="userManagementTitle">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div><h3 id="userManagementTitle" class="text-sm font-bold text-slate-200">User management</h3>
            <p class="text-[10px] text-slate-500">Accounts share this portfolio. Guests have read-only access; admins can manage accounts.</p></div>
          {account?.role === "admin" && <span class="text-[10px] uppercase tracking-wider text-emerald-400">Admin controls</span>}
        </div>
        {account?.role === "admin" ? <>
          <form onSubmit={handleCreateUser} class="settings-user-form grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_110px_120px_auto]">
            <input type="text" aria-label="User name" minLength={2} maxLength={60} required value={newName} onInput={(event) => setNewName((event.target as HTMLInputElement).value)} placeholder="User name" class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <input type="password" aria-label="Password (6+ characters)" minLength={6} maxLength={128} required value={newPassword} onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)} placeholder="Password (6+ characters)" autoComplete="new-password" class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white" />
            <select value={newRole} onChange={(event) => setNewRole((event.target as HTMLSelectElement).value as "guest" | "admin")} aria-label="New user role" class="rounded border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-white"><option class="text-center" value="guest">Guest</option><option class="text-center" value="admin">Admin</option></select>
            <select value={newLanguage} onChange={(event) => setNewLanguage((event.target as HTMLSelectElement).value as AppLanguage)} aria-label="New user language" class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-2 text-xs text-white"><option class="text-center" value="en">English</option><option class="text-center" value="ru">Russian</option></select>
            <button type="submit" disabled={savingUser} class="rounded bg-cyan-800 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-700 disabled:opacity-50">Add user</button>
          </form>
          <TableScrollRegion label="User management table" className="table-scroll-wrapper settings-table-scroll"><table class="w-full min-w-[790px] text-left text-xs">
            <caption class="sr-only">User management table</caption>
            <thead class="text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" class="p-2">Name</th><th scope="col" class="p-2">Role</th><th scope="col" class="p-2">Language</th><th scope="col" class="p-2">New password</th><th scope="col" class="p-2">Actions</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id} class="border-t border-slate-800">
              <td class="p-2"><input aria-label={`Name for ${user.name}`} value={editValues[user.id]?.name ?? user.name} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], name: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" /></td>
              <td class="p-2"><select aria-label={`Role for ${user.name}`} value={editValues[user.id]?.role ?? user.role} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], role: (event.target as HTMLSelectElement).value as "guest" | "admin" } }))} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-center text-white"><option class="text-center" value="guest">Guest</option><option class="text-center" value="admin">Admin</option></select></td>
              <td class="p-2"><select aria-label={`Language for ${user.name}`} value={editValues[user.id]?.language ?? user.language ?? "en"} onChange={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], language: (event.target as HTMLSelectElement).value as AppLanguage } }))} class="rounded border border-slate-700 bg-slate-900 text-center px-2 py-1.5 text-white"><option class="text-center" value="en">English</option><option class="text-center" value="ru">Russian</option></select></td>
              <td class="p-2"><input aria-label={`New password for ${user.name}`} type="password" minLength={6} maxLength={128} autoComplete="new-password" placeholder="Leave blank to keep" value={editValues[user.id]?.password ?? ""} onInput={(event) => setEditValues((current) => ({ ...current, [user.id]: { ...current[user.id], password: (event.target as HTMLInputElement).value } }))} class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white" /></td>
              <td class="whitespace-nowrap p-2"><button type="button" disabled={savingUser} onClick={() => void handleUpdateUser(user.id)} class="mr-2 rounded bg-slate-800 px-2 py-1.5 text-cyan-300 disabled:opacity-50">Save</button>
                {user.id !== account.id && <button type="button" disabled={savingUser} onClick={() => void handleDeleteUser(user)} class="rounded bg-rose-950 px-2 py-1.5 text-rose-300 disabled:opacity-50">Delete</button>}</td>
            </tr>)}</tbody>
          </table></TableScrollRegion>
        </> : <p class="text-xs text-slate-400">Only administrators can view or manage the user list.</p>}
        {usersError && <p class="text-xs text-rose-300" role="alert">{usersError}</p>}
      </section>}

      {permissions.canEditBrokerRules && <details class="settings-panel settings-broker-rules space-y-3">
        <summary class="cursor-pointer justify-center text-xs font-bold text-slate-300 hover:text-cyan-300">
          Broker Rules
        </summary>
        <div class="mt-3">
          <form id="brokerRulesForm" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; if (!form.reportValidity()) return; const values = { ...ruleValues }; const stopOut = Number(values.stopOutRatio); const maintenance = Number(values.maintenanceMargin); if (stopOut > maintenance) { stopOutInputRef.current?.setCustomValidity("Stop-out equity must not exceed maintenance equity."); stopOutInputRef.current?.reportValidity(); return; } stopOutInputRef.current?.setCustomValidity(""); emitUiEvent('settings:save-broker-rules', { values }); }} class="settings-rules-form space-y-2">
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
                    stopOutInputRef.current?.setCustomValidity('');
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
                    stopOutInputRef.current?.setCustomValidity('');
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
                class="rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-700"
              >
                Save rules
              </button>
              <button
                id="resetBrokerRulesButton"
                type="button"
                onClick={() => emitUiEvent('settings:reset-broker-rules')}
                class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
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
    </div>
  );
}
