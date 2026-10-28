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

export interface UiMessage<T = unknown> {
  readonly type: UiEventName;
  readonly detail: T;
}

type UiListener = (event: CustomEvent<unknown>) => void;
const listeners = new Map<UiEventName, Set<UiListener>>();

export function emitUiEvent<T = undefined>(type: UiEventName, detail?: T): void {
  const event = { type, detail } as CustomEvent<T>;
  listeners.get(type)?.forEach((listener) => listener(event as CustomEvent<unknown>));
}

export function subscribeUiEvent(type: UiEventName, listener: (event: Event) => void): () => void {
  const bucket = listeners.get(type) ?? new Set<UiListener>();
  const wrapped: UiListener = (event) => listener(event);
  bucket.add(wrapped);
  listeners.set(type, bucket);
  return () => {
    bucket.delete(wrapped);
    if (bucket.size === 0) listeners.delete(type);
  };
}
