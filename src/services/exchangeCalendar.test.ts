import { describe, expect, it } from 'vitest';
import { classifyMarketHistoryFreshness, normalizeExchangeCalendarId, resolveExchangeSession } from './exchangeCalendar';
const at=(value:string)=>Date.parse(value);
const coverage={from:'2026-01-01',to:'2026-12-31',source:'verified-test-fixture'};
describe('exchange calendar',()=>{
 it('normalizes common provider exchange codes before session calculations',()=>{
  expect(normalizeExchangeCalendarId('NMS')).toBe('NASDAQ');
  expect(normalizeExchangeCalendarId('NYQ')).toBe('NYSE');
  expect(normalizeExchangeCalendarId('XETR')).toBe('XETRA');
  expect(normalizeExchangeCalendarId('HKG')).toBe('HKEX');
  expect(normalizeExchangeCalendarId('UNSUPPORTED')).toBeNull();
 });

 it('uses exchange-local daylight saving rules',()=>{
  expect(resolveExchangeSession({exchange:'NASDAQ',at:at('2026-07-06T13:45:00Z'),coverage})).toMatchObject({timeZone:'America/New_York',session:'REGULAR',calendarQuality:'complete'});
  expect(resolveExchangeSession({exchange:'NASDAQ',at:at('2026-01-05T14:45:00Z'),coverage}).session).toBe('REGULAR');
 });
 it('models London, Frankfurt, Toronto, Tokyo and Hong Kong sessions',()=>{
  expect(resolveExchangeSession({exchange:'LSE',at:at('2026-07-06T08:30:00Z'),coverage}).session).toBe('REGULAR');
  expect(resolveExchangeSession({exchange:'XETRA',at:at('2026-07-06T08:30:00Z'),coverage}).session).toBe('REGULAR');
  expect(resolveExchangeSession({exchange:'TSX',at:at('2026-07-06T14:00:00Z'),coverage}).session).toBe('REGULAR');
  expect(resolveExchangeSession({exchange:'TSE',at:at('2026-07-06T03:00:00Z'),coverage}).session).toBe('BREAK');
  expect(resolveExchangeSession({exchange:'HKEX',at:at('2026-07-06T04:30:00Z'),coverage}).session).toBe('BREAK');
 });
 it('requires explicit holiday coverage and accepts sourced holiday/early-close overrides',()=>{
  expect(resolveExchangeSession({exchange:'LSE',at:at('2026-07-06T09:00:00Z'),holidays:['2026-07-06'],coverage}).session).toBe('CLOSED');
  expect(resolveExchangeSession({exchange:'NASDAQ',at:at('2026-07-06T17:30:00Z'),earlyCloses:{'2026-07-06':780},coverage}).session).toBe('POST');
  expect(resolveExchangeSession({exchange:'NASDAQ',at:at('2026-07-06T14:00:00Z')})).toMatchObject({session:'REGULAR',calendarQuality:'partial',holidayCoverageSource:null});
  expect(resolveExchangeSession({exchange:'UNKNOWN',at:at('2026-07-06T14:00:00Z')}).session).toBe('UNKNOWN');
 });
});
describe('interval-aware history freshness',()=>{
 it('fails closed if holiday coverage is incomplete',()=>{
  const session=resolveExchangeSession({exchange:'NASDAQ',at:at('2026-07-06T14:00:00Z')});
  expect(classifyMarketHistoryFreshness({observedAt:at('2026-07-06T13:59:00Z'),now:at('2026-07-06T14:00:00Z'),interval:'1',session})).toBe('unknown');
 });
 it('accepts only a fresh, same-exchange-day provider market-status snapshot',()=>{
  const now = at('2026-07-06T14:00:00Z');
  const fresh = resolveExchangeSession({
   exchange:'NASDAQ', at:now,
   marketStatus:{isOpen:true,session:'REGULAR',holiday:null,timeZone:'America/New_York',observedAt:now-1000,receivedAt:now}
  });
  expect(fresh).toMatchObject({session:'REGULAR',calendarQuality:'complete',holidayCoverageSource:'Finnhub market-status'});
  const stale = resolveExchangeSession({
   exchange:'NASDAQ', at:now,
   marketStatus:{isOpen:true,session:'REGULAR',holiday:null,timeZone:'America/New_York',observedAt:now-10*60_000,receivedAt:now}
  });
  expect(stale.calendarQuality).toBe('partial');
  const wrongZone = resolveExchangeSession({
   exchange:'NASDAQ', at:now,
   marketStatus:{isOpen:true,session:'REGULAR',holiday:null,timeZone:'Europe/London',observedAt:now,receivedAt:now}
  });
  expect(wrongZone.calendarQuality).toBe('partial');
 });
 it('classifies intraday freshness only during regular session',()=>{
  const session=resolveExchangeSession({exchange:'NASDAQ',at:at('2026-07-06T14:00:00Z'),coverage});
  expect(classifyMarketHistoryFreshness({observedAt:at('2026-07-06T13:59:00Z'),now:at('2026-07-06T14:00:00Z'),interval:'1',session})).toBe('fresh');
 });
});
