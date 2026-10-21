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

function scenarioReportText(message: string): string | null {
  // executeCommand wraps local command results in a [CLI] log tag; inspect the payload too.
  const report = message.replace(/^\[CLI\]:?\s*/i, '');
  const firstLine = report.split('\n', 1)[0].toUpperCase();
  const isReport =
    firstLine.startsWith('[SIM ') ||
    firstLine.startsWith('[EXIT COMPARISON:') ||
    firstLine.startsWith('[MULTI-DATE EXIT COMPARISON:') ||
    firstLine.startsWith('[HYPOTHETICAL BUY:') ||
    firstLine.startsWith('[LADDER EXIT:') ||
    firstLine.startsWith('[STAGED EXIT:');
  return isReport ? report : null;
}

function showScenarioReport(message: string): void {
  const existing = document.getElementById('scenarioReportModal');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'scenarioReportModal';
  overlay.className = 'scenario-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 opacity-0 backdrop-blur-sm transition-opacity duration-200 ease-out sm:p-6';
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'scenario-modal-dialog flex max-h-[min(90vh,900px)] w-full max-w-3xl translate-y-3 scale-[0.985] flex-col overflow-hidden rounded-2xl border border-purple-800/70 bg-slate-950 shadow-2xl shadow-black/50 ring-1 ring-white/5 transition-[opacity,transform] duration-200 ease-out opacity-0 sm:max-h-[90vh]';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'scenarioReportTitle');

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-purple-950/40 px-4 py-4 sm:px-6';

  const headingGroup = document.createElement('div');
  headingGroup.className = 'min-w-0';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-purple-300';
  eyebrow.textContent = 'What-if analysis';

  const title = document.createElement('h2');
  title.id = 'scenarioReportTitle';
  title.className = 'break-words text-base font-bold tracking-tight text-white sm:text-lg';
  title.textContent = message.split('\n', 1)[0].replace(/^\[|\]$/g, '') || 'Scenario report';

  const subtitle = document.createElement('p');
  subtitle.className = 'mt-1.5 max-w-xl text-xs leading-relaxed text-slate-400';
  subtitle.textContent = 'Estimated results based on the entered prices and current portfolio assumptions.';

  headingGroup.append(eyebrow, title, subtitle);

  const closeTop = document.createElement('button');
  closeTop.type = 'button';
  closeTop.className = 'shrink-0 rounded-lg border border-slate-700/80 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400';
  closeTop.textContent = 'Close';
  closeTop.setAttribute('aria-label', 'Close scenario report');

  header.append(headingGroup, closeTop);

  const report = document.createElement('pre');
  report.className = 'min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-950/70 px-4 py-5 font-mono text-xs leading-6 text-slate-200 selection:bg-purple-500/30 sm:px-6 sm:py-6 sm:text-[13px]';
  report.textContent = message;

  const footer = document.createElement('div');
  footer.className = 'flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/80 px-4 py-3.5 sm:px-6';

  const disclaimer = document.createElement('p');
  disclaimer.className = 'max-w-xl text-[11px] leading-relaxed text-slate-400';
  disclaimer.textContent = 'Hypothetical only — this report does not execute trades or guarantee future results. Margin costs and commissions are estimates.';

  const closeBottom = document.createElement('button');
  closeBottom.type = 'button';
  closeBottom.className = 'rounded-lg bg-purple-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-purple-950/30 transition duration-150 hover:-translate-y-px hover:bg-purple-300 hover:shadow-purple-900/30 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
  closeBottom.textContent = 'Done';

  footer.append(disclaimer, closeBottom);
  dialog.append(header, report, footer);
  overlay.appendChild(dialog);

  let isClosing = false;
  const close = () => {
    if (isClosing) return;
    isClosing = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0');
    dialog.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
    dialog.classList.add('translate-y-3', 'scale-[0.985]', 'opacity-0');
    window.setTimeout(() => overlay.remove(), 200);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  closeTop.addEventListener('click', close);
  closeBottom.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    overlay.classList.remove('transition-opacity', 'duration-200', 'opacity-0');
    overlay.classList.add('opacity-100');
    dialog.classList.remove('transition-[opacity,transform]', 'duration-200', 'translate-y-3', 'scale-[0.985]', 'opacity-0');
    dialog.classList.add('translate-y-0', 'scale-100', 'opacity-100');
  } else {
    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      overlay.classList.add('opacity-100');
      dialog.classList.remove('translate-y-3', 'scale-[0.985]', 'opacity-0');
      dialog.classList.add('translate-y-0', 'scale-100', 'opacity-100');
    });
  }
  closeTop.focus();
}

export function logTerminal(message: string, isUser = false, isError = false): void {
  const logEl =
    document.getElementById('terminalLog') || document.getElementById('terminalOutput');
  if (!logEl) return;

  const scenarioReport = !isUser && !isError ? scenarioReportText(message) : null;
  if (scenarioReport !== null) {
    showScenarioReport(scenarioReport);

    const entry = document.createElement('div');
    const timeStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    entry.className = 'flex items-start justify-between gap-2 rounded border-l-2 border-purple-500/80 bg-purple-950/15 px-2.5 py-1.5 text-xs font-mono text-slate-200';
    const summary = document.createElement('div');
    summary.className = 'min-w-0 flex-1';
    const label = document.createElement('span');
    label.className = 'mr-2 rounded border border-purple-800/80 bg-purple-950/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-300';
    label.textContent = 'WHAT-IF REPORT';
    const text = document.createElement('span');
    text.className = 'break-words';
    text.textContent = scenarioReport.split('\n', 1)[0].slice(0, 180);
    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.className = 'shrink-0 rounded border border-purple-800/80 px-2 py-1 text-[10px] font-bold text-purple-300 hover:bg-purple-950/70';
    reopen.textContent = 'View report';
    reopen.addEventListener('click', () => showScenarioReport(scenarioReport));
    summary.append(label, text);
    entry.append(summary, reopen);
    const time = document.createElement('span');
    time.className = 'shrink-0 pt-0.5 text-[9px] text-slate-600';
    time.textContent = timeStr;
    entry.appendChild(time);
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
    return;
  }

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
  // Toasts are reserved for errors; routine success and status feedback belongs in the terminal.
  if (variant !== 'error') return;

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const conciseMessage = message
    .replace(/\\s+/g, ' ')
    .replace(/^(?:Error|Failed|Failure):\\s*/i, '')
    .trim();
  const maxToastLength = 90;
  const displayMessage = conciseMessage.length > maxToastLength
    ? `${conciseMessage.slice(0, maxToastLength - 1).trimEnd()}…`
    : conciseMessage;

  toast.className = 'pointer-events-auto rounded-lg border border-rose-800 bg-slate-900/95 px-3.5 py-2 text-xs font-mono font-semibold text-rose-200 shadow-lg backdrop-blur transition-all';
  toast.textContent = displayMessage || 'Something went wrong.';
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-2');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

/** Clears terminal output through the notification layer so UI components don't mutate the log DOM directly. */
export function clearTerminalLog(): void {
  const logEl = document.getElementById('terminalLog') || document.getElementById('terminalOutput');
  logEl?.replaceChildren();
}
