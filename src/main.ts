import '../style.css';
import '../app';
import { pullCloudState, pushCloudState } from './services/api';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

/**
 * Keep browser credential managers from treating ordinary portfolio fields as
 * password-save targets. The Gateway Authentication input is intentionally
 * excluded so normal authentication/password-manager behavior remains available.
 */
function disablePasswordSavingForNonAuthInputs() {
  const authInputSelector = '#gatewaySecretInput';

  const configureInput = (input: HTMLInputElement) => {
    if (input.matches(authInputSelector)) return;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-1p-ignore', 'true');
  };

  const configureInputs = (root: ParentNode) => {
    root.querySelectorAll<HTMLInputElement>('input').forEach(configureInput);
    if (root instanceof HTMLInputElement) configureInput(root);
  };

  configureInputs(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) configureInputs(node);
      }
      if (record.type === 'attributes' && record.target instanceof HTMLInputElement) {
        configureInput(record.target);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'autocomplete']
  });
}

if (typeof document !== 'undefined') {
  disablePasswordSavingForNonAuthInputs();
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).pullCloudState = pullCloudState;
  (window as unknown as Record<string, unknown>).pushCloudState = pushCloudState;
}
