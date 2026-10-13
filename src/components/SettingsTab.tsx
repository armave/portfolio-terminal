import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import type { BrokerAssumptions } from '../types/portfolio';

export const SettingsTab: React.FC = () => {
  const {
    gatewaySecret,
    setGatewaySecret,
    quoteRefreshInterval,
    setQuoteRefreshInterval,
    brokerAssumptions,
    setBrokerAssumptions,
    resetBrokerAssumptions,
    syncFromCloud,
    saveToCloud,
    refreshAllQuotes,
    positions,
    cashHoldings,
    closedTrades,
    cashBalance,
    resetToBlank,
    isSyncing
  } = usePortfolio();

  // Local form state for Broker Rules
  const [rulesDraft, setRulesDraft] = useState<BrokerAssumptions>(brokerAssumptions);
  const [secretDraft, setSecretDraft] = useState<string>(gatewaySecret);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    setRulesDraft(brokerAssumptions);
  }, [brokerAssumptions]);

  useEffect(() => {
    setSecretDraft(gatewaySecret);
  }, [gatewaySecret]);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleRulesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBrokerAssumptions(rulesDraft);
    showFeedback('Broker rules saved.');
  };

  const handleSaveSecret = async () => {
    setGatewaySecret(secretDraft);
    try {
      await saveToCloud(secretDraft);
      showFeedback('Secret saved & cloud state updated.');
    } catch {
      showFeedback('Saved locally; cloud push failed.');
    }
  };

  const handlePullCloud = async () => {
    try {
      await syncFromCloud(secretDraft);
      showFeedback('Pulled latest cloud data.');
    } catch {
      showFeedback('Failed to pull cloud state.');
    }
  };

  // Export JSON Backup
  const handleExportJSON = () => {
    const backupData = {
      positions,
      cashHoldings,
      closedTrades,
      cashBalance,
      brokerAssumptions,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON Backup
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.brokerAssumptions) setBrokerAssumptions(parsed.brokerAssumptions);
        // Persist imported payload into current state
        localStorage.setItem('portfolioState', JSON.stringify(parsed));
        window.location.reload();
      } catch (err) {
        alert('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="border-card p-4 sm:p-6 rounded-xl space-y-6">
      <div className="border-b border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-emerald-400 tracking-wide">TERMINAL SETTINGS &amp; SYNC</h2>
          <p className="text-xs text-slate-400">
            Configure broker rules, credentials, quote polling, and data backups.
          </p>
        </div>
        {feedbackMsg && (
          <span className="text-xs font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800 px-2.5 py-1 rounded">
            {feedbackMsg}
          </span>
        )}
      </div>

      {/* Cluster Toolbar: Cloud Sync, Quotes, and Backups */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
        {/* Gateway Credentials */}
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
            Cloud Sync &amp; Secret
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              placeholder="Gateway Secret..."
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              className="w-full h-8 bg-slate-900 text-slate-200 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={handleSaveSecret}
              disabled={isSyncing}
              className="h-8 bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-3 py-1 rounded transition disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handlePullCloud}
              disabled={isSyncing}
              className="h-8 bg-slate-800 hover:bg-slate-700 border border-purple-600 text-purple-300 text-xs font-bold px-3 py-1 rounded transition flex items-center gap-1 disabled:opacity-50"
            >
              <span>☁↓</span> Pull
            </button>
          </div>
        </div>

        {/* Live Quotes Interval */}
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
            Market Quotes
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refreshAllQuotes()}
              className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 text-xs font-bold px-3 py-1 rounded transition flex items-center gap-1"
            >
              <span>↻</span> Quotes
            </button>
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
              Auto:
              <select
                value={quoteRefreshInterval}
                onChange={(e) => setQuoteRefreshInterval(Number(e.target.value))}
                className="h-8 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value={0}>Off</option>
                <option value={15000}>15 sec</option>
                <option value={30000}>30 sec</option>
                <option value={60000}>1 min</option>
              </select>
            </label>
          </div>
        </div>

        {/* Backups & State Reset */}
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
            Storage &amp; Backups
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJSON}
              className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition"
            >
              Export
            </button>
            <label className="h-8 bg-slate-800 hover:bg-slate-700 border border-purple-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer flex items-center">
              Import
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear all local terminal data and reset?')) {
                  resetToBlank();
                  showFeedback('Reset complete.');
                }
              }}
              className="h-8 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Broker Rules Form */}
      <form onSubmit={handleRulesSubmit} className="space-y-3 bg-slate-950/30 p-4 rounded-lg border border-slate-800">
        <div>
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Broker Rules (USD)</h3>
          <p className="text-[10px] text-slate-500">Margin rates, maintenance equity, and transaction fee formulas.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Annual margin rate (%)
            <input
              type="number"
              step="0.01"
              required
              value={rulesDraft.annualMarginRate}
              onChange={(e) => setRulesDraft({ ...rulesDraft, annualMarginRate: Number(e.target.value) })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Interest day-count
            <select
              value={rulesDraft.interestDayCount}
              onChange={(e) => setRulesDraft({ ...rulesDraft, interestDayCount: Number(e.target.value) as 360 | 365 })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            >
              <option value={365}>365 days</option>
              <option value={360}>360 days</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Maintenance equity (%)
            <input
              type="number"
              step="0.01"
              required
              value={rulesDraft.maintenanceMarginRatio * 100}
              onChange={(e) => setRulesDraft({ ...rulesDraft, maintenanceMarginRatio: Number(e.target.value) / 100 })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Stop-out equity (%)
            <input
              type="number"
              step="0.01"
              required
              value={rulesDraft.stopOutRatio * 100}
              onChange={(e) => setRulesDraft({ ...rulesDraft, stopOutRatio: Number(e.target.value) / 100 })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Rollover time (ARM)
            <input
              type="time"
              required
              value={rulesDraft.rolloverTime}
              onChange={(e) => setRulesDraft({ ...rulesDraft, rolloverTime: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Commission / share ($)
            <input
              type="number"
              step="0.001"
              required
              value={rulesDraft.commissionPerShare}
              onChange={(e) => setRulesDraft({ ...rulesDraft, commissionPerShare: Number(e.target.value) })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Commission by value (%)
            <input
              type="number"
              step="0.01"
              required
              value={rulesDraft.commissionVolumeRatio * 100}
              onChange={(e) => setRulesDraft({ ...rulesDraft, commissionVolumeRatio: Number(e.target.value) / 100 })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-slate-400">
            Min comm. / order ($)
            <input
              type="number"
              step="0.01"
              required
              value={rulesDraft.minimumCommission}
              onChange={(e) => setRulesDraft({ ...rulesDraft, minimumCommission: Number(e.target.value) })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
          <button
            type="submit"
            className="rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-700 transition"
          >
            Save rules
          </button>
          <button
            type="button"
            onClick={resetBrokerAssumptions}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition"
          >
            Restore defaults
          </button>
        </div>
      </form>
    </div>
  );
};