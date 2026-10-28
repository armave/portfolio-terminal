import { useEffect, useRef, useState } from 'preact/hooks';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';
import { pullCloudHistory, pushCloudHistory } from '../services/api';
import { loadSavedHistory } from '../services/storage';
import { applyCashflowAllocationsToBrokerExecutions, applyCashflowAllocationsToClosedTrades, deduplicateClosedHistoryRows } from '../domain/closedHistoryFees';

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
  const [tradesPage, setTradesPage] = useState(1);
  const lastRecalculationKey = useRef('');
  const historyHydrated = useRef(false);
  // Load cloud history once. An imported workbook is a complete snapshot: do not
  // union it with an older cloud workbook, which can resurrect stale rows.
  useEffect(() => {
    let active = true;
    void pullCloudHistory().then(async history => {
      if (!active) return;
      const current = portfolioStore.getState();
      const saved = loadSavedHistory();
      const localCashflows = current.cashflows?.length ? current.cashflows : saved.cashflows;
      const localExecutions = current.brokerExecutedTrades?.length ? current.brokerExecutedTrades : saved.brokerExecutedTrades;
      const cloud = history || { brokerExecutedTrades: [], cashflows: [] };
      historyHydrated.current = true;
      // Once the dedicated cloud history record exists, it is authoritative.
      // Prefer local snapshots only when the cloud record is absent; otherwise
      // stale local copies cause an immediate second POST after migration/load.
      const localExecutionsById = new Map<string, any>(localExecutions
        .filter((trade: any) => trade?.id != null && String(trade.id) !== '')
        .map((trade: any) => [String(trade.id), trade] as [string, any]));
      const cloudExecutions = (cloud.brokerExecutedTrades || []).map((trade: any) => {
        const local = trade?.id == null ? undefined : localExecutionsById.get(String(trade.id));
        if (!local) return trade;
        const merged = { ...trade };
        // Fee allocations are computed client-side and can be missing from an
        // older cloud snapshot. Do not discard a locally persisted calculation
        // just because navigating through Balance triggered a cloud reload.
        for (const field of ['marginFeeAllocations', 'marginFee', 'feesAndCommissions', 'netProfit']) {
          if (local[field] !== undefined && local[field] !== null) merged[field] = local[field];
        }
        return merged;
      });
      const resolved = history ? {
        brokerExecutedTrades: cloudExecutions,
        cashflows: cloud.cashflows || []
      } : {
        brokerExecutedTrades: localExecutions,
        cashflows: localCashflows
      };
      portfolioStore.setState(resolved);
      if (JSON.stringify(resolved) !== JSON.stringify(cloud) && (resolved.brokerExecutedTrades.length || resolved.cashflows.length)) {
        try { await pushCloudHistory(resolved); }
        catch (error) { console.error('Unable to sync closed history:', error); }
      }
    }).catch(error => {
      console.error('Unable to load closed history from cloud:', error);
      if (active) {
        const current = portfolioStore.getState();
        const saved = loadSavedHistory();
        portfolioStore.setState({
          brokerExecutedTrades: current.brokerExecutedTrades?.length ? current.brokerExecutedTrades : saved.brokerExecutedTrades,
          cashflows: current.cashflows?.length ? current.cashflows : saved.cashflows
        });
      }
    });
    return () => { active = false; };
  }, []);
  // Recalculate once per distinct input snapshot, not whenever the import's own
  // loading flag toggles. This prevents the calculation effect from re-entering.
  useEffect(() => {
    const cashflows = state.cashflows || [];
    if (brokerTradesLoading || !cashflows.length) return;
    const storedExecutions = portfolioStore.getState().brokerExecutedTrades || [];
    const executions = storedExecutions.length ? storedExecutions : brokerTrades;
    // Exclude calculated metadata from the input fingerprint; otherwise a
    // successful allocation changes its own key and triggers another pass.
    const calculatedFields = new Set(['marginFeeAllocations', 'marginFee', 'feesAndCommissions', 'netProfit']);
    const sourceExecutions = executions.map((trade: any) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) => !calculatedFields.has(field)))
    );
    const key = JSON.stringify({ cashflows, executions: sourceExecutions });
    if (key === lastRecalculationKey.current) return;
    void handleImportCashflows(null, cashflows).then((success) => {
      if (success) lastRecalculationKey.current = key;
    });
  }, [brokerTradesLoading, state.cashflows, state.brokerExecutedTrades, brokerTrades]);
  const handleImportCashflows = async (file: File | null, savedRows?: any[]) => {
    const showImportMessage = !savedRows;
    setCashflowImporting(true);
    if (showImportMessage) setCashflowImportMessage('');
    try {
      if (!savedRows && (!file || !file.name.toLowerCase().endsWith('.xlsx'))) throw new Error('Please select an Excel .xlsx file.');
      const rows = savedRows ?? normalizeCashflowRows(await readXlsxRows(await file!.arrayBuffer()));
      const imported = savedRows ? savedRows as ReturnType<typeof normalizeCashflowRows> : rows as ReturnType<typeof normalizeCashflowRows>;
      if (!imported.length) throw new Error('No cashflow rows were found in this workbook.');

      // Persist normalized cashflow rows as the source of truth. This lets the
      // application re-run allocations after refresh without requiring the file again.
      const feeRows = imported.filter(item => {
        const text = [item.type, item.description, ...Object.values(item.raw)].join(' ').toLowerCase();
        // Exports commonly label the direction in a separate "Direction" column,
        // while the "Operation №" column is only an ID. Inspect every cell so
        // daily negative-cash fees are not missed due to column selection.
        const isDailyFinancingFee = /negative\s+cash\s+balance\s+fee|fee\s+for\s+negative\s+cash\s+balance|margin\s+(?:fee|interest)|(?:daily\s+)?(?:margin|financing|overnight|rollover|borrow(?:ing)?)\s+(?:fee|charge|interest)|interest\s+(?:fee|charge)/i.test(text);
        const isTradeCommission = /trading\s+fee|commission\s+for\s+trade/i.test(text);
        return isDailyFinancingFee && !isTradeCommission;
      });
      const storedBrokerExecutions = portfolioStore.getState().brokerExecutedTrades || [];
      // An empty canonical array is truthy but does not mean broker history is unavailable.
      // Fall back to the loaded table data so cashflow allocation still reaches visible rows.
      const brokerExecutions = [...(storedBrokerExecutions.length ? storedBrokerExecutions : brokerTrades)] as any[];
      const executions = brokerExecutions.map((trade, index) => ({ trade, index, time: Date.parse(String(trade.executedAt ?? trade.date ?? '')), ticker: String(trade.ticker ?? '').trim().toUpperCase(), side: String(trade.side ?? '').toLowerCase(), quantity: Math.abs(Number(trade.quantity ?? trade.shares ?? 0)), price: Math.abs(Number(trade.price ?? trade.executionPrice ?? 0)) })).filter(row => row.ticker && Number.isFinite(row.time) && row.quantity > 0).sort((a, b) => a.time - b.time);
      const segments: Array<{ sellIndex: number; buyDate: number; sellDate: number; quantity: number; buyPrice: number }> = [];
      const queues = new Map<string, Array<{ date: number; quantity: number; price: number }>>();
      for (const execution of executions) {
        if (['buy', 'b', 'purchase', 'bought', '1'].includes(execution.side)) {
          const queue = queues.get(execution.ticker) || [];
          queue.push({ date: execution.time, quantity: execution.quantity, price: execution.price }); queues.set(execution.ticker, queue);
        } else if (['sell', 's', 'sale', 'sold', '2'].includes(execution.side)) {
          const queue = queues.get(execution.ticker) || []; let remaining = execution.quantity;
          while (remaining > 1e-8 && queue.length) {
            const lot = queue[0], quantity = Math.min(remaining, lot.quantity);
            segments.push({ sellIndex: execution.index, buyDate: lot.date, sellDate: execution.time, quantity, buyPrice: lot.price });
            remaining -= quantity; lot.quantity -= quantity; if (lot.quantity <= 1e-8) queue.shift();
          }
        }
      }
      const appTrades = [...(state.closedTrades || [])] as any[];
      const parseTradeDate = (value: unknown): number => {
        if (typeof value === 'number' || (typeof value === 'string' && /^\d{4,6}(\.\d+)?$/.test(value.trim()))) {
          const serial = Number(value); if (serial > 20000 && serial < 100000) return Date.UTC(1899, 11, 30) + serial * 86400000;
        }
        const text = String(value ?? '').trim(); if (!text) return NaN;
        const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
        const dmy = text.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
        if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? Date.UTC(new Date(parsed).getUTCFullYear(), new Date(parsed).getUTCMonth(), new Date(parsed).getUTCDate()) : NaN;
      };
      const feeDate = (fee: typeof imported[number]) => {
        const parsed = parseTradeDate(fee.date); if (Number.isFinite(parsed)) return parsed;
        const match = [fee.description, ...Object.values(fee.raw)].join(' ').match(/balance as at (\d{4}-\d{2}-\d{2})/i);
        return match ? parseTradeDate(match[1]) : NaN;
      };
      const allocationsBySell = new Map<number, Record<string, number>>();
      let allocatedDailyFees = 0, matchedFeeRows = 0;
      for (const fee of feeRows) {
        const date = feeDate(fee), amount = Math.abs(fee.amount); if (!Number.isFinite(date) || amount <= 0) continue;
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
      const updatedExecutions = applyCashflowAllocationsToBrokerExecutions(brokerExecutions, allocationsBySell);
      let updatedTradeCount = updatedExecutions.filter((trade, index) => trade !== brokerExecutions[index]).length;
      // Use one authoritative trade source per recalculation. When broker
      // executions exist they drive FIFO matching and fee allocation; applying
      // the same daily cashflow rows independently to app trades would allocate
      // each fee twice across two representations of the portfolio.
      const appAllocations = new Map<number, number>();
      let appAllocatedDailyFees = 0, appMatchedFeeRows = 0;
      if (!brokerExecutions.length) {
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
          appAllocatedDailyFees += amount;
          appMatchedFeeRows++;
        }
      }
      const updatedTrades = applyCashflowAllocationsToClosedTrades(appTrades, appAllocations);
      const changedBrokerRows = updatedExecutions.filter((trade, index) => trade !== brokerExecutions[index]).length;
      const changedAppRows = updatedTrades.filter((trade, index) => trade !== appTrades[index]).length;
      updatedTradeCount = changedBrokerRows + changedAppRows;
      const currentCashflows = portfolioStore.getState().cashflows || [];
      const cashflowsChanged = JSON.stringify(currentCashflows) !== JSON.stringify(imported);
      // Persist the uploaded source rows even when no fee date overlaps a closed
      // trade yet. A later broker refresh can then retry allocation from the store.
      const nextState: Record<string, unknown> = {};
      if (cashflowsChanged) nextState.cashflows = imported;
      // Compare the complete recalculated records before writing. This prevents
      // repeated post-load recalculation from causing redundant Worker syncs.
      if (changedBrokerRows && JSON.stringify(brokerExecutions) !== JSON.stringify(updatedExecutions)) {
        nextState.brokerExecutedTrades = updatedExecutions;
      }
      if (changedAppRows && JSON.stringify(appTrades) !== JSON.stringify(updatedTrades)) {
        nextState.closedTrades = updatedTrades;
      }
      if (Object.keys(nextState).length) portfolioStore.setState(nextState);
      // The closed-history collection lives in its own cloud record; saving the
      // portfolio snapshot alone does not upload updated fee allocations. Without
      // this write, the next section mount reloads stale cloud executions over the
      // freshly recalculated local rows.
      const brokerExecutionsChanged = brokerExecutions.length > 0 &&
        JSON.stringify(brokerExecutions) !== JSON.stringify(updatedExecutions);
      // Sync the history record when either source cashflows or calculated
      // execution metadata changes. A cashflow-only update must not be left in
      // local state while the cloud record retains an older, partial workbook.
      if (cashflowsChanged || brokerExecutionsChanged) {
        try {
          const synced = await pushCloudHistory({
            brokerExecutedTrades: brokerExecutionsChanged ? updatedExecutions : brokerExecutions,
            cashflows: imported
          });
          if (!synced) throw new Error('Cloud history did not confirm the update.');
        } catch (error) {
          console.error('Failed to sync closed-history cashflows and fees:', error);
          if (showImportMessage) {
            setCashflowImportMessage(`History was updated locally, but cloud sync failed: ${error instanceof Error ? error.message : 'unknown sync error'}. Retry the import before navigating away.`);
            return;
          }
        }
      }
      if (!updatedTradeCount && (matchedFeeRows > 0 || appMatchedFeeRows > 0)) {
        if (showImportMessage) {
          const matchedForMessage = brokerExecutions.length ? matchedFeeRows : appMatchedFeeRows;
          setCashflowImportMessage(`Saved ${imported.length} cashflow rows; ${matchedForMessage} fee dates matched closed trades, and existing allocations were already current. No trade rows needed updating.`);
        }
        return true;
      }
      if (!updatedTradeCount) {
        const validTradeDates = brokerExecutions.filter(trade => Number.isFinite(Date.parse(String(trade.executedAt ?? trade.date ?? '')))).length;
        const validFeeDates = feeRows.filter(fee => Number.isFinite(feeDate(fee))).length;
        const feeRange = feeRows.map(fee => feeDate(fee)).filter(Number.isFinite);
        const tradeRange = executions.map(row => row.time).filter(Number.isFinite);
        const feeSpan = feeRange.length ? new Date(Math.min(...feeRange)).toISOString().slice(0, 10) + '–' + new Date(Math.max(...feeRange)).toISOString().slice(0, 10) : 'unparseable';
        const tradeSpan = tradeRange.length ? new Date(Math.min(...tradeRange)).toISOString().slice(0, 10) + '–' + new Date(Math.max(...tradeRange)).toISOString().slice(0, 10) : 'unparseable';
        if (showImportMessage) setCashflowImportMessage(`Saved ${imported.length} workbook rows; detected ${feeRows.length} daily margin-fee rows (${validFeeDates} with valid dates; ${feeSpan}), but none overlapped ${segments.length} FIFO-matched closed trade segments from ${validTradeDates} dated broker executions (${tradeSpan}). Cashflow data is saved; check the date ranges and broker execution data to allocate fees.`);
        return true;
      }
      if (brokerExecutions.length) setBrokerTrades(updatedExecutions);
      const allocatedForMessage = brokerExecutions.length ? allocatedDailyFees : appAllocatedDailyFees;
      const matchedForMessage = brokerExecutions.length ? matchedFeeRows : appMatchedFeeRows;
      if (showImportMessage) setCashflowImportMessage(`Saved ${imported.length} cashflow rows; allocated ${allocatedForMessage.toFixed(2)} USD of daily negative-cash fees across ${updatedTradeCount} changed closed-trade rows (${matchedForMessage} fee dates matched). Saved rows can be reused after refresh.`);
      return true;
    } catch (error) {
      if (showImportMessage) setCashflowImportMessage(error instanceof Error ? error.message : 'Cashflow import failed.');
      return false;
    } finally {
      setCashflowImporting(false);
    }
  };
  useEffect(() => {
    const persistBrokerTrades = (trades: any[]) => {
      const stored = portfolioStore.getState().brokerExecutedTrades || [];
      const storedById = new Map<string, any>(stored.map((trade: any) => [String(trade.id ?? ''), trade] as [string, any]));
      const normalized = trades.map((trade: any) => {
        const previous = storedById.get(String(trade.id ?? ''));
        // Keep only the fields needed for closed-history rendering and fee matching.
        // TradeNet's raw response can be large and must not be copied into synced state.
        const compact = {
          id: String(trade?.id ?? ''),
          ticker: String(trade?.ticker ?? ''),
          side: String(trade?.side ?? ''),
          quantity: trade?.quantity ?? null,
          price: trade?.price ?? null,
          currency: String(trade?.currency ?? ''),
          executedAt: trade?.executedAt ?? null,
          tradeValue: trade?.tradeValue ?? null,
          profit: trade?.profit ?? null,
          marginFee: previous?.marginFee ?? trade?.marginFee ?? null,
          commission: trade?.commission ?? null,
          commissionCurrency: String(trade?.commissionCurrency ?? ''),
          // Cashflow-upload calculations are local persisted metadata, not fields
          // returned by the broker API. Preserve them when fresh executions arrive.
          marginFeeAllocations: previous?.marginFeeAllocations ?? trade?.marginFeeAllocations,
          feesAndCommissions: previous?.feesAndCommissions ?? trade?.feesAndCommissions,
          netProfit: previous?.netProfit ?? trade?.netProfit
        };
        return compact;
      });
      setBrokerTrades(normalized);
      setBrokerTradesLoading(false);
      setBrokerTradesError(false);
      // Persist the normalized source rows in canonical state so they survive
      // refresh and can be reapplied after broker history has hydrated.
      const current = portfolioStore.getState().brokerExecutedTrades || [];
      // Compare the complete normalized execution history, not a subset of
      // display fields. Incoming closed-trade metadata must sync just like cashflows.
      const fingerprint = (rows: any[]) => JSON.stringify(rows);
      if (fingerprint(current) !== fingerprint(normalized)) {
        portfolioStore.setState({ brokerExecutedTrades: normalized.map((trade) => ({ ...trade })) });
        // Sync only when the authoritative broker history actually changes, and
        // only after initial cloud hydration. Initial reconciliation is handled by
        // the load effect above so it doesn't race a second save against that pull.
        if (historyHydrated.current) {
          void pushCloudHistory({
            brokerExecutedTrades: normalized,
            cashflows: portfolioStore.getState().cashflows || []
          }).catch(error => console.error('Unable to sync updated broker history:', error));
        }
      }
    };
    const readCurrentTrades = () => {
      const current = (window as any).__tradenetExecutedTrades;
      if (Array.isArray(current)) persistBrokerTrades(current);
      else {
        const saved = portfolioStore.getState().brokerExecutedTrades;
        if (Array.isArray(saved) && saved.length) {
          setBrokerTrades(saved);
          setBrokerTradesLoading(false);
          setBrokerTradesError(false);
        }
      }
    };
    const onTrades = (event: Event) => {
      const trades = (event as CustomEvent).detail;
      if (Array.isArray(trades)) persistBrokerTrades(trades);
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
  const appTrades = (state.closedTrades || []).map((trade, index) => {
    // Never use feesAndCommissions as a commission fallback: that aggregate may already include margin fees, which are displayed separately below.
    const commissions = Number((trade as any).commissions ?? (trade as any).totalCommissions ?? (trade as any).commission ?? 0);
    const fees = Number((trade as any).marginFee ?? (trade as any).marginInterest ?? 0);
    return {
      trade: { ...(trade as any), source: 'app' as const }, index, source: 'app' as const,
      profit: Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0),
      fees, commissions, feesTotal: fees + commissions
    };
  });
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
  const brokerRows = brokerTrades.filter((broker: any) => ['sell', 's', 'sale', 'sold', '2'].includes(String(broker.side ?? '').toLowerCase())).map((broker: any, index) => {
    const allocatedMarginFee = Object.values((broker.marginFeeAllocations || {}) as Record<string, number>)
      .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    // Prefer the explicit allocation total when present, so the table reflects the
    // uploaded cashflows even if an older cached marginFee field is missing/stale.
    const marginFee = Number((broker.marginFeeAllocations && typeof broker.marginFeeAllocations === 'object')
      ? allocatedMarginFee
      : broker.marginFee ?? 0) || 0;
    const tradeFees = (broker.commission == null ? 0 : Math.abs(Number(broker.commission))) + (brokerTradeMetrics.get(broker)?.buyCommission ?? 0);
    const commissions = Number(tradeFees.toFixed(2));
    const fees = Number(Math.abs(marginFee).toFixed(2));
    const totalFees = Number((commissions + fees).toFixed(2));
    return {
      trade: { id: broker.id ?? ('tradenet-' + index), ticker: broker.ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: brokerTradeMetrics.get(broker)?.holdingDays, feesAndCommissions: totalFees, netProfit: broker.profit == null ? null : Number(broker.profit) - totalFees, side: broker.side, price: broker.price, source: 'tradenet' as const },
      index: -1,
      source: 'tradenet' as const,
      // Calculate from raw realized profit and the complete fee total, rather than
      // relying on cached netProfit values that may predate cashflow allocation.
      profit: broker.profit == null ? null : Number(broker.profit) - totalFees,
      fees,
      commissions,
      feesTotal: totalFees
    };
  });
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
        const oldDuration = (previous.trade as any).holdingDays;
        const newDuration = (row.trade as any).holdingDays;
        const totalQty = oldQty + newQty;
        (previous.trade as any).shares = totalQty;
        (previous.trade as any).exitDate = (row.trade as any).exitDate;
        (previous.trade as any).sellDate = (row.trade as any).exitDate;
        (previous.trade as any).id = String((previous.trade as any).id) + '+' + String((row.trade as any).id);
        (previous.trade as any).holdingDays = oldDuration != null && newDuration != null && totalQty > 0 ? (Number(oldDuration) * oldQty + Number(newDuration) * newQty) / totalQty : oldDuration ?? newDuration;
        previous.profit = oldProfit == null || newProfit == null ? null : oldProfit + newProfit;
        previous.fees = (previous.fees || 0) + (row.fees || 0);
        previous.commissions = (previous.commissions || 0) + (row.commissions || 0);
        previous.feesTotal = (previous.feesTotal || 0) + (row.feesTotal || 0);
        (previous.trade as any).price = totalQty > 0 ? (Number((previous.trade as any).price ?? 0) * oldQty + Number((row.trade as any).price ?? 0) * newQty) / totalQty : (row.trade as any).price;
      } else {
        groups.push({ ...row, trade: { ...(row.trade as any) } });
      }
    }
    return groups;
  })();
  // Broker executions are the canonical display source when the same sale
  // also exists as an app-owned closed trade.
  const uniqueAppTrades = deduplicateClosedHistoryRows(appTrades, groupedBrokerRows);
  const trades = [...uniqueAppTrades, ...groupedBrokerRows].sort((a, b) => String((b.trade as any).exitDate ?? (b.trade as any).sellDate ?? '').localeCompare(String((a.trade as any).exitDate ?? (a.trade as any).sellDate ?? '')));
  const tradesPageSize = 10;
  const tradesPageCount = Math.max(1, Math.ceil(trades.length / tradesPageSize));
  const visibleTrades = trades.slice((tradesPage - 1) * tradesPageSize, tradesPage * tradesPageSize);
  useEffect(() => {
    if (tradesPage > tradesPageCount) setTradesPage(tradesPageCount);
  }, [tradesPage, tradesPageCount]);
  const realizedNet = trades.reduce((total, row) => total + (row.profit ?? 0), 0);
  const totalFees = trades.reduce((total, row) => total + (Number.isFinite(row.feesTotal) ? row.feesTotal : ((row.fees || 0) + (row.commissions || 0))), 0);
  const profitKnownTrades = trades.filter((row) => row.profit !== null);
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades.map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld)).filter((days) => Number.isFinite(days) && days >= 0);
  const averageHoldingDays = knownDurations.length ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length : null;
  const winRate = profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0;

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
            {trades.length} records
          </div>
        </div>
      </div>

      {cashflowImportMessage && <p role="status" class="animate-in fade-in slide-in-from-top-2 duration-200 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 transition-all">{cashflowImportMessage}</p>}
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
              <th class="py-2.5 px-3 text-right">Fees</th>
              <th class="py-2.5 px-3 text-right">Commissions</th>
              <th class="py-2.5 px-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60">
            {brokerTradesLoading && brokerTrades.length === 0 ? (
              <tr><td colSpan={7} class="py-8 text-center text-slate-400">
                <span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-purple-400" aria-hidden="true" />Loading closed trade history…</span>
              </td></tr>
            ) : brokerTradesError && trades.length === 0 ? (
              <tr><td colSpan={7} class="py-8 text-center text-rose-400">Unable to load TradeNet history. Please retry.</td></tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={7} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              visibleTrades.map(({ trade, index, source, profit: rowProfit, fees: rowFees, commissions: rowCommissions }) => {
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
                      year: '2-digit'
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
                    <td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker?.replace('.US', '') || "—"}</td>
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
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      ${formatUSD(Number(rowCommissions ?? 0))}
                    </td>
                    <td
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {netProfit === null ? "—" : sign + "$" + formatUSD(Math.abs(netProfit))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {trades.length > 0 && (
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 px-1 pt-3 text-xs" aria-label="Closed history pagination">
          <span class="text-slate-500" aria-live="polite">
            Showing {(tradesPage - 1) * tradesPageSize + 1}–{Math.min(tradesPage * tradesPageSize, trades.length)} of {trades.length} trades
          </span>
          <div class="flex items-center gap-2">
            <button type="button" onClick={() => setTradesPage(page => Math.max(1, page - 1))} disabled={tradesPage <= 1} class="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Previous closed history page">Previous</button>
            <span class="min-w-16 text-center font-mono text-slate-400">Page {tradesPage} / {tradesPageCount}</span>
            <button type="button" onClick={() => setTradesPage(page => Math.min(tradesPageCount, page + 1))} disabled={tradesPage >= tradesPageCount} class="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Next closed history page">Next</button>
          </div>
        </div>
      )}
    </section>
  );
}