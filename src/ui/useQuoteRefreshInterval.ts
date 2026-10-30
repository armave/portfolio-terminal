import { useEffect, useState } from 'preact/hooks';
import { addUiEventListener, removeUiEventListener, type UiEvent } from './uiEventBus';
import { getQuoteRefreshInterval } from '../services/storage';

/** Read the persisted quote interval and follow live changes from Settings. */
export function useQuoteRefreshInterval(fallbackMs = 60000): number {
  const [intervalMs, setIntervalMs] = useState(() => getQuoteRefreshInterval(fallbackMs));

  useEffect(() => {
    const onChanged = (event: UiEvent<{ intervalMs: number }>) => {
      const next = Number(event.detail?.intervalMs);
      if (Number.isFinite(next) && next >= 0) setIntervalMs(next);
    };
    addUiEventListener('settings:refresh-interval-changed', onChanged);
    // Re-read after subscribing so a Settings update between render and effect setup is not lost.
    setIntervalMs(getQuoteRefreshInterval(fallbackMs));
    return () => removeUiEventListener('settings:refresh-interval-changed', onChanged);
  }, []);

  return intervalMs;
}
