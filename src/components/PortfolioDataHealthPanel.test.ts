import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateText } from '../services/i18n';

const source = readFileSync(new URL('./PortfolioDataHealthPanel.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const style = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const englishCopy = [
  'Data & sync', 'Portfolio status', 'Needs review', 'Up to date', 'Check data',
  'Snapshot received', 'Broker snapshot', 'Assigned snapshot', 'Quote freshness',
  'Cloud synchronization', 'Assigned data refresh', 'Review in Settings'
];

describe('Portfolio Data Health panel', () => {
  it('mounts one compact combined health and sync control in the workspace header', () => {
    expect(app).not.toContain('CloudSyncIndicator');
    expect(app).toContain('<PortfolioDataHealthPanel');
    expect(app).toContain('{permissions.isAdmin && currentUser && <PortfolioDataHealthPanel');
    expect(source).toContain('resolveCloudSyncTone(cloudStatus, cloudSyncStatus)');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-expanded={dialogOpen}');
    expect(source).toContain('aria-controls="portfolioDataHealthDialog"');
    expect(source).toContain('class="portfolio-data-health__label"');
    expect(source).toContain('class="portfolio-data-health__state"');
  });

  it('uses a neutral idle label for unknown data and reserves Up to date for verified health', () => {
    expect(source).toContain("? 'Up to date'");
    expect(source).toContain(": 'Check data'");
    expect(source).toContain("if (!isAdmin || overallTone === 'healthy') return null");
    expect(source).not.toContain('portfolio-data-health-modal__subtitle');
    expect(source).not.toContain('Checking data status');
    expect(source).toContain("overallTone === 'warning'");
    expect(source).toContain('isSyncPending');
  });

  it('distinguishes client receipt time from unavailable provider observation time', () => {
    expect(source).toContain("translateText('Observation time unavailable', language)");
    expect(source).toContain("translateText('Received', language)");
    expect(source).toContain('formatSnapshotTime(brokerSnapshot?.receivedAt, language, now)');
    expect(source).toContain("typeof observedAt === 'number'");
  });

  it('opens an accessible modal and restores keyboard focus to the header trigger', () => {
    expect(source).toContain("import { createPortal } from 'preact/compat'");
    expect(source).toContain("import { useDialogFocus } from '../ui/dialogFocus'");
    expect(source).toContain('<ModalFrame');
    expect(source).toContain('useDialogFocus(dialogRef, {');
    expect(source).toContain('initialFocusRef: closeButtonRef');
    expect(source).toContain('restoreFocusRef: triggerRef');
    expect(source).toContain('ariaLabelledBy="portfolioDataHealthTitle"');
    expect(source).toContain('id="portfolioDataHealthClose"');
    expect(source).toContain('onEscape: requestClose');
  });

  it('keeps role-scoped sources and existing sync/conflict recovery actions', () => {
    expect(source).toContain('selectPortfolioDataHealthSource(state, isAdmin)');
    expect(source).toContain("source.role === 'admin' ? source.brokerAccountInfo : undefined");
    expect(source).toContain("source.role === 'guest' ? source.guestSnapshot : undefined");
    expect(source).toContain('summarizeGuestPortfolioQuoteFreshness(guestSnapshot');
    expect(source).toContain("emitUiEvent('portfolio:sync-request'");
    expect(source).toContain("emitUiEvent('portfolio:set-active-view', { view: 'SETTINGS' })");
    expect(source).toContain('disabled={syncing}');
    expect(source).toContain('hasCloudConflict');
    expect(source).toContain("isAdmin ? 'Cloud synchronization' : 'Assigned data refresh'");
  });

  it('keeps the combined chip compact and the modal within the mobile viewport', () => {
    expect(style).toContain('.portfolio-data-health__trigger');
    expect(style).toContain('.portfolio-data-health-modal-backdrop');
    expect(style).toContain('.portfolio-data-health-modal');
    expect(style).toMatch(/\.portfolio-data-health__trigger\s*\{[^}]*min-height:\s*2\.75rem/s);
    expect(style).toMatch(/\.portfolio-data-health__action,\s*\.empty-state-panel__actions button\s*\{[^}]*min-height:\s*2\.75rem/s);
    expect(style).toMatch(/\.portfolio-data-health-modal\s*\{[^}]*max-height:\s*min\(44rem,\s*calc\(100dvh - 1\.5rem\)\)/s);
    expect(style).toMatch(/\.portfolio-data-health-modal-backdrop\s*\{[^}]*align-items:\s*center/s);
    expect(style).toContain('@media (max-width: 639px)');
  });

  it('keeps all labels in the application translation flow', () => {
    for (const copy of englishCopy) expect(source).toContain(copy);
    expect(source).not.toContain('Cloud status details from Worker payload');
  });

  it('provides Russian translations for the full health and sync vocabulary', () => {
    for (const copy of [
      ...englishCopy, 'Current', 'Partial snapshot', 'Empty snapshot',
      'Stale snapshot', 'Status unknown', 'No tracked quotes', 'No assigned holdings', 'Syncing…'
    ]) {
      expect(translateText(copy, 'ru'), copy).not.toBe(copy);
    }
  });
});
