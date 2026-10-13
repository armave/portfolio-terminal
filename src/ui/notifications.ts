export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorizeFinancialTokens(escapedText: string): string {
  return escapedText
    // Positive currency/percent (+$120.50, +4.25%)
    .replace(
      /(\+\$[0-9,]+(?:\.[0-9]+)?|\+[0-9]+(?:\.[0-9]+)?%)/g,
      '<span class="text-emerald-400 font-bold">$1</span>'
    )
    // Negative currency/percent (-$45.20, -2.10%)
    .replace(
      /(-\$[0-9,]+(?:\.[0-9]+)?|-[0-9]+(?:\.[0-9]+)?%)/g,
      '<span class="text-rose-400 font-bold">$1</span>'
    )
    // Neutral currency ($185.50)
    .replace(
      /(?<![+-])(\$[0-9,]+(?:\.[0-9]+)?)/g,
      '<span class="text-amber-300 font-semibold">$1</span>'
    )
    // Arrow highlights
    .replace(/→/g, '<span class="text-cyan-400 font-bold px-1">→</span>')
    // Pipe separators
    .replace(/\s\|\s/g, ' <span class="text-slate-700">|</span> ');
}

function parseTagAndStyle(rawMessage: string, isError: boolean) {
  const tagMatch = rawMessage.match(/^\[([^\]]+)\]:?\s*([\s\S]*)$/);
  const rawTag = tagMatch ? tagMatch[1].trim() : isError ? 'ERROR' : 'INFO';
  const upperTag = rawTag.toUpperCase();

  if (isError || upperTag.includes('ERR') || upperTag.includes('FAIL')) {
    return {
      badge: 'ERROR',
      badgeClass: 'bg-rose-950/90 text-rose-300 border border-rose-800/80',
      rowClass: 'border-l-2 border-rose-500/80 bg-rose-950/20 text-rose-200'
    };
  }
  if (upperTag.includes('SIM') || upperTag.includes('COMPARISON') || upperTag.includes('LADDER')) {
    return {
      badge: rawTag,
      badgeClass: 'bg-purple-950/90 text-purple-300 border border-purple-800/80',
      rowClass: 'border-l-2 border-purple-500/80 bg-purple-950/15 text-slate-200'
    };
  }
  if (upperTag.includes('YAHOO') || upperTag.includes('MARKET') || upperTag.includes('QUOTE')) {
    return {
      badge: rawTag,
      badgeClass: 'bg-amber-950/90 text-amber-300 border border-amber-800/80',
      rowClass: 'border-l-2 border-amber-500/70 bg-amber-950/10 text-slate-200'
    };
  }
  if (upperTag.includes('CLI') || upperTag.includes('BALANCE') || upperTag.includes('CASH')) {
    return {
      badge: rawTag,
      badgeClass: 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/80',
      rowClass: 'border-l-2 border-emerald-500/80 bg-emerald-950/15 text-slate-100'
    };
  }
  if (upperTag.includes('BROKER') || upperTag.includes('ROLLOVER')) {
    return {
      badge: 'BROKER',
      badgeClass: 'bg-cyan-950/90 text-cyan-300 border border-cyan-800/80',
      rowClass: 'border-l-2 border-cyan-500/70 bg-cyan-950/10 text-slate-200'
    };
  }

  return {
    badge: rawTag,
    badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700',
    rowClass: 'text-slate-300'
  };
}

export function logTerminal(message: string, isUser = false, isError = false): void {
  const logEl =
    document.getElementById('terminalLog') || document.getElementById('terminalOutput');
  if (!logEl) return;

  const entry = document.createElement('div');
  const timeStr = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  if (isUser) {
    entry.className =
      'flex items-center justify-between gap-2 rounded bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-emerald-300';
    entry.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-emerald-400 font-bold select-none">❯</span>
        <span class="font-semibold truncate">${escapeHtml(message)}</span>
      </div>
      <span class="text-[9px] text-slate-600 shrink-0 select-none">${timeStr}</span>
    `;
  } else {
    const tagMatch = message.match(/^\[([^\]]+)\]:?\s*([\s\S]*)$/);
    const bodyText = tagMatch ? tagMatch[2] : message;
    const { badge, badgeClass, rowClass } = parseTagAndStyle(message, isError);

    const formattedLines = escapeHtml(bodyText)
      .split('\n')
      .map((line) => colorizeFinancialTokens(line))
      .join('<br/>');

    entry.className = `flex items-start justify-between gap-2 rounded px-2.5 py-1.5 text-xs font-mono ${rowClass}`;
    entry.innerHTML = `
      <div class="flex items-start gap-2 min-w-0 flex-1">
        <span class="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badgeClass}">
          ${escapeHtml(badge)}
        </span>
        <div class="leading-relaxed break-words min-w-0 flex-1">${formattedLines}</div>
      </div>
      <span class="text-[9px] text-slate-600 shrink-0 select-none pt-0.5">${timeStr}</span>
    `;
  }

  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

export function showToast(message: string, variant: ToastVariant = 'info'): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const colorMap: Record<ToastVariant, string> = {
    info: 'border-cyan-800 bg-slate-900/95 text-cyan-200',
    success: 'border-emerald-800 bg-slate-900/95 text-emerald-200',
    warning: 'border-amber-800 bg-slate-900/95 text-amber-200',
    error: 'border-rose-800 bg-slate-900/95 text-rose-200'
  };

  toast.className = `pointer-events-auto rounded-lg border px-3.5 py-2 text-xs font-mono font-semibold shadow-lg backdrop-blur transition-all ${colorMap[variant]}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-2');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}