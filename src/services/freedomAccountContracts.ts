export interface FreedomActiveOrder {
  id: string;
  ticker: string;
  operation: number | null;
  orderType: number | null;
  limitPrice: number | null;
  remainingQuantity: number | null;
  date?: string | number | null;
  status: string;
  raw: Record<string, unknown>;
}

export interface FreedomCashBalance {
  currency: string;
  amount: number;
  forecastIn: number;
  forecastOut: number;
  t2In: number;
  t2Out: number;
}

export interface FreedomOpenPosition {
  ticker: string;
  name: string;
  quantity: number;
  currency: string;
  marketPrice: number | null;
  marketValue: number | null;
  averagePrice: number | null;
  profitClose: number | null;
  accountPositionId: number | null;
}

export interface FreedomPortfolioSnapshot {
  loaded: boolean;
  balances: FreedomCashBalance[];
  positions: FreedomOpenPosition[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== null && record[key] !== undefined) return record[key];
  }
  return undefined;
}

function textOr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalize active order aliases without trusting the provider's raw row shape. */
export function normalizeFreedomActiveOrders(response: unknown): FreedomActiveOrder[] {
  const envelope = asRecord(response);
  const data = asRecord(envelope?.data);
  const result = asRecord(data?.result);
  const root = Array.isArray(response)
    ? response
    : result ?? data ?? asRecord(envelope?.result) ?? envelope;
  if (!root) return [];

  const rootRecord = asRecord(root);
  const orders = asRecord(rootRecord?.orders);
  const rows = Array.isArray(root)
    ? root
    : Array.isArray(orders?.order) ? orders.order
      : Array.isArray(rootRecord?.orders) ? rootRecord.orders
        : Array.isArray(rootRecord?.items) ? rootRecord.items
          : Array.isArray(rootRecord?.data) ? rootRecord.data
            : [];

  return rows.flatMap((value, index): FreedomActiveOrder[] => {
    const row = asRecord(value);
    if (!row) return [];
    const idValue = readFirst(row, ['order_id', 'id', 'orderId']);
    const dateValue = readFirst(row, ['date', 'created_at', 'createdAt', 'created', 'time', 'timestamp']);
    return [{
      id: textOr(idValue, String(index)),
      ticker: textOr(readFirst(row, ['instr_nm', 'i', 'ticker', 'symbol', 'instr'])).trim().toUpperCase(),
      operation: numberOrNull(readFirst(row, ['oper', 'operation', 'open'])),
      orderType: numberOrNull(readFirst(row, ['type', 'order_type', 'orderType'])),
      limitPrice: numberOrNull(readFirst(row, ['p', 'price', 'limit_price', 'limitPrice'])),
      remainingQuantity: numberOrNull(readFirst(row, ['leaves_qty', 'remaining_qty', 'remainingQuantity', 'q', 'quantity'])),
      date: typeof dateValue === 'string' || (typeof dateValue === 'number' && Number.isFinite(dateValue))
        ? dateValue
        : null,
      status: textOr(readFirst(row, ['stat', 'status'])),
      raw: row
    }];
  });
}

interface FreedomPortfolioDifference {
  path: string;
  websocketValue: string | number | null;
  restValue: string | number | null;
  delta?: number;
}

export interface FreedomPortfolioComparison {
  matches: boolean;
  tolerance: number;
  websocket: { accounts: number; positions: number };
  rest: { accounts: number; positions: number };
  differenceCount: number;
  differences: FreedomPortfolioDifference[];
}

/**
 * Compare two broker snapshots after applying the app's existing USD-only
 * normalizer. This is a pure diagnostic: it never mutates portfolio state.
 */
export function compareFreedomPortfolioSnapshots(
  websocketResponse: unknown,
  restResponse: unknown,
  tolerance = 0.01
): FreedomPortfolioComparison {
  const websocket = normalizeFreedomPortfolio(websocketResponse);
  const rest = normalizeFreedomPortfolio(restResponse);
  const allowedTolerance = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0.01;
  const differences: FreedomPortfolioDifference[] = [];

  const addDifference = (difference: FreedomPortfolioDifference) => {
    if (differences.length < 100) differences.push(difference);
  };
  const compareValue = (
    path: string,
    websocketValue: string | number | null,
    restValue: string | number | null
  ) => {
    if (typeof websocketValue === 'number' && typeof restValue === 'number') {
      const delta = websocketValue - restValue;
      if (Math.abs(delta) > allowedTolerance) {
        addDifference({ path, websocketValue, restValue, delta });
      }
      return;
    }
    if (websocketValue !== restValue) {
      addDifference({ path, websocketValue, restValue });
    }
  };
  const compareRows = <T>(
    label: string,
    websocketRows: T[],
    restRows: T[],
    keyOf: (row: T, index: number) => string,
    fields: Array<keyof T>
  ) => {
    if (websocketRows.length !== restRows.length) {
      addDifference({
        path: `${label}.count`,
        websocketValue: websocketRows.length,
        restValue: restRows.length,
        delta: websocketRows.length - restRows.length
      });
    }
    const restByKey = new Map<string, T[]>();
    restRows.forEach((row, index) => {
      const key = keyOf(row, index);
      const values = restByKey.get(key) || [];
      values.push(row);
      restByKey.set(key, values);
    });
    const consumed = new Map<string, number>();
    websocketRows.forEach((row, index) => {
      const key = keyOf(row, index);
      const occurrence = consumed.get(key) || 0;
      consumed.set(key, occurrence + 1);
      const counterpart = restByKey.get(key)?.[occurrence];
      if (!counterpart) {
        addDifference({ path: `${label}[${key}].missing_in_rest`, websocketValue: "present", restValue: null });
        return;
      }
      fields.forEach((field) => {
        const websocketValue = row[field];
        const restValue = counterpart[field];
        if (
          websocketValue === null || typeof websocketValue === 'string' || typeof websocketValue === 'number'
        ) {
          if (restValue === null || typeof restValue === 'string' || typeof restValue === 'number') {
            compareValue(`${label}[${key}].${String(field)}`, websocketValue as string | number | null, restValue as string | number | null);
          }
        }
      });
    });
    restRows.forEach((row, index) => {
      const key = keyOf(row, index);
      const websocketCount = consumed.get(key) || 0;
      const restCount = (restByKey.get(key) || []).length;
      const alreadyReported = differences.some((difference) => difference.path === `${label}[${key}].missing_in_rest`);
      if (restCount > websocketCount && !alreadyReported) {
        addDifference({ path: `${label}[${key}].missing_in_websocket`, websocketValue: null, restValue: "present" });
      }
    });
  };

  compareRows(
    'balances',
    websocket.balances,
    rest.balances,
    (row, index) => `${row.currency}#${index}`,
    ['currency', 'amount', 'forecastIn', 'forecastOut', 't2In', 't2Out']
  );
  compareRows(
    'positions',
    websocket.positions,
    rest.positions,
    (row, index) => {
      const ticker = row.ticker.trim().toUpperCase();
      return ticker || `row#${index}`;
    },
    ['ticker', 'name', 'quantity', 'currency', 'marketPrice', 'marketValue', 'averagePrice', 'profitClose']
  );

  return {
    matches: differences.length === 0,
    tolerance: allowedTolerance,
    websocket: { accounts: websocket.balances.length, positions: websocket.positions.length },
    rest: { accounts: rest.balances.length, positions: rest.positions.length },
    differenceCount: differences.length,
    differences
  };
}

/** Return null when an active-order collection is missing or malformed. */
function extractFreedomActiveOrderRows(response: unknown): unknown[] | null {
  const envelope = asRecord(response);
  const data = asRecord(envelope?.data);
  const result = asRecord(data?.result);
  const root = Array.isArray(response) ? response : result ?? data ?? asRecord(envelope?.result) ?? envelope;
  const rootRecord = asRecord(root);
  const orders = asRecord(rootRecord?.orders);
  if (Array.isArray(root)) return root;
  if (Array.isArray(orders?.order)) return orders.order;
  if (Array.isArray(rootRecord?.orders)) return rootRecord.orders as unknown[];
  if (Array.isArray(rootRecord?.items)) return rootRecord.items;
  if (Array.isArray(rootRecord?.data)) return rootRecord.data;
  return null;
}

/** Empty order arrays are valid; each returned order needs an identity and ticker. */
export function isCompleteFreedomActiveOrdersResponse(response: unknown): boolean {
  const rows = extractFreedomActiveOrderRows(response);
  if (!rows) return false;
  return rows.every((value) => {
    const row = asRecord(value);
    if (!row) return false;
    const id = textOr(readFirst(row, ['order_id', 'id', 'orderId'])).trim();
    const ticker = textOr(readFirst(row, ['instr_nm', 'i', 'ticker', 'symbol', 'instr'])).trim();
    return Boolean(id && ticker);
  });
}

/** Normalize the documented USD account fields without converting currencies or inventing values. */
export function normalizeFreedomPortfolio(response: unknown): FreedomPortfolioSnapshot {
  const envelope = asRecord(response);
  const data = asRecord(envelope?.data);
  const result = asRecord(data?.result);
  const ps = asRecord(result?.ps);
  if (!ps) throw new Error('TradeNet response is missing data.result.ps.');
  if (ps.loaded !== true) throw new Error('TradeNet USD account data is not loaded yet.');
  if (!Array.isArray(ps.acc) || !Array.isArray(ps.pos)) {
    throw new Error('TradeNet USD account snapshot is incomplete: balances and positions must both be arrays.');
  }

  const requireRows = (value: unknown, label: string): Record<string, unknown>[] => {
    const records = (value as unknown[]).map(asRecord);
    if (records.some((row) => row === null)) {
      throw new Error(`TradeNet USD account snapshot contains a malformed ${label} row.`);
    }
    return records as Record<string, unknown>[];
  };
  const currencyOf = (row: Record<string, unknown>, label: string): string => {
    const currency = textOr(readFirst(row, ['curr', 'base_currency'])).trim().toUpperCase();
    if (!currency) throw new Error(`TradeNet USD account snapshot contains a ${label} row without a currency.`);
    return currency;
  };

  const accountRows = requireRows(ps.acc, 'balance');
  const positionRows = requireRows(ps.pos, 'position');
  const balances = accountRows.filter((row) => currencyOf(row, 'balance') === 'USD')
    .map((row): FreedomCashBalance => {
      const amount = numberOrNull(row.s) ?? numberOrNull(row.currval);
      if (amount === null) throw new Error('TradeNet USD account snapshot contains a balance without a valid amount.');
      return {
        currency: 'USD', amount,
        forecastIn: numberOrNull(row.forecast_in) ?? 0,
        forecastOut: numberOrNull(row.forecast_out) ?? 0,
        t2In: numberOrNull(row.t2_in) ?? 0,
        t2Out: numberOrNull(row.t2_out) ?? 0
      };
    });
  const positions = positionRows.filter((row) => currencyOf(row, 'position') === 'USD')
    .map((row): FreedomOpenPosition => {
      const ticker = textOr(readFirst(row, ['i', 'base_contract_code'])).trim();
      const quantity = numberOrNull(row.q);
      if (!ticker || quantity === null) {
        throw new Error('TradeNet USD account snapshot contains a position without a valid ticker or quantity.');
      }
      return {
        ticker,
        name: textOr(readFirst(row, ['name', 'name2', 'i']), 'Unknown instrument'),
        quantity, currency: 'USD',
        marketPrice: numberOrNull(row.mkt_price),
        marketValue: numberOrNull(row.market_value),
        averagePrice: numberOrNull(row.bal_price_a),
        profitClose: numberOrNull(row.profit_close),
        accountPositionId: numberOrNull(row.acc_pos_id)
      };
    });
  return { loaded: true, balances, positions };
}
