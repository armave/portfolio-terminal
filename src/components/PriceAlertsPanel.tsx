import { useEffect, useMemo, useState } from 'preact/hooks';

type AlertDirection = 'above' | 'below';
interface PriceAlert { id: string; ticker: string; target: number; direction: AlertDirection; enabled: boolean; triggeredAt?: number; lastPrice?: number }
const STORAGE_KEY = 'portfolio_terminal_price_alerts_v1';
function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((a) => a && typeof a.ticker === 'string' && Number.isFinite(Number(a.target))) : [];
  } catch { return []; }
}
function saveAlerts(alerts: PriceAlert[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts)); } catch { /* storage may be unavailable */ }
}

export function PriceAlertsPanel() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts);
  const [ticker, setTicker] = useState('');
  const [target, setTarget] = useState('');
  const [direction, setDirection] = useState<AlertDirection>('above');
  const [notice, setNotice] = useState('');
  const activeCount = useMemo(() => alerts.filter((a) => a.enabled && !a.triggeredAt).length, [alerts]);

  useEffect(() => {
    const onPrice = (event: Event) => {
      const detail = (event as CustomEvent<{ ticker: string; price: number }>).detail;
      if (!detail || !detail.ticker || !Number.isFinite(detail.price)) return;
      setAlerts((current) => {
        let changed = false;
        const next = current.map((alert) => {
          if (!alert.enabled || alert.triggeredAt || alert.ticker !== detail.ticker.toUpperCase()) return alert;
          const hit = alert.direction === 'above' ? detail.price >= alert.target : detail.price <= alert.target;
          if (!hit) return { ...alert, lastPrice: detail.price };
          changed = true;
          const triggeredAt = Date.now();
          setNotice(`${alert.ticker} reached ${detail.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Price alert: ${alert.ticker}`, { body: `Price ${detail.price} ${alert.direction === 'above' ? 'reached or exceeded' : 'fell to or below'} ${alert.target}.` });
          }
          return { ...alert, lastPrice: detail.price, triggeredAt };
        });
        if (changed || next.some((a, i) => a !== current[i])) saveAlerts(next);
        return next;
      });
    };
    window.addEventListener('portfolio-price-update', onPrice);
    return () => window.removeEventListener('portfolio-price-update', onPrice);
  }, []);

  const update = (next: PriceAlert[]) => { setAlerts(next); saveAlerts(next); };
  const addAlert = (event: Event) => {
    event.preventDefault();
    const cleanTicker = ticker.trim().toUpperCase();
    const numericTarget = Number(target);
    if (!/^[A-Z0-9.^=_-]{1,20}$/.test(cleanTicker) || !Number.isFinite(numericTarget) || numericTarget <= 0) {
      setNotice('Enter a valid ticker and a target price above zero.');
      return;
    }
    update([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ticker: cleanTicker, target: numericTarget, direction, enabled: true }, ...alerts]);
    setTicker(''); setTarget(''); setNotice('Price alert created.');
  };
  const enableNotifications = async () => {
    if (!('Notification' in window)) { setNotice('Browser notifications are not supported.'); return; }
    const permission = await Notification.requestPermission();
    setNotice(permission === 'granted' ? 'Browser notifications enabled.' : 'Notifications were not enabled; alerts remain visible here.');
  };

  return (
    <section class="border border-cyan-900/60 bg-slate-900/70 rounded-xl p-4 space-y-3" aria-label="Price alerts">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><h2 class="text-sm font-black tracking-wide text-cyan-200">PRICE ALERTS</h2><p class="text-[11px] text-slate-400">Trigger when a tracked quote crosses your target.</p></div>
        <span class="text-[10px] font-mono text-slate-400">{activeCount} active</span>
      </div>
      <form onSubmit={addAlert} class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
        <input aria-label="Ticker symbol" value={ticker} onInput={(e) => setTicker((e.target as HTMLInputElement).value)} placeholder="Ticker (e.g. AAPL)" maxlength={20} class="min-w-0 h-9 rounded border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100" required />
        <input aria-label="Target price" value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} type="number" min="0.0001" step="any" placeholder="Target price" class="min-w-0 h-9 rounded border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100" required />
        <select aria-label="Alert direction" value={direction} onChange={(e) => setDirection((e.target as HTMLSelectElement).value as AlertDirection)} class="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"><option value="above">At or above</option><option value="below">At or below</option></select>
        <button type="submit" class="h-9 rounded bg-cyan-500 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-400">Add alert</button>
      </form>
      {notice && <p class="text-[11px] text-cyan-300" role="status">{notice}</p>}
      <div class="flex justify-end"><button type="button" onClick={enableNotifications} class="text-[11px] text-slate-400 underline hover:text-cyan-300">Enable browser notifications</button></div>
      {alerts.length === 0 ? <p class="rounded border border-dashed border-slate-700 p-3 text-xs text-slate-500">No alerts yet. Add a ticker and target price above.</p> : (
        <div class="space-y-2">{alerts.map((alert) => (
          <div key={alert.id} class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <div class="min-w-0"><div class="text-xs font-bold text-slate-100">{alert.ticker} <span class="font-normal text-slate-400">{alert.direction === 'above' ? '≥' : '≤'} ${alert.target.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div><div class="mt-1 text-[10px] text-slate-500">{alert.triggeredAt ? `Triggered ${new Date(alert.triggeredAt).toLocaleString()}` : alert.enabled ? `Waiting for quote${alert.lastPrice ? ` · last ${alert.lastPrice}` : ''}` : 'Paused'}</div></div>
            <div class="flex items-center gap-2"><button type="button" onClick={() => update(alerts.map((a) => a.id === alert.id ? { ...a, enabled: !a.enabled, triggeredAt: undefined } : a))} class="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300">{alert.enabled && !alert.triggeredAt ? 'Pause' : 'Re-arm'}</button><button type="button" onClick={() => update(alerts.filter((a) => a.id !== alert.id))} aria-label={`Delete ${alert.ticker} alert`} class="rounded border border-rose-900 px-2 py-1 text-[10px] text-rose-300">Delete</button></div>
          </div>
        ))}</div>
      )}
      <p class="text-[10px] text-slate-500">Alerts run in this browser when quote updates arrive; notifications require permission. They are not broker orders and do not guarantee instant delivery.</p>
    </section>
  );
}
