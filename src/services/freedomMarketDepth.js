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
  // Retain a compact, bounded update trail so position drift can be traced to the first bad delta.
  const recentUpdates = [];
  let initialSequence;
  let initialReportedDepth;
  let initialRawInsertionCount;
  let initialAcceptedInsertionCount;
  let initialRejectedInsertionCount;
  let initialBidInsertionCount;
  let initialAskInsertionCount;

  // Tradernet payloads can encode numeric fields as JSON numbers or numeric strings.
  const finiteNumber = value => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizePosition = value => {
    const position = finiteNumber(value);
    return Number.isSafeInteger(position) && position >= 0 ? position : null;
  };
  const normalizeSide = value => {
    if (typeof value === "boolean") return value ? "B" : "S";
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 0 ? "B" : value < 0 ? "S" : null;
    }
    const sideValue = String(value ?? "").trim().toUpperCase();
    return sideValue === "B" || sideValue === "BUY"
      ? "B"
      : sideValue === "S" || sideValue === "SELL" ? "S" : null;
  };

  const normalizeRow = (value, requireValues = true) => {
    if (!isRecord(value)) return null;
    const side = normalizeSide(value.s);
    const position = normalizePosition(value.k);
    const price = finiteNumber(value.p);
    const quantity = finiteNumber(value.q);
    if (!side || position === null ||
        (requireValues && (price === null || price <= 0 ||
          quantity === null || quantity < 0))) return null;
    return {
      side,
      position,
      ...(price !== null && price > 0 ? { price } : {}),
      ...(quantity !== null && quantity >= 0 ? { quantity } : {})
    };
  };

  // Some live TradeNet del rows contain only a position (or a numeric k).
  // A delete needs the global position; side/price/quantity are optional hints.
  const normalizeDeletion = value => {
    const numericPosition = typeof value === "number" || typeof value === "string"
      ? normalizePosition(value)
      : null;
    if (numericPosition !== null) return { position: numericPosition };
    if (!isRecord(value)) return null;
    const position = normalizePosition(value.k);
    if (position === null) return null;
    let side = null;
    if (value.s !== undefined && value.s !== null && String(value.s).trim() !== "") {
      side = normalizeSide(value.s);
      if (!side) return null;
    }
    const price = finiteNumber(value.p);
    const quantity = finiteNumber(value.q);
    return {
      position,
      ...(side ? { side } : {}),
      ...(price !== null && price > 0 ? { price } : {}),
      ...(quantity !== null && quantity >= 0 ? { quantity } : {})
    };
  };

  const describePositionConflict = (operation, update, row, existing) => {
    const compactRows = (value, deletion = false) => rows(value).slice(0, 24).map(item => {
      const normalized = deletion ? normalizeDeletion(item) : normalizeRow(item, false);
      return normalized
        ? `${normalized.position}${normalized.side ? `:${normalized.side}` : ""}${Number.isFinite(normalized.price) ? `@${normalized.price}` : ""}`
        : "invalid";
    }).join(",");
    const nearby = [];
    for (let position = Math.max(0, row.position - 2); position <= row.position + 2; position += 1) {
      const level = levels.get(position);
      nearby.push(level
        ? `${position}:${level.side}@${level.price}`
        : `${position}:empty`);
    }
    const history = recentUpdates.map(entry =>
      `n${entry.sequence}[d:${entry.del};i:${entry.ins};u:${entry.upd}]`
    ).join("|");
    const message = `TradeNet Market Depth ${operation} side mismatch at k=${row.position}: incoming=${row.side}${Number.isFinite(row.price) ? `@${row.price}` : ""}, existing=${existing.side}${Number.isFinite(existing.price) ? `@${existing.price}` : ""}, n=${Number.isSafeInteger(update.n) ? update.n : "unknown"}, del=[${compactRows(update.del, true)}], ins=[${compactRows(update.ins)}], upd=[${compactRows(update.upd)}], nearby=[${nearby.join(",")}], history=[${history}]`;
    return message.length > 5000 ? message.slice(0, 4997) + "..." : message;
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
        throw new Error("TradeNet Market Depth deletion row did not contain a valid global position.");
      }
      const rawInsertions = rows(update.ins);
      const insertions = rawInsertions.map(row => normalizeRow(row)).filter(Boolean);
      const rawRowUpdates = rows(update.upd);
      const rowUpdates = rawRowUpdates.map(row => normalizeRow(row)).filter(Boolean);

      // Capture the first provider snapshot before any normalization/aggregation so a shallow
      // account feed can be distinguished from rows rejected by the parser or grouped by price.
      if (updateCount === 0) {
        initialSequence = Number.isSafeInteger(update.n) ? update.n : undefined;
        initialReportedDepth = Number.isSafeInteger(update.cnt) && update.cnt >= 0 ? update.cnt : undefined;
        initialRawInsertionCount = rawInsertions.length;
        initialAcceptedInsertionCount = insertions.length;
        initialRejectedInsertionCount = rawInsertions.length - insertions.length;
        initialBidInsertionCount = insertions.filter(row => row.side === "B").length;
        initialAskInsertionCount = insertions.filter(row => row.side === "S").length;
      }
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
        if (row.side && existing.side !== row.side) {
          throw new Error(describePositionConflict("deletion", update, row, existing));
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
          throw new Error(describePositionConflict("update", update, row, existing));
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
    const bids = collectSide("B");
    const asks = collectSide("S");
    return {
      symbol,
      ...(Number.isSafeInteger(sequence) ? { sequence } : {}),
      ...(Number.isSafeInteger(reportedDepth) && reportedDepth >= 0 ? { reportedDepth } : {}),
      ...(Number.isFinite(minStep) && minStep > 0 ? { minStep } : {}),
      ...(Number.isFinite(stepPrice) && stepPrice > 0 ? { stepPrice } : {}),
      providerLevelCount: bids.length + asks.length,
      providerBidRowCount: bids.length,
      providerAskRowCount: asks.length,
      ...(Number.isSafeInteger(initialSequence) ? { initialSequence } : {}),
      ...(Number.isSafeInteger(initialReportedDepth) ? { initialReportedDepth } : {}),
      ...(Number.isSafeInteger(initialRawInsertionCount) ? { initialRawInsertionCount } : {}),
      ...(Number.isSafeInteger(initialAcceptedInsertionCount) ? { initialAcceptedInsertionCount } : {}),
      ...(Number.isSafeInteger(initialRejectedInsertionCount) ? { initialRejectedInsertionCount } : {}),
      ...(Number.isSafeInteger(initialBidInsertionCount) ? { initialBidInsertionCount } : {}),
      ...(Number.isSafeInteger(initialAskInsertionCount) ? { initialAskInsertionCount } : {}),
      updateCount,
      insertionsApplied,
      rowUpdatesApplied,
      deletionsApplied,
      ...(Number.isFinite(captureDurationMs) && captureDurationMs >= 0 ? { captureDurationMs } : {}),
      bids,
      asks
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
