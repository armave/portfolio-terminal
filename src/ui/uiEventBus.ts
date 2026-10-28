import type { CashCushionDeskProps } from '../components/CashCushionDesk';
import type { SettingsDeskProps } from '../components/SettingsDesk';
import type { TickerTabsProps } from '../components/TickerTab';
import type { SummaryMetricsGridProps } from '../components/SummaryMetricsGrid';
import type { ProjectionsTableProps } from '../components/ProjectionsTable';
import type { MarketInsightsPanelProps } from '../components/MarketInsightsPanel';
import type { TradingConsoleProps } from '../components/TradingConsole';
import type { BoardExternalLinksProps } from '../components/BoardExternalLinks';
import type { EmptyStatePanelProps } from '../components/EmptyStatePanel';

/** Typed in-process UI channel. Runtime/UI messages must not leak through window DOM events. */
export interface UiEventPayloads {
  'terminal:auth-visibility': { isOpen: boolean };
  'terminal:cash-cushion-props': CashCushionDeskProps;
  'terminal:empty-state-props': EmptyStatePanelProps | null;
  'terminal:external-links-props': BoardExternalLinksProps;
  'terminal:margin-intelligence-request': { ticker?: string; refresh?: boolean };
  'terminal:market-insights-props': MarketInsightsPanelProps;
  'terminal:projections-props': ProjectionsTableProps;
  'terminal:scenario-modal': unknown;
  'terminal:settings-props': SettingsDeskProps;
  'terminal:startup-offline': undefined;
  'terminal:startup-retry': undefined;
  'terminal:startup-state': { visible: boolean; failed: boolean };
  'terminal:summary-metrics-props': SummaryMetricsGridProps;
  'terminal:ticker-tabs-props': TickerTabsProps;
  'terminal:trading-console-props': TradingConsoleProps;
}

export type UiEventName = keyof UiEventPayloads;
const listeners = new Map<UiEventName, Set<(detail: unknown) => void>>();
const listenerWrappers = new WeakMap<(event: Event) => void, (detail: unknown) => void>();

/** Publish a typed UI update to current subscribers. */
export function emitUiEvent<K extends UiEventName>(
  type: K,
  ...args: UiEventPayloads[K] extends undefined ? [detail?: undefined] : [detail: UiEventPayloads[K]]
): void {
  const detail = args[0];
  listeners.get(type)?.forEach((listener) => listener(detail));
}

export function addUiEventListener<K extends UiEventName>(
  type: K,
  listener: (event: CustomEvent<UiEventPayloads[K]>) => void
): void {
  const bucket = listeners.get(type) ?? new Set<(detail: unknown) => void>();
  const wrapped = (detail: unknown) => listener({ type, detail } as CustomEvent<UiEventPayloads[K]>);
  listenerWrappers.set(listener as (event: Event) => void, wrapped);
  bucket.add(wrapped);
  listeners.set(type, bucket);
}

export function removeUiEventListener<K extends UiEventName>(
  type: K,
  listener: (event: CustomEvent<UiEventPayloads[K]>) => void
): void {
  const bucket = listeners.get(type);
  const wrapped = listenerWrappers.get(listener as (event: Event) => void);
  if (!bucket || !wrapped) return;
  bucket.delete(wrapped);
  listenerWrappers.delete(listener as (event: Event) => void);
  if (bucket.size === 0) listeners.delete(type);
}
