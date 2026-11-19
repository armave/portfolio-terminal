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
    .map((sample, index) => ({
      value: sample?.[metric],
      run: Number.isSafeInteger(sample?.run) && sample.run > 0 ? sample.run : index + 1
    }))
    .filter((sample) => typeof sample.value === 'number' && Number.isFinite(sample.value))
    .sort((left, right) => left.value - right.value);

  if (values.length === 0) {
    return {
      sampleCount: 0, min: null, p25: null, median: null, p75: null,
      p95: null, max: null, mean: null, variance: null,
      standardDeviation: null, interquartileRange: null, outlierRunNumbers: []
    };
  }

  const numericValues = values.map((sample) => sample.value);
  const middle = Math.floor(numericValues.length / 2);
  const median = numericValues.length % 2 === 0
    ? (numericValues[middle - 1] + numericValues[middle]) / 2
    : numericValues[middle];
  const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const variance = numericValues.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / numericValues.length;
  const p95Index = Math.max(0, Math.ceil(numericValues.length * 0.95) - 1);
  const p25 = numericValues[Math.max(0, Math.ceil(numericValues.length * 0.25) - 1)];
  const p75 = numericValues[Math.max(0, Math.ceil(numericValues.length * 0.75) - 1)];
  const interquartileRange = p75 - p25;
  const lowerFence = p25 - (1.5 * interquartileRange);
  const upperFence = p75 + (1.5 * interquartileRange);

  return {
    sampleCount: numericValues.length,
    min: numericValues[0],
    p25,
    median,
    p75,
    p95: numericValues[p95Index],
    max: numericValues[numericValues.length - 1],
    mean,
    variance,
    standardDeviation: Math.sqrt(variance),
    interquartileRange,
    outlierRunNumbers: values
      .filter((sample) => sample.value < lowerFence || sample.value > upperFence)
      .map((sample) => sample.run)
      .sort((left, right) => left - right)
  };
}

export function summarizePerformanceViewport(samples) {
  return {
    elapsedToPortfolioReadyMs: summarizePerformanceSamples(samples, 'elapsedToPortfolioReadyMs'),
    elapsedToTradesDeskReadyMs: summarizePerformanceSamples(samples, 'elapsedToTradesDeskReadyMs'),
    authShellReadyMs: summarizePerformanceSamples(samples, 'authShellReadyMs'),
    authenticationMs: summarizePerformanceSamples(samples, 'authenticationMs'),
    fixtureHydrationMs: summarizePerformanceSamples(samples, 'fixtureHydrationMs'),
    brokerRefreshAndParityMs: summarizePerformanceSamples(samples, 'brokerRefreshAndParityMs'),
    portfolioRenderReadyMs: summarizePerformanceSamples(samples, 'portfolioRenderReadyMs'),
    tradesDeskReadyMs: summarizePerformanceSamples(samples, 'tradesDeskReadyMs'),
    firstContentfulPaintMs: summarizePerformanceSamples(samples, 'firstContentfulPaintMs'),
    largestContentfulPaintMs: summarizePerformanceSamples(samples, 'largestContentfulPaintMs'),
    cumulativeLayoutShift: summarizePerformanceSamples(samples, 'cumulativeLayoutShift'),
    totalResourceTransferBytes: summarizePerformanceSamples(samples, 'totalResourceTransferBytes'),
    resourceCount: summarizePerformanceSamples(samples, 'resourceCount'),
    heapUsedBytes: summarizePerformanceSamples(samples, 'heapUsedBytes'),
    domNodeCount: summarizePerformanceSamples(samples, 'domNodeCount')
  };
}


/** Preserve the environment that produced a browser sample without guessing unavailable fields. */
export function buildPerformanceEnvironmentMetadata(input) {
  const optionalString = (value) => (
    typeof value === 'string' && value.trim() ? value.trim() : null
  );
  const logicalCpuCount = Number.isSafeInteger(input?.logicalCpuCount) && input.logicalCpuCount > 0
    ? input.logicalCpuCount
    : null;

  return {
    platform: optionalString(input?.platform),
    osRelease: optionalString(input?.osRelease),
    architecture: optionalString(input?.architecture),
    nodeVersion: optionalString(input?.nodeVersion),
    cpuModel: optionalString(input?.cpuModel),
    logicalCpuCount,
    runnerImageOS: optionalString(input?.runnerImageOS),
    runnerImageVersion: optionalString(input?.runnerImageVersion),
    browserName: optionalString(input?.browserName),
    browserVersion: optionalString(input?.browserVersion),
    headless: input?.headless === true,
    viewports: Array.isArray(input?.viewports)
      ? input.viewports.map((viewport) => ({
        name: optionalString(viewport?.name),
        width: Number.isSafeInteger(viewport?.width) && viewport.width > 0 ? viewport.width : null,
        height: Number.isSafeInteger(viewport?.height) && viewport.height > 0 ? viewport.height : null
      }))
      : []
  };
}
