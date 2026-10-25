import { useEffect, useState } from 'preact/hooks';
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
  const typeIdx = headers.findIndex(header => /type|direction|operation|kind|description|comment|details|назначение|операц|тип|описан|մեկնաբան|գործարք/.test(header.replace(/[ _-]+/g, '')));
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
      const feeRows = imported.filter(item => {
        const text = [item.type, item.description, ...Object.values(item.raw)].join(' ').toLowerCase();
        // Exports commonly label the direction in a separate "Direction" column,
        // while the "Operation №" column is only an ID. Inspect every cell so
        // daily negative-cash fees are not missed due to column selection.
        const isDailyFinancingFee = /negative\s+cash\s+balance\s+fee|fee\s+for\s+negative\s+cash\s+balance|margin\s+(?:fee|interest)|(?:daily\s+)?(?:margin|financing|overnight|rollover|borrow(?:ing)?)\s+(?:fee|charge|interest)|interest\s+(?:fee|charge)/i.test(text);
        const isTradeCommission = /trading\s+fee|commission\s+for\s+trade/i.test(text);
        return isDailyFinancingFee && !isTradeCommission;
      });
      const brokerExecutions = [...(portfolioStore.getState().brokerExecutedTrades || brokerTrades)] as any[];
      const executions = brokerExecutions.map((trade, index) => ({ trade, index, time: Date.parse(String(trade.executedAt ?? trade.date ?? '')), ticker: String(trade.ticker ?? '').trim().toUpperCase(), side: String(trade.side ?? '').toLowerCase(), quantity: Math.abs(Number(trade.quantity ?? trade.shares ?? 0)), price: Math.abs(Number(trade.price ?? trade.executionPrice ?? 0)) })).filter(row => row.ticker && Number.isFinite(row.time) && row.quantity > 0).sort((a, b) => a.time - b.time);
      const segments: Array<{ sellIndex: number; buyDate: number; sellDate: number; quantity: number; buyPrice: number }> = [];
      const queues = new Map<string, Array<{ date: number; quantity: number; price: number }>>();
      for (const execution of executions) {
        if (['buy', 'b', 'purchase', 'bought', '1'].includes(execution.side)) {
          const queue = queues.get(execution.ticker) || [];
          queue.push({ date: execution.time, quantity: execution.quantity, price: execution.price });
          queues.set(execution.ticker, queue);
        } else if (['sell', 's', 'sale', 'sold', '2'].includes(execution.side)) {
          const queue = queues.get(execution.ticker) || [];
          let remaining = execution.quantity;
          while (remaining > 1e-8 && queue.length) {
            const lot = queue[0], quantity = Math.min(remaining, lot.quantity);
            segments.push({ sellIndex: execution.index, buyDate: lot.date, sellDate: execution.time, quantity, buyPrice: lot.price });
            remaining -= quantity; lot.quantity -= quantity;
            if (lot.quantity <= 1e-8) queue.shift();
          }
        }
      }
      const appTrades = [...(state.closedTrades || [])] as any[];
      const parseTradeDate = (value: unknown): number => {
        if (typeof value === 'number' || (typeof value === 'string' && /^\\d{4,6}(\\.\\d+)?$/.test(value.trim()))) {
          const serial = Number(value);
          if (serial > 20000 && serial < 100000) return Date.UTC(1899, 11, 30) + serial * 86400000;
        }
        const text = String(value ?? '').trim();
        if (!text) return NaN;
        const us = text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
        if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
        const dmy = text.match(/^(\\d{1,2})[.-](\\d{1,2})[.-](\\d{4})$/);
        if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? Date.UTC(new Date(parsed).getUTCFullYear(), new Date(parsed).getUTCMonth(), new Date(parsed).getUTCDate()) : NaN;
      };
      const feeDate = (fee: typeof imported[number]) => {
        const parsed = parseTradeDate(fee.date);
        if (Number.isFinite(parsed)) return parsed;
        const match = [fee.description, ...Object.values(fee.raw)].join(' ').match(/balance as at (\\d{4}-\\d{2}-\\d{2})/i);
        return match ? parseTradeDate(match[1]) : NaN;
      };
      const allocationsBySell = new Map<number, Record<string, number>>();
      let allocatedDailyFees = 0, matchedFeeRows = 0;
      for (const fee of feeRows) {
        const date = feeDate(fee), amount = Math.abs(fee.amount);
        if (!Number.isFinite(date) || amount <= 0) continue;
        const open = segments.filter(segment => {
          const buyDay = Date.UTC(new Date(segment.buyDate).getUTCFullYear(), new Date(segment.buyDate).getUTCMonth(), new Date(segment.buyDate).getUTCDate());
          const sellDay = Date.UTC(new Date(segment.sellDate).getUTCFullYear(), new Date(segment.sellDate).getUTCMonth(), new Date(segment.sellDate).getUTCDate());
          return date >= buyDay && date <= sellDay && segment.quantity > 0 && segment.buyPrice > 0;
        });
        const totalWeight = open.reduce((sum, segment) => sum + segment.quantity * segment.buyPrice, 0);
        if (!open.length || totalWeight <= 0) continue;
        for (const segment of open) {
          const byFee = allocationsBySell.get(segment.sellIndex) || {};
          byFee[fee.id] = (byFee[fee.id] || 0) + amount * segment.quantity * segment.buyPrice / totalWeight;
          allocationsBySell.set(segment.sellIndex, byFee);
        }
        allocatedDailyFees += amount; matchedFeeRows++;
      }
      let updatedTradeCount = 0;
      const updatedExecutions = brokerExecutions.map((trade, index) => {
        if (!['sell', 's', 'sale', 'sold', '2'].includes(String(trade.side ?? '').toLowerCase())) return trade;
        const incoming = allocationsBySell.get(index);
        if (!incoming || !Object.keys(incoming).length) return trade;
        const persisted = { ...(trade.marginFeeAllocations || {}) } as Record<string, number>;
        Object.entries(incoming).forEach(([id, amount]) => { persisted[id] = Number(amount.toFixed(6)); });
        const marginFee = Number(Object.values(persisted).reduce((sum, amount) => sum + (Number(amount) || 0), 0).toFixed(2));
        updatedTradeCount++;
        return { ...trade, marginFeeAllocations: persisted, marginFee };
      });
      let updatedTrades = appTrades;
      if (!brokerExecutions.length) {
        const appAllocations = new Map<number, number>();
        for (const fee of feeRows) {
          const date = feeDate(fee), amount = Math.abs(fee.amount);
          if (!Number.isFinite(date) || amount <= 0) continue;
          const open = appTrades.map((trade, index) => {
            const sell = parseTradeDate(trade.sellDate ?? trade.exitDate ?? trade.closedAt ?? trade.date);
            const buy = parseTradeDate(trade.buyDate ?? trade.purchaseDate ?? trade.entryDate ?? trade.openDate);
            const shares = Math.abs(Number(trade.shares ?? trade.quantity ?? 0));
            const price = Math.abs(Number(trade.entryPrice ?? trade.avgBuyPrice ?? trade.buyPrice ?? 0));
            return { index, buy, sell, weight: shares * (price || 1) };
          }).filter(t => Number.isFinite(t.buy) && Number.isFinite(t.sell) && date >= t.buy && date <= t.sell && t.weight > 0);
          const totalWeight = open.reduce((sum, t) => sum + t.weight, 0);
          if (!open.length || totalWeight <= 0) continue;
          for (const position of open) appAllocations.set(position.index, (appAllocations.get(position.index) || 0) + amount * position.weight / totalWeight);
          allocatedDailyFees += amount; matchedFeeRows++;
        }
        updatedTrades = appTrades.map((trade, index) => {
          const addedFee = Number((appAllocations.get(index) || 0).toFixed(2));
          if (addedFee <= 0) return trade;
          updatedTradeCount++;
          const previousMargin = Math.abs(Number(trade.marginInterest ?? trade.marginFee ?? 0)) || 0;
          const previousFees = Number(trade.feesAndCommissions ?? trade.totalCommissions ?? trade.commissions ?? 0) || 0;
          const net = Number(trade.netProfit ?? trade.netRealizedGain ?? trade.grossProfit ?? 0) || 0;
          const fees = Number((Math.max(0, previousFees - previousMargin) + addedFee).toFixed(2));
          return { ...trade, feesAndCommissions: fees, totalCommissions: fees, marginInterest: addedFee, marginFee: addedFee, netProfit: Number((net + previousMargin - addedFee).toFixed(2)), netRealizedGain: Number((net + previousMargin - addedFee).toFixed(2)) };
        });
      }
      if (!updatedTradeCount) {
        const validTradeDates = brokerExecutions.filter(trade => Number.isFinite(Date.parse(String(trade.executedAt ?? trade.date ?? '')))).length;
        const validFeeDates = feeRows.filter(fee => Number.isFinite(feeDate(fee))).length;
        const feeRange = feeRows.map(fee => feeDate(fee)).filter(Number.isFinite);
        const tradeRange = executions.map(row => row.time).filter(Number.isFinite);
        const feeSpan = feeRange.length ? new Date(Math.min(...feeRange)).toISOString().slice(0, 10) + '–' + new Date(Math.max(...feeRange)).toISOString().slice(0, 10) : 'unparseable';
        const tradeSpan = tradeRange.length ? new Date(Math.min(...tradeRange)).toISOString().slice(0, 10) + '–' + new Date(Math.max(...tradeRange)).toISOString().slice(0, 10) : 'unparseable';
        setCashflowImportMessage(`Read ${imported.length} workbook rows; detected ${feeRows.length} daily margin-fee rows (${validFeeDates} with valid dates; ${feeSpan}), but none overlapped ${segments.length} FIFO-matched closed trade segments from ${validTradeDates} dated broker executions (${tradeSpan}). No state was changed. Check the date ranges and broker execution data.`);
        return;
      }
      portfolioStore.setState(brokerExecutions.length ? { brokerExecutedTrades: updatedExecutions } : { closedTrades: updatedTrades });
      setBrokerTrades(brokerExecutions.length ? updatedExecutions : brokerTrades);
      setCashflowImportMessage(`Read ${imported.length} workbook rows; allocated ${allocatedDailyFees.toFixed(2)} USD of daily negative-cash fees across ${updatedTradeCount} closed trade rows (${matchedFeeRows} fee dates matched). Allocation uses invested cost (shares × buy execution price). Workbook rows were not stored.`);
}