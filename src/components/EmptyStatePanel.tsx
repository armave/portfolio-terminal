export function EmptyStatePanel() {
  const handleQuickBuy = () => {
    const input = document.getElementById('cmdInput') as HTMLInputElement | null;
    if (!input) return;
    input.value = 'bought [shares] [TICKER] for [price]';
    input.focus();
    const start = input.value.indexOf('[');
    const end = input.value.indexOf(']', start) + 1;
    if (start >= 0 && end > start) {
      input.setSelectionRange(start, end);
    }
  };

  const handleAddCashStock = () => {
    const input = document.getElementById('cmdInput') as HTMLInputElement | null;
    if (!input) return;
    input.value = 'add cash stock [shares] [TICKER] for [price]';
    input.focus();
    const start = input.value.indexOf('[');
    const end = input.value.indexOf(']', start) + 1;
    if (start >= 0 && end > start) {
      input.setSelectionRange(start, end);
    }
  };

  const handleImportBackup = () => {
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement | null;
    fileInput?.click();
  };

  return (
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div class="text-lg font-black text-slate-100 tracking-wide">
          NO ACTIVE MARGIN POSITIONS
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Start with a trade, add a cash stock, or restore a saved backup to continue.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleQuickBuy}
          class="bg-emerald-600 hover:bg-emerald-500 text-black text-[11px] font-bold px-3 py-1.5 rounded transition"
        >
          Quick Buy
        </button>
        <button
          type="button"
          onClick={handleAddCashStock}
          class="bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
        >
          Add Cash Stock
        </button>
        <button
          type="button"
          onClick={handleImportBackup}
          class="bg-slate-800 hover:bg-slate-700 text-purple-300 text-[11px] font-bold px-3 py-1.5 rounded border border-purple-700 transition"
        >
          Import Backup
        </button>
      </div>
    </div>
  );
}