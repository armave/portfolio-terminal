import '../style.css';
import '../app';
import { pullCloudState, pushCloudState } from './services/api';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

/**
 * Reduce browser and password-manager autofill suggestions across the app.
 * The gateway secret field is excluded to preserve normal credential handling.
 *
 * Mobile browsers can ignore autocomplete="off" for ordinary text fields, so
 * use the stronger "new-password" hint for non-auth fields and disable mobile
 * text correction. This is a best-effort browser hint, not a guarantee against
 * OS-level autofill services.
 */
function disableAutofillForNonAuthFields() {
  const authFieldSelector = '#gatewaySecretInput';
  const fieldSelector = 'input, textarea, select';

  const configureField = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    if (field.matches(authFieldSelector)) return;

    // "off" is ignored by some mobile browsers; "new-password" is a stronger
    // hint that discourages stored-value suggestions without changing the value.
    const autocomplete = field instanceof HTMLSelectElement ? 'off' : 'new-password';
    if (field.getAttribute('autocomplete') !== autocomplete) {
      field.setAttribute('autocomplete', autocomplete);
    }

    if (field.getAttribute('data-lpignore') !== 'true') {
      field.setAttribute('data-lpignore', 'true');
    }
    if (field.getAttribute('data-1p-ignore') !== 'true') {
      field.setAttribute('data-1p-ignore', 'true');
    }

    if (!(field instanceof HTMLSelectElement)) {
      if (field.getAttribute('autocorrect') !== 'off') field.setAttribute('autocorrect', 'off');
      if (field.getAttribute('autocapitalize') !== 'off') field.setAttribute('autocapitalize', 'off');
      if (field.getAttribute('spellcheck') !== 'false') field.setAttribute('spellcheck', 'false');
    }
  };

  const configureFields = (root: ParentNode) => {
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(fieldSelector)
      .forEach(configureField);
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement || root instanceof HTMLSelectElement) {
      configureField(root);
    }
  };

  configureFields(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) configureFields(node);
      }
      if (
        record.type === 'attributes' &&
        (record.target instanceof HTMLInputElement ||
          record.target instanceof HTMLTextAreaElement ||
          record.target instanceof HTMLSelectElement)
      ) {
        configureField(record.target);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'autocomplete', 'name']
  });
}

if (typeof document !== 'undefined') {
  disableAutofillForNonAuthFields();
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).pullCloudState = pullCloudState;
  (window as unknown as Record<string, unknown>).pushCloudState = pushCloudState;
}
