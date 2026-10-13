import { useState, useEffect, useRef } from 'preact/hooks';

export interface AuthModalProps {
  isOpen: boolean;
  onSaveSecret: (secret: string) => void | Promise<void>;
}

export function AuthModal({ isOpen, onSaveSecret }: AuthModalProps) {
  const [secret, setSecret] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    onSaveSecret(secret.trim());
  };

  return (
    <div class="auth-card border-card">
      <div class="space-y-1">
        <h2 class="text-sm font-bold text-emerald-400 tracking-wider uppercase">
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
          onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          placeholder="Enter Gateway Secret"
          required
          class="flex-1 bg-slate-900 text-slate-200 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500"
        />
        <button
          id="authSaveButton"
          type="submit"
          class="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition"
        >
          Save
        </button>
      </form>
    </div>
  );
}