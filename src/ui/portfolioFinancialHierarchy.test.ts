import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');
const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

const renderBoardSource = readFileSync(new URL('./renderBoard.ts', import.meta.url), 'utf8');

describe('financial target and carry-break-even scope', () => {
  it('keeps the Combined Portfolio title standalone and outside the ticker target panel', () => {
    const combinedBranchStart = appSource.indexOf("{activeDeskView === 'COMBINED' ? (");
    const combinedBranchEnd = appSource.indexOf(") : (", combinedBranchStart);
    const combinedHeaderBranch = appSource.slice(combinedBranchStart, combinedBranchEnd);

    expect(combinedBranchStart).toBeGreaterThanOrEqual(0);
    expect(combinedHeaderBranch).toContain('id="boardTitle"');
    expect(combinedHeaderBranch).not.toContain('boardTargetSection');
  });

  it('uses the portfolio-wide target-price post-sale balance floor horizon', () => {
    expect(runtimeSource).not.toContain("translateText('BE', getAppLanguage())");
    expect(summarySource).toContain("translateText('Post-sale balance floor', getAppLanguage())");
    expect(runtimeSource).toContain('getPortfolioNetSaleProceeds(state, TRADERNET_RULES)');
    expect(runtimeSource).toContain('calculatePostSaleBalanceFloorHorizon');
    expect(runtimeSource).toContain("translateText('Post-sale balance estimate unavailable', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('Already below floor', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('No projected floor breach within 10 years', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('No active trades', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('days', getAppLanguage())");
  });

  it('visibly identifies the external analyst target source on ticker views', () => {
    expect(runtimeSource).toContain('${analystTargetLabel} · ${snapshot.source}');
  });
});

describe('Stage 3 before/after visual review evidence', () => {
  const smokeSource = readFileSync(new URL('../../scripts/browser-smoke.mjs', import.meta.url), 'utf8');
  const workflowSource = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

  it('captures the admin ticker and guest Balance surfaces at mobile, tablet and desktop sizes', () => {
    expect(smokeSource).toContain("captureUxReviewScreenshots(page, 'admin-combined')");
    expect(smokeSource).toContain("captureUxReviewScreenshots(page, 'admin-ticker')");
    expect(smokeSource).toContain("captureUxReviewScreenshots(page, 'guest-balance')");
    expect(smokeSource).toContain("{ name: 'mobile', width: 390, height: 844 }");
    expect(smokeSource).toContain("{ name: 'tablet', width: 768, height: 1024 }");
    expect(smokeSource).toContain("{ name: 'desktop', width: 1440, height: 900 }");
    expect(smokeSource).toContain('process.env.UX_SCREENSHOT_DIR');
  });

  it('compares the PR base build with the PR head and uploads the matching captures', () => {
    expect(workflowSource).toContain('git worktree add --detach "$BEFORE_WORKTREE" "$PR_BASE_SHA"');
    expect(workflowSource).toContain('AFTER_CHECKOUT_SHA="$(git rev-parse HEAD)"');
    expect(workflowSource).toContain('After tested checkout (PR merge candidate): $AFTER_CHECKOUT_SHA');
    expect(workflowSource).toContain('UX_SCREENSHOT_DIR="$GITHUB_WORKSPACE/artifacts/ux-visual-review/before"');
    expect(workflowSource).toContain('UX_SCREENSHOT_DIR="$GITHUB_WORKSPACE/artifacts/ux-visual-review/after"');
    expect(workflowSource).toContain('ux-visual-review-${{ github.event.pull_request.number }}-${{ github.run_id }}');
    expect(workflowSource).toContain('path: artifacts/ux-visual-review/');
  });
});

describe('financial title and KPI single-source presentation', () => {
  it('keeps Combined title treatment and groups ticker identity, PT and analyst target together', () => {
    const combinedTitle = renderBoardSource.slice(
      renderBoardSource.indexOf('if (isCombined)'),
      renderBoardSource.indexOf("if (typeof onRenderAnalystConsensus === 'function' && tickers[0])")
    );
    expect(combinedTitle).toContain('COMBINED PORTFOLIO (${tickers.length} Positions)');
    expect(combinedTitle).not.toContain('Net Target');
    expect(renderBoardSource).toContain('title: pos.ticker');
    expect(renderBoardSource).toContain('shareCount: pos.shares');
    expect(renderBoardSource).toContain('dailyMovePercent:');
    expect(renderBoardSource).toContain('marginPtValue: formatUSD(pos.pt)');
    expect(renderBoardSource).toContain('marginPtReturnText:');
    expect(renderBoardSource).toContain('formatMarginTargetDifference(pos.pt, pos.currentPrice)');
    expect(renderBoardSource).not.toContain('metrics.netPct');
    expect(appSource).toContain("{activeDeskView === 'COMBINED' ? (");
    expect(appSource).toContain('id="boardTickerIdentity"');
    expect(appSource).toContain('id="boardTargetSection"');
    expect(appSource).toContain('id="boardMarginTarget"');
    expect(appSource).toContain('id="boardAnalystConsensus"');
    expect(appSource).toContain('analystConsensus.upsideText');
    expect(appSource).toContain('translateText(shareCount === 1 ? \'share\' : \'shares\', getAppLanguage())');
    expect(renderBoardSource).not.toContain('Margin PT ${formatUSD(pos.pt)} in the ticker title');
    expect(renderBoardSource).not.toContain('Guest PT');
  });

  it('keeps Guest Stocks PT-free and labels the Yahoo target consistently', () => {
    const guestSource = readFileSync(new URL('../components/CashCushionDesk.tsx', import.meta.url), 'utf8');
    expect(guestSource).toContain("translateText('Analyst (Yahoo)', getAppLanguage())");
    expect(guestSource).not.toContain('Margin PT');
    expect(guestSource).toContain('guest-stock-value-section');
  });
});
