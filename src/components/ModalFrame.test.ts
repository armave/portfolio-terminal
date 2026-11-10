import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('shared modal frame', () => {
  it('owns the common opening and closing animation lifecycle', () => {
    const frame = readSource('./ModalFrame.tsx');

    expect(frame).toContain("type ModalPhase = 'opening' | 'open' | 'closing'");
    expect(frame).toContain('MODAL_TRANSITION_MS = 200');
    expect(frame).toContain('view.requestAnimationFrame');
    expect(frame).toContain('window.setTimeout');
    expect(frame).toContain('prefers-reduced-motion: reduce');
    expect(frame).toContain('data-modal-state={phase}');
    expect(frame).toContain('translate3d(0, 10px, 0) scale(0.985)');
    expect(frame).toContain('transition: dialogTransition');
    expect(frame).toContain('closeRef.current = requestClose');
    expect(frame).toContain('onCloseRef.current()');
    expect(frame).toContain("phaseRef.current === 'closing'");
  });

  it('owns accessible dialog semantics and only dismisses when the backdrop itself is clicked', () => {
    const frame = readSource('./ModalFrame.tsx');

    expect(frame).toContain('role="presentation"');
    expect(frame).toContain('role="dialog"');
    expect(frame).toContain('aria-modal="true"');
    expect(frame).toContain('aria-labelledby={ariaLabelledBy}');
    expect(frame).toContain('tabIndex={-1}');
    expect(frame).toContain('event.target === event.currentTarget');
    expect(frame).toContain('requestClose();');
  });

  it('routes all migrated modal close controls through the shared frame lifecycle', () => {
    const modalPaths = [
      './ScenarioComparisonModal.tsx',
      './ScenarioReportModal.tsx',
      './ExitComparisonModal.tsx',
      './MarginIntelligenceModal.tsx',
      './MarketDepthModal.tsx',
      './MarginRiskOverviewModal.tsx'
    ];

    for (const path of modalPaths) {
      const source = readSource(path);
      expect(source, path).toContain('<ModalFrame');
      expect(source, path).toContain('closeRef={closeRef}');
      expect(source, path).toContain('onClose={onClose}');
      expect(source, path).toContain('closeRef.current?.()');
      expect(source, path).not.toContain('scheduleDialogClose');
    }

    const news = readSource('./MarketInsightsPanel.tsx');
    expect(news).toContain('closeRef={newsCloseRef}');
    expect(news).toContain('onClose={dismissNewsDialog}');
    expect(news).toContain('newsCloseRef.current?.()');
  });

  it('keeps focus management and content in their owning modules', () => {
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

  it('keeps scenario comparison dialogs inside the viewport and scrolls wide tables independently', () => {
    const comparison = readSource('./ScenarioComparisonModal.tsx');

    expect(comparison).toContain('overflow-y-auto overscroll-contain');
    expect(comparison).toContain('max-h-[calc(100dvh-1rem)]');
    expect(comparison).toContain('min-h-0 w-full min-w-0');
    expect(comparison).toContain('overflow-x-auto overscroll-x-contain');
    expect(comparison).toContain('min-w-[42rem]');
  });

  it('preserves caller-owned backgrounds and custom dialog styling while the frame animates', () => {
    const comparison = readSource('./ScenarioComparisonModal.tsx');
    const report = readSource('./ScenarioReportModal.tsx');
    const exit = readSource('./ExitComparisonModal.tsx');
    const frame = readSource('./ModalFrame.tsx');

    expect(comparison).toContain('backdropStyle=');
    expect(comparison).toContain('dialogStyle=');
    expect(report).toContain('scenario-modal-dialog');
    expect(exit).toContain('exit-comparison-dialog');
    expect(frame).toContain("typeof backdropStyle === 'object' && backdropStyle !== null");
    expect(frame).toContain("typeof dialogStyle === 'object' && dialogStyle !== null");
  });
});
