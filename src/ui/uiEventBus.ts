
/** Typed in-process UI channel. Runtime/UI messages must not leak through window DOM events. */
export interface UiEventPayloads {
  'terminal:auth-visibility': { isOpen: boolean };
  'terminal:backup-import-request': undefined;
  'terminal:backup-import-file': { file: File };
  'terminal:command-prefill': { command: string; selectText?: string | null; cursorAtEnd?: boolean };
  'terminal:margin-intelligence-request': { ticker?: string; refresh?: boolean };
  'terminal:scenario-modal': unknown;
  'terminal:startup-offline': undefined;
  'terminal:startup-retry': undefined;
  'terminal:startup-state': { visible: boolean; failed: boolean };
  'terminal:scroll-workspace': undefined;
  'terminal:execute-command': { command: string };
  'portfolio:set-active-view': { view: string };
  'portfolio:refresh-live-prices': { resolve: () => void };
  'settings:save-broker-rules': { values: { annualRate: string; dayCountBasis: string; maintenanceMargin: string; stopOutRatio: string; rolloverTime: string; commPerShare: string; commVolumePct: string; minCommOrder: string } };
  'settings:reset-broker-rules': undefined;
  'settings:save-api-keys': { secret: string; resolve: (saved: boolean) => void };
  'settings:pull-cloud-state': undefined;
  'settings:change-refresh-interval': { intervalMs: string };
  'settings:refresh-interval-changed': { intervalMs: number };
  'settings:export-backup': undefined;
  'settings:reset-to-blank-state': undefined;
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
