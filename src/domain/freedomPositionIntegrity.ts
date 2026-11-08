import type {
  BrokerPositionIntegrityIssue,
  BrokerPositionIntegrityIssueCode
} from '../types/broker';

interface PositionIntegrityRow {
  ticker?: unknown;
  quantity?: unknown;
  direction?: unknown;
  rawQuantity?: unknown;
  rawSide?: unknown;
  instrumentId?: unknown;
  raw?: Record<string, unknown>;
}

interface PositionIntegritySnapshot {
  positions?: readonly PositionIntegrityRow[];
}

interface PositionIntegrityTrade {
  ticker?: unknown;
  side?: unknown;
  quantity?: unknown;
  qty?: unknown;
  executedAt?: unknown;
  date?: unknown;
  time?: unknown;
  raw?: Record<string, unknown>;
}

function tickerKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function finiteQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedTradeSide(value: unknown): 'buy' | 'sell' | 'short' | 'cover' | null {
  const side = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (side === 'BUY' || side === 'BOUGHT' || side === 'PURCHASE') return 'buy';
  if (side === 'SELL' || side === 'SOLD' || side === 'SALE') return 'sell';
  if (side === 'SELL_SHORT' || side === 'SHORT_SELL' || side === 'SHORT') return 'short';
  if (side === 'BUY_TO_COVER' || side === 'COVER' || side === 'COVER_SHORT') return 'cover';
  return null;
}

function timestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = finiteQuantity(value);
  if (numeric !== null && numeric > 0) return numeric < 1e11 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function issue(
  ticker: string,
  code: BrokerPositionIntegrityIssueCode,
  source: BrokerPositionIntegrityIssue['source'],
  details: { rawQuantity?: number | null; rawSide?: string | number | null; instrumentId?: string | null; raw?: Record<string, unknown> } = {}
): BrokerPositionIntegrityIssue {
  return { ticker, code, source, ...details };
}

/**
 * Fail-closed checks for the app's current long-only position ledger.
 * This function does not infer broker short-side numeric codes or manufacture
 * signed exposure. It returns evidence that must remain visible until the
 * provider's position semantics and the relevant execution history are verified.
 */
export function collectFreedomPositionIntegrityIssues(
  snapshot: PositionIntegritySnapshot,
  trades?: readonly PositionIntegrityTrade[]
): BrokerPositionIntegrityIssue[] {
  const findings: BrokerPositionIntegrityIssue[] = [];

  (Array.isArray(snapshot?.positions) ? snapshot.positions : []).forEach((position, index) => {
    const ticker = tickerKey(position?.ticker);
    const quantity = finiteQuantity(position?.quantity);
    const rawQuantity = finiteQuantity(position?.rawQuantity) ?? quantity;
    const rawSideValue = position?.rawSide ??
      position?.raw?.position_side ??
      position?.raw?.positionSide ??
      position?.raw?.pos_side ??
      position?.raw?.posSide ??
      position?.raw?.position_direction ??
      position?.raw?.positionDirection ??
      position?.raw?.side ??
      position?.raw?.direction;
    const rawSide = typeof rawSideValue === 'string' || typeof rawSideValue === 'number'
      ? rawSideValue
      : null;
    const instrumentIdValue = position?.instrumentId ??
      position?.raw?.instrument_id ??
      position?.raw?.instrumentId ??
      position?.raw?.instr_id ??
      position?.raw?.security_id ??
      position?.raw?.isin ??
      position?.raw?.figi;
    const instrumentId = instrumentIdValue === null || instrumentIdValue === undefined
      ? null
      : String(instrumentIdValue);

    if (!ticker || quantity === null) {
      findings.push(issue(ticker || `ROW ${index + 1}`, 'invalid_broker_position', 'account_snapshot', {
        rawQuantity,
        rawSide,
        instrumentId,
        ...(position?.raw ? { raw: position.raw } : {})
      }));
      return;
    }
    if (quantity === 0) return;

    const direction = String(position?.direction ?? '').trim().toLowerCase();
    const rawSideText = typeof rawSide === 'string' ? rawSide.trim().toLowerCase() : '';
    if (quantity < 0 || (rawQuantity !== null && rawQuantity < 0)) {
      findings.push(issue(ticker, 'negative_quantity_sign_unverified', 'account_snapshot', {
        rawQuantity,
        rawSide,
        instrumentId
      }));
    } else if (direction === 'short' || rawSideText === 'short') {
      findings.push(issue(ticker, 'short_position_side_unverified', 'account_snapshot', {
        rawQuantity,
        rawSide,
        instrumentId
      }));
    } else if (direction === 'unknown' || (rawSide !== null && rawSideText !== 'long')) {
      findings.push(issue(ticker, 'unrecognized_position_side', 'account_snapshot', {
        rawQuantity,
        rawSide,
        instrumentId
      }));
    }
  });

  if (!Array.isArray(trades)) return deduplicate(findings);

  const ordered = trades.map((trade, index) => {
    const raw = trade?.raw && typeof trade.raw === 'object' ? trade.raw : {};
    const sideValue = trade?.side ?? raw.side ?? raw.operation ?? raw.oper ?? raw.buy_sell ?? raw.type;
    const quantity = finiteQuantity(trade?.quantity ?? trade?.qty ?? raw.q ?? raw.quantity ?? raw.qty);
    const ticker = tickerKey(trade?.ticker ?? raw.instr_nm ?? raw.i ?? raw.symbol ?? raw.ticker);
    const at = timestamp(trade?.executedAt ?? trade?.date ?? trade?.time ?? raw.date ?? raw.time ?? raw.datetime ?? raw.exec_time);
    return { index, ticker, side: normalizedTradeSide(sideValue), rawSide: typeof sideValue === 'string' || typeof sideValue === 'number' ? sideValue : null, quantity, at };
  }).filter(item => item.ticker).sort((a, b) =>
    (a.at ?? 0) - (b.at ?? 0) || a.index - b.index
  );

  const openLongQuantity = new Map<string, number>();
  for (const item of ordered) {
    if (item.side === 'short') {
      findings.push(issue(item.ticker, 'short_execution_unsupported', 'execution_history', {
        rawQuantity: item.quantity,
        rawSide: item.rawSide
      }));
      continue;
    }
    if (item.side === 'cover') {
      findings.push(issue(item.ticker, 'short_cover_unsupported', 'execution_history', {
        rawQuantity: item.quantity,
        rawSide: item.rawSide
      }));
      continue;
    }
    if (item.side === null || item.quantity === null || item.quantity <= 0) {
      findings.push(issue(item.ticker, 'unknown_execution_side', 'execution_history', {
        rawQuantity: item.quantity,
        rawSide: item.rawSide
      }));
      continue;
    }
    if (item.side === 'buy') {
      openLongQuantity.set(item.ticker, (openLongQuantity.get(item.ticker) || 0) + item.quantity);
      continue;
    }

    const available = openLongQuantity.get(item.ticker) || 0;
    const consumed = Math.min(available, item.quantity);
    openLongQuantity.set(item.ticker, Math.max(0, available - consumed));
    if (item.quantity - consumed > 1e-8) {
      findings.push(issue(item.ticker, 'unmatched_sell_quantity', 'execution_history', {
        rawQuantity: item.quantity,
        rawSide: item.rawSide
      }));
    }
  }

  return deduplicate(findings);
}

function deduplicate(findings: BrokerPositionIntegrityIssue[]): BrokerPositionIntegrityIssue[] {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.ticker}|${finding.code}|${finding.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
