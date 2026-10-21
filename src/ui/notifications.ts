export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appendScenarioLineContent(container: HTMLElement, rawLine: string): void {
  const tokenPattern = /([+-]?\$[0-9,]+(?:\.[0-9]+)?|[+-]?\d+(?:\.[0-9]+)?%|→)/g;
  let cursor = 0;
  for (const match of rawLine.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) container.append(document.createTextNode(rawLine.slice(cursor, index)));
    const token = match[0];
    const span = document.createElement('span');
    span.textContent = token;
    if (token === '→') {
      span.className = 'mx-1 font-bold text-cyan-300';
    } else if (token.startsWith('+$') || (token.startsWith('+') && token.endsWith('%'))) {
      span.className = 'font-bold text-emerald-300';
    } else if (token.startsWith('-$') || (token.startsWith('-') && token.endsWith('%'))) {
      span.className = 'font-bold text-rose-300';
    } else if (token.startsWith('$')) {
      span.className = 'font-semibold text-amber-200';
    } else {
      span.className = 'font-semibold text-slate-100';
    }
    container.append(span);
    cursor = index + token.length;
  }
  if (cursor < rawLine.length) container.append(document.createTextNode(rawLine.slice(cursor)));
}

function renderScenarioReport(container: HTMLElement, message: string): void {
  const lines = message.split('\n');
  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) {
      const spacer = document.createElement('div');
      spacer.className = 'h-2';
      spacer.setAttribute('aria-hidden', 'true');
      container.append(spacer);
      return;
    }

    if (/^\s*(?:[-=]{3,}|_{3,})\s*$/.test(rawLine)) {
      const divider = document.createElement('div');
      divider.className = 'my-3 border-t border-slate-700/80';
      divider.setAttribute('aria-hidden', 'true');
      container.append(divider);
      return;
    }

    const row = document.createElement('div');
    row.className = 'rounded-lg px-3 py-2 leading-relaxed';
    if (index === 0) {
      row.className = 'mb-4 rounded-xl border border-violet-400/30 bg-gradient-to-r from-violet-500/15 via-indigo-500/10 to-cyan-500/10 px-4 py-3 text-base font-bold leading-relaxed text-white shadow-inner shadow-violet-950/20 sm:text-lg';
    } else if (/^(?:\s*[A-Z][A-Z0-9 /&()_-]{2,}:|\s*\d+[.)]\s|\s*[A-Z]\)\s)/.test(rawLine) ||
      /^(?:BEST ESTIMATED EXIT|NET ADVANTAGE|RESULT:|PRICE SENSITIVITY:)/i.test(rawLine.trim())) {
      row.className += ' mt-2 border-l-2 border-cyan-400/80 bg-cyan-400/[0.07] font-semibold text-cyan-100';
    } else if (/(?:-\$|loss|downside|worse|decrease|commission|interest)/i.test(rawLine)) {
      row.className += ' my-1 bg-rose-400/[0.045] text-slate-200';
    } else if (/(?:\+\$|\+\d|profit|gain|upside|better|increase|NET P&L)/i.test(rawLine)) {
      row.className += ' my-1 bg-emerald-400/[0.06] text-slate-100';
    } else if (rawLine.includes('|')) {
      row.className += ' my-0.5 odd:bg-white/[0.025] text-slate-200';
    } else {
      row.className += ' text-slate-200';
    }
    appendScenarioLineContent(row, rawLine);
    container.append(row);
  });
}

function colorizeFinancialTokens(escapedText: string): string {
  return escapedText
    .replace(/(\+\$[0-9,]+(?:\.[0-9]+)?|\+[0-9]+(?:\.[0-9]+)?%)/g, '<span class="text-emerald-400 font-bold">$1</span>')
    .replace(/(-\$[0-9,]+(?:\.[0-9]+)?|-[0-9]+(?:\.[0-9]+)?%)/g, '<span class="text-rose-400 font-bold">$1</span>')
    .replace(/(?<![+-])(\$[0-9,]+(?:\.[0-9]+)?)/g, '<span class="text-amber-300 font-semibold">$1</span>')
    .replace(/→/g, '<span class="text-cyan-400 font-bold px-1">→</span>')
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
  dialog.setAttribute('tabindex', '-1');

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

  const report = document.createElement('div');
  report.className = 'scenario-report-content min-h-0 flex-1 overflow-auto break-words bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/90 px-3 py-4 text-sm leading-relaxed selection:bg-violet-500/30 sm:px-6 sm:py-6 sm:text-[15px]';
  report.setAttribute('aria-label', 'Scenario report details');
  renderScenarioReport(report, message);

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
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    if (isClosing) return;
    isClosing = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0');
    dialog.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
    dialog.classList.add('translate-y-3', 'scale-[0.985]', 'opacity-0');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finishClose = () => {
      overlay.remove();
      document.body.style.overflow = previousBodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    if (reduceMotion) finishClose();
    else window.setTimeout(finishClose, 200);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
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
