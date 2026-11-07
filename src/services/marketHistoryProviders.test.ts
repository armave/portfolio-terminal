import { describe, expect, it, vi } from 'vitest';
import { createMarketHistoryProviderRegistry } from './marketHistoryProviders';
const result={points:[],observedAt:null,freshness:'unknown' as const,session:'UNKNOWN' as const,delayClass:'unknown' as const,quality:'unavailable' as const,issues:[]};
describe('market history provider registry',()=>{
 it('lists providers and dispatches by stable provider ID',async()=>{
  const freedom={providerId:'FREEDOM_TRADENET' as const,fetchHistory:vi.fn().mockResolvedValue(result)};
  const finnhub={providerId:'FINNHUB' as const,fetchHistory:vi.fn().mockResolvedValue(result)};
  const registry=createMarketHistoryProviderRegistry([freedom,finnhub]);
  expect(registry.list()).toEqual(['FREEDOM_TRADENET','FINNHUB']);
  await registry.fetch('finnhub',{instrument:{} as never,startAt:1,endAt:2,interval:'D'});
  expect(finnhub.fetchHistory).toHaveBeenCalledTimes(1);
  expect(registry.get('unknown')).toBeNull();
 });
 it('rejects duplicate provider IDs and unsupported lookup',async()=>{
  const adapter={providerId:'FINNHUB' as const,fetchHistory:vi.fn().mockResolvedValue(result)};
  expect(()=>createMarketHistoryProviderRegistry([adapter,adapter])).toThrow('unique');
  await expect(createMarketHistoryProviderRegistry([]).fetch('UNKNOWN',{instrument:{} as never,startAt:1,endAt:2,interval:'D'})).rejects.toThrow('Unsupported');
 });
});
