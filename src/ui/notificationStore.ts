import { useEffect, useState } from 'preact/hooks';

export interface TerminalLogEntry {
  id: number;
  message: string;
  isUser: boolean;
  isError: boolean;
  time: string;
  kind?: 'system';
  scenarioReport?: string;
}

export interface ErrorToast {
  id: number;
  message: string;
  isClosing: boolean;
}

const terminalLogListeners = new Set<(entries: TerminalLogEntry[]) => void>();
const scenarioReportListeners = new Set<(report: string | null) => void>();
const errorToastListeners = new Set<(toasts: ErrorToast[]) => void>();

let nextLogId = 1;
let nextToastId = 1;
let terminalEntries: TerminalLogEntry[] = [{
  id: 0,
  message: 'Portfolio CLI ready. Broker-synced portfolio data is available; refresh quotes or choose a quick action below.',
  isUser: false,
  isError: false,
  time: '',
  kind: 'system'
}];
let scenarioReport: string | null = null;
let errorToasts: ErrorToast[] = [];

function notifyTerminalLog(): void {
  terminalLogListeners.forEach((listener) => listener(terminalEntries));
}

function notifyScenarioReport(): void {
  scenarioReportListeners.forEach((listener) => listener(scenarioReport));
}

function notifyErrorToasts(): void {
  errorToastListeners.forEach((listener) => listener(errorToasts));
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function appendTerminalLog(
  message: string,
  isUser = false,
  isError = false,
  scenarioReport?: string
): void {
  terminalEntries = [...terminalEntries, {
    id: nextLogId++,
    message,
    isUser,
    isError,
    time: formatTime(),
    ...(scenarioReport !== undefined ? { scenarioReport } : {})
  }];
  notifyTerminalLog();
}

export function clearTerminalLogEntries(): void {
  terminalEntries = [];
  notifyTerminalLog();
}

export function subscribeTerminalLog(listener: (entries: TerminalLogEntry[]) => void): () => void {
  terminalLogListeners.add(listener);
  return () => terminalLogListeners.delete(listener);
}

export function useTerminalLogEntries(): TerminalLogEntry[] {
  const [entries, setEntries] = useState(terminalEntries);
  useEffect(() => {
    terminalLogListeners.add(setEntries);
    setEntries(terminalEntries);
    return () => terminalLogListeners.delete(setEntries);
  }, []);
  return entries;
}

export function setScenarioReport(report: string | null): void {
  if (report === scenarioReport) return;
  scenarioReport = report;
  notifyScenarioReport();
}

export function dismissScenarioReport(): void {
  setScenarioReport(null);
}

export function subscribeScenarioReport(listener: (report: string | null) => void): () => void {
  scenarioReportListeners.add(listener);
  return () => scenarioReportListeners.delete(listener);
}

export function useScenarioReport(): string | null {
  const [report, setReport] = useState(scenarioReport);
  useEffect(() => {
    scenarioReportListeners.add(setReport);
    setReport(scenarioReport);
    return () => scenarioReportListeners.delete(setReport);
  }, []);
  return report;
}

export function addErrorToast(rawMessage: string): void {
  const conciseMessage = rawMessage
    .replace(/\s+/g, ' ')
    .replace(/^(?:Error|Failed|Failure):\s*/i, '')
    .trim();
  const maxToastLength = 90;
  const message = conciseMessage.length > maxToastLength
    ? `${conciseMessage.slice(0, maxToastLength - 1).trimEnd()}…`
    : conciseMessage;
  const id = nextToastId++;
  errorToasts = [...errorToasts, { id, message: message || 'Something went wrong.', isClosing: false }];
  notifyErrorToasts();

  setTimeout(() => {
    errorToasts = errorToasts.map((toast) => toast.id === id ? { ...toast, isClosing: true } : toast);
    notifyErrorToasts();
    setTimeout(() => {
      errorToasts = errorToasts.filter((toast) => toast.id !== id);
      notifyErrorToasts();
    }, 250);
  }, 2800);
}

export function useErrorToasts(): ErrorToast[] {
  const [toasts, setToasts] = useState(errorToasts);
  useEffect(() => {
    errorToastListeners.add(setToasts);
    setToasts(errorToasts);
    return () => errorToastListeners.delete(setToasts);
  }, []);
  return toasts;
}
