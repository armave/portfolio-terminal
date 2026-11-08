interface InstrumentSymbolVersion { symbol: string; validFrom: string; validThrough: string | null; }
export interface InstrumentAliasRecord {
  instrumentId: string; canonicalSymbol: string; exchange: string; assetType: string; quoteCurrency: string | null;
  symbols: readonly InstrumentSymbolVersion[]; effectiveDate: string; sourceName: string; sourceUrl: string; verifiedAt: string;
}
export interface ResolvedInstrumentAlias {
  instrumentId: string; canonicalSymbol: string; historicalSymbol: string; exchange: string; assetType: string;
  quoteCurrency: string | null; asOf: string; record: InstrumentAliasRecord;
}
function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function normalizeSymbol(value: unknown): string { return typeof value === 'string' ? value.trim().toUpperCase() : ''; }
function validateRecord(record: InstrumentAliasRecord): void {
  if (!record.instrumentId.trim() || !/^[A-Z0-9:-]{3,64}$/i.test(record.instrumentId)) throw new Error('Instrument alias record requires a stable instrument ID.');
  if (!normalizeSymbol(record.canonicalSymbol) || !/^[A-Z0-9.^=-]{1,32}$/.test(normalizeSymbol(record.canonicalSymbol))) throw new Error('Instrument alias record has an invalid canonical symbol.');
  if (!record.exchange.trim() || !record.assetType.trim()) throw new Error('Instrument alias record requires exchange and asset type.');
  if (!isDateOnly(record.effectiveDate) || !isDateOnly(record.verifiedAt)) throw new Error('Instrument alias record requires valid effective and verification dates.');
  if (!record.sourceName.trim()) throw new Error('Instrument alias record requires source attribution.');
  let source: URL;
  try { source = new URL(record.sourceUrl); } catch { throw new Error('Instrument alias record requires a source URL.'); }
  if (source.protocol !== 'https:') throw new Error('Instrument alias source must use HTTPS.');
  if (!Array.isArray(record.symbols) || record.symbols.length === 0) throw new Error('Instrument alias record requires symbol history.');
  for (const version of record.symbols) {
    if (!normalizeSymbol(version.symbol) || !isDateOnly(version.validFrom) ||
        (version.validThrough !== null && !isDateOnly(version.validThrough)) ||
        (version.validThrough !== null && version.validThrough < version.validFrom)) throw new Error('Instrument alias record contains an invalid symbol validity range.');
  }
  const ordered = [...record.symbols].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i - 1].validThrough === null || ordered[i - 1].validThrough! >= ordered[i].validFrom) {
      throw new Error('Instrument alias symbol validity ranges overlap.');
    }
  }
}

function cloneRecord(record: InstrumentAliasRecord): InstrumentAliasRecord {
  return {
    ...record,
    symbols: record.symbols.map(version => ({ ...version }))
  };
}

function freezeRecord(record: InstrumentAliasRecord): InstrumentAliasRecord {
  const copy = cloneRecord(record);
  copy.symbols.forEach(version => Object.freeze(version));
  Object.freeze(copy.symbols);
  return Object.freeze(copy);
}

export function createInstrumentAliasRegistry(records: readonly InstrumentAliasRecord[]) {
  const byId = new Map<string, InstrumentAliasRecord>();
  const bySymbol = new Map<string, InstrumentAliasRecord[]>();
  for (const input of records) {
    validateRecord(input);
    const record = freezeRecord(input);
    if (byId.has(record.instrumentId)) throw new Error('Instrument alias instrument IDs must be unique.');
    byId.set(record.instrumentId, record);
    for (const version of record.symbols) {
      const key = record.exchange.toUpperCase() + ':' + normalizeSymbol(version.symbol);
      const assigned = bySymbol.get(key) ?? [];
      for (const other of assigned) {
        const match = other.symbols.find(item => normalizeSymbol(item.symbol) === normalizeSymbol(version.symbol))!;
        const overlap = (match.validThrough === null || match.validThrough >= version.validFrom) &&
          (version.validThrough === null || version.validThrough >= match.validFrom);
        if (overlap) throw new Error('Instrument alias symbol is assigned to overlapping instrument records.');
      }
      assigned.push(record);
      bySymbol.set(key, assigned);
    }
  }
  return {
    list: () => [...byId.values()].map(cloneRecord),
    resolve(symbolValue: string, exchangeValue: string, asOf: string): ResolvedInstrumentAlias | null {
      const symbol = normalizeSymbol(symbolValue), exchange = normalizeSymbol(exchangeValue);
      if (!symbol || !exchange || !isDateOnly(asOf)) return null;
      const record = (bySymbol.get(exchange + ':' + symbol) ?? []).find(candidate =>
        candidate.symbols.some(version => normalizeSymbol(version.symbol) === symbol &&
          version.validFrom <= asOf && (version.validThrough === null || asOf <= version.validThrough)));
      if (!record) return null;
      const active = record.symbols.find(version => version.validFrom <= asOf &&
        (version.validThrough === null || asOf <= version.validThrough));
      if (!active) return null;
      return {
        instrumentId: record.instrumentId, canonicalSymbol: record.canonicalSymbol,
        historicalSymbol: normalizeSymbol(active.symbol), exchange: record.exchange,
        assetType: record.assetType, quoteCurrency: record.quoteCurrency, asOf,
        record: cloneRecord(record)
      };
    },
    resolveCurrentSymbol(
      symbolValue: string,
      exchangeValue: string,
      asOf = new Date().toISOString().slice(0, 10)
    ): ResolvedInstrumentAlias | null {
      const symbol = normalizeSymbol(symbolValue), exchange = normalizeSymbol(exchangeValue);
      if (!symbol || !exchange || !isDateOnly(asOf)) return null;
      const record = (bySymbol.get(exchange + ':' + symbol) ?? []).find(candidate =>
        candidate.symbols.some(version => normalizeSymbol(version.symbol) === symbol));
      if (!record) return null;
      const active = record.symbols.find(version => version.validFrom <= asOf &&
        (version.validThrough === null || asOf <= version.validThrough));
      if (!active) return null;
      return {
        instrumentId: record.instrumentId, canonicalSymbol: record.canonicalSymbol,
        historicalSymbol: normalizeSymbol(active.symbol), exchange: record.exchange,
        assetType: record.assetType, quoteCurrency: record.quoteCurrency, asOf,
        record: cloneRecord(record)
      };
    }
  };
}
/** Nasdaq Equity Corporate Actions Alert #2022-125: FB→META, effective 2022-06-09. */
export const DEFAULT_INSTRUMENT_ALIAS_RECORDS: readonly InstrumentAliasRecord[] = [{
  instrumentId: 'CUSIP:30303M102',
  canonicalSymbol: 'META',
  exchange: 'NASDAQ',
  assetType: 'EQUITY',
  quoteCurrency: 'USD',
  effectiveDate: '2022-06-09',
  verifiedAt: '2022-06-03',
  sourceName: 'Nasdaq Equity Corporate Actions Alert #2022-125',
  sourceUrl: 'https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2022-125',
  symbols: [
    { symbol: 'FB', validFrom: '2012-05-18', validThrough: '2022-06-08' },
    { symbol: 'META', validFrom: '2022-06-09', validThrough: null }
  ]
}];
export const instrumentAliasRegistry = createInstrumentAliasRegistry(DEFAULT_INSTRUMENT_ALIAS_RECORDS);
