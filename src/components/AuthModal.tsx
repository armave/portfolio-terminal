
import { bootstrapAdmin, getAuthStatus, loginAccount } from "../services/api";
import { useState, useEffect, useRef } from "preact/hooks";
import { getGatewaySecret } from "../services/storage";
import { useDialogFocus } from "../ui/dialogFocus";

export interface AuthModalProps {
  isOpen: boolean;
  onSaveSecret: (sessionToken: string) => boolean | void | Promise<boolean | void>;
}

export function AuthModal({ isOpen, onSaveSecret }: AuthModalProps) {
  const [setupRequired, setSetupRequired] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useDialogFocus(dialogRef, { active: isOpen, initialFocusRef: nameRef });

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setStatusLoading(true);
    setError("");
    getAuthStatus()
      .then((status) => {
        if (!active) return;
        setSetupRequired(status.setupRequired);
        if (status.setupRequired) setBootstrapSecret(getGatewaySecret());
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not connect to the authentication service."); })
      .finally(() => { if (active) setStatusLoading(false); });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !statusLoading) nameRef.current?.focus();
  }, [isOpen, statusLoading]);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const session = setupRequired
        ? await bootstrapAdmin(name.trim(), password, bootstrapSecret)
        : await loginAccount(name.trim(), password);
      const accepted = await onSaveSecret(session.token);
      if (accepted === false) throw new Error("The account was created, but this device could not establish its session.");
      setPassword("");
      setBootstrapSecret("");
    } catch (reason) {
      setPassword("");
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
      if (setupRequired) {
        const status = await getAuthStatus().catch(() => null);
        if (status) setSetupRequired(status.setupRequired);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={dialogRef} class="auth-card auth-dialog-surface border-card" role="dialog" aria-modal="true" aria-labelledby="authModalTitle" aria-busy={submitting} tabIndex={-1}>
      <div class="space-y-1">
        <h2 id="authModalTitle" class="text-sm font-bold text-emerald-400 tracking-wider uppercase">
          {setupRequired ? "Create administrator account" : "Portfolio Terminal sign in"}
        </h2>
        <p class="text-xs text-slate-400">
          {setupRequired
            ? "Initial setup is one-time. Use the Worker Gateway Secret to create the first admin account."
            : "Sign in with the account created by an administrator."}
        </p>
      </div>
      {statusLoading ? <p class="text-xs text-slate-400" class="auth-feedback auth-feedback--status" role="status">Checking account setup…</p> : (
        <form onSubmit={handleSubmit} class="auth-form flex flex-col gap-2 pt-2">
          <label class="flex flex-col gap-1 text-xs text-slate-400">
            Name
            <input id="authUserName" name="username" ref={nameRef} type="text" value={name}
              onInput={(event) => setName((event.target as HTMLInputElement).value)}
              minLength={2} maxLength={60} required autoComplete="username" disabled={submitting}
              class="auth-input bg-slate-900 text-slate-200 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-400">
            Password
            <input id="authPassword" name="password" type="password" value={password}
              onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
              minLength={6} maxLength={128} required autoComplete={setupRequired ? "new-password" : "current-password"} disabled={submitting}
              class="auth-input bg-slate-900 text-slate-200 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500" />
            {setupRequired && <span class="text-[10px] text-slate-500">Use at least 6 characters.</span>}
          </label>
          {setupRequired && <label class="flex flex-col gap-1 text-xs text-slate-400">
            Gateway Secret
            <input id="bootstrapSecret" name="bootstrapSecret" type="password" value={bootstrapSecret}
              onInput={(event) => setBootstrapSecret((event.target as HTMLInputElement).value)}
              required autoComplete="off" disabled={submitting}
              class="auth-input bg-slate-900 text-slate-200 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500" />
          </label>}
          <button type="submit" disabled={submitting} class="auth-submit-button bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-black text-xs font-bold px-4 py-2 rounded transition">
            {submitting ? "Loading portfolio…" : setupRequired ? "Create admin account" : "Sign in"}
          </button>
          {submitting && <div class="auth-feedback auth-feedback--pending flex items-center justify-center gap-2 rounded border border-cyan-900/70 bg-cyan-950/30 px-3 py-3 text-xs text-cyan-200" role="status" aria-live="polite">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" aria-hidden="true" />
            <span>Loading your portfolio and assigned stocks. Please wait…</span>
          </div>}
        </form>
      )}
      {error && <p class="auth-feedback auth-feedback--error text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}
