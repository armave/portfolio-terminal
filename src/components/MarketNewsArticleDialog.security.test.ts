import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

const dialogSource = readFileSync(new URL('./MarketNewsArticleDialog.tsx', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile(
  'MarketNewsArticleDialog.tsx',
  dialogSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function descendants(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function jsxTagName(element: ts.JsxElement): string {
  return element.openingElement.tagName.getText(sourceFile);
}

function jsxStringAttribute(element: ts.JsxElement, name: string): string | null {
  const attribute = element.openingElement.attributes.properties.find((property) =>
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
  );
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer &&
    ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function directChildExpressions(element: ts.JsxElement): ts.Expression[] {
  return element.children.flatMap((child) =>
    ts.isJsxExpression(child) && child.expression ? [child.expression] : []
  );
}

describe('company news article untrusted text boundary', () => {
  it('keeps provider headlines and article bodies as Preact text children', () => {
    // These represent untrusted provider values. Preact must receive them as
    // JSX text children so markup-like content is rendered as text, not parsed.
    const hostileHeadline = '<img src=x onerror="window.__ptXss=1">';
    const hostileBody = '<svg onload="window.__ptXss=2"><script>alert(1)</script></svg>';
    expect(hostileHeadline).toContain('onerror=');
    expect(hostileBody).toContain('onload=');

    const elements = descendants(sourceFile).filter(ts.isJsxElement);
    const headline = elements.find((element) =>
      jsxTagName(element) === 'h2' &&
      jsxStringAttribute(element, 'id') === 'newsArticleModalTitle'
    );
    expect(headline, 'news title must remain the labelled heading').toBeDefined();
    const headlineExpressions = headline ? directChildExpressions(headline) : [];
    expect(headlineExpressions).toHaveLength(1);
    expect(headlineExpressions[0]?.getText(sourceFile)).toContain('article.headline');

    const articleRegion = elements.find((element) =>
      jsxTagName(element) === 'div' &&
      (jsxStringAttribute(element, 'class') || '').includes('news-article-content')
    );
    expect(articleRegion, 'article text must remain inside the labelled content region').toBeDefined();

    const contentBlocks = articleRegion
      ? descendants(articleRegion).filter((node): node is ts.JsxElement =>
        ts.isJsxElement(node) &&
        jsxTagName(node) === 'div' &&
        (jsxStringAttribute(node, 'class') || '').includes('whitespace-pre-wrap')
      )
      : [];
    expect(contentBlocks).toHaveLength(1);
    const bodyExpressions = directChildExpressions(contentBlocks[0]);
    expect(bodyExpressions).toHaveLength(1);
    const bodyExpression = bodyExpressions[0]?.getText(sourceFile) || '';
    expect(bodyExpression).toContain('article.summary');
    expect(bodyExpression).toContain('article.description');
    expect(bodyExpression).toContain('article.content');
  });

  it('does not introduce raw HTML insertion APIs in the article dialog', () => {
    const forbiddenDomSinks = new Set([
      'dangerouslySetInnerHTML',
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML'
    ]);
    const usedSinks = descendants(sourceFile).flatMap((node) => {
      if (ts.isPropertyAccessExpression(node) && forbiddenDomSinks.has(node.name.text)) {
        return [node.name.text];
      }
      if (ts.isJsxAttribute(node) && forbiddenDomSinks.has(node.name.getText(sourceFile))) {
        return [node.name.getText(sourceFile)];
      }
      return [];
    });

    expect(usedSinks).toEqual([]);
  });
});
