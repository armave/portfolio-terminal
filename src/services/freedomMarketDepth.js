export const MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE = 1000;
const MAX_BOOK_POSITIONS = MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE * 2;
const MAX_UPDATE_ROWS = MAX_BOOK_POSITIONS;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value : isRecord(value) ? [value] : [];
}

/** Stateful accumulator for TradeNet's single, shared bid/ask position space. */
export function createFreedomMarketDepthBook(requestedSymbol) {
  const symbol = String(requestedSymbol || "").trim().toUpperCase();
  if (!symbol) throw new Error("TradeNet market-depth update did not match the requested symbol.");

  // TradeNet k is a global order-book index, not an index local to each side.
  const levels = new Map();
  let maxPosition = -1;
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

  // Delete one global position and shift every later row, including the other side.
  const deleteAt = position => {
    const removed = levels.get(position);
    if (!removed) return null;
    levels.delete(position);
    for (let index = position + 1; index <= maxPosition; index += 1) {
      const following = levels.get(index);
      if (!following) continue;
      levels.delete(index);
      following.position = index - 1;
      levels.set(index - 1, following);
    }
    maxPosition -= 1;
    return removed;
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

      // n is a per-ticker ordinal. A gap means deltas were missed and the book is unsafe.
      if (Number.isSafeInteger(update.n)) {
        if (sequence !== undefined && update.n !== sequence + 1) {
          throw new Error("TradeNet Market Depth sequence gap detected; a fresh snapshot is required.");
        }
      }

      updateCount += 1;
      applied += 1;
      if (Number.isSafeInteger(update.cnt) && update.cnt >= 0) reportedDepth = update.cnt;
      if (Number.isFinite(update.min_step) && update.min_step > 0) minStep = update.min_step;
      if (Number.isFinite(update.step_price) && update.step_price > 0) stepPrice = update.step_price;

      // TradeNet specifies del -> ins -> upd. Delete from highest k downward.
      deletions.sort((left, right) => right.position - left.position);
      for (const row of deletions) {
        if (row.position >= MAX_BOOK_POSITIONS) continue;
        const existing = levels.get(row.position);
        if (!existing) {
          throw new Error("TradeNet Market Depth deletion referenced a missing book position.");
        }
        if (existing.side !== row.side) {
          throw new Error("TradeNet Market Depth deletion side did not match its book position.");
        }
        deleteAt(row.position);
        deletionsApplied += 1;
      }

      // Insert from lowest k upward; each insert shifts all later positions.
      insertions.sort((left, right) => left.position - right.position);
      for (let index = 1; index < insertions.length; index += 1) {
        if (insertions[index - 1].position === insertions[index].position) {
          throw new Error("TradeNet Market Depth update contained duplicate insertion positions.");
        }
      }
      for (const row of insertions) {
        if (row.position >= MAX_BOOK_POSITIONS) continue;
        if (row.position > maxPosition + 1) {
          throw new Error("TradeNet Market Depth insertion referenced a missing book position.");
        }
        for (let position = maxPosition; position >= row.position; position -= 1) {
          const displaced = levels.get(position);
          if (!displaced) continue;
          levels.delete(position);
          const nextPosition = position + 1;
          if (nextPosition < MAX_BOOK_POSITIONS) {
            displaced.position = nextPosition;
            levels.set(nextPosition, displaced);
          }
        }
        levels.set(row.position, row);
        maxPosition = Math.min(maxPosition + 1, MAX_BOOK_POSITIONS - 1);
        insertionsApplied += 1;
      }

      // Updates replace the row at global k and must match its existing side.
      for (const row of rowUpdates) {
        if (row.position >= MAX_BOOK_POSITIONS) continue;
        const existing = levels.get(row.position);
        if (!existing) {
          throw new Error("TradeNet Market Depth update referenced a missing book position.");
        }
        if (existing.side !== row.side) {
          throw new Error("TradeNet Market Depth update side did not match its book position.");
        }
        levels.set(row.position, row);
        rowUpdatesApplied += 1;
      }

      // Commit the ordinal only after the entire delta was applied successfully.
      if (Number.isSafeInteger(update.n)) sequence = update.n;
    }
    return applied;
  };

  const snapshot = (captureDurationMs = undefined) => {
    const collectSide = side => {
      const result = [];
      for (let position = 0; position <= maxPosition && result.length < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE; position += 1) {
        const level = levels.get(position);
        if (level?.side === side) {
          result.push({
            position: level.position,
            price: level.price,
            quantity: level.quantity
          });
        }
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
