import type { MarketHistoryRequest, MarketHistoryResult } from './marketDataContracts';
import { fetchFinnhubHistory } from './finnhubMarketData';
import { fetchFreedomHistory } from './freedomMarketData';

export interface MarketHistoryProviderAdapter {
  readonly providerId: 'FREEDOM_TRADENET' | 'FINNHUB';
  fetchHistory(request: MarketHistoryRequest): Promise<MarketHistoryResult>;
}
export interface MarketHistoryProviderRegistry {
  list(): readonly string[];
  get(providerId: string): MarketHistoryProviderAdapter | null;
  fetch(providerId: string, request: MarketHistoryRequest): Promise<MarketHistoryResult>;
  fetchDailyHistory(request: MarketHistoryRequest): Promise<MarketHistoryResult>;
}
export function createMarketHistoryProviderRegistry(adapters: readonly MarketHistoryProviderAdapter[]): MarketHistoryProviderRegistry {
  const providers=new Map<string,MarketHistoryProviderAdapter>();
  for(const adapter of adapters){const id=adapter.providerId.trim().toUpperCase();if(!id||providers.has(id))throw new Error('Market history provider IDs must be non-empty and unique.');providers.set(id,adapter);}
  const isAbort = (error: unknown, request: MarketHistoryRequest): boolean =>
    request.signal?.aborted === true ||
    Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');

  const fetchDailyHistory = async (request: MarketHistoryRequest): Promise<MarketHistoryResult> => {
    const interval = request.interval.trim().toUpperCase();
    if (!['D', '1D'].includes(interval)) {
      throw new Error('Provider fallback is available for daily history only.');
    }
    const primary = providers.get('FINNHUB');
    const fallback = providers.get('FREEDOM_TRADENET');
    let primaryError: unknown = new Error('Finnhub history provider is not configured.');
    if (primary) {
      try {
        const result = await primary.fetchHistory(request);
        if (result.points.length > 0 && result.quality !== 'unavailable') return result;
        primaryError = new Error('Finnhub returned no usable daily candles.');
      } catch (error) {
        if (isAbort(error, request)) throw error;
        primaryError = error;
      }
    }
    if (!fallback) {
      throw new Error('Finnhub daily history is unavailable and no alternate daily history provider is configured.');
    }
    try {
      const result = await fallback.fetchHistory(request);
      if (!result.points.length || result.quality === 'unavailable') {
        throw new Error('Freedom TradeNet returned no usable daily candles.');
      }
      const reason = primaryError instanceof Error ? primaryError.message : String(primaryError);
      return {
        ...result,
        quality: result.quality === 'complete' ? 'partial' : result.quality,
        issues: [
          ...result.issues,
          'Finnhub history unavailable; daily candles were loaded from Freedom TradeNet.'
        ]
      };
    } catch (fallbackError) {
      if (isAbort(fallbackError, request)) throw fallbackError;
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error('Finnhub daily history unavailable (' + primaryMessage + '). Freedom TradeNet fallback also failed (' + fallbackMessage + ').');
    }
  };

  return {
    list:()=>[...providers.keys()],
    get:id=>providers.get(id.trim().toUpperCase())??null,
    fetch:async(id,request)=>{const adapter=providers.get(id.trim().toUpperCase());if(!adapter)throw new Error('Unsupported market history provider.');return adapter.fetchHistory(request);},
    fetchDailyHistory
  };
}
const freedomAdapter:MarketHistoryProviderAdapter={
  providerId:'FREEDOM_TRADENET',
  fetchHistory:async request=>{
    if(!['D','1D'].includes(request.interval.toUpperCase()))throw new Error('Freedom TradeNet history currently supports daily candles only.');
    return fetchFreedomHistory(request.instrument.symbol,{
      signal:request.signal,currency:request.instrument.quoteCurrency??undefined,
      exchange:request.instrument.exchange??undefined,assetType:request.instrument.assetType
    });
  }
};
const finnhubAdapter:MarketHistoryProviderAdapter={providerId:'FINNHUB',fetchHistory:fetchFinnhubHistory};
export const marketHistoryProviderRegistry=createMarketHistoryProviderRegistry([freedomAdapter,finnhubAdapter]);
