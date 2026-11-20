import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getSafeNewsArticleUrl } from '../features/quotes/marketInsightsContent';

describe('Margin Intelligence source article links', () => {
  it('accepts only absolute HTTP(S) URLs without credentials or unsafe schemes', () => {
    expect(getSafeNewsArticleUrl('https://example.com/article')).toBe('https://example.com/article');
    expect(getSafeNewsArticleUrl('http://example.com/article')).toBe('http://example.com/article');
    expect(getSafeNewsArticleUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeNewsArticleUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(getSafeNewsArticleUrl('https://user:password@example.com/article')).toBeNull();
  });

  it('validates provider-supplied URLs before rendering external links', () => {
    const source = readFileSync(new URL('./MarginIntelligenceModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const safeArticleUrl = getSafeNewsArticleUrl(article.url)');
    expect(source).toContain('href={safeArticleUrl}');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).not.toContain('href={article.url}');
  });
  it('discloses the external AI provider and the data sent for analysis', () => {
    const source = readFileSync(new URL('./MarginIntelligenceModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('When a Margin Intelligence review is generated, selected portfolio facts and up to 12 recent news headlines and summaries are sent to Google Gemini. The generated review and selected source metadata are saved as an encrypted cloud digest.');
    expect(source).toContain('translateText(');
  });

});
