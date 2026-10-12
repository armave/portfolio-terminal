import React, { useState, useEffect } from 'react';
import { useNotifications } from '../contexts/NotificationContext';

export function CredentialsBar() {
  const { showToast } = useNotifications();
  const [creds, setCreds] = useState({
    gemini: '', finnhub: '', twelveData: '', alphaVantage: '', rapidApi: '', gistId: '', githubPat: ''
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const loaded = localStorage.getItem('portfolio_credentials');
    if (loaded) {
      try { setCreds(JSON.parse(loaded)); } catch (e) {}
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCreds({ ...creds, [e.target.name]: e.target.value });
  };

  const handleSave = () => {
    localStorage.setItem('portfolio_credentials', JSON.stringify(creds));
    showToast('Credentials saved locally', 'success');
  };

  return (
    <div className="border-card p-4 rounded-xl space-y-3 bg-slate-900/50">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">API Credentials</h3>
        <button onClick={() => setVisible(!visible)} className="text-[10px] text-cyan-400 hover:text-cyan-300">{visible ? 'Hide Values' : 'Show Values'}</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Object.entries(creds).map(([key, val]) => (
          <label key={key} className="flex flex-col gap-1 text-[10px] text-slate-400 capitalize">
            {key.replace(/([A-Z])/g, ' $1').trim()}
            <input type={visible ? "text" : "password"} name={key} value={val} onChange={handleChange} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none" />
          </label>
        ))}
      </div>
      <button onClick={handleSave} className="bg-cyan-800 hover:bg-cyan-700 text-white text-xs font-bold px-3 py-1.5 rounded transition">Save Credentials</button>
    </div>
  );
}
