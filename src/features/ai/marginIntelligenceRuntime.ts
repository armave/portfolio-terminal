import {
  fetchMarketNews,
  loadSyncedMarginDigest,
  proxyFetch,
  saveSyncedMarginDigest,
  type LoadedSyncedMarginDigest,
  type SyncedMarginDigest
} from '../../services/api';
import type { BoardState } from '../../types/portfolio';
import { createLatestRequestGuard } from '../../utils/requestGeneration';
import {
  buildMarginReviewPrompt,
  fingerprintMarginReviewSnapshot,
  getMarginDigestFreshness,
  MARGIN_REVIEW_PROMPT_VERSION,
  normalizeMarginReviewTicker,
  selectMarginReviewNews,
  type MarginNewsFetchResult
} from './marginIntelligence';
import { buildMarginReviewContext } from './marginIntelligenceContext';
import {
  getMatchingMarginIntelligenceState,
  type MarginIntelligenceState
} from './marginIntelligenceState';

export interface MarginIntelligenceRequestDetail {
  ticker?: string;
  refresh?: boolean;
}

type MarginIntelligenceStateUpdate =
  | MarginIntelligenceState
  | null
  | ((current: MarginIntelligenceState | null) => MarginIntelligenceState | null);

type MarginIntelligenceStateSetter = (next: MarginIntelligenceStateUpdate) => void;

type MarginReviewContext = ReturnType<typeof buildMarginReviewContext>;

export interface MarginIntelligenceRuntimeDependencies {
  canViewMarginDesk: () => boolean;
  getPortfolioState: () => BoardState;
  refreshIntervalMs: number;
  setState: MarginIntelligenceStateSetter;
  translate: (message: string) => string;
  buildContext?: typeof buildMarginReviewContext;
  fingerprint?: typeof fingerprintMarginReviewSnapshot;
  loadDigest?: typeof loadSyncedMarginDigest;
  saveDigest?: typeof saveSyncedMarginDigest;
  fetchNews?: typeof fetchMarketNews;
  generateAnalysis?: (prompt: string) => Promise<string>;
  now?: () => number;
  nowIso?: () => string;
}

export interface MarginIntelligenceRuntime {
  handleRequest(detail?: MarginIntelligenceRequestDetail): Promise<void>;
  dispose(): void;
}

async function generateGeminiAnalysis(prompt: string): Promise<string> {
  const response = await proxyFetch('gemini', {}, {
    method: 'POST',
    body: JSON.stringify({ prompt, model: 'gemini-3.8-flash' }),
    cache: 'no-store'
  });
  const analysis = response?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => String(part.text || ''))
    .filter(Boolean).join('\n\n');
  if (!analysis) throw new Error(response?.error?.message || response?.error || 'Gemini returned an empty analysis.');
  return analysis;
}

/**
 * Owns request ordering, cache reuse, news/AI orchestration, snapshot validation,
 * and digest persistence for the Margin Intelligence feature.
 */
export function createMarginIntelligenceRuntime(
  dependencies: MarginIntelligenceRuntimeDependencies
): MarginIntelligenceRuntime {
  const requestGuard = createLatestRequestGuard();
  const buildContext = dependencies.buildContext ?? buildMarginReviewContext;
  const fingerprint = dependencies.fingerprint ?? fingerprintMarginReviewSnapshot;
  const loadDigest = dependencies.loadDigest ?? loadSyncedMarginDigest;
  const saveDigest = dependencies.saveDigest ?? saveSyncedMarginDigest;
  const fetchNews = dependencies.fetchNews ?? fetchMarketNews;
  const generateAnalysis = dependencies.generateAnalysis ?? generateGeminiAnalysis;
  const now = dependencies.now ?? Date.now;
  const nowIso = dependencies.nowIso ?? (() => new Date(now()).toISOString());

  const processRequest = async (
    detail: MarginIntelligenceRequestDetail | undefined,
    snapshotRetry: number
  ): Promise<void> => {
    if (!dependencies.canViewMarginDesk()) return;

    // Begin before validation or async work so even invalid newer requests supersede old ones.
    const requestId = requestGuard.begin();
    const requestedTicker = normalizeMarginReviewTicker(detail?.ticker);
    const reviewInput = buildContext(
      dependencies.getPortfolioState(),
      requestedTicker || null,
      now(),
      dependencies.refreshIntervalMs
    );
    const { allPositions, focusPosition } = reviewInput;

    if (requestedTicker && !focusPosition) {
      dependencies.setState({
        title: requestedTicker + ' · Position Review',
        scope: 'position',
        ticker: requestedTicker,
        loading: false,
        analysis: '',
        articles: [],
        error: 'No active margin position was found for ' + requestedTicker + '. Select an active margin ticker and try again.'
      });
      return;
    }

    const isPortfolio = !requestedTicker;
    const scope: 'portfolio' | 'position' = isPortfolio ? 'portfolio' : 'position';
    const requestIdentity = { scope, ...(requestedTicker ? { ticker: requestedTicker } : {}) };
    const title = isPortfolio ? 'Portfolio-wide Margin Review' : requestedTicker + ' · Position Review';
    const digestKey = isPortfolio ? 'portfolio' : 'position:' + requestedTicker;

    dependencies.setState((current) => {
      const previous = getMatchingMarginIntelligenceState(current, requestIdentity);
      return {
        title,
        scope,
        ...(requestedTicker ? { ticker: requestedTicker } : {}),
        loading: true,
        analysis: previous?.analysis || '',
        articles: previous?.articles || [],
        ...(previous?.coverage ? { coverage: previous.coverage } : {}),
        ...(previous?.stale !== undefined ? { stale: previous.stale } : {}),
        ...(previous?.staleReasons ? { staleReasons: previous.staleReasons } : {}),
        ...(previous?.snapshotAsOf ? { snapshotAsOf: previous.snapshotAsOf } : {}),
        ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
        ...(previous?.digestRevision !== undefined ? { digestRevision: previous.digestRevision } : {})
      };
    });

    try {
      const snapshotFingerprint = await fingerprint(reviewInput.snapshotIdentity);
      const cached = await loadDigest(digestKey);
      if (!requestGuard.isCurrent(requestId)) return;

      const latestCacheInput = buildContext(
        dependencies.getPortfolioState(),
        requestedTicker || null,
        now(),
        dependencies.refreshIntervalMs
      );
      const latestCacheFingerprint = await fingerprint(latestCacheInput.snapshotIdentity);

      if (cached && !detail?.refresh) {
        const freshness = getMarginDigestFreshness(cached.digest, latestCacheFingerprint);
        dependencies.setState({
          title: cached.digest.title || title,
          scope: cached.digest.scope,
          ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
          loading: false,
          analysis: cached.digest.analysis,
          articles: cached.digest.articles,
          ...(cached.digest.coverage ? { coverage: cached.digest.coverage } : {}),
          stale: freshness.stale,
          staleReasons: freshness.reasons,
          ...(cached.digest.snapshotAsOf ? { snapshotAsOf: cached.digest.snapshotAsOf } : {}),
          syncedAt: cached.digest.syncedAt,
          digestRevision: cached.revision,
          ...(cached.migrationStatus === 'pending' ? {
            error: dependencies.translate('This saved Margin Intelligence review still needs an encryption upgrade. Retry the migration from Settings.')
          } : {})
        });
        return;
      }

      if (cached) {
        const freshness = getMarginDigestFreshness(cached.digest, latestCacheFingerprint);
        dependencies.setState({
          title: cached.digest.title || title,
          scope: cached.digest.scope,
          ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
          loading: true,
          analysis: cached.digest.analysis,
          articles: cached.digest.articles,
          ...(cached.digest.coverage ? { coverage: cached.digest.coverage } : {}),
          stale: freshness.stale,
          staleReasons: freshness.reasons,
          ...(cached.digest.snapshotAsOf ? { snapshotAsOf: cached.digest.snapshotAsOf } : {}),
          syncedAt: cached.digest.syncedAt,
          digestRevision: cached.revision
        });
      }

      const newsPositions = isPortfolio ? allPositions : focusPosition ? [focusPosition] : [];
      const newsResults: MarginNewsFetchResult[] = await Promise.all(newsPositions.map(async position => {
        try {
          const items = await fetchNews(position.ticker, true);
          return {
            ticker: position.ticker,
            fetchedAt: nowIso(),
            items: Array.isArray(items) ? items : []
          };
        } catch (error) {
          return {
            ticker: position.ticker,
            fetchedAt: nowIso(),
            items: [],
            error: error instanceof Error ? error.message : 'News provider request failed.'
          };
        }
      }));

      const { articles, coverage } = selectMarginReviewNews(newsResults, reviewInput.priorityTickers);
      const prompt = buildMarginReviewPrompt(reviewInput.portfolioContext, coverage, articles);
      const analysis = await generateAnalysis(prompt);
      if (!analysis) throw new Error('Gemini returned an empty analysis.');
      if (!requestGuard.isCurrent(requestId)) return;

      const latestInput = buildContext(
        dependencies.getPortfolioState(),
        requestedTicker || null,
        now(),
        dependencies.refreshIntervalMs
      );
      const latestFingerprint = await fingerprint(latestInput.snapshotIdentity);
      if (!requestGuard.isCurrent(requestId)) return;

      if (latestFingerprint !== snapshotFingerprint) {
        if (snapshotRetry < 1) {
          await processRequest({ ...detail, refresh: true }, snapshotRetry + 1);
          return;
        }
        dependencies.setState({
          title,
          scope,
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: false,
          analysis,
          articles,
          coverage,
          snapshotAsOf: reviewInput.portfolioContext.asOf,
          error: 'The portfolio changed while this review was being generated. Refresh to review the current snapshot.'
        });
        return;
      }

      const syncedAt = nowIso();
      const digest: SyncedMarginDigest = {
        key: digestKey,
        title,
        scope,
        ...(requestedTicker ? { ticker: requestedTicker } : {}),
        analysis,
        articles,
        coverage,
        snapshotFingerprint,
        snapshotAsOf: reviewInput.portfolioContext.asOf,
        promptVersion: MARGIN_REVIEW_PROMPT_VERSION,
        syncedAt
      };
      const nextRevision = await saveDigest(digest, cached?.revision ?? 0);
      if (!requestGuard.isCurrent(requestId)) return;

      const postSaveInput = buildContext(
        dependencies.getPortfolioState(),
        requestedTicker || null,
        now(),
        dependencies.refreshIntervalMs
      );
      const postSaveFingerprint = await fingerprint(postSaveInput.snapshotIdentity);
      const freshness = getMarginDigestFreshness(digest, postSaveFingerprint);
      dependencies.setState({
        title,
        scope,
        ...(requestedTicker ? { ticker: requestedTicker } : {}),
        loading: false,
        analysis,
        articles,
        coverage,
        snapshotAsOf: reviewInput.portfolioContext.asOf,
        stale: freshness.stale,
        staleReasons: freshness.reasons,
        ...(freshness.stale ? { error: 'The portfolio changed while the review was being saved. Refresh to review the current snapshot.' } : {}),
        syncedAt,
        digestRevision: nextRevision
      });
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      const message = error instanceof Error ? error.message : 'Could not load or save the synced Gemini margin review.';
      dependencies.setState((current) => {
        const previous = getMatchingMarginIntelligenceState(current, requestIdentity);
        return {
          title,
          scope,
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: false,
          analysis: previous?.analysis || '',
          articles: previous?.articles || [],
          ...(previous?.coverage ? { coverage: previous.coverage } : {}),
          ...(previous?.stale !== undefined ? { stale: previous.stale } : {}),
          ...(previous?.staleReasons ? { staleReasons: previous.staleReasons } : {}),
          ...(previous?.snapshotAsOf ? { snapshotAsOf: previous.snapshotAsOf } : {}),
          ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
          ...(previous?.digestRevision !== undefined ? { digestRevision: previous.digestRevision } : {}),
          error: message
        };
      });
    }
  };

  return {
    handleRequest: (detail) => processRequest(detail, 0),
    dispose: () => requestGuard.invalidate()
  };
}
