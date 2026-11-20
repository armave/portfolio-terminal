import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('Combined workspace responsive disclosures', () => {
  it('keeps disclosure summaries and ticker controls keyboard-visible', () => {
    expect(styles).toContain('.workspace-disclosure>summary:focus-visible');
    expect(styles).toContain('.market-insights-ticker-control select:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion:reduce)');
  });
});
