import { useState, useEffect, useRef } from 'preact/hooks';
import {
  areHeaderCredentialsConfigured,
  getGatewaySecret,
  getQuoteRefreshInterval
} from '../services/storage';
import { BrokerRules } from '../types/portfolio';
import { testFreedomTradeNetConnection, fetchFreedomTradeNetPositions, normalizeFreedomPortfolio } from '../services/api';

export interface SettingsDeskProps {
  rules: BrokerRules;
  defaultRefreshIntervalMs?: number;
  onSaveBrokerRules: (event: Event) => void;
  onResetBrokerRules: () => void;
  onSaveApiKeys: (secret: string) => void | Promise<void>;
  onPullCloudState: () => void;
  onChangeRefreshInterval: (intervalMs: string) => void;
  onExportBackup: () => void;
  onImportBackup: (event: Event) => void;
  onResetToBlankState: () => void;
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
export function toBrokerRulesFormValues(rules: BrokerRules): BrokerRulesFormValues {
  const hours = String(rules.rolloverHour ?? 4).padStart(2, '0');
  const minutes = String(rules.rolloverMinute ?? 0).padStart(2, '0');

  return {
    annualRate: ((rules.annualRate ?? 0.15) * 100).toFixed(2),
    dayCountBasis: String(rules.dayCountBasis ?? 365),
    maintenanceMargin: ((rules.maintenanceMarginRatio ?? 0.1) * 100).toFixed(2),
    stopOutRatio: ((rules.stopOutRatio ?? 0) * 100).toFixed(2),
    rolloverTime: `${hours}:${minutes}`,
    commPerShare: String(rules.commPerShare ?? 0.012),
    commVolumePct: ((rules.commVolumePct ?? 0.0012) * 100).toFixed(2),
    minCommOrder: (rules.minCommOrder ?? 1.2).toFixed(2)
  };
}

export function SettingsDesk({
  rules,
  defaultRefreshIntervalMs = 60000,
  onSaveBrokerRules,
  onResetBrokerRules,
  onSaveApiKeys,
  onPullCloudState,
  onChangeRefreshInterval,
  onExportBackup,
  onImportBackup,
  onResetToBlankState
}: SettingsDeskProps) {
  const [secretValue, setSecretValue] = useState<string>(() => getGatewaySecret() || '');
  const [isTestingTradeNet, setIsTestingTradeNet] = useState(false);
  const [tradeNetTestStatus, setTradeNetTestStatus] = useState('');
  const [isLoadingTradeNetPositions, setIsLoadingTradeNetPositions] = useState(false);
  const [tradeNetPositionsPreview, setTradeNetPositionsPreview] = useState('');
  const handleTradeNetFetchPositions = async () => {
    setIsLoadingTradeNetPositions(true);
    setTradeNetPositionsPreview('');
    try {
      const result = await fetchFreedomTradeNetPositions();
      const snapshot = normalizeFreedomPortfolio(result);
      setTradeNetPositionsPreview(JSON.stringify(snapshot, null, 2).slice(0, 12000));
    } catch (error) {
      setTradeNetPositionsPreview(error instanceof Error ? error.message : 'Failed to retrieve TradeNet positions.');
    } finally {
      setIsLoadingTradeNetPositions(false);
    }
  };
  const handleTradeNetTest = async () => {
    setIsTestingTradeNet(true);
    setTradeNetTestStatus('Testing TradeNet connection…');
    try {
      const result = await testFreedomTradeNetConnection();
      setTradeNetTestStatus(result?.ok ? 'TradeNet connection successful.' : 'TradeNet returned an unexpected response.');
    } catch (error) {
      setTradeNetTestStatus(error instanceof Error ? error.message : 'TradeNet connection failed.');
    } finally {
      setIsTestingTradeNet(false);
    }
  };
  useEffect(() => {
    const handleAuthenticated = (event: Event) => {
      const secret = (event as CustomEvent<{ secret: string }>).detail?.secret || '';
      setSecretValue(secret);
      setCredentialsHidden(false);
      setIsConfigured(Boolean(secret));
    };
    window.addEventListener('gateway-secret-authenticated', handleAuthenticated);
    return () => window.removeEventListener('gateway-secret-authenticated', handleAuthenticated);
  }, []);
  const [isConfigured, setIsConfigured] = useState<boolean>(() =>
    areHeaderCredentialsConfigured()
  );
  const [credentialsHidden, setCredentialsHidden] = useState<boolean>(() =>
    areHeaderCredentialsConfigured()
  );
  const [refreshInterval, setRefreshInterval] = useState<string>(() =>
    String(getQuoteRefreshInterval(defaultRefreshIntervalMs))
  );

  const [ruleValues, setRuleValues] = useState<BrokerRulesFormValues>(() =>
    toBrokerRulesFormValues(rules)
  );

  const stopOutInputRef = useRef<HTMLInputElement | null>(null);

  // Sync local form values whenever rules prop updates (e.g. Restore defaults)
  useEffect(() => {
    setRuleValues(toBrokerRulesFormValues(rules));
    stopOutInputRef.current?.setCustomValidity('');
  }, [
    rules.annualRate,
    rules.dayCountBasis,
    rules.maintenanceMarginRatio,
    rules.stopOutRatio,
    rules.rolloverHour,
    rules.rolloverMinute,
    rules.commPerShare,
    rules.commVolumePct,
    rules.minCommOrder
  ]);

  const updateRuleValue = (field: keyof BrokerRulesFormValues, value: string) => {
    setRuleValues((current) => ({ ...current, [field]: value }));
  };

  const handleSecretInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    setSecretValue(val);
    const configured = Boolean(val.trim()) || areHeaderCredentialsConfigured();
    setIsConfigured(configured);
    if (!configured) {
      setCredentialsHidden(false);
    }
  };

  const handleSaveKeysClick = async () => {
    await onSaveApiKeys(secretValue);
    const configured = areHeaderCredentialsConfigured();
    setIsConfigured(configured);
    setCredentialsHidden(configured);
  };

  const handleIntervalChange = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    setRefreshInterval(val);
    onChangeRefreshInterval(val);
  };

  return (
    <>
      <div class="border-b border-slate-800 pb-3">
        <h2 class="text-lg font-black text-slate-200 tracking-wide">
          TERMINAL SETTINGS &amp; SYNC
        </h2>
        <p class="text-xs text-slate-400">
          Configure broker margin assumptions, cloud KV synchronization, quote polling, and
          backups.
        </p>
      </div>

      <div class="terminal-toolbar flex flex-col lg:flex-row w-full items-center lg:divide-x divide-slate-700 gap-y-3 lg:gap-y-0 py-1">
        {/* Cluster 1: Cloud & Secret */}
        <div class="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <div
            id="headerCredentialsFields"
            style={{ display: isConfigured && credentialsHidden ? 'none' : 'flex' }}
            class="flex items-center"
          >
            <input
              id="headerGatewaySecretInput"
              // Use a text input with visual masking: password inputs can trigger
              // Google Password Manager's saved-password bottom sheet on mobile.
              type="text"
              value={secretValue}
              onInput={handleSecretInput}
              placeholder="Gateway Secret..."
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-protonpass-ignore="true"
              data-form-type="other"
              style={{ WebkitTextSecurity: 'disc' }}
              class="w-36 h-8 bg-slate-800 text-slate-200 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            id="toggleHeaderCredentialsButton"
            type="button"
            onClick={() => setCredentialsHidden((prev) => !prev)}
            aria-expanded={!credentialsHidden}
            title={credentialsHidden ? 'Show credential inputs' : 'Hide credential inputs'}
            class={`${isConfigured ? '' : 'hidden '
              }h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center`}
          >
            {credentialsHidden ? 'Show inputs' : 'Hide inputs'}
          </button>
          <div
            id="headerCredentialsActions"
            style={{ display: isConfigured && credentialsHidden ? 'none' : 'flex' }}
            class="flex items-center gap-1.5"
          >
            <button
              id="saveApiKeysButton"
              type="button"
              onClick={handleSaveKeysClick}
              title="Save keys and pull latest cloud state"
              class="secret-action-btn h-8 bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
            >
              Save
            </button>
          </div>
          <button
            type="button"
            onClick={onPullCloudState}
            title="Force pull cloud data and rewrite local storage"
            class="secret-action-btn h-8 bg-slate-800 hover:bg-slate-700 border border-purple-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
          >
            <span>☁↓</span>
            Pull
          </button>
          <button
            type="button"
            onClick={handleTradeNetTest}
            disabled={isTestingTradeNet}
            title="Test the read-only Freedom TradeNet API connection"
            class="h-8 bg-slate-800 hover:bg-slate-700 border border-cyan-700 text-cyan-300 disabled:opacity-50 text-xs font-bold px-2.5 py-1 rounded transition"
          >
            {isTestingTradeNet ? 'Testing…' : 'Test TradeNet'}
          </button>
          {tradeNetTestStatus && (
            <p role="status" aria-live="polite" class="w-full text-center text-[10px] text-slate-300">
              {tradeNetTestStatus}
            </p>
          )}
          <button
            type="button"
            onClick={handleTradeNetFetchPositions}
            disabled={isLoadingTradeNetPositions}
            title="Retrieve read-only TradeNet positions"
            class="h-8 bg-slate-800 hover:bg-slate-700 border border-emerald-700 text-emerald-300 disabled:opacity-50 text-xs font-bold px-2.5 py-1 rounded transition"
          >
            {isLoadingTradeNetPositions ? 'Loading positions…' : 'Fetch positions'}
          </button>
          {tradeNetPositionsPreview && (
            <pre role="status" aria-live="polite" class="w-full max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-300">{tradeNetPositionsPreview}</pre>
          )}
        </div>

        {/* Cluster 2: Polling & Backups */}
        <div class="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <label class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            Update Interval
            <select
              id="quoteRefreshInterval"
              value={refreshInterval}
              onChange={handleIntervalChange}
              aria-label="Automatic quote refresh interval"
              class="h-8 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="0">Off</option>
              <option value="15000">15 sec</option>
              <option value="30000">30 sec</option>
              <option value="60000">1 min</option>
            </select>
          </label>
          <button
            type="button"
            onClick={onExportBackup}
            title="Export portfolio state to JSON file"
            class="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
          >
            Export
          </button>
          <label
            title="Validate and confirm a portfolio backup import; cloud sync depends on KV configuration"
            class="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer flex items-center justify-center text-center"
          >
            Import
            <input
              type="file"
              id="importFileInput"
              class="hidden"
              accept=".json"
              onChange={onImportBackup}
            />
          </label>
          <button
            type="button"
            onClick={onResetToBlankState}
            title="Clear all local data and return to blank slate"
            aria-label="Reset all local portfolio data"
            class="h-8 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center"
          >
            Reset
          </button>
        </div>
      </div>

      <details class="space-y-3">
        <summary class="cursor-pointer justify-center text-xs font-bold text-slate-300 hover:text-cyan-300">
          Broker Rules
        </summary>
        <div class="mt-3">
          <form id="brokerRulesForm" onSubmit={onSaveBrokerRules} class="space-y-2">
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
                onClick={onResetBrokerRules}
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
      </details>
    </>
  );
}
