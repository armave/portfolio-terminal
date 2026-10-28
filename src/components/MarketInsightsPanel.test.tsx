import { describe, expect, it } from 'vitest';
import { getStocktwitsCashtags, getVisibleStocktwitsMessages, hasStocktwitsCommentary, isStandaloneStocktwitsMessage } from './MarketInsightsPanel';

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

describe('getVisibleStocktwitsMessages', () => {
  it('shows up to ten recent standalone posts without filtering their content', () => {
    const messages = Array.from({ length: 14 }, (_, id) => ({
      id,
      body: id === 0 ? '$AAPL' : id === 1 ? '$AAPL $MSFT' : `Post ${id}`,
      ...(id === 3 ? { in_reply_to: 1 } : {})
    }));

    const visible = getVisibleStocktwitsMessages(messages);

    expect(visible).toHaveLength(10);
    expect(visible.map((message) => message.id)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns fewer than ten when the source has fewer standalone posts', () => {
    expect(getVisibleStocktwitsMessages([
      { id: 1, body: '$AAPL' },
      { id: 2, in_reply_to: 1 },
      { id: 3, body: 'Bullish $AAPL $MSFT' }
    ])).toHaveLength(2);
  });
});
