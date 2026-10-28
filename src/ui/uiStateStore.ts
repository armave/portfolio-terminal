import { useEffect, useState } from 'preact/hooks';
import type { TradingConsoleProps } from '../components/TradingConsole';
import type { CashCushionDeskProps } from '../components/CashCushionDesk';
import type { SettingsDeskProps } from '../components/SettingsDesk';
import type { TickerTabsProps } from '../components/TickerTab';
import type { SummaryMetricsGridProps } from '../components/SummaryMetricsGrid';
import type { ProjectionsTableProps } from '../components/ProjectionsTable';
import type { MarketInsightsPanelProps } from '../components/MarketInsightsPanel';
import type { BoardExternalLinksProps } from '../components/BoardExternalLinks';
import type { EmptyStatePanelProps } from '../components/EmptyStatePanel';

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

let activeDeskView = 'COMBINED';
const activeDeskViewListeners = new Set<(view: string) => void>();

/** Publish the active desk through shared UI state rather than a prop-shaped event. */
export function setActiveDeskViewState(view: string): void {
  if (!view || view === activeDeskView) return;
  activeDeskView = view;
  activeDeskViewListeners.forEach((listener) => listener(activeDeskView));
}

export function useActiveDeskView(): string {
  const [view, setView] = useState(activeDeskView);
  useEffect(() => {
    activeDeskViewListeners.add(setView);
    // Re-read after subscribing so a publish between render and effect setup is not lost.
    setView(activeDeskView);
    return () => activeDeskViewListeners.delete(setView);
  }, []);
  return view;
}

let tradingConsoleProps: TradingConsoleProps | null = null;
const tradingConsolePropsListeners = new Set<(props: TradingConsoleProps | null) => void>();

/** Publish the latest console inputs through shared Preact state. */
export function setTradingConsoleProps(props: TradingConsoleProps): void {
  tradingConsoleProps = props;
  tradingConsolePropsListeners.forEach((listener) => listener(tradingConsoleProps));
}

export function useTradingConsoleProps(): TradingConsoleProps | null {
  const [props, setProps] = useState<TradingConsoleProps | null>(tradingConsoleProps);
  useEffect(() => {
    tradingConsolePropsListeners.add(setProps);
    setProps(tradingConsoleProps);
    return () => tradingConsolePropsListeners.delete(setProps);
  }, []);
  return props;
}

type UiPropStateMap = {
  cashCushionProps: CashCushionDeskProps;
  settingsProps: SettingsDeskProps | null;
  tickerTabsProps: TickerTabsProps | null;
  summaryMetricsProps: SummaryMetricsGridProps | null;
  projectionsProps: ProjectionsTableProps | null;
  marketInsightsProps: MarketInsightsPanelProps | null;
  externalLinksProps: BoardExternalLinksProps | null;
  emptyStateProps: EmptyStatePanelProps | null;
};
type UiPropKey = keyof UiPropStateMap;
const uiPropState: UiPropStateMap = {
  cashCushionProps: {},
  settingsProps: null,
  tickerTabsProps: null,
  summaryMetricsProps: null,
  projectionsProps: null,
  marketInsightsProps: null,
  externalLinksProps: null,
  emptyStateProps: null
};
const uiPropListeners = new Map<UiPropKey, Set<(value: unknown) => void>>();

function setUiProp<K extends UiPropKey>(key: K, value: UiPropStateMap[K]): void {
  if (uiPropState[key] === value) return;
  uiPropState[key] = value;
  uiPropListeners.get(key)?.forEach((listener) => listener(value));
}

function useUiProp<K extends UiPropKey>(key: K): UiPropStateMap[K] {
  const [value, setValue] = useState<UiPropStateMap[K]>(uiPropState[key]);
  useEffect(() => {
    const listeners = uiPropListeners.get(key) ?? new Set<(next: unknown) => void>();
    const listener = (next: unknown) => setValue(next as UiPropStateMap[K]);
    listeners.add(listener);
    uiPropListeners.set(key, listeners);
    setValue(uiPropState[key]);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) uiPropListeners.delete(key);
    };
  }, [key]);
  return value;
}

export const setCashCushionPropsState = (value: CashCushionDeskProps) => setUiProp('cashCushionProps', value);
export const setSettingsPropsState = (value: SettingsDeskProps | null) => setUiProp('settingsProps', value);
export const setTickerTabsPropsState = (value: TickerTabsProps) => setUiProp('tickerTabsProps', value);
export const setSummaryMetricsPropsState = (value: SummaryMetricsGridProps) => setUiProp('summaryMetricsProps', value);
export const setProjectionsPropsState = (value: ProjectionsTableProps) => setUiProp('projectionsProps', value);
export const setMarketInsightsPropsState = (value: MarketInsightsPanelProps) => setUiProp('marketInsightsProps', value);
export const setExternalLinksPropsState = (value: BoardExternalLinksProps) => setUiProp('externalLinksProps', value);
export const setEmptyStatePropsState = (value: EmptyStatePanelProps | null) => setUiProp('emptyStateProps', value);

export const useCashCushionProps = () => useUiProp('cashCushionProps');
export const useSettingsProps = () => useUiProp('settingsProps');
export const useTickerTabsProps = () => useUiProp('tickerTabsProps');
export const useSummaryMetricsProps = () => useUiProp('summaryMetricsProps');
export const useProjectionsProps = () => useUiProp('projectionsProps');
export const useMarketInsightsProps = () => useUiProp('marketInsightsProps');
export const useExternalLinksProps = () => useUiProp('externalLinksProps');
export const useEmptyStateProps = () => useUiProp('emptyStateProps');
