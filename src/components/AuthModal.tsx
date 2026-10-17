import { useState, useEffect, useRef } from 'preact/hooks';

export interface AuthModalProps {
  isOpen: boolean;
  onSaveSecret: (secret: string) => boolean | void | Promise<boolean | void>;
}

export function AuthModal({ isOpen, onSaveSecret }: AuthModalProps) {
  const [secret, setSecret] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleDialogKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSecret('');
      inputRef.current?.focus();
      return;
    }

    if (event.key !== 'Tab') return;
    const form = inputRef.current?.form;
    const saveButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const input = inputRef.current;
    if (!input || !saveButton) return;

    if (event.shiftKey && document.activeElement === input) {
      event.preventDefault();
      saveButton.focus();
    } else if (!event.shiftKey && document.activeElement === saveButton) {
      event.preventDefault();
      input.focus();
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setInvalid(false);
    try {
      const accepted = await onSaveSecret(secret.trim());
      if (accepted === false) {
        setSecret('');
        setInvalid(true);
        inputRef.current?.focus();
      } else {
        setSecret('');
      }
    } catch {
      setSecret('');
      setInvalid(true);
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="auth-card border-card" role="dialog" aria-modal="true" aria-labelledby="authModalTitle" onKeyDown={handleDialogKeyDown}>
      <div class="space-y-1">
        <h2 id="authModalTitle" class="text-sm font-bold text-emerald-400 tracking-wider uppercase">
          Gateway Authentication
        </h2>
        <p class="text-xs text-slate-400">
          Enter Gateway Secret to unlock the terminal and sync data.
        </p>
      </div>
      <form onSubmit={handleSubmit} class="flex flex-col sm:flex-row gap-2 pt-2">
        <input
          ref={inputRef}
          type="password"
          id="gatewaySecretInput"
          value={secret}
          onInput={(e) => { setSecret((e.target as HTMLInputElement).value); setInvalid(false); }}
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          placeholder="Enter Gateway Secret"
          required
          class={"flex-1 bg-slate-900 text-slate-200 border rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 " + (invalid ? "border-red-500" : "border-slate-700")} aria-invalid={invalid}
        />
        <button
          id="authSaveButton"
          type="submit"
          class="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition"
        >
          {submitting ? 'Checking…' : 'Save'}
        </button>
      </form>
      {invalid && <p class="text-xs text-red-400" role="alert">Invalid Gateway Secret. Please try again.</p>}
    </div>
  );
}