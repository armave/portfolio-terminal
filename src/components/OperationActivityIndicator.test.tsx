import { describe, expect, it } from 'vitest';
import { OperationActivityIndicator } from './OperationActivityIndicator';

describe('OperationActivityIndicator', () => {
  it('does not render when its caller reports no visible operation', () => {
    expect(OperationActivityIndicator({ visible: false, label: 'Refreshing history' })).toBeNull();
  });

  it('renders an accessible labelled status for foreground work', () => {
    const indicator = OperationActivityIndicator({
      visible: true,
      label: 'Refreshing history…',
      ariaLabel: 'Refreshing TradeNet execution history…',
      tone: 'purple',
      size: 'inline'
    });

    expect(indicator?.type).toBe('span');
    expect(indicator?.props.role).toBe('status');
    expect(indicator?.props['aria-live']).toBe('polite');
    expect(indicator?.props['aria-busy']).toBe('true');
    expect(indicator?.props['aria-label']).toBe('Refreshing TradeNet execution history…');
    expect(indicator?.props['data-operation-activity']).toBe('purple');
    expect(indicator?.props.children[0].props.class).toContain('motion-reduce:animate-none');
    expect(indicator?.props.children[1].props.children).toBe('Refreshing history…');
  });

  it('can render a compact decorative spinner when the containing control already has an accessible label', () => {
    const indicator = OperationActivityIndicator({
      visible: true,
      label: 'Syncing…',
      tone: 'cyan',
      size: 'compact',
      showLabel: false,
      announce: false
    });

    expect(indicator?.props.role).not.toBe('status');
    expect(indicator?.props['aria-live']).not.toBe('polite');
    expect(indicator?.props['aria-hidden']).toBe('true');
    expect(indicator?.props['aria-label']).not.toBe('Syncing…');
    expect(indicator?.props.children[0].props.class).toContain('h-2.5 w-2.5');
    expect(indicator?.props.children[1]).toBeFalsy();
  });
});
