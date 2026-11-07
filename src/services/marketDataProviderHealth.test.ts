import { describe, expect, it } from 'vitest';
import { createMarketDataProviderHealth } from './marketDataProviderHealth';
describe('market provider health',()=>{
 it('distinguishes unknown from healthy and records success',()=>{
  const health=createMarketDataProviderHealth({now:()=>1000});
  expect(health.getSnapshot('freedom-websocket').status).toBe('unknown');
  expect(health.recordSuccess('freedom-websocket')).toMatchObject({status:'healthy',successes:1,lastSuccessAt:1000});
 });
 it('degrades after failures and exposes bounded retry cooldown',()=>{
  const health=createMarketDataProviderHealth({failureThreshold:2,cooldownMs:5000,now:()=>10000});
  expect(health.recordFailure('FINNHUB')).toMatchObject({status:'degraded',consecutiveFailures:1,retryAfter:null});
  expect(health.recordFailure('FINNHUB')).toMatchObject({status:'unavailable',consecutiveFailures:2,retryAfter:15000});
  expect(health.canAttempt('FINNHUB',14999)).toBe(false);
  expect(health.canAttempt('FINNHUB',15000)).toBe(true);
  expect(health.recordSuccess('FINNHUB',15001)).toMatchObject({status:'healthy',retryAfter:null});
 });
 it('enforces cooldown only after the configured consecutive-failure threshold',()=> {
  let now = 100;
  const health = createMarketDataProviderHealth({ now: () => now, failureThreshold: 2, cooldownMs: 500 });
  expect(health.canAttempt('YAHOO')).toBe(true);
  health.recordFailure('YAHOO');
  expect(health.canAttempt('YAHOO')).toBe(true);
  health.recordFailure('YAHOO');
  expect(health.canAttempt('YAHOO')).toBe(false);
  expect(health.getSnapshot('YAHOO')).toMatchObject({ status: 'unavailable', retryAfter: 600 });
  now = 600;
  expect(health.canAttempt('YAHOO')).toBe(true);
  expect(health.getSnapshot('YAHOO').status).toBe('degraded');
 });

 it('normalizes and resets provider IDs',()=>{
  const health=createMarketDataProviderHealth();health.recordFailure(' yahoo ');
  expect(health.list()[0].providerId).toBe('YAHOO');health.reset('YAHOO');expect(health.list()).toEqual([]);
 });
});
