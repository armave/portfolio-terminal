import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankPortfolioState } from '../../store/portfolioDefaults';
import type { MarginIntelligenceState } from './marginIntelligenceState';
import { createMarginIntelligenceRuntime } from './marginIntelligenceRuntime';

function createSnapshot() {
  const snapshot = createBlankPortfolioState(Date.UTC(2026, 10, 11, 8, 0, 0));
  snapshot.balance = 1_000;
  snapshot.positions = {
    AAPL: {
      ticker: 'AAPL',
      shares: 2,
      currentPrice: 100,
      pt: 120,
      commBuy: 1,
      quoteSource: 'Example',
      quoteUpdatedAt: Date.UTC(2026, 10, 11, 8, 0, 0),
      quoteDetails: { sourceTimestamp: Date.UTC(2026, 10, 11, 8, 0, 0), freshness: 'fresh' },
      tranches: [{ qty: 2, price: 80, date: '2026-01-01' }]
    }
  };
  return snapshot;
}

function createStateRecorder() {
  let state: MarginIntelligenceState | null = null;
  const setState = vi.fn((next: MarginIntelligenceState | null | ((current: MarginIntelligenceState | null) => MarginIntelligenceState | null)) => {
    state = typeof next === 'function' ? next(state) : next;
  });
  return { setState, getState: () => state };
}

describe('Margin Intelligence runtime', () => {
  const now = Date.UTC(2026, 10, 11, 8, 0, 0);
  const nowIso = () => new Date(now).toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a matching cached review without refetching news or regenerating analysis', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    const loadDigest = vi.fn().mockResolvedValue({
      digest: {
        key: 'position:AAPL',
        title: 'AAPL · Position Review',
        scope: 'position',
        ticker: 'AAPL',
        analysis: 'Saved analysis',
        articles: [],
        snapshotFingerprint: 'cached-fingerprint',
        snapshotAsOf: nowIso(),
        promptVersion: 4,
        syncedAt: nowIso()
      },
      revision: 4,
      migrationStatus: 'pending'
    });
    const fetchNews = vi.fn();
    const generateAnalysis = vi.fn();

    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => 'translated:' + message,
      loadDigest,
      fetchNews,
      generateAnalysis,
      now: () => now,
      nowIso
    });

    await runtime.handleRequest({ ticker: 'aapl.us' });

    expect(loadDigest).toHaveBeenCalledWith('position:AAPL');
    expect(fetchNews).not.toHaveBeenCalled();
    expect(generateAnalysis).not.toHaveBeenCalled();
    expect(recorder.getState()).toMatchObject({
      scope: 'position',
      ticker: 'AAPL',
      analysis: 'Saved analysis',
      digestRevision: 4,
      stale: true,
      staleReasons: ['snapshot-changed'],
      error: expect.stringContaining('translated:')
    });
    runtime.dispose();
  });

  it('fetches evidence, generates analysis, validates the snapshot, and saves a new digest', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    const fetchNews = vi.fn().mockResolvedValue([
      { headline: 'AAPL company update', source: 'Example', url: 'https://news.test/aapl', datetime: 1_798_000_000 }
    ]);
    const generateAnalysis = vi.fn().mockResolvedValue('AAPL evidence-based review');
    const saveDigest = vi.fn().mockResolvedValue(5);

    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => message,
      loadDigest: vi.fn().mockResolvedValue(null),
      saveDigest,
      fetchNews,
      generateAnalysis,
      now: () => now,
      nowIso
    });

    await runtime.handleRequest({ ticker: 'AAPL', refresh: true });

    expect(fetchNews).toHaveBeenCalledWith('AAPL', true);
    expect(generateAnalysis).toHaveBeenCalledOnce();
    expect(generateAnalysis.mock.calls[0][0]).toContain('PORTFOLIO DATA');
    expect(saveDigest).toHaveBeenCalledOnce();
    expect(saveDigest.mock.calls[0][0]).toMatchObject({
      key: 'position:AAPL',
      ticker: 'AAPL',
      analysis: 'AAPL evidence-based review',
      promptVersion: 4,
      snapshotAsOf: nowIso()
    });
    expect(recorder.getState()).toMatchObject({
      scope: 'position',
      ticker: 'AAPL',
      loading: false,
      analysis: 'AAPL evidence-based review',
      digestRevision: 5,
      stale: false
    });
    runtime.dispose();
  });

  it('does not let a slower valid request overwrite a newer invalid ticker request', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    let resolveLoad: ((value: null) => void) | undefined;
    const loadDigest = vi.fn(() => new Promise<null>((resolve) => { resolveLoad = resolve; }));
    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => message,
      loadDigest,
      now: () => now,
      nowIso
    });

    const firstRequest = runtime.handleRequest({ ticker: 'AAPL' });
    await Promise.resolve();
    await runtime.handleRequest({ ticker: 'MISSING' });
    resolveLoad?.(null);
    await firstRequest;

    expect(recorder.getState()).toMatchObject({
      scope: 'position',
      ticker: 'MISSING',
      loading: false,
      analysis: '',
      error: expect.stringContaining('No active margin position')
    });
    runtime.dispose();
  });

  it('retries once when the portfolio changes during analysis, then leaves an explicit stale-review error', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    const fingerprint = vi.fn()
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('cache-snapshot')
      .mockResolvedValueOnce('changed')
      .mockResolvedValueOnce('retry-initial')
      .mockResolvedValueOnce('retry-cache')
      .mockResolvedValueOnce('retry-changed');
    const generateAnalysis = vi.fn()
      .mockResolvedValueOnce('First analysis')
      .mockResolvedValueOnce('Second analysis');
    const saveDigest = vi.fn().mockResolvedValue(1);
    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => message,
      fingerprint,
      loadDigest: vi.fn().mockResolvedValue(null),
      saveDigest,
      fetchNews: vi.fn().mockResolvedValue([]),
      generateAnalysis,
      now: () => now,
      nowIso
    });

    await runtime.handleRequest({ ticker: 'AAPL' });

    expect(generateAnalysis).toHaveBeenCalledTimes(2);
    expect(saveDigest).not.toHaveBeenCalled();
    expect(recorder.getState()).toMatchObject({
      ticker: 'AAPL',
      loading: false,
      analysis: 'Second analysis',
      error: expect.stringContaining('portfolio changed while this review was being generated')
    });
    runtime.dispose();
  });
});
