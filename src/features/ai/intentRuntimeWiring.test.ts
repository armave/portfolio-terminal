import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../../app.ts', import.meta.url), 'utf8');

describe('AI intent application wiring', () => {
  it('routes read-only AI intents through the deterministic command dispatcher', () => {
    expect(source).toContain('const command = buildAiIntentCommand(parsed, activeTicker);');
    expect(source).toContain('await executeCommand(command, true);');
  });

  it('rejects obsolete requests and changed portfolio context before showing/applying results', () => {
    expect(source).toContain('if (!aiRequestLifecycle.isCurrent(requestId)) return;');
    expect(source).toContain('aiIntentRequiresFreshPortfolioContext(parsed.intent');
    expect(source).toContain("localResult.type !== 'unrecognized' && !isAiPrefixed");
    expect(source).toContain("const aiQuery = text.replace(/^(?:ai|ask)");
    expect(source).toContain('latestContextFingerprint !== contextFingerprint');
    expect(source).toContain('aiRequestLifecycle.invalidate();');
  });

  it('retains the explicit confirmation boundary for all AI portfolio-changing intents', () => {
    expect(source).toContain('applyAiPortfolioActionAfterConfirmation(');
    expect(source).toContain('confirmAiPortfolioAction,');
    expect(source).toContain('applyPortfolioActions');
  });
});
