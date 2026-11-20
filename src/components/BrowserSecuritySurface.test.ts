import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name)) || TEST_FILE.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe('browser security source boundaries', () => {
  it('keeps raw HTML insertion APIs out of production application source', () => {
    const forbidden = /\b(?:dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc)\b|document\.write\s*\(/;
    const findings = productionSourceFiles(SOURCE_ROOT).flatMap(path => {
      const source = readFileSync(path, 'utf8');
      return forbidden.test(source) ? [path.slice(SOURCE_ROOT.length + 1)] : [];
    });
    expect(findings).toEqual([]);
  });

  it('keeps external navigation confined to fixed or HTTP(S)-validated destinations', () => {
    const boardLinks = readFileSync(join(SOURCE_ROOT, 'components', 'BoardExternalLinks.tsx'), 'utf8');
    const articleDialog = readFileSync(join(SOURCE_ROOT, 'components', 'MarketNewsArticleDialog.tsx'), 'utf8');
    const marginDialog = readFileSync(join(SOURCE_ROOT, 'components', 'MarginIntelligenceModal.tsx'), 'utf8');
    const insightsPanel = readFileSync(join(SOURCE_ROOT, 'components', 'MarketInsightsPanel.tsx'), 'utf8');
    const urlValidator = readFileSync(join(SOURCE_ROOT, 'features', 'quotes', 'marketInsightsContent.ts'), 'utf8');
    const settings = readFileSync(join(SOURCE_ROOT, 'components', 'SettingsDesk.tsx'), 'utf8');

    expect(boardLinks).toContain('const symbol = encodeURIComponent(ticker)');
    expect(boardLinks).toContain('https://finviz.com/stock');
    expect(boardLinks).toContain('https://stocktwits.com/symbol/');
    expect(boardLinks).toContain('https://tradingview.com/chart/');
    expect(boardLinks).toContain('rel="noopener noreferrer"');

    expect(urlValidator).toContain("url.protocol !== 'https:' && url.protocol !== 'http:'");
    expect(urlValidator).toContain('url.username || url.password');
    expect(articleDialog).toContain('getSafeNewsArticleUrl(article.url)');
    expect(marginDialog).toContain('getSafeNewsArticleUrl(article.url)');
    expect(insightsPanel).toContain('getSafeNewsArticleUrl(currentStocktwitsData?.streamUrl)');
    expect(articleDialog).toContain('rel="noopener noreferrer"');
    expect(marginDialog).toContain('rel="noopener noreferrer"');
    expect(insightsPanel).toContain('rel="noopener noreferrer"');

    const settingsExternalLinks = settings.match(/<a\b[^>]*href="[^"]+"/g) || [];
    expect(settingsExternalLinks.every(link => /href="#settings-[a-z-]+"/.test(link))).toBe(true);
  });
});
