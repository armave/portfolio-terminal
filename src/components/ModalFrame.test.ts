import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('shared modal frame', () => {
  it('owns accessible dialog semantics and only dismisses when the backdrop itself is clicked', () => {
    const frame = readSource('./ModalFrame.tsx');

    expect(frame).toContain('role="presentation"');
    expect(frame).toContain('role="dialog"');
    expect(frame).toContain('aria-modal="true"');
    expect(frame).toContain('aria-labelledby={ariaLabelledBy}');
    expect(frame).toContain('tabIndex={-1}');
    expect(frame).toContain('event.target === event.currentTarget');
    expect(frame).toContain('onBackdropClick()');
  });

  it('is reused by every backdrop-based modal while keeping focus and content in their owning modules', () => {
    const modalPaths = [
      './ScenarioComparisonModal.tsx',
      './ScenarioReportModal.tsx',
      './ExitComparisonModal.tsx',
      './MarginIntelligenceModal.tsx',
      './MarketDepthModal.tsx',
      './MarginRiskOverviewModal.tsx',
      './MarketInsightsPanel.tsx'
    ];

    for (const path of modalPaths) {
      const source = readSource(path);
      expect(source, path).toContain('<ModalFrame');
      expect(source, path).toContain('dialogRef={');
      expect(source, path).toContain('ariaLabelledBy=');
      expect(source, path).toContain('useDialogFocus(');
      expect(source, path).not.toContain('role="dialog"');
    }
  });

  it('retains portal mounting for overlays that must escape app stacking contexts', () => {
    for (const path of [
      './ExitComparisonModal.tsx',
      './MarginRiskOverviewModal.tsx',
      './MarketInsightsPanel.tsx'
    ]) {
      const source = readSource(path);
      expect(source, path).toContain('createPortal(');
      expect(source, path).toContain('document.body');
    }
  });

  it('preserves caller-owned transitions and custom dialog styling', () => {
    const comparison = readSource('./ScenarioComparisonModal.tsx');
    const report = readSource('./ScenarioReportModal.tsx');
    const exit = readSource('./ExitComparisonModal.tsx');

    expect(comparison).toContain('backdropStyle=');
    expect(comparison).toContain('dialogStyle=');
    expect(comparison).toContain('scenario-modal-closing');
    expect(report).toContain('transition-[opacity,transform]');
    expect(exit).toContain('motion-reduce:transition-none');
    expect(exit).toContain('isClosing || !isOpen');
  });
});
