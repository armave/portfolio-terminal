import { describe, expect, it } from 'vitest';
import { renderStocktwitsBody } from './stocktwitsMessagePresentation';

describe('renderStocktwitsBody', () => {
  it('highlights cashtags without changing surrounding message text', () => {
    const rendered = renderStocktwitsBody('Watching $aapl and $MSFT today');
    expect(Array.isArray(rendered)).toBe(true);
    const parts = rendered as Array<unknown>;
    expect(parts[0]).toBe('Watching ');
    expect(parts[2]).toBe(' and ');
    expect(parts[4]).toBe(' today');

    const cashtags = [parts[1], parts[3]] as Array<{ type: unknown; props: { children: string; class: string } }>;
    expect(cashtags.map(node => node.props.children)).toEqual(['$aapl', '$MSFT']);
    expect(cashtags.every(node => node.type === 'span' && node.props.class.includes('text-cyan-300'))).toBe(true);
  });

  it('leaves ordinary dollar amounts as message text', () => {
    const rendered = renderStocktwitsBody('Spent $125, then watched $AAPL');
    const parts = rendered as Array<unknown>;
    expect(parts[0]).toBe('Spent $125, then watched ');
    expect((parts[1] as { props: { children: string } }).props.children).toBe('$AAPL');
  });
});
