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
}
export function createMarketHistoryProviderRegistry(adapters: readonly MarketHistoryProviderAdapter[]): MarketHistoryProviderRegistry {
  const providers=new Map<string,MarketHistoryProviderAdapter>();
  for(const adapter of adapters){const id=adapter.providerId.trim().toUpperCase();if(!id||providers.has(id))throw new Error('Market history provider IDs must be non-empty and unique.');providers.set(id,adapter);}
  return {
    list:()=>[...providers.keys()],
    get:id=>providers.get(id.trim().toUpperCase())??null,
    fetch:async(id,request)=>{const adapter=providers.get(id.trim().toUpperCase());if(!adapter)throw new Error('Unsupported market history provider.');return adapter.fetchHistory(request);}
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
