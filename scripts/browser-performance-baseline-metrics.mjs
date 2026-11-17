export function parsePerformanceSampleCount(value, fallback = 3) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new RangeError('PERFORMANCE_BASELINE_RUNS must be an integer from 1 to 20.');
  }
  return parsed;
}

export function summarizePerformanceSamples(samples, metric) {
  const values = samples
    .map((sample) => sample?.[metric])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return {
      sampleCount: 0,
      min: null,
      median: null,
      p95: null,
      max: null,
      mean: null,
      variance: null,
      standardDeviation: null
    };
  }

  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const p95Index = Math.max(0, Math.ceil(values.length * 0.95) - 1);

  return {
    sampleCount: values.length,
    min: values[0],
    median,
    p95: values[p95Index],
    max: values[values.length - 1],
    mean,
    variance,
    standardDeviation: Math.sqrt(variance)
  };
}

export function summarizePerformanceViewport(samples) {
  return {
    elapsedToAuthReadyMs: summarizePerformanceSamples(samples, 'elapsedToAuthReadyMs'),
    firstContentfulPaintMs: summarizePerformanceSamples(samples, 'firstContentfulPaintMs'),
    largestContentfulPaintMs: summarizePerformanceSamples(samples, 'largestContentfulPaintMs'),
    cumulativeLayoutShift: summarizePerformanceSamples(samples, 'cumulativeLayoutShift'),
    totalResourceTransferBytes: summarizePerformanceSamples(samples, 'totalResourceTransferBytes'),
    resourceCount: summarizePerformanceSamples(samples, 'resourceCount')
  };
}
