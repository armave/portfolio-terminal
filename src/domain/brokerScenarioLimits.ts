export type BrokerLimitFreshness = 'current' | 'stale' | 'unavailable' | 'malformed';

export interface BrokerQuantityLimit {
  /** Non-negative quantity confirmed by the broker; zero is a hard zero limit. */
  quantity: number | null;
  freshness: BrokerLimitFreshness;
  observedAt: number | null;
  source: 'getOPQ' | 'getTradingLimits';
}

export interface ScenarioQuantityConstraintInput {
  requestedQuantity: number;
  localMaximum: number | null;
  accountMaximum: BrokerQuantityLimit;
  instrumentMaximum: BrokerQuantityLimit;
  heldLongQuantity?: number | null;
  lotSize?: number;
}

export interface ScenarioQuantityConstraintResult {
  allowed: boolean;
  effectiveMaximum: number | null;
  bindingSource: 'local' | 'account' | 'instrument' | 'position' | 'unknown';
  freshness: BrokerLimitFreshness;
  reasons: string[];
}

/** Intersects local and broker-reported quantity caps. Unknown broker limits never become infinity or zero. */
export function resolveBuyQuantityConstraint(input: ScenarioQuantityConstraintInput): ScenarioQuantityConstraintResult {
  return resolveConstraint(input, 'buy');
}

/** Long exits cannot exceed held quantity and may never cross through zero. */
export function resolveLongExitQuantityConstraint(input: ScenarioQuantityConstraintInput): ScenarioQuantityConstraintResult {
  return resolveConstraint(input, 'exit');
}

function resolveConstraint(input: ScenarioQuantityConstraintInput, mode: 'buy' | 'exit'): ScenarioQuantityConstraintResult {
  const reasons: string[] = [];
  if (!Number.isFinite(input.requestedQuantity) || input.requestedQuantity <= 0) {
    return result(false, 0, 'unknown', 'malformed', ['Requested quantity must be a positive finite number.']);
  }
  const lotSize = input.lotSize ?? 1;
  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    return result(false, 0, 'unknown', 'malformed', ['Instrument lot size is invalid.']);
  }
  const caps: Array<{ source: 'local' | 'account' | 'instrument' | 'position'; value: number }> = [];
  if (input.localMaximum !== null) {
    if (!Number.isFinite(input.localMaximum) || input.localMaximum < 0) {
      return result(false, 0, 'local', 'malformed', ['Local scenario maximum is invalid.']);
    }
    caps.push({ source: 'local', value: input.localMaximum });
  } else {
    reasons.push('Local scenario maximum is unavailable.');
  }

  const brokerLimits = [input.accountMaximum, input.instrumentMaximum];
  for (const limit of brokerLimits) {
    if (limit.freshness !== 'current' || limit.quantity === null) {
      reasons.push(limit.source + ' limit is ' + limit.freshness + ' or unavailable.');
      continue;
    }
    if (!Number.isFinite(limit.quantity) || limit.quantity < 0) {
      reasons.push(limit.source + ' limit is malformed.');
      continue;
    }
    caps.push({ source: limit.source === 'getOPQ' ? 'account' : 'instrument', value: limit.quantity });
  }

  if (mode === 'exit') {
    if (input.heldLongQuantity === null || input.heldLongQuantity === undefined ||
        !Number.isFinite(input.heldLongQuantity) || input.heldLongQuantity <= 0) {
      return result(false, 0, 'position', 'malformed', [...reasons, 'A verified positive long holding is required for Exit.']);
    }
    caps.push({ source: 'position', value: input.heldLongQuantity });
  }

  const hasUnknownBrokerLimit = brokerLimits.some(limit =>
    limit.freshness !== 'current' || limit.quantity === null ||
    !Number.isFinite(limit.quantity) || limit.quantity < 0
  );
  if (hasUnknownBrokerLimit) {
    return result(false, null, 'unknown', aggregateFreshness(brokerLimits), [
      ...reasons,
      'Broker capacity is not fully verified; no executable maximum is asserted.'
    ]);
  }
  if (caps.length === 0) return result(false, null, 'unknown', 'unavailable', reasons);

  const smallest = caps.reduce((a, b) => b.value < a.value ? b : a);
  const lotRounded = Math.floor((smallest.value + Number.EPSILON) / lotSize) * lotSize;
  const allowed = input.requestedQuantity <= lotRounded + 1e-9;
  return result(allowed, lotRounded, smallest.source, 'current', [
    ...reasons,
    allowed ? 'Requested quantity is within all verified limits.'
      : mode === 'buy' ? 'Requested Buy quantity exceeds the most restrictive verified capacity.'
        : 'Requested Exit quantity exceeds the most restrictive verified sellable quantity.'
  ]);
}

function aggregateFreshness(limits: BrokerQuantityLimit[]): BrokerLimitFreshness {
  if (limits.some(limit => limit.freshness === 'malformed')) return 'malformed';
  if (limits.some(limit => limit.freshness === 'stale')) return 'stale';
  return 'unavailable';
}

function result(
  allowed: boolean,
  effectiveMaximum: number | null,
  bindingSource: ScenarioQuantityConstraintResult['bindingSource'],
  freshness: BrokerLimitFreshness,
  reasons: string[]
): ScenarioQuantityConstraintResult {
  return { allowed, effectiveMaximum, bindingSource, freshness, reasons };
}
