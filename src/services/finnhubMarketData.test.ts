import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyFetch } from './api';
import { fetchFinnhubHistory, fetchFinnhubMarketCalendar, fetchFinnhubMarketEvents } from './finnhubMarketData';
vi.mock('./api',()=>({proxyFetch:vi.fn()}));
const instrument={id:'EQUITY:NASDAQ:GOOGL',symbol:'GOOGL',exchange:'NASDAQ',assetType:'EQUITY' as const,quoteCurrency:'USD',aliases:[],providerSymbols:{FINNHUB:'GOOGL'}};
describe('Finnhub market-data client adapters',()=>{
 afterEach(()=>vi.resetAllMocks());
 it('normalizes a provider calendar and verifies market status provenance',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({
   ok:true,provider:'Finnhub',exchange:'NASDAQ',providerExchange:'US',timeZone:'America/New_York',receivedAt:1793966401000,
   holidays:['2026-12-25','invalid'],
   earlyCloses:{'2026-12-24':780,'2026-02-30':700,'2026-12-23':1440},
   events:[
    {date:'2026-12-25',name:'Christmas',kind:'CLOSED'},
    {date:'2026-12-24',name:'Christmas Eve',kind:'EARLY_CLOSE',earlyCloseMinute:780},
    {date:'2026-02-30',kind:'CLOSED'}
   ],
   marketStatus:{isOpen:true,session:'regular',holiday:null,timeZone:'America/New_York',timestamp:1793966400000}
  });
  const result=await fetchFinnhubMarketCalendar('NASDAQ');
  expect(result).toMatchObject({
   exchange:'NASDAQ',providerExchange:'US',holidays:['2026-12-25'],
   earlyCloses:{'2026-12-24':780},
   events:[{date:'2026-12-25',kind:'CLOSED'},{date:'2026-12-24',kind:'EARLY_CLOSE',earlyCloseMinute:780}],
   marketStatus:{isOpen:true,session:'REGULAR',observedAt:1793966400000,receivedAt:1793966401000}
  });
  expect(proxyFetch).toHaveBeenCalledWith('market-calendar',{exchange:'NASDAQ'},{});
 });
 it('normalizes provider exchange aliases before requesting a calendar',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({
   ok:true,provider:'Finnhub',exchange:'NASDAQ',providerExchange:'US',timeZone:'America/New_York',receivedAt:1793966401000,
   holidays:[],earlyCloses:{},events:[],
   marketStatus:{isOpen:true,session:'regular',holiday:null,timeZone:'America/New_York',timestamp:1793966400000}
  });
  await fetchFinnhubMarketCalendar('NMS');
  expect(proxyFetch).toHaveBeenCalledWith('market-calendar',{exchange:'NASDAQ'},{});
 });
 it('rejects an unverified exchange calendar rather than inferring its timezone',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({
   ok:true,provider:'Finnhub',exchange:'NASDAQ',providerExchange:'US',timeZone:'America/New_York',receivedAt:1793966401000,
   marketStatus:{isOpen:true,session:'regular',holiday:null,timeZone:'Europe/London',timestamp:1793966400000}
  });
  await expect(fetchFinnhubMarketCalendar('NASDAQ')).rejects.toThrow('verifiable');
 });
 it('maps candles into the shared history contract',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({ok:true,provider:'Finnhub',symbol:'GOOGL',interval:'D',receivedAt:1794000000000,points:[{timestamp:1793966400000,price:284.64,open:280,high:286,low:279,volume:1000}]});
  const result=await fetchFinnhubHistory({instrument,startAt:1793900000000,endAt:1794100000000,interval:'1D'});
  expect(result).toMatchObject({provider:'FINNHUB',quality:'complete',interval:'D',observedAt:1793966400000,points:[{price:284.64,open:280}]});
  expect(proxyFetch).toHaveBeenCalledWith('provider-history',{symbol:'GOOGL',resolution:'D',from:1793900000,to:1794100000},{});
 });
 it('keeps unknown currency as partial data quality',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({ok:true,provider:'Finnhub',symbol:'GOOGL',interval:'D',receivedAt:1794000000000,points:[{timestamp:1793966400000,price:100}]});
  const result=await fetchFinnhubHistory({instrument:{...instrument,quoteCurrency:null},startAt:1793900000000,endAt:1794100000000,interval:'D'});
  expect(result.quality).toBe('partial');
  expect(result.issues).toContain('Historical quote currency is unknown; currency conversion is unavailable.');
 });
 it('forwards cancellation and rejects provider-symbol mismatches',async()=>{
  const controller=new AbortController();
  vi.mocked(proxyFetch).mockResolvedValue({ok:true,provider:'Finnhub',symbol:'MSFT',receivedAt:1794000000000,points:[]});
  await expect(fetchFinnhubHistory({instrument,startAt:1793900000000,endAt:1794100000000,interval:'D',signal:controller.signal})).rejects.toThrow('unverified historical response');
  expect(proxyFetch).toHaveBeenCalledWith('provider-history',expect.any(Object),{signal:controller.signal});
 });
 it('uses verified live exchange status and holiday data to classify history freshness',async()=>{
  const now=Date.now();
  vi.mocked(proxyFetch).mockImplementation(async action=>{
   if(action==='provider-history') return {
    ok:true,provider:'Finnhub',symbol:'GOOGL',interval:'D',receivedAt:now,
    points:[{timestamp:now-12*60*60*1000,price:284.64}]
   };
   if(action==='market-calendar') return {
    ok:true,provider:'Finnhub',exchange:'NASDAQ',providerExchange:'US',timeZone:'America/New_York',receivedAt:now,
    holidays:['2026-12-25'],earlyCloses:{'2026-12-24':780},events:[],
    marketStatus:{isOpen:false,session:'closed',holiday:null,timeZone:'America/New_York',timestamp:now}
   };
   throw new Error('Unexpected market-data action: '+action);
  });
  const result=await fetchFinnhubHistory({
   instrument,startAt:now-30*24*60*60*1000,endAt:now,interval:'1D'
  });
  expect(result).toMatchObject({
   provider:'FINNHUB',quality:'complete',session:'CLOSED',freshness:'fresh',
   issues:[]
  });
  expect(proxyFetch).toHaveBeenCalledTimes(2);
 });
 it('keeps history data when the calendar provider is unavailable but marks weekday freshness unknown',async()=>{
  const now=Date.parse('2026-11-06T15:00:00.000Z');
  const nowSpy=vi.spyOn(Date,'now').mockReturnValue(now);
  vi.mocked(proxyFetch).mockImplementation(async action=>{
   if(action==='provider-history') return {
    ok:true,provider:'Finnhub',symbol:'GOOGL',interval:'D',receivedAt:now,
    points:[{timestamp:now-60_000,price:284.64}]
   };
   throw new Error('Calendar unavailable');
  });
  try {
   const result=await fetchFinnhubHistory({
    instrument,startAt:now-30*24*60*60*1000,endAt:now,interval:'1D'
   });
   expect(result).toMatchObject({quality:'complete',freshness:'unknown'});
   expect(result.issues).toContain('Calendar unavailable');
  } finally {
   nowSpy.mockRestore();
  }
 });
 it('normalizes earnings and dividends from the typed event action',async()=>{
  vi.mocked(proxyFetch).mockResolvedValue({ok:true,provider:'Finnhub',symbol:'GOOGL',receivedAt:1794000000000,earningsAvailable:true,dividendsAvailable:true,corporateActionsAvailable:true,earnings:[{symbol:'GOOGL',date:'2026-11-07',hour:'amc',epsEstimate:2.1}],dividends:[{symbol:'GOOGL',date:'2026-11-10',amount:0.2,currency:'USD'}],corporateActions:[{symbol:'GOOGL',date:'2026-11-20',fromFactor:1,toFactor:2}]});
  const result=await fetchFinnhubMarketEvents('GOOGL','2026-11-01','2026-11-30');
  expect(result).toMatchObject({quality:'complete',earnings:[{eventDate:'2026-11-07',timing:'after_market'}],dividends:[{exDate:'2026-11-10',amount:0.2,currency:'USD'}],corporateActions:[
{kind:'cash_dividend',effectiveDate:'2026-11-10',amountPerShare:0.2,currency:'USD'},
{kind:'stock_split',effectiveDate:'2026-11-20',sharesAfterPerShareBefore:2}
]});
 });
});
