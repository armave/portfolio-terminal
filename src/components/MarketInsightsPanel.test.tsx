import { describe, expect, it } from 'vitest';
import { formatNewsRelativeTime, getStocktwitsCashtags, getVisibleStocktwitsMessages, hasStocktwitsCommentary, isBearishStocktwitsMessage, isStandaloneStocktwitsMessage } from './MarketInsightsPanel';

describe('formatNewsRelativeTime', () => {
  it('converts positive provider Unix seconds into relative time', () => {
    const now = 1_800_000_000_000;
    expect(formatNewsRelativeTime(1_799_999_940, now)).toBe('1m ago');
    expect(formatNewsRelativeTime('1799999940', now)).toBe('1m ago');
  });

  it('shows unknown time instead of interpreting missing values as the Unix epoch', () => {
    const now = 1_800_000_000_000;
    for (const value of [null, undefined, '', '   ', 0, -1, Number.NaN, 'not-a-time', true]) {
      expect(formatNewsRelativeTime(value, now)).toBe('Time unknown');
    }
  });
});

describe('getStocktwitsCashtags', () => {
  it('returns unique ticker cashtags in uppercase', () => {
    expect(getStocktwitsCashtags('Watching $aapl and $MSFT; $AAPL again')).toEqual(['AAPL', 'MSFT']);
  });

  it('returns no tickers when a message has no cashtags', () => {
    expect(getStocktwitsCashtags('Market is choppy today')).toEqual([]);
  });

  it('safely handles malformed message bodies', () => {
    expect(getStocktwitsCashtags(null)).toEqual([]);
    expect(getStocktwitsCashtags(undefined)).toEqual([]);
  });

  it('does not treat ordinary dollar amounts as ticker symbols', () => {
    expect(getStocktwitsCashtags('Bought shares for $125 and waiting')).toEqual([]);
  });
});

describe('hasStocktwitsCommentary', () => {
  it('filters posts containing only ticker symbols and punctuation', () => {
    expect(hasStocktwitsCommentary('$AAPL')).toBe(false);
    expect(hasStocktwitsCommentary('$AAPL $MSFT')).toBe(false);
    expect(hasStocktwitsCommentary('  $aapl, $AAPL!  ')).toBe(false);
  });

  it('keeps posts with commentary alongside a ticker', () => {
    expect(hasStocktwitsCommentary('$AAPL looking bullish')).toBe(true);
    expect(hasStocktwitsCommentary('$MSFT 🚀')).toBe(true);
  });

  it('safely rejects missing or malformed bodies', () => {
    expect(hasStocktwitsCommentary(null)).toBe(false);
    expect(hasStocktwitsCommentary(undefined)).toBe(false);
  });
});


describe('isStandaloneStocktwitsMessage', () => {
  it('keeps original posts without reply metadata', () => {
    expect(isStandaloneStocktwitsMessage({ id: 1, body: '$AAPL bullish' })).toBe(true);
    expect(isStandaloneStocktwitsMessage({ conversation: { parent_message_id: null } })).toBe(true);
  });

  it('filters replies identified by conversation parent or reply fields', () => {
    expect(isStandaloneStocktwitsMessage({ conversation: { parent_message_id: 42 } })).toBe(false);
    expect(isStandaloneStocktwitsMessage({ in_reply_to: 42 })).toBe(false);
    expect(isStandaloneStocktwitsMessage({ reply_to: { id: 42 } })).toBe(false);
  });

  it('rejects malformed messages', () => {
    expect(isStandaloneStocktwitsMessage(null)).toBe(false);
    expect(isStandaloneStocktwitsMessage('message')).toBe(false);
  });
});

describe('isBearishStocktwitsMessage', () => {
  it('filters direct bearish sentiment case-insensitively', () => {
    expect(isBearishStocktwitsMessage({ sentiment: { basic: 'Bearish' } })).toBe(true);
    expect(isBearishStocktwitsMessage({ sentiment: { basic: ' bearish ' } })).toBe(true);
  });

  it('uses entity sentiment when the primary sentiment is absent', () => {
    expect(isBearishStocktwitsMessage({ entities: { sentiment: { basic: 'BEARISH' } } })).toBe(true);
  });

  it('keeps bullish, neutral, unknown, and malformed sentiment values', () => {
    expect(isBearishStocktwitsMessage({ sentiment: { basic: 'Bullish' } })).toBe(false);
    expect(isBearishStocktwitsMessage({ entities: { sentiment: { basic: 'Neutral' } } })).toBe(false);
    expect(isBearishStocktwitsMessage({ body: 'No sentiment label' })).toBe(false);
    expect(isBearishStocktwitsMessage(null)).toBe(false);
  });

  it('matches the sentiment shown by the feed when sources disagree', () => {
    expect(isBearishStocktwitsMessage({
      sentiment: { basic: 'Bullish' },
      entities: { sentiment: { basic: 'Bearish' } }
    })).toBe(false);
  });
});

describe('getVisibleStocktwitsMessages', () => {
  it('shows up to ten recent standalone non-bearish posts', () => {
    const messages = Array.from({ length: 14 }, (_, id) => ({
      id,
      body: id === 0 ? '$AAPL' : id === 1 ? '$AAPL $MSFT' : `Post ${id}`,
      ...(id === 3 ? { in_reply_to: 1 } : {}),
      ...(id === 4 ? { sentiment: { basic: 'Bearish' } } : {}),
      ...(id === 5 ? { entities: { sentiment: { basic: 'bearish' } } } : {})
    }));

    const visible = getVisibleStocktwitsMessages(messages);

    expect(visible).toHaveLength(10);
    expect(visible.map((message) => message.id)).toEqual([0, 1, 2, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('returns fewer than ten when the source has fewer standalone posts', () => {
    expect(getVisibleStocktwitsMessages([
      { id: 1, body: '$AAPL' },
      { id: 2, in_reply_to: 1 },
      { id: 3, body: 'Bullish $AAPL $MSFT' },
      { id: 4, body: 'Bearish $AAPL', sentiment: { basic: 'Bearish' } }
    ])).toHaveLength(2);
  });
});
