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

  it('loads a saved review without refetching news and preserves its stale/migration warnings', async () => {
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
        coverage: [],
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

  it('does not let a slower valid request overwrite a newer invalid ticker request or spend an AI call', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    let resolveLoad!: (value: null) => void;
    const pendingLoad = new Promise<null>((resolve) => { resolveLoad = resolve; });
    const loadDigest = vi.fn(() => pendingLoad);
    const generateAnalysis = vi.fn();
    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => message,
      loadDigest,
      generateAnalysis,
      now: () => now,
      nowIso
    });

    const firstRequest = runtime.handleRequest({ ticker: 'AAPL' });
    await runtime.handleRequest({ ticker: 'MISSING' });
    resolveLoad(null);
    await firstRequest;

    expect(generateAnalysis).not.toHaveBeenCalled();
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


describe('Margin Intelligence timeout recovery', () => {
  const now = Date.UTC(2026, 10, 11, 8, 0, 0);
  const nowIso = () => new Date(now).toISOString();

  it('keeps the last saved review visibly stale and reports a retryable refresh timeout', async () => {
    const recorder = createStateRecorder();
    const snapshot = createSnapshot();
    const loadDigest = vi.fn().mockResolvedValue({
      digest: {
        key: 'position:AAPL',
        title: 'AAPL · Position Review',
        scope: 'position',
        ticker: 'AAPL',
        analysis: 'Previously saved analysis',
        articles: [],
        coverage: [{
          ticker: 'AAPL', status: 'loaded', fetchedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
          availableArticleCount: 1, selectedArticleCount: 1
        }],
        snapshotFingerprint: 'old-fingerprint',
        snapshotAsOf: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
        promptVersion: 4,
        syncedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString()
      },
      revision: 7,
      migrationStatus: 'not-required'
    });
    const runtime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => true,
      getPortfolioState: () => snapshot,
      refreshIntervalMs: 60_000,
      setState: recorder.setState,
      translate: (message) => message,
      loadDigest,
      fetchNews: vi.fn().mockResolvedValue([]),
      generateAnalysis: vi.fn().mockRejectedValue(new Error('Request timed out after 40 seconds.')),
      now: () => now,
      nowIso
    });

    await runtime.handleRequest({ ticker: 'AAPL', refresh: true });

    expect(recorder.getState()).toMatchObject({
      ticker: 'AAPL',
      loading: false,
      analysis: 'Previously saved analysis',
      stale: true,
      error: 'Request timed out after 40 seconds.'
    });
    expect(recorder.getState()?.staleReasons).toContain('news-old');
    runtime.dispose();
  });
});
