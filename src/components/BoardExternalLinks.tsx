import { memo } from 'preact/compat';
import { useActiveView, usePortfolio } from '../store/portfolioStore';

const PROVIDERS = [
  {
    name: 'Finviz',
    id: 'finvizLink',
    brandClass: 'stock-link-finviz',
    getUrl: (symbol: string) => `https://finviz.com/stock?t=${symbol}`
  },
  {
    name: 'Stocktwits',
    id: 'stocktwitsLink',
    brandClass: 'stock-link-stocktwits',
    getUrl: (symbol: string) => `https://stocktwits.com/symbol/${symbol}`
  },
  {
    name: 'TV Chart',
    id: 'tvChartLink',
    brandClass: 'stock-link-tv-chart',
    getUrl: (symbol: string) => `https://tradingview.com/chart/?symbol=${symbol}`
  },
  {
    name: 'TV Ideas',
    id: 'tvIdeasLink',
    brandClass: 'stock-link-tv-ideas',
    getUrl: (symbol: string) => `https://tradingview.com/symbols/${symbol}/ideas/?sort=recent`
  }
] as const;

function BoardExternalLinksView() {
  const state = usePortfolio();
  const activeView = useActiveView();
  const ticker = state.positions?.[activeView] ? activeView : '';
  if (!ticker) return null;

  const symbol = encodeURIComponent(ticker);

  return (
    <>
      {PROVIDERS.map((p) => (
        <a
          key={p.name}
          id={p.id}
          href={p.getUrl(symbol)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${ticker} on ${p.name} in a new tab`}
          aria-label={`Open ${ticker} on ${p.name} in a new tab`}
          class={`stock-external-link ${p.brandClass} inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold font-mono uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`}
        >
          {p.name}
        </a>
      ))}
    </>
  );
}

export const BoardExternalLinks = memo(BoardExternalLinksView);
