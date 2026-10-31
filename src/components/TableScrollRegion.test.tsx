import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { TableScrollRegion } from './TableScrollRegion';

afterEach(() => setAppLanguage('en'));

describe('TableScrollRegion', () => {
  it('provides a named keyboard-focusable region with shared scroll and focus styling', () => {
    const table = h('table', null);
    const region = TableScrollRegion({
      label: 'Guest assignment history table',
      children: table,
      className: 'table-scroll-wrapper',
      focusClassName: 'focus-visible:outline-indigo-400'
    });

    expect(region.type).toBe('div');
    expect(region.props.role).toBe('region');
    expect(region.props['aria-label']).toBe('Guest assignment history table');
    expect(region.props.tabIndex).toBe(0);
    expect(region.props.class).toContain('overflow-x-auto');
    expect(region.props.class).toContain('table-scroll-wrapper');
    expect(region.props.class).toContain('focus-visible:outline');
    expect(region.props.class).toContain('focus-visible:outline-indigo-400');
    expect(region.props.children).toBe(table);
  });

  it('can leave the tab order while its containing panel is collapsed', () => {
    const region = TableScrollRegion({
      label: 'Active tranches and guest assignments',
      children: h('table', null),
      tabIndex: -1
    });

    expect(region.props.tabIndex).toBe(-1);
  });

  it('localizes its accessible region name', () => {
    setAppLanguage('ru');
    const region = TableScrollRegion({
      label: 'Guest assignment history table',
      children: h('table', null)
    });

    expect(region.props['aria-label']).toBe('Таблица истории назначений гостю');
  });
});
