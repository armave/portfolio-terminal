type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalArray(record: JsonRecord, key: string, label: string): void {
  if (Object.prototype.hasOwnProperty.call(record, key) && !Array.isArray(record[key])) {
    throw new Error(`Invalid cloud portfolio: ${label} must be an array.`);
  }
}

function validateOptionalRecord(record: JsonRecord, key: string, label: string): void {
  if (Object.prototype.hasOwnProperty.call(record, key) && !isRecord(record[key])) {
    throw new Error(`Invalid cloud portfolio: ${label} must be an object.`);
  }
}

/**
 * Validate persisted container shapes before a decrypted cloud snapshot can
 * replace the local portfolio. Fields remain optional for older snapshots;
 * when present, their top-level container type must be safe to consume.
 */
export function assertValidCloudPortfolioPayload(value: unknown): asserts value is JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Invalid cloud portfolio: the snapshot must be an object.');
  }

  validateOptionalArray(value, 'holdings', 'holdings');
  validateOptionalArray(value, 'closedTrades', 'closed trades');
  validateOptionalArray(value, 'brokerExecutedTrades', 'broker executions');
  validateOptionalArray(value, 'cashflows', 'cashflows');
  validateOptionalArray(value, 'guestTrancheLedger', 'guest tranche ledger');

  validateOptionalRecord(value, 'positions', 'positions');
  validateOptionalRecord(value, 'activeTrancheTypes', 'active tranche types');
  validateOptionalRecord(value, 'activeTrancheMixes', 'active tranche mixes');
  validateOptionalRecord(value, 'activeTrancheGuestAssignments', 'guest assignments');
  validateOptionalRecord(value, 'activeTrancheGuestAssignmentDetails', 'guest assignment details');
  validateOptionalRecord(value, 'closedTradeAllocations', 'closed-trade allocations');
  validateOptionalRecord(value, 'brokerAssumptions', 'broker assumptions');
  validateOptionalRecord(value, 'apiKeys', 'API keys');

  if (isRecord(value.positions)) {
    for (const [ticker, position] of Object.entries(value.positions)) {
      if (!isRecord(position)) {
        throw new Error(`Invalid cloud portfolio: position ${ticker} must be an object.`);
      }
    }
  }

  if (value.cashCushion !== undefined) {
    if (!isRecord(value.cashCushion)) {
      throw new Error('Invalid cloud portfolio: cash cushion must be an object.');
    }
    validateOptionalArray(value.cashCushion, 'holdings', 'cash cushion holdings');
    if (Object.prototype.hasOwnProperty.call(value.cashCushion, 'freeCash')) {
      const freeCash = value.cashCushion.freeCash;
      if (freeCash !== null && typeof freeCash !== 'string' && typeof freeCash !== 'number') {
        throw new Error('Invalid cloud portfolio: free cash must be a number or numeric string.');
      }
    }
  }

  if (value.brokerAccountInfo !== undefined) {
    if (!isRecord(value.brokerAccountInfo)) {
      throw new Error('Invalid cloud portfolio: broker account information must be an object.');
    }
    validateOptionalArray(value.brokerAccountInfo, 'balances', 'broker balances');
    validateOptionalArray(value.brokerAccountInfo, 'positions', 'broker positions');
  }

  if (value.guestPortfolioSnapshot !== undefined) {
    if (!isRecord(value.guestPortfolioSnapshot) || !Array.isArray(value.guestPortfolioSnapshot.tranches)) {
      throw new Error('Invalid cloud portfolio: guest portfolio snapshot must contain a tranche array.');
    }
  }
}

/** Validate the independent Closed History payload without dropping malformed rows. */
export function normalizeCloudHistoryPayload(value: unknown): {
  brokerExecutedTrades: unknown[];
  cashflows: unknown[];
} {
  if (!isRecord(value)) {
    throw new Error('Invalid cloud history: the snapshot must be an object.');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'brokerExecutedTrades') &&
      !Array.isArray(value.brokerExecutedTrades)) {
    throw new Error('Invalid cloud history: broker executions must be an array.');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'cashflows') &&
      !Array.isArray(value.cashflows)) {
    throw new Error('Invalid cloud history: cashflows must be an array.');
  }
  return {
    brokerExecutedTrades: Array.isArray(value.brokerExecutedTrades) ? value.brokerExecutedTrades : [],
    cashflows: Array.isArray(value.cashflows) ? value.cashflows : []
  };
}
