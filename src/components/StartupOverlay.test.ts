import type { VNode } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { StartupOverlay } from './StartupOverlay';

type TestVNode = VNode & { props: VNode['props'] & Record<string, unknown> };

function visitNodes(value: unknown, visitor: (node: TestVNode) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitNodes(item, visitor));
    return;
  }
  if (!value || typeof value !== 'object' || !('type' in value) || !('props' in value)) return;
  const node = value as TestVNode;
  visitor(node);
  visitNodes(node.props.children, visitor);
}

function collectText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  if (value && typeof value === 'object' && 'props' in value) {
    return collectText((value as TestVNode).props.children);
  }
  return '';
}

afterEach(() => setAppLanguage('en'));

describe('startup overlay', () => {
  it('presents an accessible, indeterminate loading state without claiming a percentage', () => {
    const view = StartupOverlay({
      failed: false,
      onRetry: vi.fn(),
      onContinueOffline: vi.fn(),
      onRepair: vi.fn()
    });

    expect(view.props.role).toBe('status');
    expect(view.props['aria-live']).toBe('polite');
    expect(view.props['aria-busy']).toBe(true);
    expect(view.props['aria-labelledby']).toBe('startup-loading-title');
    expect(collectText(view)).toContain('Preparing your workspace');
    expect(collectText(view)).toContain('The app is checking its first page before opening.');

    const buttons: TestVNode[] = [];
    const decorativeTracks: TestVNode[] = [];
    visitNodes(view, (node) => {
      if (node.type === 'button') buttons.push(node);
      if (node.props.class === 'startup-loading__track') decorativeTracks.push(node);
    });
    expect(buttons).toHaveLength(0);
    expect(decorativeTracks).toHaveLength(1);
  });

  it('announces failures and orders recovery actions from least disruptive to app-cache repair', () => {
    const onRetry = vi.fn();
    const onContinueOffline = vi.fn();
    const onRepair = vi.fn();
    const view = StartupOverlay({
      failed: true,
      onRetry,
      onContinueOffline,
      onRepair
    });

    expect(view.props.role).toBe('alert');
    expect(view.props['aria-live']).toBe('assertive');
    expect(view.props['aria-busy']).toBe(false);
    expect(collectText(view)).toContain('Your saved portfolio and sign-in credentials will be kept.');
    expect(collectText(view)).toContain('Repair clears only this app’s cached files.');

    const buttons: TestVNode[] = [];
    visitNodes(view, (node) => {
      if (node.type === 'button') buttons.push(node);
    });
    expect(buttons.map((button) => collectText(button))).toEqual([
      'Retry',
      'Continue offline',
      'Repair app cache'
    ]);

    (buttons[0].props.onClick as () => void)();
    (buttons[1].props.onClick as () => void)();
    (buttons[2].props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onContinueOffline).toHaveBeenCalledTimes(1);
    expect(onRepair).toHaveBeenCalledTimes(1);
  });

  it('renders startup and recovery copy in the selected account language', () => {
    setAppLanguage('ru');
    const view = StartupOverlay({
      failed: true,
      onRetry: vi.fn(),
      onContinueOffline: vi.fn(),
      onRepair: vi.fn()
    });
    const text = collectText(view);
    expect(text).toContain('ТРЕБУЕТСЯ ВНИМАНИЕ ПРИ ЗАПУСКЕ');
    expect(text).toContain('Восстановить кэш приложения');
  });
});
