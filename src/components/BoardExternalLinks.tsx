import { usePortfolio } from '../store/portfolioStore';

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

export function BoardExternalLinks() {
  const state = usePortfolio();
  const ticker = state.positions?.[state.activeView] ? state.activeView : '';
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
          class={`stock-external-link ${p.brandClass} px-2 py-1 rounded text-[10px] font-bold font-mono uppercase`}
        >
          {p.name}
        </a>
      ))}
    </>
  );
}