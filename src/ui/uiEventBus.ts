import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';

/** Typed in-process UI channel. Runtime/UI messages must not leak through window DOM events. */
export interface UiEventPayloads {
  'auth:logout': undefined;
  'auth:user-changed': { user: { id: string; name: string; role: "guest" | "admin"; language: "en" | "ru"; createdAt: string } | null };
  'auth:visibility': { isOpen: boolean };
  'settings:backup-import-request': undefined;
  'settings:backup-import-file': { file: File };
  'market:depth-request': { ticker: string };
  'margin:intelligence-request': { ticker?: string; refresh?: boolean };
  'scenario:exit-comparison-request': { ticker?: string };
  'scenario:buy-more-request': { ticker?: string };
  'app:startup-offline': undefined;
  'app:startup-retry': undefined;
  'app:startup-state': { visible: boolean; failed: boolean };
  'app:scroll-workspace': undefined;
  'portfolio:set-active-view': { view: string };
  'portfolio:refresh-live-prices': { resolve: () => void };
  'portfolio:sync-request': { resolve: (result: ManualPortfolioSyncResult) => void };
  'settings:gateway-secret-authenticated': { secret: string };
  'settings:save-broker-rules': { values: { annualRate: string; dayCountBasis: string; maintenanceMargin: string; stopOutRatio: string; rolloverTime: string; commPerShare: string; commVolumePct: string; minCommOrder: string } };
  'settings:reset-broker-rules': undefined;
  'settings:save-api-keys': { secret: string; resolve: (saved: boolean) => void };
  'settings:pull-cloud-state': undefined;
  'settings:change-refresh-interval': { intervalMs: string; refreshNow?: boolean };
  'settings:refresh-interval-changed': { intervalMs: number };
  'settings:export-backup': undefined;
  'settings:reset-to-blank-state': undefined;
}

export type UiEventName = keyof UiEventPayloads;

export interface UiEvent<Detail = unknown> {
  readonly type: UiEventName;
  readonly detail: Detail;
}

type AnyUiEventListener = (event: UiEvent<unknown>) => void;
const listeners = new Map<UiEventName, Set<AnyUiEventListener>>();

/** Publish a typed application message to a snapshot of the active subscribers. */
export function emitUiEvent<K extends UiEventName>(
  type: K,
  ...args: UiEventPayloads[K] extends undefined ? [detail?: undefined] : [detail: UiEventPayloads[K]]
): void {
  const bucket = listeners.get(type);
  if (!bucket?.size) return;

  const detail = args[0] as UiEventPayloads[K];
  const event: UiEvent<UiEventPayloads[K]> = { type, detail };
  [...bucket].forEach((listener) => listener(event as UiEvent<unknown>));
}

export function addUiEventListener<K extends UiEventName>(
  type: K,
  listener: (event: UiEvent<UiEventPayloads[K]>) => void
): void {
  const bucket = listeners.get(type) ?? new Set<AnyUiEventListener>();
  bucket.add(listener as unknown as AnyUiEventListener);
  listeners.set(type, bucket);
}

export function removeUiEventListener<K extends UiEventName>(
  type: K,
  listener: (event: UiEvent<UiEventPayloads[K]>) => void
): void {
  const bucket = listeners.get(type);
  if (!bucket) return;
  bucket.delete(listener as unknown as AnyUiEventListener);
  if (bucket.size === 0) listeners.delete(type);
}
