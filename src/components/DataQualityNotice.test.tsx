import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { DataQualityNotice } from './DataQualityNotice';

describe('DataQualityNotice', () => {
  it('renders the caller-classified status and preserves caller-provided explanation content', () => {
    const explanation = h('p', { class: 'quality-explanation' }, 'Missing prices remain unavailable.');
    const notice = DataQualityNotice({
      title: 'Risk data quality',
      status: 'incomplete',
      statusLabel: 'Incomplete',
      className: 'portfolio-data-quality-summary',
      children: explanation
    });

    expect(notice.type).toBe('section');
    expect(notice.props.role).toBe('group');
    expect(notice.props['aria-label']).toBe('Risk data quality');
    expect(notice.props['data-quality-status']).toBe('incomplete');
    expect(notice.props.class).toContain('data-quality-notice--incomplete');
    expect(notice.props.class).toContain('portfolio-data-quality-summary');
    expect(notice.props.children[0].props.children[1].props.children).toBe('Incomplete');
    expect(notice.props.children[1]).toBe(explanation);
  });

  it('keeps provisional and unavailable data visibly distinct', () => {
    const provisional = DataQualityNotice({
      title: 'Risk data quality',
      status: 'provisional',
      statusLabel: 'Provisional estimate'
    });
    const unavailable = DataQualityNotice({
      title: 'Risk data quality',
      status: 'unavailable',
      statusLabel: 'Unavailable'
    });

    expect(provisional.props['data-quality-status']).toBe('provisional');
    expect(provisional.props.class).toContain('border-amber-900/60');
    expect(unavailable.props['data-quality-status']).toBe('unavailable');
    expect(unavailable.props.class).toContain('border-rose-900/50');
  });
});
