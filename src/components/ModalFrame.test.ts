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
      './ExitComparisonModal.tsx',
      './MarginIntelligenceModal.tsx',
      './MarketDepthModal.tsx',
      './MarginRiskOverviewModal.tsx',
      './TrancheDetailsModal.tsx'
    ];

    for (const path of modalPaths) {
      const source = readSource(path);
      expect(source, path).toContain('<ModalFrame');
      expect(source, path).toContain('closeRef={closeRef}');
      expect(source, path).toContain('onClose={onClose}');
      expect(source, path).toContain('closeRef.current?.()');
      expect(source, path).not.toContain('scheduleDialogClose');
    }

    const news = readSource('./MarketNewsArticleDialog.tsx');
    expect(news).toContain('closeRef={closeRef}');
    expect(news).toContain('onClose={onClose}');
    expect(news).toContain('closeRef.current?.()');
  });

  it('keeps focus management and content in their owning modules', () => {
    const modalPaths = [
      './ExitComparisonModal.tsx',
      './MarginIntelligenceModal.tsx',
      './MarketDepthModal.tsx',
      './MarginRiskOverviewModal.tsx',
      './TrancheDetailsModal.tsx',
      './MarketNewsArticleDialog.tsx'
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
      './TrancheDetailsModal.tsx',
      './MarketNewsArticleDialog.tsx'
    ]) {
      const source = readSource(path);
      expect(source, path).toContain('createPortal(');
      expect(source, path).toContain('document.body');
    }
  });

  it('preserves caller-owned backgrounds and custom dialog styling while the frame animates', () => {
    const exit = readSource('./ExitComparisonModal.tsx');
    const frame = readSource('./ModalFrame.tsx');

    expect(exit).toContain('exit-comparison-dialog');
    expect(frame).toContain("typeof backdropStyle === 'object' && backdropStyle !== null");
    expect(frame).toContain("typeof dialogStyle === 'object' && dialogStyle !== null");
  });
  it('keeps the company-news article portal and focus lifecycle in its own component', () => {
    const panel = readSource('./MarketInsightsPanel.tsx');
    const dialog = readSource('./MarketNewsArticleDialog.tsx');

    expect(panel).toContain('<MarketNewsArticleDialog');
    expect(panel).not.toContain('createPortal(');
    expect(panel).not.toContain('useDialogFocus(');
    expect(dialog).toContain('createPortal(');
    expect(dialog).toContain('useDialogFocus(');
    expect(dialog).toContain('ariaLabelledBy="newsArticleModalTitle"');
    expect(dialog).toContain('restoreFocusRef');
  });

});
