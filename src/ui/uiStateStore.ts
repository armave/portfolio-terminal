import { useEffect, useState } from 'preact/hooks';

let aiStatus = 'READY';
const aiStatusListeners = new Set<(status: string) => void>();

/** Publish the AI runtime status without routing component state through UI events. */
export function setAiStatus(status: string): void {
  if (!status || status === aiStatus) return;
  aiStatus = status;
  aiStatusListeners.forEach((listener) => listener(aiStatus));
}

/** Subscribe to the latest AI status; returns a cleanup callback. */
function subscribeAiStatus(listener: (status: string) => void): () => void {
  aiStatusListeners.add(listener);
  return () => aiStatusListeners.delete(listener);
}

export function useAiStatus(): string {
  const [status, setStatus] = useState(aiStatus);
  useEffect(() => subscribeAiStatus(setStatus), []);
  return status;
}

let breakevenText = 'Combined Breakeven: 0 days';
const breakevenTextListeners = new Set<(text: string) => void>();

/** Publish the current combined-portfolio breakeven label. */
export function setBreakevenText(text: string): void {
  if (text === breakevenText) return;
  breakevenText = text;
  breakevenTextListeners.forEach((listener) => listener(breakevenText));
}

function subscribeBreakevenText(listener: (text: string) => void): () => void {
  breakevenTextListeners.add(listener);
  return () => breakevenTextListeners.delete(listener);
}

export function useBreakevenText(): string {
  const [text, setText] = useState(breakevenText);
  useEffect(() => subscribeBreakevenText(setText), []);
  return text;
}

export interface CloudStatus {
  status: string;
  text: string;
}

let cloudStatus: CloudStatus = { status: 'idle', text: 'OFFLINE' };
const cloudStatusListeners = new Set<(status: CloudStatus) => void>();

export function setCloudStatusState(status: CloudStatus): void {
  if (status.status === cloudStatus.status && status.text === cloudStatus.text) return;
  cloudStatus = status;
  cloudStatusListeners.forEach((listener) => listener(cloudStatus));
}

function subscribeCloudStatus(listener: (status: CloudStatus) => void): () => void {
  cloudStatusListeners.add(listener);
  return () => cloudStatusListeners.delete(listener);
}

export function useCloudStatus(): CloudStatus {
  const [status, setStatus] = useState(cloudStatus);
  useEffect(() => subscribeCloudStatus(setStatus), []);
  return status;
}

let cloudSyncStatus: CloudStatus = { status: 'idle', text: '' };
const cloudSyncStatusListeners = new Set<(status: CloudStatus) => void>();

export function setCloudSyncStatus(status: CloudStatus): void {
  if (status.status === cloudSyncStatus.status && status.text === cloudSyncStatus.text) return;
  cloudSyncStatus = status;
  cloudSyncStatusListeners.forEach((listener) => listener(cloudSyncStatus));
}

function subscribeCloudSyncStatus(listener: (status: CloudStatus) => void): () => void {
  cloudSyncStatusListeners.add(listener);
  return () => cloudSyncStatusListeners.delete(listener);
}

export function useCloudSyncStatus(): CloudStatus {
  const [status, setStatus] = useState(cloudSyncStatus);
  useEffect(() => subscribeCloudSyncStatus(setStatus), []);
  return status;
}

export interface AnalystConsensusState {
  text: string;
  title: string;
  className: string;
}

let analystConsensus: AnalystConsensusState = { text: '', title: '', className: 'hidden' };
const analystConsensusListeners = new Set<(state: AnalystConsensusState) => void>();

export function setAnalystConsensus(state: AnalystConsensusState): void {
  if (state.text === analystConsensus.text && state.title === analystConsensus.title && state.className === analystConsensus.className) return;
  analystConsensus = state;
  analystConsensusListeners.forEach((listener) => listener(analystConsensus));
}

function subscribeAnalystConsensus(listener: (state: AnalystConsensusState) => void): () => void {
  analystConsensusListeners.add(listener);
  return () => analystConsensusListeners.delete(listener);
}

export function useAnalystConsensus(): AnalystConsensusState {
  const [state, setState] = useState(analystConsensus);
  useEffect(() => subscribeAnalystConsensus(setState), []);
  return state;
}

export interface BoardTitleState {
  title: string;
  showDailyMove: boolean;
}

let boardTitle: BoardTitleState = { title: 'COMBINED PORTFOLIO', showDailyMove: false };
const boardTitleListeners = new Set<(state: BoardTitleState) => void>();

export function setBoardTitle(state: BoardTitleState): void {
  if (state.title === boardTitle.title && state.showDailyMove === boardTitle.showDailyMove) return;
  boardTitle = state;
  boardTitleListeners.forEach((listener) => listener(boardTitle));
}

function subscribeBoardTitle(listener: (state: BoardTitleState) => void): () => void {
  boardTitleListeners.add(listener);
  return () => boardTitleListeners.delete(listener);
}

export function useBoardTitle(): BoardTitleState {
  const [state, setState] = useState(boardTitle);
  useEffect(() => subscribeBoardTitle(setState), []);
  return state;
}
