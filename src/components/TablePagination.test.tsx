import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { TablePagination } from './TablePagination';

afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

function flatten(node: any): any[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== 'object' || !('type' in node)) return [];
  return [node, ...flatten(node.props?.children)];
}

const baseProps = {
  tableLabel: 'Closed history',
  page: 2,
  pageCount: 8,
  pageSize: 25,
  start: 26,
  end: 50,
  total: 190,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  controlsId: 'closedHistoryBody'
};

describe('TablePagination', () => {
  it('renders compact page-size and navigation controls connected to the table body', () => {
    const view = TablePagination(baseProps)!;
    const nodes = flatten(view);
    const select = nodes.find((node) => node.type === 'select');

    expect(view.type).toBe('div');
    expect(view.props.role).toBe('group');
    expect(view.props['aria-controls']).toBe('closedHistoryBody');
    expect(select).toBeDefined();
    expect(select.props.value).toBe('25');
    expect(select.props['aria-label']).toBe('Rows per page for Closed history');
    expect(nodes.filter((node) => node.type === 'option').map((node) => node.props.value))
      .toEqual(['10', '25', '50', '100']);
  });

  it('wires page-size and previous/next actions to their supplied callbacks', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const nodes = flatten(TablePagination({ ...baseProps, onPageChange, onPageSizeChange }));
    const select = nodes.find((node) => node.type === 'select');
    const buttons = nodes.filter((node) => node.type === 'button');

    select.props.onChange({ currentTarget: { value: '50' } });
    buttons[0].props.onClick();
    buttons[1].props.onClick();

    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
    expect(buttons[0].props.disabled).toBe(false);
    expect(buttons[1].props.disabled).toBe(false);
  });

  it('localizes its accessible labels and hides controls for an empty table', () => {
    setAppLanguage('ru');
    const view = TablePagination(baseProps)!;
    const nodes = flatten(view);
    const select = nodes.find((node) => node.type === 'select');

    expect(view.props['aria-label']).toBe('Страницы: Closed history');
    expect(select.props['aria-label']).toBe('Строк на странице: Closed history');
    expect(TablePagination({ ...baseProps, total: 0 })).toBeNull();
  });
});
