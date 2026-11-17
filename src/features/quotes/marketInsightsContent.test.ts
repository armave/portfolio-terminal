import { describe, expect, it } from 'vitest';
import { getSafeNewsArticleUrl } from './marketInsightsContent';

describe('getSafeNewsArticleUrl', () => {
  it('accepts absolute HTTP and HTTPS destinations and returns their canonical URL', () => {
    expect(getSafeNewsArticleUrl('https://example.com/research?q=ABC#summary'))
      .toBe('https://example.com/research?q=ABC#summary');
    expect(getSafeNewsArticleUrl('http://example.com/article'))
      .toBe('http://example.com/article');
  });

  it('rejects non-web and executable URL schemes', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'mailto:research@example.com',
      'blob:https://example.com/id'
    ]) {
      expect(getSafeNewsArticleUrl(value), value).toBeNull();
    }
  });

  it('rejects protocol-relative and malformed destinations', () => {
    for (const value of [
      '//example.com/article',
      'https://',
      'https://exa mple.com/article',
      'https://example.com:invalid/article'
    ]) {
      expect(getSafeNewsArticleUrl(value), value).toBeNull();
    }
  });

  it('rejects URLs containing embedded usernames or passwords', () => {
    expect(getSafeNewsArticleUrl('https://user@example.com/article')).toBeNull();
    expect(getSafeNewsArticleUrl('https://user:secret@example.com/article')).toBeNull();
  });

  it('rejects non-string, blank, and overlong input without throwing', () => {
    for (const value of [null, undefined, 42, {}, '', '   ']) {
      expect(getSafeNewsArticleUrl(value)).toBeNull();
    }
    expect(getSafeNewsArticleUrl(`https://example.com/${'a'.repeat(2_048)}`)).toBeNull();
  });
});
