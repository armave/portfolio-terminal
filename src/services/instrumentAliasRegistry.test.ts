import { describe, expect, it } from 'vitest';
import { createInstrumentAliasRegistry, DEFAULT_INSTRUMENT_ALIAS_RECORDS } from './instrumentAliasRegistry';
describe('effective-dated instrument alias registry',()=>{
 const registry=createInstrumentAliasRegistry(DEFAULT_INSTRUMENT_ALIAS_RECORDS);
 it('resolves FB and META to one stable CUSIP across the effective date',()=>{
  expect(registry.resolve('FB','NASDAQ','2022-06-08')).toMatchObject({instrumentId:'CUSIP:30303M102',canonicalSymbol:'META',historicalSymbol:'FB'});
  expect(registry.resolve('META','NASDAQ','2022-06-09')).toMatchObject({instrumentId:'CUSIP:30303M102',canonicalSymbol:'META',historicalSymbol:'META'});
  expect(registry.resolve('FB','NASDAQ','2022-06-09')).toBeNull();
 });
 it('requires a sourced HTTPS record and rejects overlapping symbol assignments',()=>{
  expect(()=>createInstrumentAliasRegistry([{...DEFAULT_INSTRUMENT_ALIAS_RECORDS[0],sourceUrl:'http://example.com'}])).toThrow('HTTPS');
  expect(()=>createInstrumentAliasRegistry([{...DEFAULT_INSTRUMENT_ALIAS_RECORDS[0],symbols:[{symbol:'FB',validFrom:'2012-05-18',validThrough:null},{symbol:'META',validFrom:'2022-06-09',validThrough:null}]}])).toThrow('overlap');
 });
 it('resolves the symbol active on the supplied history date',()=>{
  expect(registry.resolveCurrentSymbol('FB','NASDAQ','2022-06-08')).toMatchObject({
   historicalSymbol:'FB',canonicalSymbol:'META',asOf:'2022-06-08'
  });
  expect(registry.resolveCurrentSymbol('META','NASDAQ','2022-06-09')).toMatchObject({
   historicalSymbol:'META',canonicalSymbol:'META',asOf:'2022-06-09'
  });
 });
 it('returns detached registry records so callers cannot mutate the verified alias source',()=>{
  const records=registry.list();
  records[0].symbols[0].symbol='BROKEN';
  expect(registry.resolve('FB','NASDAQ','2022-06-08')?.historicalSymbol).toBe('FB');
 });
 it('returns null for unknown instrument and invalid as-of date',()=>{
  expect(registry.resolve('FB','NYSE','2022-06-08')).toBeNull();
  expect(registry.resolve('FB','NASDAQ','2022-02-30')).toBeNull();
 });
});
