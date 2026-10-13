import React from 'react';
import { usePortfolio, ActiveTab } from '../store/PortfolioContext';

export const Header: React.FC = () => {
  const { activeTab, setActiveTab, isSyncing, syncError } = usePortfolio();

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'margin', label: 'Margin' },
    { id: 'balance', label: 'Balance' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' }
  ];

  return (
    <header className="border-card p-4 sm:p-5 rounded-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MARGIN DESK TERMINAL</h1>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-black px-2 py-0.5 rounded tracking-wide">
            BROKER MODEL
          </span>
          {isSyncing && (
            <span className="text-[10px] text-cyan-400 font-mono animate-pulse ml-2">
              Syncing cloud...
            </span>
          )}
          {syncError && (
            <span className="text-[10px] text-rose-400 font-mono ml-2">
              [{syncError}]
            </span>
          )}
        </div>

        {/* 4-Tab Navigation */}
        <nav className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${isActive
                  ? 'bg-emerald-600 text-black shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};