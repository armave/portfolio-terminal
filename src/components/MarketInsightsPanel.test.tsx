import { describe, expect, it } from 'vitest';
import { getStocktwitsCashtags, getVisibleStocktwitsMessages, handleNewsDialogKeyDown, hasStocktwitsCommentary, isBearishStocktwitsMessage, isStandaloneStocktwitsMessage } from './MarketInsightsPanel';

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


describe('handleNewsDialogKeyDown', () => {
  it('closes the dialog and prevents Escape from reaching the page', () => {
    let prevented = false;
    let closed = false;

    handleNewsDialogKeyDown({
      key: 'Escape',
      shiftKey: false,
      preventDefault: () => { prevented = true; }
    }, [], null, () => { closed = true; });

    expect(prevented).toBe(true);
    expect(closed).toBe(true);
  });

  it('wraps Shift+Tab from the first control to the last control', () => {
    const focused: string[] = [];
    const first = { focus: () => focused.push('first') };
    const last = { focus: () => focused.push('last') };
    let prevented = false;

    handleNewsDialogKeyDown({
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { prevented = true; }
    }, [first, last], first, () => undefined);

    expect(prevented).toBe(true);
    expect(focused).toEqual(['last']);
  });

  it('wraps Tab from the last control to the first control', () => {
    const focused: string[] = [];
    const first = { focus: () => focused.push('first') };
    const last = { focus: () => focused.push('last') };
    let prevented = false;

    handleNewsDialogKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { prevented = true; }
    }, [first, last], last, () => undefined);

    expect(prevented).toBe(true);
    expect(focused).toEqual(['first']);
  });

  it('moves focus back inside when the active element is outside the dialog', () => {
    const focused: string[] = [];
    const first = { focus: () => focused.push('first') };
    const last = { focus: () => focused.push('last') };

    handleNewsDialogKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => undefined
    }, [first, last], null, () => undefined);

    expect(focused).toEqual(['first']);
  });

  it('leaves normal Tab movement alone between controls', () => {
    const focused: string[] = [];
    const first = { focus: () => focused.push('first') };
    const middle = { focus: () => focused.push('middle') };
    const last = { focus: () => focused.push('last') };
    let prevented = false;

    handleNewsDialogKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { prevented = true; }
    }, [first, middle, last], middle, () => undefined);

    expect(prevented).toBe(false);
    expect(focused).toEqual([]);
  });

  it('prevents focus from escaping when the dialog has no focusable controls', () => {
    let prevented = false;

    handleNewsDialogKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { prevented = true; }
    }, [], null, () => undefined);

    expect(prevented).toBe(true);
  });
});
