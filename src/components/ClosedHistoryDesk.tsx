import { useEffect, useState } from 'preact/hooks';
import { syncCloudState } from '../services/api';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';

type ImportedCashflow = { id: string; date: string; type: string; amount: number; currency?: string; description?: string; raw: Record<string, string> };

function xmlText(node: Element | null): string {
  return node?.textContent ?? '';
}

function columnIndex(cellRef: string): number {
  const letters = (cellRef.match(/^[A-Z]+/) || ['A'])[0];
  return letters.split('').reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

// Minimal XLSX reader for the workbook's first worksheet, using the browser's ZIP and XML APIs.
async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  const inflate = async (data: Uint8Array, method: number) => {
    if (method === 0) return data;
    if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the XLSX workbook.');
    const stream = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  let offset = 0;
  while (offset + 30 < bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    if (compressedSize === 0xffffffff) throw new Error('Unsupported XLSX ZIP64 archive.');
    entries.set(name, await inflate(bytes.slice(start, start + compressedSize), method));
    offset = start + compressedSize;
  }
  const parseXml = (name: string) => {
    const data = entries.get(name);
    if (!data) return null;
    return new DOMParser().parseFromString(decoder.decode(data), 'application/xml');
  };
  const sharedDoc = parseXml('xl/sharedStrings.xml');
  const shared = sharedDoc ? Array.from(sharedDoc.getElementsByTagName('si')).map(si =>
    Array.from(si.getElementsByTagName('t')).map(t => t.textContent || '').join('')
  ) : [];
  const sheet = parseXml('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The workbook has no first worksheet.');
  const rows: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const values: string[] = [];
    for (const cell of Array.from(row.children).filter(el => el.localName === 'c')) {
      const idx = columnIndex(cell.getAttribute('r') || 'A1');
      const type = cell.getAttribute('t');
      const value = xmlText(cell.getElementsByTagName('v')[0] || null);
      values[idx] = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr'
        ? Array.from(cell.getElementsByTagName('t')).map(t => t.textContent || '').join('')
        : value;
    }
    rows.push(values.map(value => value ?? ''));
  }
  return rows.filter(row => row.some(value => value.trim() !== ''));
}

function normalizeCashflowRows(rows: string[][]): ImportedCashflow[] {
  if (rows.length < 2) throw new Error('The workbook contains no transaction rows.');
  const headers = rows[0].map(value => value.trim().toLowerCase());
  const find = (...names: string[]) => headers.findIndex(header => names.includes(header.replace(/[ _-]+/g, '')));
  const dateIdx = headers.findIndex(header => /date|time|дата|ժամանակ|датаоперации/.test(header.replace(/[ _-]+/g, '')));
  const amountIdx = headers.findIndex(header => /amount|sum|value|cashflow|fee|interest|commission|сумма|начислен|списан|процент|комис|տոկոս|գումար/.test(header.replace(/[ _-]+/g, '')));
  const typeIdx = headers.findIndex(header => /type|operation|kind|description|comment|details|назначение|операц|тип|описан|մեկնաբան|գործարք/.test(header.replace(/[ _-]+/g, '')));
  const currencyIdx = find('currency', 'curr');
  const descIdx = headers.findIndex(header => /description|comment|details|name|purpose|ticker|symbol|instrument|asset|назначение|описан|коммент|тикер|инструмент|ценнаябумага|актив|մեկնաբան|գործիք/.test(header.replace(/[ _-]+/g, '')));
  if (dateIdx < 0 || amountIdx < 0) {
    throw new Error('Could not identify date and amount columns. Workbook columns: ' + rows[0].join(', '));
  }
  const seen = new Set<string>();
  const result: ImportedCashflow[] = [];
  for (const row of rows.slice(1)) {
    const date = (row[dateIdx] || '').trim();
    const amountText = (row[amountIdx] || '').trim().replace(/\s/g, '').replace(',', '.');
    if (!date && !amountText) continue;
    const amount = Number(amountText.replace(/[^0-9.+-]/g, ''));
    if (!date || !Number.isFinite(amount)) continue;
    const raw: Record<string, string> = {};
    rows[0].forEach((header, i) => { raw[header.trim()] = row[i] ?? ''; });
    const type = typeIdx >= 0 ? (row[typeIdx] || 'Cashflow').trim() : 'Cashflow';
    const description = descIdx >= 0 ? (row[descIdx] || '').trim() : '';
    const currency = currencyIdx >= 0 ? (row[currencyIdx] || '').trim() : '';
    const fingerprint = [date, type, amount.toFixed(8), currency, description].join('|').toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    result.push({ id: 'cashflow-' + fingerprint, date, type, amount, currency: currency || undefined, description: description || undefined, raw });
  }
  if (!result.length) throw new Error('No valid cashflow rows were found. Check the workbook columns.');
  return result;
}


export function ClosedHistoryDesk() {
  const state = usePortfolio();
  const [brokerTrades, setBrokerTrades] = useState<any[]>([]);
  const [brokerTradesLoading, setBrokerTradesLoading] = useState(true);
  const [brokerTradesError, setBrokerTradesError] = useState(false);
  const [cashflowImporting, setCashflowImporting] = useState(false);
  const [cashflowImportMessage, setCashflowImportMessage] = useState('');
  const handleImportCashflows = async (file: File) => {
    setCashflowImporting(true);
    setCashflowImportMessage('');
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Please select an Excel .xlsx file.');
      const rows = await readXlsxRows(await file.arrayBuffer());
      const imported = normalizeCashflowRows(rows);
      if (!imported.length) throw new Error('No cashflow rows were found in this workbook.');

      // The uploaded workbook is a one-off calculation input only. Do not add
      // its rows to portfolio state or send the workbook data to Cloudflare.
      const feeRows = imported.filter(item => /margin|interest|financing|overnight|rollover|borrow|fee|commission|процент|маржин|комис|плата за пользован|տոկոս|մարժին/i.test(
        [item.type, item.description, ...Object.entries(item.raw).map(([key, value]) => key + ' ' + value)].join(' ')
      ));
      const trades = [...(state.closedTrades || [])] as any[];
      let matchedFees = 0;
      let updatedTradeCount = 0;
      const parseTradeDate = (value: unknown): number => {
        if (typeof value === 'number' || (typeof value === 'string' && /^\\d{4,6}(\\.\\d+)?$/.test(value.trim()))) {
          const serial = Number(value);
          if (serial > 20000 && serial < 100000) return Date.UTC(1899, 11, 30) + serial * 86400000;
        }
        const text = String(value ?? '').trim();
        if (!text) return NaN;
        const dmy = text.match(/^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})$/);
        if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? Date.UTC(new Date(parsed).getUTCFullYear(), new Date(parsed).getUTCMonth(), new Date(parsed).getUTCDate()) : NaN;
      };
      const feeTicker = (fee: typeof imported[number]) => {
        const entry = Object.entries(fee.raw).find(([key]) => /^(ticker|symbol|instrument|asset|security|тикер|инструмент)$/i.test(key.trim()));
        return String(entry?.[1] ?? '').trim().toUpperCase();
      };
      const feeDate = (fee: typeof imported[number]) => {
        const raw = Object.entries(fee.raw).find(([key]) => /date|time|дата/i.test(key.replace(/[ _-]/g, '')));
        return parseTradeDate(raw?.[1] ?? fee.date);
      };
      const updatedTrades = trades.map(trade => {
        const ticker = String(trade.ticker ?? trade.symbol ?? trade.instrument ?? '').trim().toUpperCase();
        const buyDate = parseTradeDate(trade.buyDate ?? trade.purchaseDate ?? trade.entryDate ?? trade.openDate ?? trade.openedAt ?? trade.date);
        const sellDate = parseTradeDate(trade.sellDate ?? trade.exitDate ?? trade.closedAt ?? trade.closeDate ?? trade.executedAt);
        if (!ticker || !Number.isFinite(buyDate) || !Number.isFinite(sellDate)) return trade;
        const matching = feeRows.filter(fee => {
          const date = feeDate(fee);
          const symbol = feeTicker(fee);
          if (!Number.isFinite(date) || date < buyDate || date > sellDate) return false;
          if (symbol) return symbol === ticker;
          // Without a symbol, allocate only if a single closed trade covers that date.
          return trades.filter(other => {
            const otherBuy = parseTradeDate(other.buyDate ?? other.purchaseDate ?? other.entryDate ?? other.openDate ?? other.openedAt ?? other.date);
            const otherSell = parseTradeDate(other.sellDate ?? other.exitDate ?? other.closedAt ?? other.closeDate ?? other.executedAt);
            return Number.isFinite(otherBuy) && Number.isFinite(otherSell) && date >= otherBuy && date <= otherSell;
          }).length === 1;
        });
        if (!matching.length) return trade;
        const feeAmount = matching.reduce((sum, fee) => sum + Math.abs(Number(fee.amount) || 0), 0);
        if (!feeAmount) return trade;
        matchedFees += matching.length;
        updatedTradeCount++;
        const previousFees = Number(trade.feesAndCommissions ?? trade.totalCommissions ?? trade.commissions ?? 0) || 0;
        const previousMargin = Number(trade.marginInterest ?? trade.marginFee ?? 0) || 0;
        const previousNet = Number(trade.netProfit ?? trade.netRealizedGain ?? trade.grossProfit ?? 0) || 0;
        return {
          ...trade,
          feesAndCommissions: Number((previousFees + feeAmount).toFixed(2)),
          totalCommissions: Number((Number(trade.totalCommissions ?? previousFees) + feeAmount).toFixed(2)),
          marginInterest: Number((previousMargin + feeAmount).toFixed(2)),
          marginFee: Number((previousMargin + feeAmount).toFixed(2)),
          netProfit: Number((previousNet - feeAmount).toFixed(2)),
          netRealizedGain: Number((previousNet - feeAmount).toFixed(2))
        };
      });
      if (!matchedFees) {
        setCashflowImportMessage(`Read ${imported.length} workbook rows; detected ${feeRows.length} possible fee rows, but matched none to closed trades. No state was changed. Check workbook date/ticker columns and trade purchase/sale dates.`);
        return;
      }
      portfolioStore.setState({ closedTrades: updatedTrades });
      setCashflowImportMessage(`Read ${imported.length} workbook rows; detected ${feeRows.length} possible fee rows; applied ${matchedFees} fee rows to ${updatedTradeCount} closed trades. Only updated closed trades were saved; workbook rows were not stored.`);
    } catch (error) {
      setCashflowImportMessage(error instanceof Error ? error.message : 'Cashflow import failed.');
    } finally {
      setCashflowImporting(false);
    }
  };
  useEffect(() => {
    const readCurrentTrades = () => {
      const current = (window as any).__tradenetExecutedTrades;
      if (Array.isArray(current)) { setBrokerTrades(current); setBrokerTradesLoading(false); setBrokerTradesError(false); }
    };
    const onTrades = (event: Event) => {
      const trades = (event as CustomEvent).detail;
      if (Array.isArray(trades)) { setBrokerTrades(trades); setBrokerTradesLoading(false); setBrokerTradesError(false); }
    };
    readCurrentTrades();
    // If the route opens directly, App's initial fetch may already have fired.
    // Ask App to fetch now as well; both the event and shared cache are supported.
    const onTradesError = () => { setBrokerTradesLoading(false); setBrokerTradesError(true); };
    window.addEventListener('tradenet:executed-trades', onTrades);
    window.addEventListener('tradenet:executed-trades-error', onTradesError);
    window.dispatchEvent(new CustomEvent('tradenet:request-executed-trades'));
    return () => { window.removeEventListener('tradenet:executed-trades', onTrades); window.removeEventListener('tradenet:executed-trades-error', onTradesError); };
  }, []);
  const appTrades = (state.closedTrades || []).map((trade, index) => ({ trade: { ...(trade as any), source: 'app' as const }, index, source: 'app' as const, profit: Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0), fees: Number((trade as any).feesAndCommissions ?? (trade as any).totalCommissions ?? (trade as any).commissions ?? 0) }));
  // Match buy lots FIFO to sell executions so both entry and exit commissions
  // are reflected in the closed-history row. Fees are allocated per share for partial closes.
  const brokerTradeMetrics = (() => {
    const sorted = [...brokerTrades].filter((t: any) => t.ticker && t.executedAt)
      .sort((a: any, b: any) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
    const queues = new Map<string, { date: number; quantity: number; commissionPerShare: number | null }[]>();
    const metricsByObject = new Map<any, { holdingDays: number | null; buyCommission: number }>();
    for (const trade of sorted) {
      const ticker = String(trade.ticker).trim().toUpperCase();
      const side = String(trade.side ?? '').toLowerCase();
      const qty = Math.abs(Number(trade.quantity ?? 0));
      const time = Date.parse(trade.executedAt);
      if (!Number.isFinite(time) || !Number.isFinite(qty) || qty <= 0) continue;
      const isBuy = ['buy', 'b', 'purchase', 'bought', '1'].includes(side);
      const isSell = ['sell', 's', 'sale', 'sold', '2'].includes(side);
      const commission = trade.commission == null ? null : Math.abs(Number(trade.commission));
      if (isBuy) {
        const queue = queues.get(ticker) ?? [];
        queue.push({ date: time, quantity: qty, commissionPerShare: commission !== null && Number.isFinite(commission) ? commission / qty : null });
        queues.set(ticker, queue);
      } else if (isSell) {
        const queue = queues.get(ticker) ?? [];
        let remaining = qty;
        let weightedDays = 0;
        let matched = 0;
        let buyCommission = 0;
        let commissionKnown = true;
        while (remaining > 1e-8 && queue.length) {
          const lot = queue[0];
          const used = Math.min(remaining, lot.quantity);
          weightedDays += Math.max(0, time - lot.date) / 86400000 * used;
          matched += used;
          if (lot.commissionPerShare === null) commissionKnown = false;
          else buyCommission += lot.commissionPerShare * used;
          remaining -= used;
          lot.quantity -= used;
          if (lot.quantity <= 1e-8) queue.shift();
        }
        metricsByObject.set(trade, { holdingDays: matched > 0 ? weightedDays / matched : null, buyCommission: commissionKnown && matched > 0 ? buyCommission : 0 });
      }
    }
    return metricsByObject;
  })();
  const brokerRows = brokerTrades.filter((broker: any) => ['sell', 's', 'sale', 'sold'].includes(String(broker.side ?? '').toLowerCase())).map((broker: any, index) => ({ trade: { id: broker.id ?? ('tradenet-' + index), ticker: broker.ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: brokerTradeMetrics.get(broker)?.holdingDays, feesAndCommissions: broker.commission == null ? null : Math.abs(Number(broker.commission)) + (brokerTradeMetrics.get(broker)?.buyCommission ?? 0), netProfit: broker.profit, side: broker.side, price: broker.price, source: 'tradenet' as const }, index: -1, source: 'tradenet' as const, profit: broker.profit == null ? null : Number(broker.profit) - (broker.marginFee == null ? 0 : Math.abs(Number(broker.marginFee))), fees: broker.commission == null ? (brokerTradeMetrics.get(broker)?.buyCommission ?? 0) : Math.abs(Number(broker.commission)) + (brokerTradeMetrics.get(broker)?.buyCommission ?? 0) }));
  // Group same-ticker sell executions that occur within one hour into one closed-history row.
  // Keep separate groups when the gap from the previous execution exceeds one hour.
  const groupedBrokerRows = (() => {
    const sorted = [...brokerRows].sort((a, b) => Date.parse(String((a.trade as any).exitDate ?? '')) - Date.parse(String((b.trade as any).exitDate ?? '')));
    const groups: typeof brokerRows = [];
    for (const row of sorted) {
      const ticker = String((row.trade as any).ticker ?? '').trim().toUpperCase();
      const time = Date.parse(String((row.trade as any).exitDate ?? ''));
      const previous = groups[groups.length - 1];
      const previousTicker = previous ? String((previous.trade as any).ticker ?? '').trim().toUpperCase() : '';
      const previousTime = previous ? Date.parse(String((previous.trade as any).exitDate ?? '')) : NaN;
      if (previous && ticker && ticker === previousTicker && Number.isFinite(time) && Number.isFinite(previousTime) && time - previousTime <= 60 * 60 * 1000) {
        const oldQty = Number((previous.trade as any).shares ?? 0);
        const newQty = Number((row.trade as any).shares ?? 0);
        const oldProfit = previous.profit;
        const newProfit = row.profit;
        const oldFees = previous.fees;
        const newFees = row.fees;
        const oldDuration = (previous.trade as any).holdingDays;
        const newDuration = (row.trade as any).holdingDays;
        const totalQty = oldQty + newQty;
        (previous.trade as any).shares = totalQty;
        (previous.trade as any).exitDate = (row.trade as any).exitDate;
        (previous.trade as any).sellDate = (row.trade as any).exitDate;
        (previous.trade as any).id = String((previous.trade as any).id) + '+' + String((row.trade as any).id);
        (previous.trade as any).holdingDays = oldDuration != null && newDuration != null && totalQty > 0 ? (Number(oldDuration) * oldQty + Number(newDuration) * newQty) / totalQty : oldDuration ?? newDuration;
        previous.profit = oldProfit == null || newProfit == null ? null : oldProfit + newProfit;
        previous.fees = oldFees + newFees;
        (previous.trade as any).price = totalQty > 0 ? (Number((previous.trade as any).price ?? 0) * oldQty + Number((row.trade as any).price ?? 0) * newQty) / totalQty : (row.trade as any).price;
      } else {
        groups.push({ ...row, trade: { ...(row.trade as any) } });
      }
    }
    return groups;
  })();
  const trades = [...appTrades, ...groupedBrokerRows].sort((a, b) => String((b.trade as any).exitDate ?? (b.trade as any).sellDate ?? '').localeCompare(String((a.trade as any).exitDate ?? (a.trade as any).sellDate ?? '')));
  const realizedNet = trades.reduce((total, row) => total + (row.profit ?? 0), 0);
  const totalFees = trades.reduce((total, row) => total + (Number.isFinite(row.fees) ? row.fees : 0), 0);
  const profitKnownTrades = trades.filter((row) => row.profit !== null);
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades.map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld)).filter((days) => Number.isFinite(days) && days >= 0);
  const averageHoldingDays = knownDurations.length ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length : null;
  const winRate = profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0;

  const handleDelete = (index: number) => {
    const trade = state.closedTrades?.[index];
    const ticker = trade?.ticker || 'unknown';
    if (!confirm(`Delete the ${ticker} closed trade from history? This cannot be undone.`)) {
      return;
    }
    portfolioStore.deleteClosedTrade(index);
  };

  return (
    <section class="rounded-xl border-card p-4 space-y-4" aria-label="Closed trade history">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-base font-black uppercase tracking-wider text-purple-300">
            Closed Trade History
          </h2>
          <p class="text-xs text-slate-400">
            Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="h-8 rounded border border-amber-600 bg-amber-600 px-3 text-xs font-bold text-black hover:bg-amber-500 cursor-pointer inline-flex items-center justify-center">
            {cashflowImporting ? "Importing…" : "Import Cashflows"}
            <input type="file" accept=".xlsx,.xls" disabled={cashflowImporting} class="sr-only" onChange={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void handleImportCashflows(file);
              input.value = "";
            }} />
          </label>
          <div class="text-xs font-mono text-slate-500">
            {trades.length} records ({appTrades.length} app · {brokerRows.length} Freedom)
          </div>
        </div>
      </div>

      {cashflowImportMessage && <p role="status" class="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">{cashflowImportMessage}</p>}
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Closed trade performance summary">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Realized net P&amp;L</div>
          <div class={`mt-1 font-mono text-sm font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedNet >= 0 ? '+' : '−'}${formatUSD(Math.abs(realizedNet))}
          </div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Win rate</div>
          <div class="mt-1 font-mono text-sm font-bold text-white">{winRate.toFixed(1)}%</div>
          <div class="text-[10px] text-slate-500">{winningTrades} of {profitKnownTrades.length} records with known profit profitable</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">${formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">{averageHoldingDays === null ? '—' : averageHoldingDays.toFixed(1) + ' days'}</div>
        </div>
      </div>

      <div class="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table class="w-full text-left text-xs font-mono">
          <thead class="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th class="py-2.5 px-3">Ticker</th>
              <th class="py-2.5 px-3">Date Closed</th>
              <th class="py-2.5 px-3 text-right">Shares</th>
              <th class="py-2.5 px-3 text-right">Duration</th>
              <th class="py-2.5 px-3 text-right">Fees & Comm.</th>
              <th class="py-2.5 px-3 text-right">Net Profit</th>
              <th class="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60">
            {brokerTradesLoading && brokerTrades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-slate-400">
                <span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-purple-400" aria-hidden="true" />Loading closed trade history…</span>
              </td></tr>
            ) : brokerTradesError && trades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-rose-400">Unable to load TradeNet history. Please retry.</td></tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={8} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              trades.map(({ trade, index, source, profit: rowProfit, fees: rowFees }) => {
                // 1. Resolve Exit Date
                const rawDate =
                  (trade as any).exitDate ||
                  (trade as any).sellDate ||
                  (trade as any).closedAt ||
                  (trade as any).date;

                let closedDate: Date | null = null;
                if (typeof rawDate === 'number') {
                  closedDate = new Date(rawDate);
                } else if (typeof rawDate === 'string') {
                  const parsed = Date.parse(rawDate);
                  if (!Number.isNaN(parsed)) closedDate = new Date(parsed);
                }

                const dateText =
                  closedDate && !Number.isNaN(closedDate.getTime())
                    ? closedDate.toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    })
                    : 'Unknown';

                // 2. Resolve Duration in Days
                const rawDuration = (trade as any).holdingDays ?? (trade as any).daysHeld;
                let durationDays = rawDuration == null ? null : Number(rawDuration);
                if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays < 0)) durationDays = null;
                if (
                  (durationDays === null || durationDays <= 0) &&
                  ((trade as any).buyDate || (trade as any).purchaseDate) &&
                  ((trade as any).sellDate || (trade as any).exitDate)
                ) {
                  const bTime = new Date(
                    (trade as any).buyDate || (trade as any).purchaseDate
                  ).getTime();
                  const sTime = new Date(
                    (trade as any).sellDate || (trade as any).exitDate
                  ).getTime();
                  if (!Number.isNaN(bTime) && !Number.isNaN(sTime)) {
                    durationDays = Math.max(0, (sTime - bTime) / 86400000);
                  }
                }

                // 3. Resolve Fees & Commissions
                const fees = Number(rowFees ?? 0);

                // 4. Resolve Net Profit
                const netProfit = rowProfit === null ? null : Number(rowProfit ?? 0);

                const isPositive = (netProfit ?? 0) >= 0;
                const sign = isPositive ? '+' : '-';

                return (
                  <tr key={(trade as any).id || (source + "-" + index)} class="hover:bg-slate-900/40 text-slate-300">
                    <td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker || "—"}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                      <span>{dateText}</span>
                      {closedDate && !Number.isNaN(closedDate.getTime()) ? (
                        <span class="mt-0.5 block text-[10px] text-slate-500" title={dateText}>
                          {formatRelativeTime(closedDate)}
                        </span>
                      ) : null}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      {(trade as any).shares ?? "—"}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-400">
                      {durationDays === null ? '—' : durationDays < 1 ? Math.round(durationDays * 24) + ' hrs' : durationDays.toFixed(1) + ' days'}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      ${formatUSD(fees)}
                    </td>
                    <td
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {netProfit === null ? "—" : sign + "$" + formatUSD(Math.abs(netProfit))}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap">{source === "app" ? <button type="button" onClick={() => handleDelete(index)} class="rounded border border-slate-700 px-2 py-1 text-[10px]">Delete</button> : <span class="text-[10px] text-slate-600">Read-only</span>}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}