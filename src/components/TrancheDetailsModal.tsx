import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import type { TrancheItem } from '../types/portfolio';
import { FREEDOM_BROKER_TIME_ZONE } from '../domain/brokerAssumptions';
import { formatTrancheDate, formatUSD } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';

export interface TrancheDetailsRow {
  key: string;
  number: number;
  date: string;
  quantity: number | null;
  entryPrice: number | null;
  costBasis: number | null;
  buyCommission: number | null;
}

type CompatibleTranche = TrancheItem & {
  entryPrice?: unknown;
  averagePrice?: unknown;
  purchaseDate?: string;
  entryDate?: string;
};

function positiveFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalFinite(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.trim() === '')
  ) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAcquiredAt(value: number, language: 'en' | 'ru'): string {
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeZone: FREEDOM_BROKER_TIME_ZONE
  }).format(new Date(value));
}

/** Converts saved purchase lots and broker-resolved quantities into display rows without changing source data. */
export function buildTrancheDetailsRows(
  tranches: TrancheItem[],
  resolvedQuantities: Array<number | null>,
  language: 'en' | 'ru' = getAppLanguage()
): TrancheDetailsRow[] {
  return tranches.map((tranche, index) => {
    const compatible = tranche as CompatibleTranche;
    const quantity = positiveFinite(resolvedQuantities[index]);
    const entryPrice = positiveFinite(tranche.price ?? compatible.entryPrice ?? compatible.averagePrice);
    const rawCostBasis = quantity !== null && entryPrice !== null ? quantity * entryPrice : null;
    const rawDate = tranche.date ?? compatible.purchaseDate ?? compatible.entryDate;
    const date = typeof rawDate === 'string' && rawDate.trim()
      ? formatTrancheDate(rawDate)
      : typeof tranche.acquiredAt === 'number' && Number.isFinite(tranche.acquiredAt) && tranche.acquiredAt > 0
        ? formatAcquiredAt(tranche.acquiredAt, language)
        : translateText('Date unavailable', language);

    return {
      key: tranche.lotId || `tranche-${index + 1}`,
      number: index + 1,
      date,
      quantity,
      entryPrice,
      costBasis: rawCostBasis !== null && Number.isFinite(rawCostBasis) ? rawCostBasis : null,
      buyCommission: optionalFinite(tranche.buyCommission)
    };
  });
}

function formatQuantity(value: number, language: 'en' | 'ru'): string {
  return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    maximumFractionDigits: 6
  }).format(value);
}

function formatOptionalMoney(value: number | null): string {
  return value === null ? '—' : formatUSD(value);
}

export function TrancheDetailsModal({
  ticker,
  tranches,
  quantities,
  positionShares,
  totalInvested,
  averageEntry,
  restoreFocusRef,
  onClose
}: {
  ticker: string;
  tranches: TrancheItem[];
  quantities: Array<number | null>;
  positionShares: number;
  totalInvested: number;
  averageEntry: number;
  restoreFocusRef: { current: HTMLButtonElement | null };
  onClose: () => void;
}) {
  const language = getAppLanguage();
  const rows = buildTrancheDetailsRows(tranches, quantities, language);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const requestClose = () => { closeRef.current?.(); };

  useDialogFocus(dialogRef, {
    initialFocusRef: closeButtonRef,
    restoreFocusRef,
    onEscape: requestClose
  });

  if (typeof document === 'undefined') return null;

  const safeShares = Number.isFinite(positionShares) ? formatQuantity(positionShares, language) : '—';
  const safeInvested = Number.isFinite(totalInvested) ? formatUSD(totalInvested) : '—';
  const safeAverageEntry = Number.isFinite(averageEntry) && averageEntry > 0 ? formatUSD(averageEntry) : '—';

  return createPortal(
    <ModalFrame
      backdropClassName="tranche-details-backdrop"
      dialogClassName="tranche-details-dialog"
      dialogRef={dialogRef}
      dialogId="trancheDetailsDialog"
      ariaLabelledBy="trancheDetailsTitle"
      closeRef={closeRef}
      onClose={onClose}
    >
      <header class="tranche-details-header">
        <div class="min-w-0">
          <p class="tranche-details-eyebrow">{translateText('Position tranches', language)}</p>
          <h2 id="trancheDetailsTitle">{ticker}</h2>
          <p class="tranche-details-subtitle">
            {translateText('Open purchase lots for {ticker}', language).replace('{ticker}', ticker)}
          </p>
        </div>
        <div class="tranche-details-header-actions">
          <span class="tranche-details-count">{tranches.length}</span>
          <button
            ref={closeButtonRef}
            type="button"
            class="tranche-details-close"
            aria-label={translateText('Close', language)}
            onClick={requestClose}
          >
            ×
          </button>
        </div>
      </header>

      <div class="tranche-details-content" data-tranche-count={tranches.length}>
        <div class="tranche-details-summary">
          <div class="tranche-details-summary-card">
            <span>{translateText('Position shares', language)}</span>
            <strong>{safeShares}</strong>
          </div>
          <div class="tranche-details-summary-card">
            <span>{translateText('Total Invested', language)}</span>
            <strong>{safeInvested}</strong>
          </div>
          <div class="tranche-details-summary-card">
            <span>{translateText('Average entry', language)}</span>
            <strong>{safeAverageEntry}</strong>
          </div>
        </div>

        {rows.length > 0 ? (
          <div class="tranche-details-table-scroll" role="region" aria-label={translateText('Position tranches', language)} tabIndex={0}>
            <table class="tranche-details-table">
              <caption class="sr-only">{translateText('Position tranches', language)} · {ticker}</caption>
              <thead>
                <tr>
                  <th scope="col">{translateText('Tranche', language)}</th>
                  <th scope="col">{translateText('Date', language)}</th>
                  <th scope="col">{translateText('Quantity', language)}</th>
                  <th scope="col">{translateText('Entry price', language)}</th>
                  <th scope="col">{translateText('Cost basis', language)}</th>
                  <th scope="col">{translateText('Buy commission', language)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-tranche-row>
                    <th scope="row">
                      <span class="tranche-details-row-number">{String(row.number).padStart(2, '0')}</span>
                    </th>
                    <td>{row.date}</td>
                    <td class="tranche-details-number">{row.quantity === null ? '—' : formatQuantity(row.quantity, language)}</td>
                    <td class="tranche-details-number">{formatOptionalMoney(row.entryPrice)}</td>
                    <td class="tranche-details-number">{formatOptionalMoney(row.costBasis)}</td>
                    <td class="tranche-details-number">{formatOptionalMoney(row.buyCommission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="tranche-details-empty">{translateText('No active tranche details available.', language)}</p>
        )}
      </div>
    </ModalFrame>,
    document.body
  );
}
