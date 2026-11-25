import { useEffect, useRef, useState } from 'preact/hooks';
import type { PortfolioState } from '../types/portfolio';

/** Minimal store contract required by the UI subscription adapters. */
export interface PortfolioSubscriptionSource {
  getState(): PortfolioState;
  subscribe(listener: (state: PortfolioState) => void): () => void;
}

/** Store contract for the device-local active-desk subscription. */
export interface ActiveViewSubscriptionSource {
  getState(): PortfolioState;
  subscribeActiveView(listener: (view: string) => void): () => void;
}

/**
 * Subscribe and immediately replay the current portfolio snapshot.
 * Registering before reading closes the render-to-effect race: a state update
 * between the initial render and effect installation cannot be missed.
 */
export function subscribeToPortfolioState(
  listener: (state: PortfolioState) => void,
  store: PortfolioSubscriptionSource
): () => void {
  const unsubscribe = store.subscribe(listener);
  try {
    listener(store.getState());
  } catch (error) {
    unsubscribe();
    throw error;
  }
  return unsubscribe;
}

/**
 * Subscribe to a derived portfolio slice and notify only when that selection
 * changes. This keeps quote-only updates away from components that render
 * navigation structure or other state-independent UI.
 */
export function subscribeToPortfolioSelector<T>(
  selector: (state: PortfolioState) => T,
  listener: (selection: T) => void,
  store: PortfolioSubscriptionSource,
  isEqual: (previous: T, next: T) => boolean = Object.is
): () => void {
  let current!: T;
  let pending!: T;
  let notificationVersion = 0;
  let initializing = true;

  // Register first, then read the initial state. Notifications delivered during
  // the read are held until the snapshot is selected, closing the lost-update
  // window without allowing a synchronous subscription replay to replace a newer
  // getState() value.
  const unsubscribe = store.subscribe((state) => {
    const next = selector(state);
    notificationVersion += 1;
    if (initializing) {
      pending = next;
      return;
    }
    if (isEqual(current, next)) return;
    current = next;
    listener(next);
  });

  try {
    const versionBeforeRead = notificationVersion;
    const initial = selector(store.getState());
    current = notificationVersion > versionBeforeRead ? pending : initial;
    initializing = false;
    listener(current);
  } catch (error) {
    initializing = false;
    unsubscribe();
    throw error;
  }
  return unsubscribe;
}

/** Preact hook adapter for a selected slice of a canonical portfolio store. */
export function usePortfolioSelectorFromStore<T>(
  selector: (state: PortfolioState) => T,
  isEqual: (previous: T, next: T) => boolean,
  store: PortfolioSubscriptionSource
): T {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  selectorRef.current = selector;
  equalityRef.current = isEqual;

  const [selection, setSelection] = useState<T>(() => selector(store.getState()));
  useEffect(() => subscribeToPortfolioSelector(
    (state) => selectorRef.current(state),
    setSelection,
    store,
    (previous, next) => equalityRef.current(previous, next)
  ), [store]);

  return selection;
}

/** Preact hook adapter for components that need the complete portfolio snapshot. */
export function usePortfolioFromStore(store: PortfolioSubscriptionSource): PortfolioState {
  const [state, setState] = useState<PortfolioState>(() => store.getState());

  useEffect(() => subscribeToPortfolioState((newState) => {
    setState({ ...newState });
  }, store), [store]);

  return state;
}

/**
 * Subscribe to the device-local active desk independently from portfolio data.
 * Registering before replaying the value prevents a render-to-effect race.
 */
export function subscribeToActiveView(
  listener: (view: string) => void,
  store: ActiveViewSubscriptionSource
): () => void {
  const unsubscribe = store.subscribeActiveView(listener);
  try {
    listener(store.getState().activeView);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  return unsubscribe;
}

/** Preact hook adapter for the device-local active desk. */
export function useActiveViewFromStore(store: ActiveViewSubscriptionSource): string {
  const [activeView, setActiveView] = useState<string>(() => store.getState().activeView);

  useEffect(() => subscribeToActiveView(setActiveView, store), [store]);
  return activeView;
}
