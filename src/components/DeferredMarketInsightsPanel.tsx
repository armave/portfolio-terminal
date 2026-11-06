import { lazy, memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

const MarketInsightsPanel = lazy(() =>
  import('./MarketInsightsPanel').then(({ MarketInsightsPanel }) => ({ default: memo(MarketInsightsPanel) }))
);

export function DeferredMarketInsightsPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsNearViewport(true);
      observer.disconnect();
    }, { rootMargin: '240px 0px' });

    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef}>
      {isNearViewport ? (
        <MarketInsightsPanel />
      ) : (
        <div class="min-h-24" aria-hidden="true" />
      )}
    </div>
  );
}
