import { getAppLanguage, translateText } from '../services/i18n';

export interface StartupOverlayProps {
  failed: boolean;
  onRetry: () => void;
  onContinueOffline: () => void;
  onRepair: () => void;
}

/** Critical first-paint overlay; keep its layout/styles in startup-critical.css. */
export function StartupOverlay({
  failed,
  onRetry,
  onContinueOffline,
  onRepair
}: StartupOverlayProps) {
  const language = getAppLanguage();
  const t = (copy: string) => translateText(copy, language);

  return (
    <div
      class={`startup-loading${failed ? ' startup-loading--failed' : ''}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      aria-busy={!failed}
      aria-labelledby="startup-loading-title"
      aria-describedby="startup-loading-detail startup-loading-hint"
    >
      <section class={`startup-loading__content${failed ? ' is-failed' : ''}`}>
        <header class="startup-loading__header">
          <div class="startup-loading__mark" aria-hidden="true">PT</div>
          <div class="startup-loading__identity">
            <p class="startup-loading__brand">{t('PORTFOLIO TERMINAL')}</p>
            <p class="startup-loading__eyebrow">
              {t(failed ? 'STARTUP NEEDS ATTENTION' : 'WORKSPACE STARTUP')}
            </p>
          </div>
        </header>

        <div class="startup-loading__divider" aria-hidden="true" />

        <div class="startup-loading__copy">
          <h1 id="startup-loading-title" class="startup-loading__message">
            {t(failed ? 'Could not finish initializing the app.' : 'Preparing your workspace')}
          </h1>
          <p id="startup-loading-detail" class="startup-loading__detail">
            {t(failed
              ? 'Check your connection, then retry or continue offline.'
              : 'Restoring saved data and preparing the active page.')}
          </p>
        </div>

        {!failed && (
          <div class="startup-loading__track" aria-hidden="true">
            <span />
          </div>
        )}

        <p id="startup-loading-hint" class="startup-loading__hint">
          {t(failed
            ? 'Your saved portfolio and sign-in credentials will be kept.'
            : 'The app is checking its first page before opening.')}
        </p>

        {failed && (
          <>
            <div class="startup-loading__recovery-note">
              <span class="startup-loading__recovery-icon" aria-hidden="true">i</span>
              <p>{t('Repair clears only this app’s cached files. Your portfolio and sign-in data are kept.')}</p>
            </div>
            <div class="startup-loading__actions">
              <button type="button" class="startup-loading__button startup-loading__button--primary" onClick={onRetry}>
                {t('Retry')}
              </button>
              <button type="button" class="startup-loading__button startup-loading__button--secondary" onClick={onContinueOffline}>
                {t('Continue offline')}
              </button>
              <button type="button" class="startup-loading__button startup-loading__button--tertiary" onClick={onRepair}>
                {t('Repair app cache')}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
