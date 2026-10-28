import {
  addErrorToast,
  appendTerminalLog,
  clearTerminalLogEntries,
  setScenarioReport
} from './notificationStore';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

function scenarioReportText(message: string): string | null {
  // executeCommand wraps local command results in a [CLI] log tag; inspect the payload too.
  const report = message.replace(/^\[CLI\]:?\s*/i, '');
  const firstLine = report.split('\n', 1)[0].toUpperCase();
  const isReport =
    firstLine.startsWith('[SIM ') ||
    firstLine.startsWith('[EXIT COMPARISON:') ||
    firstLine.startsWith('[MULTI-DATE EXIT COMPARISON:') ||
    firstLine.startsWith('[HYPOTHETICAL BUY:') ||
    firstLine.startsWith('[STAGED EXIT:');
  return isReport ? report : null;
}

/** Publish terminal output to the Preact-owned log rather than mutating its DOM. */
export function logTerminal(message: string, isUser = false, isError = false): void {
  const scenarioReport = !isUser && !isError ? scenarioReportText(message) : null;
  if (scenarioReport !== null) setScenarioReport(scenarioReport);
  appendTerminalLog(message, isUser, isError, scenarioReport ?? undefined);
}

export function showToast(message: string, variant: ToastVariant = 'info'): void {
  // Toasts are reserved for errors; routine success and status feedback belongs in the terminal.
  if (variant !== 'error') return;
  addErrorToast(message);
}

/** Clear terminal output through shared UI state. */
export function clearTerminalLog(): void {
  clearTerminalLogEntries();
}
