import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('responsive app shell width', () => {
  const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('keeps the desktop root mount centered within a maximum width', () => {
    expect(html).toContain('id="root" class="max-w-6xl mx-auto pt-10"');
  });

  it('stretches the body, root, and workspace to the mobile viewport', () => {
    const mobileShellStart = styles.indexOf('/* Mobile shell: stretch the workspace across narrow viewports. */');
    expect(mobileShellStart).toBeGreaterThanOrEqual(0);
    const mobileShell = styles.slice(mobileShellStart);

    expect(mobileShell).toMatch(/@media \(max-width: 767px\)/);
    expect(mobileShell).toMatch(/body\s*\{[^}]*padding-left:\s*env\(safe-area-inset-left\)/);
    expect(mobileShell).toMatch(/#root\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*margin-inline:\s*0/);
    expect(mobileShell).toMatch(/#mainTerminalView\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/);
  });
});
