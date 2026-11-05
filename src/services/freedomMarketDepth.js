export const MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE = 1000;
const MAX_UPDATE_ROWS = MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE * 2;
const BOOK_SIDES = ["B", "S"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value : isRecord(value) ? [value] : [];
}

/** Stateful accumulator for TradeNet's side-local bid/ask position spaces. */
export function createFreedomMarketDepthBook(requestedSymbol) {
  const symbol = String(requestedSymbol || "").trim().toUpperCase();
  if (!symbol) throw new Error("TradeNet market-depth update did not match the requested symbol.");

  // TradeNet k is scoped to its row side. Bid k=0 and ask k=0 are distinct levels.
  const levels = new Map();
  const maxPosition = { B: -1, S: -1 };
  const levelKey = (side, position) => `${side}:${position}`;
  let updateCount = 0;
  let sequence;
  let reportedDepth;
  let minStep;
  let stepPrice;
  let deletionsApplied = 0;
  let insertionsApplied = 0;
  let rowUpdatesApplied = 0;
  // Retain a compact, bounded update trail so position drift can be traced to the first bad delta.
  const recentUpdates = [];

  const normalizeSide = value => {
    const sideValue = String(value ?? "").trim().toUpperCase();
    return sideValue === "B" || sideValue === "BUY"
      ? "B"
      : sideValue === "S" || sideValue === "SELL" ? "S" : null;
  };

  const normalizeRow = (value, requireValues = true) => {
    if (!isRecord(value)) return null;
    const side = normalizeSide(value.s);
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

  // Deletes may omit side and price/quantity. Resolve only when one side is unambiguous.
  const normalizeDeletion = value => {
    if (Number.isSafeInteger(value) && value >= 0) return { position: value };
    if (!isRecord(value)) return null;
    const position = value.k;
    if (!Number.isSafeInteger(position) || position < 0) return null;
    let side = null;
    if (value.s !== undefined && value.s !== null && String(value.s).trim() !== "") {
      side = normalizeSide(value.s);
      if (!side) return null;
    }
    return {
      position,
      ...(side ? { side } : {}),
      ...(Number.isFinite(value.p) && value.p > 0 ? { price: value.p } : {}),
      ...(Number.isFinite(value.q) && value.q >= 0 ? { quantity: value.q } : {})
    };
  };

  const resolveDeletionSide = row => {
    if (row.side) {
      if (!levels.has(levelKey(row.side, row.position))) {
        throw new Error("TradeNet Market Depth deletion referenced a missing book position.");
      }
      return row.side;
    }

    let candidates = BOOK_SIDES.filter(side => levels.has(levelKey(side, row.position)));
    if (Number.isFinite(row.price)) {
      candidates = candidates.filter(side => levels.get(levelKey(side, row.position)).price === row.price);
    }
    if (Number.isFinite(row.quantity)) {
      candidates = candidates.filter(side => levels.get(levelKey(side, row.position)).quantity === row.quantity);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      throw new Error("TradeNet Market Depth deletion referenced a missing book position.");
    }
    throw new Error(`TradeNet Market Depth deletion at k=${row.position} is ambiguous without a side.`);
  };

  const describeMissingPosition = (operation, update, row) => {
    const compactRows = (value, deletion = false) => rows(value).slice(0, 24).map(item => {
      const normalized = deletion ? normalizeDeletion(item) : normalizeRow(item, false);
      return normalized
        ? `${normalized.position}${normalized.side ? `:${normalized.side}` : ""}${Number.isFinite(normalized.price) ? `@${normalized.price}` : ""}`
        : "invalid";
    }).join(",");
    const nearby = BOOK_SIDES.map(side => {
      const level = levels.get(levelKey(side, row.position));
      return level ? `${side}:${level.position}@${level.price}` : `${side}:${row.position}:empty`;
    }).join(",");
    const history = recentUpdates.map(entry =>
      `n${entry.sequence}[d:${entry.del};i:${entry.ins};u:${entry.upd}]`
    ).join("|");
    const message = `TradeNet Market Depth ${operation} referenced a missing ${row.side} position k=${row.position}, n=${Number.isSafeInteger(update.n) ? update.n : "unknown"}, del=[${compactRows(update.del, true)}], ins=[${compactRows(update.ins)}], upd=[${compactRows(update.upd)}], nearby=[${nearby}], history=[${history}]`;
    return message.length > 5000 ? message.slice(0, 4997) + "..." : message;
  };

  // Delete and shift rows only within the selected side.
  const deleteAt = (side, position) => {
    const removed = levels.get(levelKey(side, position));
    if (!removed) return null;
    levels.delete(levelKey(side, position));
    for (let index = position + 1; index <= maxPosition[side]; index += 1) {
      const following = levels.get(levelKey(side, index));
      if (!following) continue;
      levels.delete(levelKey(side, index));
      following.position = index - 1;
      levels.set(levelKey(side, index - 1), following);
    }
    maxPosition[side] -= 1;
    return removed;
  };

  const apply = payload => {
    const updates = [];
    const collectUpdates = value => {
      if (Array.isArray(value)) {
        for (const item of value) collectUpdates(item);
        return;
      }
      if (!isRecord(value)) return;
      // TradeNet's documented "b" event wraps its per-ticker update blocks in dom[].
      if (Array.isArray(value.dom)) {
        collectUpdates(value.dom);
        return;
      }
      updates.push(value);
    };
    collectUpdates(payload);
    let applied = 0;

    for (const update of updates) {
      if (!isRecord(update)) continue;
      const responseSymbol = typeof update.i === "string" ? update.i.trim().toUpperCase() : symbol;
      if (responseSymbol !== symbol) {
        throw new Error("TradeNet market-depth update did not match the requested symbol.");
      }

      const rawDeletions = rows(update.del);
      const deletions = rawDeletions.map(normalizeDeletion);
      if (deletions.some(row => row === null)) {
        throw new Error("TradeNet Market Depth deletion row did not contain a valid side-local position.");
      }
      const insertions = rows(update.ins).map(row => normalizeRow(row)).filter(Boolean);
      const rowUpdates = rows(update.upd).map(row => normalizeRow(row)).filter(Boolean);
      const rowCount = deletions.length + insertions.length + rowUpdates.length;
      if (rowCount > MAX_UPDATE_ROWS) {
        throw new Error("TradeNet sent more Market Depth rows than this stream can safely process.");
      }

      const historyRows = (value, deletion = false) => rows(value).slice(0, 24).map(item => {
        const normalized = deletion ? normalizeDeletion(item) : normalizeRow(item, false);
        return normalized
          ? `${normalized.position}${normalized.side ? `:${normalized.side}` : ""}${Number.isFinite(normalized.price) ? `@${normalized.price}` : ""}`
          : "invalid";
      }).join(",");
      recentUpdates.push({
        sequence: Number.isSafeInteger(update.n) ? update.n : "?",
        del: historyRows(update.del, true),
        ins: historyRows(update.ins),
        upd: historyRows(update.upd)
      });
      if (recentUpdates.length > 12) recentUpdates.shift();

      // n is a per-ticker ordinal. A gap means deltas were missed and the book is unsafe.
      if (Number.isSafeInteger(update.n)) {
        if (sequence !== undefined && update.n !== sequence + 1) {
          throw new Error("TradeNet Market Depth sequence gap detected; a fresh snapshot is required.");
        }
      }

      // Ignore rows beyond the per-side safety window, matching the insertion/update cap.
      // Resolve every in-range side-less delete before mutating the book; never guess when k overlaps.
      const resolvedDeletions = deletions
        .filter(row => row.position < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE)
        .map(row => ({ ...row, side: resolveDeletionSide(row) }));
      const deletionPositions = new Set();
      for (const row of resolvedDeletions) {
        const key = levelKey(row.side, row.position);
        if (deletionPositions.has(key)) {
          throw new Error(`TradeNet Market Depth update contained duplicate ${row.side} deletion position k=${row.position}.`);
        }
        deletionPositions.add(key);
      }

      updateCount += 1;
      applied += 1;
      if (Number.isSafeInteger(update.cnt) && update.cnt >= 0) reportedDepth = update.cnt;
      if (Number.isFinite(update.min_step) && update.min_step > 0) minStep = update.min_step;
      if (Number.isFinite(update.step_price) && update.step_price > 0) stepPrice = update.step_price;

      // TradeNet specifies del -> ins -> upd. Delete from highest k downward per side.
      resolvedDeletions.sort((left, right) => left.side.localeCompare(right.side) || right.position - left.position);
      for (const row of resolvedDeletions) {
        if (row.position >= MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) continue;
        if (!levels.has(levelKey(row.side, row.position))) {
          throw new Error("TradeNet Market Depth deletion referenced a missing book position.");
        }
        deleteAt(row.side, row.position);
        deletionsApplied += 1;
      }

      // Insert from lowest k upward per side; each insert shifts only that side.
      insertions.sort((left, right) => left.side.localeCompare(right.side) || left.position - right.position);
      const insertionPositions = new Set();
      for (const row of insertions) {
        const key = levelKey(row.side, row.position);
        if (insertionPositions.has(key)) {
          throw new Error(`TradeNet Market Depth update contained duplicate ${row.side} insertion position k=${row.position}.`);
        }
        insertionPositions.add(key);
      }
      for (const row of insertions) {
        if (row.position >= MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) continue;
        if (row.position > maxPosition[row.side] + 1) {
          throw new Error(`TradeNet Market Depth ${row.side} insertion referenced a missing book position.`);
        }
        for (let position = maxPosition[row.side]; position >= row.position; position -= 1) {
          const displaced = levels.get(levelKey(row.side, position));
          if (!displaced) continue;
          levels.delete(levelKey(row.side, position));
          const nextPosition = position + 1;
          if (nextPosition < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) {
            displaced.position = nextPosition;
            levels.set(levelKey(row.side, nextPosition), displaced);
          }
        }
        levels.set(levelKey(row.side, row.position), row);
        maxPosition[row.side] = Math.min(maxPosition[row.side] + 1, MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE - 1);
        insertionsApplied += 1;
      }

      // Updates replace the row at side-local k.
      for (const row of rowUpdates) {
        if (row.position >= MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE) continue;
        const key = levelKey(row.side, row.position);
        if (!levels.has(key)) {
          throw new Error(describeMissingPosition("update", update, row));
        }
        levels.set(key, row);
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
      for (let position = 0; position <= maxPosition[side] && result.length < MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE; position += 1) {
        const level = levels.get(levelKey(side, position));
        if (level) {
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
