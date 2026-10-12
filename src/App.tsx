import React, { useState } from 'react';
import { NotificationProvider } from './contexts/NotificationContext';
import { PortfolioProvider, usePortfolio } from './store/PortfolioContext';
import TerminalUI from './components/TerminalUI';

function MainLayout() {
  const { isAppInitialized, initApp } = usePortfolio();
  const [secretInput, setSecretInput] = useState('');

  if (!isAppInitialized) {
    return (
      <div className="auth-overlay" style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 9999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
        <div className="auth-card border-card w-full max-w-md p-6 rounded-xl bg-[#18181b] border border-slate-700 shadow-2xl">
          <h2 className="text-sm font-bold text-emerald-400 tracking-wider uppercase mb-1">Gateway Authentication</h2>
          <p className="text-xs text-slate-400 mb-4">Enter Gateway Secret to unlock the terminal and sync data.</p>
          <div className="flex gap-2">
            <input type="password" value={secretInput} onChange={e => setSecretInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && initApp(secretInput)} placeholder="Enter Gateway Secret" className="flex-1 bg-slate-900 text-slate-200 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500" />
            <button onClick={() => initApp(secretInput)} className="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition">Save</button>
          </div>
        </div>
      </div>
    );
  }

  return <TerminalUI />;
}

export default function App() {
  return (
    <NotificationProvider>
      <PortfolioProvider>
        <MainLayout />
      </PortfolioProvider>
    </NotificationProvider>
  );
}
