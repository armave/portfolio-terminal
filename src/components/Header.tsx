import React, { useRef, useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { useNotifications } from '../contexts/NotificationContext';
import { createBlankState } from '../domain/portfolio';
import { saveGatewaySecret, loadGatewaySecret } from '../services/storage.js';

export function Header({ keysHidden, onToggleKeys }: { keysHidden: boolean, onToggleKeys: () => void }) {
  const { state, mutateState, syncFromCloud, saveToCloud, refreshAllLivePrices, refreshInterval, setRefreshInterval, cloudStatus, rules: brokerAssumptions, setRules, saveLocalState } = usePortfolio();
  const { showToast } = useNotifications();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showRules, setShowRules] = useState(false);

  const handleExport = async () => {
    const jsonStr = JSON.stringify(state, null, 2);
    const fileName = "portfolio_backup.json";

    try {
      const file = new File([jsonStr], fileName, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Portfolio Backup',
        });
        return;
      }
    } catch (err) {
      console.log("Web Share API failed or was cancelled", err);
    }

    // Fallback to standard anchor download
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        mutateState((draft: any) => {
          Object.keys(draft).forEach(key => delete draft[key]);
          Object.assign(draft, parsed);
        });
        showToast('Portfolio imported successfully', 'success');
      } catch (err) {
        showToast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset the entire portfolio? This cannot be undone.')) {
      mutateState((draft: any) => {
        const blank = createBlankState();
        Object.keys(draft).forEach(key => delete draft[key]);
        Object.assign(draft, blank);
      });
      showToast('Portfolio reset to blank state', 'info');
    }
  };

  const handleRuleChange = (field: string, value: string) => {
    setRules((prev: any) => {
      const updated = { ...prev, [field]: Number(value) };
      return updated;
    });
  };

  const handleSaveRules = () => {
    saveLocalState();
    saveToCloud();
    showToast('Broker rules saved', 'success');
    setShowRules(false);
  };

  const handleSaveToCloud = async () => {
    let secret = state.gatewaySecret || loadGatewaySecret();
    if (!secret) {
      secret = window.prompt("Enter Gateway Secret to enable cloud sync:");
      if (secret) {
        saveGatewaySecret(secret);
        mutateState((draft: any) => { draft.gatewaySecret = secret; });
        // Auto-pull after saving the key to fetch and populate the UI automatically
        await syncFromCloud(secret);
      } else {
        return; // Cancelled
      }
    }
    await saveToCloud();
  };

  return (
    <div className="border-card p-4 sm:p-5 rounded-xl space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MARGIN DESK TERMINAL</h1>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-black px-2 py-0.5 rounded tracking-wide">BROKER MODEL</span>
        </div>
        <div className="flex items-center gap-2">
          <span id="cloudStatusDot" className={`w-1.5 h-1.5 rounded-full ${cloudStatus.status === 'synced' ? 'bg-emerald-400' : cloudStatus.status === 'syncing' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`}></span>
          <span id="cloudStatusText" className="text-[10px] font-bold text-slate-400 tracking-wider">KV: {cloudStatus.text}</span>
        </div>
      </div>

      <div className="terminal-toolbar flex flex-col lg:flex-row w-full items-center lg:divide-x divide-slate-700 gap-y-3 lg:gap-y-0 py-1">
        <div className="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <button onClick={onToggleKeys} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition">
            {keysHidden ? 'Show keys' : 'Hide keys'}
          </button>
          <button onClick={() => setShowRules(!showRules)} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition">
            Broker Rules
          </button>
          <button onClick={() => syncFromCloud(state.gatewaySecret)} className="h-8 bg-slate-800 hover:bg-slate-700 border border-purple-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center gap-1">
            <span>☁↓</span> Pull
          </button>
          <button onClick={handleSaveToCloud} className="h-8 bg-slate-800 hover:bg-slate-700 border border-emerald-600 text-emerald-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center gap-1">
            <span>☁↑</span> Save
          </button>
          <button onClick={handleExport} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition">
            Export JSON
          </button>
          <label className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition cursor-pointer flex items-center">
            Import JSON
            <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleImport} />
          </label>
          <button onClick={handleReset} className="h-8 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold px-2.5 py-1 rounded transition">
            Reset
          </button>
        </div>
        <div className="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <button onClick={refreshAllLivePrices} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center gap-1">
            <span>↻</span> Quotes
          </button>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            Auto
            <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))} className="h-8 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500">
              <option value="0">Off</option>
              <option value="15000">15 sec</option>
              <option value="30000">30 sec</option>
              <option value="60000">1 min</option>
            </select>
          </label>
        </div>
      </div>

      {showRules && (
        <div className="mt-4 p-4 bg-slate-900/50 border border-slate-700 rounded-lg">
          <h3 className="text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">Broker Assumptions</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <label className="flex flex-col gap-1 text-[10px] text-slate-400 uppercase">
              Annual Margin Rate
              <input type="number" step="0.0001" value={brokerAssumptions.annualRate} onChange={e => handleRuleChange('annualRate', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400 uppercase">
              Maintenance Margin
              <input type="number" step="0.01" value={brokerAssumptions.maintenanceMarginRatio} onChange={e => handleRuleChange('maintenanceMarginRatio', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400 uppercase">
              Comm Per Share
              <input type="number" step="0.001" value={brokerAssumptions.commPerShare} onChange={e => handleRuleChange('commPerShare', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400 uppercase">
              Comm Volume Pct
              <input type="number" step="0.0001" value={brokerAssumptions.commVolumePct} onChange={e => handleRuleChange('commVolumePct', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400 uppercase">
              Min Comm Order
              <input type="number" step="0.01" value={brokerAssumptions.minCommOrder} onChange={e => handleRuleChange('minCommOrder', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500" />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={handleSaveRules} className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded transition">
              Apply & Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
