export const MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE = 1000;
const MAX_UPDATE_ROWS = 1000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value : isRecord(value) ? [value] : [];
}

/** Stateful position-based book accumulator shared by snapshot and live relays. */
export function createFreedomMarketDepthBook(requestedSymbol) {
  const symbol = String(requestedSymbol || "").trim().toUpperCase();
  if (!symbol) throw new Error("TradeNet market-depth update did not match the requested symbol.");

  const levels = new Map();
  let updateCount = 0;
  let sequence;
  let reportedDepth;
  let minStep;
  let stepPrice;
  let deletionsApplied = 0;
  let insertionsApplied = 0;
  let rowUpdatesApplied = 0;

  const normalizeRow = (value, requireValues = true) => {
    if (!isRecord(value)) return null;
    const sideValue = String(value.s ?? "").trim().toUpperCase();
    const side = sideValue === "B" || sideValue === "BUY"
      ? "B"
      : sideValue === "S" || sideValue === "SELL" ? "S" : null;
    const position = value.k;
    const price = value.p;
    const quantity = value.q;
    if (!side || !Number.isSafeInteger(position) || position < 0 ||
        (requireValues && (!Number.isFinite(price) || price <= 0 ||
          !Number.isFinite(quantity) || quantity < 0))) return null;
    return {
      side,
      position,
      ...(Number.isFinite(price) && price > 0 ? { price } : {}),
      ...(Number.isFinite(quantity) && quantity >= 0 ? { quantity } : {})
    };
  };

  const maxPositionBySide = { B: -1, S: -1 };

  // Position indices are contiguous in normal TradeNet books. Track each side's
  // upper bound so inserts/deletes can shift map keys directly instead of
  // allocating, filtering, and sorting the entire book for every provider row.
  const trimSide = side => {
    const maxPosition = maxPositionBySide[side];
    for (let position = MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE; position <= maxPosition; position += 1) {
      levels.delete(`${side}:${position}`);
    }
    maxPositionBySide[side] = Math.min(maxPosition, MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE - 1);
  };

  const refreshMaxPosition = side => {
    let position = Math.min(
      maxPositionBySide[side],
      MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE - 1
    );
    while (position >= 0 && !levels.has(`${side}:${position}`)) position -= 1;
    maxPositionBySide[side] = position;
  };

  const apply = payload => {
    const updates = Array.isArray(payload) ? payload : [payload];
    let applied = 0;
    for (const update of updates) {
      if (!isRecord(update)) continue;
      const responseSymbol = typeof update.i === "string" ? update.i.trim().toUpperCase() : symbol;
      if (responseSymbol !== symbol) {
        throw new Error("TradeNet market-depth update did not match the requested symbol.");
      }

      const deletions = rows(update.del).map(row => normalizeRow(row, false)).filter(Boolean);
      const insertions = rows(update.ins).map(row => normalizeRow(row)).filter(Boolean);
      const rowUpdates = rows(update.upd).map(row => normalizeRow(row)).filter(Boolean);
      const rowCount = deletions.length + insertions.length + rowUpdates.length;
      if (rowCount > MAX_UPDATE_ROWS) {
        throw new Error("TradeNet sent more Market Depth rows than this stream can safely process.");
      }

      updateCount += 1;
      applied += 1;
      if (Number.isSafeInteger(update.n)) sequence = update.n;
      if (Number.isSafeInteger(update.cnt) && update.cnt >= 0) reportedDepth = update.cnt;
      if (Number.isFinite(update.min_step) && update.min_step > 0) minStep = update.min_step;
      if (Number.isFinite(update.step_price) && update.step_price > 0) stepPrice = update.step_price;

      deletions.sort((left, right) => left.side.localeCompare(right.side) || right.position - left.position);
      for (const row of deletions) {
        const key = `${row.side}:${row.position}`;
        if (!levels.has(key)) continue;
        levels.delete(key);
        const maxPosition = maxPositionBySide[row.side];
        for (let position = row.position + 1; position <= maxPosition; position += 1) {
          const followingKey = `${row.side}:${position}`;
          const following = levels.get(followingKey);
          if (!following) continue;
          levels.delete(followingKey);
          following.position = position - 1;
          levels.set(`${row.side}:${following.position}`, following);
        }
        maxPositionBySide[row.side] = Math.min(
          maxPosition - 1,
          MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE - 1
        );
        refreshMaxPosition(row.side);
        deletionsApplied += 1;
      }

      insertions.sort((left, right) => left.side.localeCompare(right.side) || left.position - right.position);
      for (const row of insertions) {
        const maxPosition = maxPositionBySide[row.side];
        for (let position = maxPosition; position >= row.position; position -= 1) {
          const displacedKey = `${row.side}:${position}`;
          const displaced = levels.get(displacedKey);
          if (!displaced) continue;
          levels.delete(displacedKey);
          const nextPosition = position + 1;
          if (nextPosition >= MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) continue;
          displaced.position = nextPosition;
          levels.set(`${row.side}:${nextPosition}`, displaced);
        }
        if (row.position < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) {
          levels.set(`${row.side}:${row.position}`, row);
          maxPositionBySide[row.side] = Math.min(
            Math.max(maxPosition + 1, row.position),
            MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE - 1
          );
          trimSide(row.side);
        }
        insertionsApplied += 1;
      }

      for (const row of rowUpdates) {
        if (row.position < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) {
          levels.set(`${row.side}:${row.position}`, row);
          maxPositionBySide[row.side] = Math.max(maxPositionBySide[row.side], row.position);
          trimSide(row.side);
        }
        rowUpdatesApplied += 1;
      }
    }
    return applied;
  };

  const snapshot = (captureDurationMs = undefined) => {
    const collectSide = side => {
      const result = [];
      for (let position = 0; position <= maxPositionBySide[side]; position += 1) {
        const level = levels.get(`${side}:${position}`);
        if (level) result.push({
          position: level.position,
          price: level.price,
          quantity: level.quantity
        });
      }
      return result;
    };
    return {
      symbol,
      ...(Number.isSafeInteger(sequence) ? { sequence } : {}),
      ...(Number.isSafeInteger(reportedDepth) && reportedDepth >= 0 ? { reportedDepth } : {}),
      ...(Number.isFinite(minStep) && minStep > 0 ? { minStep } : {}),
      ...(Number.isFinite(stepPrice) && stepPrice > 0 ? { stepPrice } : {}),
      updateCount,
      insertionsApplied,
      rowUpdatesApplied,
      deletionsApplied,
      ...(Number.isFinite(captureDurationMs) && captureDurationMs >= 0 ? { captureDurationMs } : {}),
      bids: collectSide("B"),
      asks: collectSide("S")
    };
  };

  return { apply, snapshot, get updateCount() { return updateCount; } };
}

/** Aggregate multiple broker rows at the same price into market-by-price levels. */
export function groupFreedomMarketDepthByPrice(snapshot) {
  const group = levels => {
    const quantities = new Map();
    for (const level of levels) {
      quantities.set(level.price, (quantities.get(level.price) || 0) + level.quantity);
    }
    return [...quantities.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([price, quantity], position) => ({ position, price, quantity }));
  };
  return {
    ...snapshot,
    bids: group(snapshot.bids),
    asks: group(snapshot.asks).reverse().map((level, position) => ({ ...level, position }))
  };
}

export function sanitizeFreedomMarketDepth(payload, requestedSymbol, captureDurationMs = undefined) {
  const book = createFreedomMarketDepthBook(requestedSymbol);
  book.apply(payload);
  if (book.updateCount === 0) throw new Error("TradeNet returned an invalid market-depth update.");
  return book.snapshot(captureDurationMs);
}
