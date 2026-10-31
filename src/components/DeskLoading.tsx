interface DeskLoadingProps {
  title: string;
  message: string;
  accent?: 'cyan' | 'purple' | 'blue';
}

const ACCENTS = {
  cyan: { spinner: 'border-t-cyan-300', title: 'text-cyan-300', glow: 'bg-cyan-400/10', sweep: 'via-cyan-300/90' },
  purple: { spinner: 'border-t-purple-300', title: 'text-purple-300', glow: 'bg-purple-400/10', sweep: 'via-purple-300/90' },
  blue: { spinner: 'border-t-blue-300', title: 'text-blue-300', glow: 'bg-blue-400/10', sweep: 'via-blue-300/90' }
} as const;

/** Consistent, content-sized loading state used while a desk's initial data is prepared. */
export function DeskLoading({ title, message, accent = 'cyan' }: DeskLoadingProps) {
  const colors = ACCENTS[accent];
  return (
    <section
      class="desk-section-loading min-h-[25rem] overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 sm:p-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div class="mx-auto flex max-w-xl flex-col items-center text-center">
        <div class={`grid h-12 w-12 place-items-center rounded-full border border-slate-700 ${colors.glow}`}>
          <span class={`h-6 w-6 animate-spin rounded-full border-2 border-slate-700 ${colors.spinner}`} aria-hidden="true" />
        </div>
        <p class={`mt-5 text-[11px] font-black uppercase tracking-[0.24em] ${colors.title}`}>{title}</p>
        <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">{message}</p>
        <div class="mt-6 h-1 w-48 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
          <span class={`desk-section-loading__bar block h-full w-2/5 rounded-full bg-gradient-to-r from-transparent ${colors.sweep} to-transparent`} />
        </div>
      </div>
      <div class="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} class="animate-pulse rounded-lg border border-slate-800/80 bg-slate-900/60 p-4">
            <div class="h-2 w-16 rounded bg-slate-700/70" />
            <div class="mt-4 h-5 w-24 max-w-full rounded bg-slate-700/60" />
            <div class="mt-3 h-2 w-3/4 rounded bg-slate-800" />
          </div>
        ))}
      </div>
      <div class="mx-auto mt-4 max-w-5xl space-y-2" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div key={item} class="flex items-center gap-3 rounded-lg border border-slate-800/70 bg-slate-900/35 px-4 py-3">
            <div class="h-7 w-7 shrink-0 animate-pulse rounded-md bg-slate-800" />
            <div class="min-w-0 flex-1 space-y-2">
              <div class="h-2 w-1/3 animate-pulse rounded bg-slate-700/70" />
              <div class="h-2 w-2/3 animate-pulse rounded bg-slate-800" />
            </div>
            <div class="h-2 w-16 animate-pulse rounded bg-slate-800" />
          </div>
        ))}
      </div>
    </section>
  );
}
