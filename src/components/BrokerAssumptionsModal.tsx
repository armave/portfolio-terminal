import React, { useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { useNotifications } from '../contexts/NotificationContext';
import { saveBrokerRules } from '../services/storage.js';

export function BrokerAssumptionsModal() {
  const { rules, setRules } = usePortfolio();
  const { showToast } = useNotifications();
  const [formData, setFormData] = useState({
    annualRate: (rules.annualRate * 100).toFixed(2),
    dayCountBasis: String(rules.dayCountBasis),
    maintenanceMarginRatio: (rules.maintenanceMarginRatio * 100).toFixed(2),
    stopOutRatio: (rules.stopOutRatio * 100).toFixed(2),
    rolloverTime: `${String(rules.rolloverHour).padStart(2, '0')}:${String(rules.rolloverMinute).padStart(2, '0')}`,
    commPerShare: String(rules.commPerShare),
    commVolumePct: (rules.commVolumePct * 100).toFixed(2),
    minCommOrder: rules.minCommOrder.toFixed(2)
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const [rolloverHour, rolloverMinute] = formData.rolloverTime.split(':').map(Number);
    const updatedRules = {
      ...rules,
      annualRate: Number(formData.annualRate) / 100,
      dayCountBasis: Number(formData.dayCountBasis),
      maintenanceMarginRatio: Number(formData.maintenanceMarginRatio) / 100,
      stopOutRatio: Number(formData.stopOutRatio) / 100,
      rolloverHour,
      rolloverMinute,
      commPerShare: Number(formData.commPerShare),
      commVolumePct: Number(formData.commVolumePct) / 100,
      minCommOrder: Number(formData.minCommOrder)
    };
    if (updatedRules.stopOutRatio > updatedRules.maintenanceMarginRatio) {
      showToast('Stop-out equity must not exceed maintenance equity.', 'error');
      return;
    }
    setRules(updatedRules);
    saveBrokerRules(updatedRules);
    showToast('Broker assumptions saved in this browser.', 'success');
  };

  return (
    <details className="rounded border border-slate-800 bg-slate-950/40 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300 hover:text-cyan-300">Broker Rules</summary>
      <div className="mt-3">
        <form onSubmit={handleSubmit} className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Margin and commission rules (USD)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Annual margin rate (%)
              <input name="annualRate" value={formData.annualRate} onChange={handleChange} type="number" min="0" max="100" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Interest day-count
              <select name="dayCountBasis" value={formData.dayCountBasis} onChange={handleChange} className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white">
                <option value="365">365 days</option>
                <option value="360">360 days</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Maintenance equity (%)
              <input name="maintenanceMarginRatio" value={formData.maintenanceMarginRatio} onChange={handleChange} type="number" min="0" max="99.99" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Stop-out equity (%)
              <input name="stopOutRatio" value={formData.stopOutRatio} onChange={handleChange} type="number" min="0" max="99.99" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Rollover time (ARM)
              <input name="rolloverTime" value={formData.rolloverTime} onChange={handleChange} type="time" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Commission / share ($)
              <input name="commPerShare" value={formData.commPerShare} onChange={handleChange} type="number" min="0" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Commission by value (%)
              <input name="commVolumePct" value={formData.commVolumePct} onChange={handleChange} type="number" min="0" max="100" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Min comm. / order ($)
              <input name="minCommOrder" value={formData.minCommOrder} onChange={handleChange} type="number" min="0" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-700">Save rules</button>
            <span className="text-[10px] text-slate-500">Saved in this browser. Confirm rates with your broker.</span>
          </div>
        </form>
      </div>
    </details>
  );
}
