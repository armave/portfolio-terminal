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

describe('market history daily fallback', () => {
  const request = { instrument: {} as never, startAt: 1, endAt: 2, interval: '1D' };

  it('keeps Finnhub as the source when it returns usable candles', async () => {
    const finnhubResult = { ...result, points: [{ timestamp: 2, price: 101 }], provider: 'Finnhub' };
    const finnhub = { providerId: 'FINNHUB' as const, fetchHistory: vi.fn().mockResolvedValue(finnhubResult) };
    const freedom = { providerId: 'FREEDOM_TRADENET' as const, fetchHistory: vi.fn().mockResolvedValue(result) };
    const registry = createMarketHistoryProviderRegistry([finnhub, freedom]);

    await expect(registry.fetchDailyHistory(request)).resolves.toEqual(finnhubResult);
    expect(freedom.fetchHistory).not.toHaveBeenCalled();
  });

  it('falls back to Freedom TradeNet and records the provider failure as provisional provenance', async () => {
    const freedomResult = {
      ...result,
      points: [{ timestamp: 2, price: 101 }],
      provider: 'Freedom TradeNet',
      quality: 'complete' as const
    };
    const finnhub = {
      providerId: 'FINNHUB' as const,
      fetchHistory: vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 403 forbidden'), { status: 403 }))
    };
    const freedom = { providerId: 'FREEDOM_TRADENET' as const, fetchHistory: vi.fn().mockResolvedValue(freedomResult) };
    const registry = createMarketHistoryProviderRegistry([finnhub, freedom]);

    const actual = await registry.fetchDailyHistory(request);
    expect(actual.provider).toBe('Freedom TradeNet');
    expect(actual.quality).toBe('partial');
    expect(actual.issues).toContain(
      'Finnhub history unavailable; daily candles were loaded from Freedom TradeNet.'
    );
  });

  it('does not fall back for non-daily intervals or after cancellation', async () => {
    const finnhub = { providerId: 'FINNHUB' as const, fetchHistory: vi.fn().mockRejectedValue(new Error('no access')) };
    const freedom = { providerId: 'FREEDOM_TRADENET' as const, fetchHistory: vi.fn().mockResolvedValue(result) };
    const registry = createMarketHistoryProviderRegistry([finnhub, freedom]);

    await expect(registry.fetchDailyHistory({ ...request, interval: '1H' })).rejects.toThrow('daily history only');
    const controller = new AbortController();
    controller.abort();
    await expect(registry.fetchDailyHistory({ ...request, signal: controller.signal })).rejects.toThrow('no access');
    expect(freedom.fetchHistory).not.toHaveBeenCalled();
  });
});
