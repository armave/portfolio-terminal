import { useState } from 'preact/hooks';
import { formatQuoteMetadata, formatUSD } from '../utils/formatters';
import { getMarginPositionMarketSummaries, type MarginPositionMarketSummary } from '../domain/portfolioSelectors';
import { getAppLanguage, translateText } from '../services/i18n';
import { emitUiEvent } from '../ui/uiEventBus';
import { TableScrollRegion } from './TableScrollRegion';
import { QuoteVolumeBadge } from './QuoteVolumeBadge';
import type { BoardState } from '../types/portfolio';

type SortKey = 'ticker' | 'marketValue' | 'unrealizedPnl' | 'unrealizedPnlPct' | 'weight';
type SortDirection = 'asc' | 'desc';

interface CombinedPositionsTableProps {
  positions: BoardState['positions'];
  refreshIntervalMs: number;
  isAdmin: boolean;
}

const money = (value: number | null) => value === null ? '—' : formatUSD(value);
const signedMoney = (value: number | null) => value === null ? '—' : (value >= 0 ? '+' : '') + formatUSD(value);
const signedPercent = (value: number | null) => value === null || !Number.isFinite(value)
  ? '—'
  : (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
const pnlClass = (value: number | null) => value === null ? 'is-muted' : value >= 0 ? 'is-positive' : 'is-negative';

export function CombinedPositionsTable({ positions, refreshIntervalMs, isAdmin }: CombinedPositionsTableProps) {
  const language = getAppLanguage();
  const rows = getMarginPositionMarketSummaries(positions);
  const [sortKey, setSortKey] = useState<SortKey>('marketValue');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const sharesText = (shares: number) => shares.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 });
  const completeMarketValue = rows.length > 0 && rows.every(row => row.marketValue !== null)
    ? rows.reduce((total, row) => total + (row.marketValue ?? 0), 0)
    : null;
  const getWeight = (row: MarginPositionMarketSummary): number | null =>
    completeMarketValue !== null && completeMarketValue > 0 && row.marketValue !== null
      ? row.marketValue / completeMarketValue
      : null;
  const getSortValue = (row: MarginPositionMarketSummary): string | number | null => {
    switch (sortKey) {
      case 'ticker': return row.ticker;
      case 'marketValue': return row.marketValue;
      case 'unrealizedPnl': return row.unrealizedPnl;
      case 'unrealizedPnlPct': return row.unrealizedPnlPct;
      case 'weight': return getWeight(row);
    }
  };
  const sortedRows = [...rows].sort((left, right) => {
    const a = getSortValue(left);
    const b = getSortValue(right);
    if (a === null && b === null) return left.ticker.localeCompare(right.ticker);
    if (a === null) return 1;
    if (b === null) return -1;
    const comparison = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b);
    return comparison * (sortDirection === 'asc' ? 1 : -1);
  });
  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDirection(key === 'ticker' ? 'asc' : 'desc');
    }
  };
  const sortButton = (key: SortKey, label: string) => (
    <button type="button" class="combined-position-sort-button" onClick={() => sortBy(key)} aria-label={label}>
      {label}<span aria-hidden="true">{sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
    </button>
  );
  const openPosition = (ticker: string) => emitUiEvent('portfolio:set-active-view', { view: ticker });
  const quoteStatus = (row: MarginPositionMarketSummary) => {
    const position = positions?.[row.ticker];
    return row.marketPrice === null ? translateText('Quote unavailable', language)
      : position ? formatQuoteMetadata(position, refreshIntervalMs) : translateText('Not available', language);
  };
  const badge = (row: MarginPositionMarketSummary) => {
    const position = positions?.[row.ticker];
    return position ? (
      <QuoteVolumeBadge
        volumeValue={position.quoteDetails?.volumeValue}
        currency={position.quoteDetails?.currency}
        lastTradeTime={position.quoteDetails?.lastTradeTime}
        serverTime={position.quoteDetails?.serverTime}
        isAdmin={isAdmin}
      />
    ) : null;
  };
  const weightText = (row: MarginPositionMarketSummary) => {
    const weight = getWeight(row);
    return weight === null ? '—' : (weight * 100).toFixed(1) + '%';
  };

  return (
    <section class="combined-positions" aria-labelledby="combinedPositionsTitle">
      <header class="combined-positions__header">
        <div class="min-w-0">
          <h2 id="combinedPositionsTitle">{translateText('Portfolio positions', language)}</h2>
          <p>{translateText('Compare current market value, gross unrealized P&L and target prices. Select a ticker to open its Margin page.', language)}</p>
        </div>
        {rows.length > 0 && <span class="combined-positions__count">{rows.length} {translateText('positions', language)}</span>}
      </header>
      {rows.length === 0 ? (
        <p class="combined-positions__empty">{translateText('No active Margin positions to compare.', language)}</p>
      ) : (
        <>
          <TableScrollRegion label={translateText('Portfolio positions comparison table', language)} className="combined-positions-table-region">
            <table class="combined-positions-table">
              <caption class="sr-only">{translateText('Portfolio positions comparison table', language)}</caption>
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortKey === 'ticker' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {sortButton('ticker', translateText('Ticker', language))}
                  </th>
                  <th scope="col">{translateText('Shares', language)}</th>
                  <th scope="col">{translateText('Average entry', language)}</th>
                  <th scope="col">{translateText('Last price', language)}</th>
                  <th scope="col" aria-sort={sortKey === 'marketValue' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {sortButton('marketValue', translateText('Market value', language))}
                  </th>
                  <th scope="col" aria-sort={sortKey === 'unrealizedPnl' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {sortButton('unrealizedPnl', translateText('Gross unrealized P&L', language))}
                  </th>
                  <th scope="col" aria-sort={sortKey === 'unrealizedPnlPct' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {sortButton('unrealizedPnlPct', translateText('Return', language))}
                  </th>
                  <th scope="col" aria-sort={sortKey === 'weight' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {sortButton('weight', translateText('Margin weight', language))}
                  </th>
                  <th scope="col">{translateText('Target price', language)}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => (
                  <tr key={row.ticker}>
                    <th scope="row">
                      <button type="button" class="combined-position-ticker" onClick={() => openPosition(row.ticker)}
                        aria-label={translateText('Open Margin position {ticker}', language).replace('{ticker}', row.ticker)}>
                        {row.ticker}
                      </button>
                      <span class="combined-position-quote-status">{quoteStatus(row)}</span>
                      {badge(row)}
                    </th>
                    <td class="tabular-nums">{sharesText(row.shares)}</td>
                    <td class="tabular-nums">{money(row.averageEntryPrice)}</td>
                    <td class="tabular-nums">{money(row.marketPrice)}</td>
                    <td class="tabular-nums">{money(row.marketValue)}</td>
                    <td class={'tabular-nums combined-position-pnl ' + pnlClass(row.unrealizedPnl)}>{signedMoney(row.unrealizedPnl)}</td>
                    <td class={'tabular-nums combined-position-pnl ' + pnlClass(row.unrealizedPnlPct)}>{signedPercent(row.unrealizedPnlPct)}</td>
                    <td class="tabular-nums">{weightText(row)}</td>
                    <td class="tabular-nums">{money(row.targetPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
          <ul class="combined-position-cards" aria-label={translateText('Portfolio positions', language)}>
            {sortedRows.map(row => (
              <li class="combined-position-card" key={row.ticker}>
                <header>
                  <button type="button" class="combined-position-ticker" onClick={() => openPosition(row.ticker)}
                    aria-label={translateText('Open Margin position {ticker}', language).replace('{ticker}', row.ticker)}>
                    {row.ticker}
                  </button>
                  <strong class="combined-position-card__market-value">{money(row.marketValue)}</strong>
                </header>
                <dl>
                  <div><dt>{translateText('Gross unrealized P&L', language)}</dt><dd class={pnlClass(row.unrealizedPnl)}>{signedMoney(row.unrealizedPnl)}</dd></div>
                  <div><dt>{translateText('Return', language)}</dt><dd class={pnlClass(row.unrealizedPnlPct)}>{signedPercent(row.unrealizedPnlPct)}</dd></div>
                  <div><dt>{translateText('Shares', language)}</dt><dd>{sharesText(row.shares)}</dd></div>
                  <div><dt>{translateText('Average entry', language)}</dt><dd>{money(row.averageEntryPrice)}</dd></div>
                  <div><dt>{translateText('Last price', language)}</dt><dd>{money(row.marketPrice)}</dd></div>
                  <div><dt>{translateText('Margin weight', language)}</dt><dd>{weightText(row)}</dd></div>
                  <div><dt>{translateText('Target price', language)}</dt><dd>{money(row.targetPrice)}</dd></div>
                  <div><dt>{translateText('Quote status', language)}</dt><dd>{quoteStatus(row)}</dd></div>
                </dl>
                {badge(row)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
