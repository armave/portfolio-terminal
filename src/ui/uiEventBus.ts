/** Typed in-process UI channel. Runtime/UI messages must not leak through window DOM events. */
export type UiEventName =
  | 'terminal:active-view'
  | 'terminal:ai-status'
  | 'terminal:analyst-consensus'
  | 'terminal:auth-visibility'
  | 'terminal:board-title'
  | 'terminal:breakeven-text'
  | 'terminal:cash-cushion-props'
  | 'terminal:cloud-status'
  | 'terminal:cloud-sync-status'
  | 'terminal:empty-state-props'
  | 'terminal:external-links-props'
  | 'terminal:margin-intelligence-request'
  | 'terminal:market-insights-props'
  | 'terminal:projections-props'
  | 'terminal:scenario-modal'
  | 'terminal:settings-props'
  | 'terminal:startup-offline'
  | 'terminal:startup-retry'
  | 'terminal:startup-state'
  | 'terminal:summary-metrics-props'
  | 'terminal:ticker-tabs-props'
  | 'terminal:trading-console-props';

type UiListener = (event: CustomEvent<unknown>) => void;
const listeners = new Map<UiEventName, Set<UiListener>>();
const listenerWrappers = new WeakMap<(event: Event) => void, UiListener>();

export function emitUiEvent<T = undefined>(type: UiEventName, detail?: T): void {
  const event = { type, detail } as CustomEvent<T>;
  listeners.get(type)?.forEach((listener) => listener(event as CustomEvent<unknown>));
}

export function addUiEventListener(type: UiEventName, listener: (event: Event) => void): void {
  const bucket = listeners.get(type) ?? new Set<UiListener>();
  const wrapped: UiListener = (event) => listener(event);
  listenerWrappers.set(listener, wrapped);
  bucket.add(wrapped);
  listeners.set(type, bucket);
}

export function removeUiEventListener(type: UiEventName, listener: (event: Event) => void): void {
  const bucket = listeners.get(type);
  const wrapped = listenerWrappers.get(listener);
  if (!bucket || !wrapped) return;
  bucket.delete(wrapped);
  listenerWrappers.delete(listener);
  if (bucket.size === 0) listeners.delete(type);
}
