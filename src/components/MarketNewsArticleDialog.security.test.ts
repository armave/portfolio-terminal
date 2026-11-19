import { readFileSync } from 'node:fs';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';

const dialogSource = readFileSync(new URL('./MarketNewsArticleDialog.tsx', import.meta.url), 'utf8');

describe('company news article untrusted text boundary', () => {
  it('keeps provider headlines and article bodies in direct Preact text-child positions', () => {
    // These represent hostile values returned by an untrusted news provider.
    const hostileHeadline = '<img src=x onerror="window.__ptXss=1">';
    const hostileBody = '<svg onload="window.__ptXss=2"><script>alert(1)</script></svg>';
    const headlineVNode = h('h2', null, hostileHeadline);
    const bodyVNode = h('div', null, hostileBody);
    expect(typeof headlineVNode.props.children).toBe('string');
    expect(headlineVNode.props.children).toBe(hostileHeadline);
    expect(typeof bodyVNode.props.children).toBe('string');
    expect(bodyVNode.props.children).toBe(hostileBody);

    const headlineStart = dialogSource.indexOf('<h2 id="newsArticleModalTitle"');
    const headlineExpressionStart = dialogSource.indexOf('{article.headline', headlineStart);
    const headlineEnd = dialogSource.indexOf('</h2>', headlineStart);
    expect(headlineStart).toBeGreaterThanOrEqual(0);
    expect(headlineExpressionStart).toBeGreaterThan(headlineStart);
    expect(headlineEnd).toBeGreaterThan(headlineExpressionStart);
    expect(dialogSource.slice(headlineExpressionStart, headlineEnd))
      .toContain("{article.headline || 'Untitled article'}");

    const articleRegionStart = dialogSource.indexOf('class="news-article-content');
    const bodyElementStart = dialogSource.indexOf('class="whitespace-pre-wrap break-words leading-relaxed text-slate-300"', articleRegionStart);
    const bodyExpressionStart = dialogSource.indexOf('{article.summary', bodyElementStart);
    const bodyElementEnd = dialogSource.indexOf('</div>', bodyExpressionStart);
    expect(articleRegionStart).toBeGreaterThanOrEqual(0);
    expect(bodyElementStart).toBeGreaterThan(articleRegionStart);
    expect(bodyExpressionStart).toBeGreaterThan(bodyElementStart);
    expect(bodyElementEnd).toBeGreaterThan(bodyExpressionStart);
    expect(dialogSource.slice(bodyExpressionStart, bodyElementEnd))
      .toContain("{article.summary || article.description || article.content || 'A summary is not available from the news provider. Open the original article for the full story.'}");
  });

  it('does not introduce raw HTML insertion APIs in the article dialog', () => {
    expect(dialogSource).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/);
  });
});
