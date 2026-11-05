import { describe, expect, it } from 'vitest';
import { buildAiIntentCommand } from './intentCommand';
import type { AiIntent } from './intent';

describe('AI read-only intent command routing', () => {
  it('routes simulations through the deterministic projection command', () => {
    expect(buildAiIntentCommand({
      intent: 'simulation', ticker: 'AAPL', simPrice: 205.5, daysOffset: 14, label: 'Two weeks'
    })).toBe('sim AAPL 205.5 in 14d');
  });

  it('uses the selected active position when a read-only intent omits its ticker', () => {
    expect(buildAiIntentCommand({
      intent: 'simulation', ticker: null, simPrice: 205, daysOffset: 0, label: 'Today'
    }, 'googl')).toBe('sim GOOGL 205 in 0d');
    expect(buildAiIntentCommand({ intent: 'fetch_quote', ticker: null }, 'MSFT')).toBe('quote MSFT');
  });

  it('routes two-price comparisons to the existing exit comparison engine', () => {
    const intent: AiIntent = {
      intent: 'comparison', ticker: 'GOOGL',
      scenarios: [
        { label: 'Today', price: 294, days: 0 },
        { label: 'Two weeks', price: 310.25, days: 14 }
      ]
    };
    expect(buildAiIntentCommand(intent)).toBe('compare exits GOOGL today at 294, in 14 days at 310.25');
  });

  it('routes quote requests to the existing live quote path', () => {
    expect(buildAiIntentCommand({ intent: 'fetch_quote', ticker: 'AAPL' })).toBe('quote AAPL');
  });

  it('does not invent an instrument when no active ticker is available', () => {
    expect(buildAiIntentCommand({
      intent: 'simulation', ticker: null, simPrice: 200, daysOffset: 7, label: 'Next week'
    })).toBeNull();
  });

  it('rejects tickers and numbers that the local command grammar cannot safely express', () => {
    expect(buildAiIntentCommand({ intent: 'fetch_quote', ticker: 'BRK.B' })).toBeNull();
    expect(buildAiIntentCommand({
      intent: 'simulation', ticker: 'AAPL', simPrice: Number.MAX_VALUE, daysOffset: 7, label: 'Later'
    })).toBeNull();
    expect(buildAiIntentCommand({
      intent: 'simulation', ticker: 'AAPL', simPrice: 200, daysOffset: 3651, label: 'Too far'
    })).toBeNull();
  });

  it('never turns chat or portfolio-changing intents into an automatic command', () => {
    const action: AiIntent = {
      intent: 'action', action: 'buy', ticker: 'AAPL', shares: 1, price: 100, pt: null, date: null
    };
    expect(buildAiIntentCommand({ intent: 'chat', response: 'Please clarify.' })).toBeNull();
    expect(buildAiIntentCommand(action, 'AAPL')).toBeNull();
  });
});
