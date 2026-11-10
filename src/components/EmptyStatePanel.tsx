import { emitUiEvent } from '../ui/uiEventBus';

export function EmptyStatePanel() {
  const onImportBackup = () => emitUiEvent('settings:backup-import-request');

  return (
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-lg font-black text-slate-100 tracking-wide">
          NO ACTIVE MARGIN POSITIONS
        </h1>
        <p class="text-xs text-slate-400 mt-1">
          Your margin positions will appear after broker sync. You can also restore a saved portfolio backup.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" onClick={onImportBackup} class="min-h-11 bg-slate-800 hover:bg-slate-700 text-purple-300 text-[11px] font-bold px-3 py-1.5 rounded border border-purple-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">
          Import Backup
        </button>
      </div>
    </div>
  );
}
