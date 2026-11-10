import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';
import { getAppLanguage, translateText } from '../services/i18n';
import type { MarginRiskSnapshot } from '../domain/marginRisk';

function formatPercentage(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function formatMoney(value: number | null, currency: string, language: string): string {
  if (value === null || !Number.isFinite(value)) return translateText('Not reported', language);
  return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function sourceLabel(source: 'broker' | 'configured-assumption' | 'unknown' | 'unavailable', language: string): string {
  const label = source === 'broker'
    ? 'Broker reported'
    : source === 'configured-assumption'
      ? 'Configured assumption'
      : source === 'unavailable'
        ? 'Not reported'
        : 'Source unknown';
  return translateText(label, language);
}

function requirementText(
  amount: number | null,
  source: 'broker' | 'configured-assumption' | 'unavailable',
  currency: string,
  language: string
): string {
  if (amount === null) return translateText('Not reported', language);
  return `${formatMoney(amount, currency, language)} · ${sourceLabel(source, language)}`;
}

function observedAtText(timestamp: number | null, language: string): string {
  if (timestamp === null) return translateText('Not reported', language);
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Yerevan'
  }).format(timestamp);
}

function OverviewItem({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning' | 'positive';
}) {
  return (
    <div class="margin-risk-overview-item">
      <span>{label}</span>
      <strong class={tone === 'warning' ? 'warning' : tone === 'positive' ? 'positive' : ''}>{value}</strong>
    </div>
  );
}

export function MarginRiskOverviewModal({
  onClose,
  riskSnapshot,
  equityText,
  equityPct,
  collateralText,
  riskLabel,
  riskStatus,
  valuationStatus,
  maintenanceThresholdPct,
  marginCallBufferPct,
  stopOutBufferPct,
  warnings,
  riskReason
}: {
  onClose: () => void;
  riskSnapshot?: MarginRiskSnapshot | null;
  equityText: string;
  equityPct: number;
  collateralText: string;
  riskLabel: string;
  riskStatus: 'available' | 'provisional' | 'unavailable';
  valuationStatus: 'current' | 'provisional' | 'incomplete';
  maintenanceThresholdPct: number;
  marginCallBufferPct: number;
  stopOutBufferPct: number;
  warnings: string[];
  riskReason?: string;
}) {
  const language = getAppLanguage();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const requestClose = () => { closeRef.current?.(); };
  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: requestClose });

  const dataQuality = riskStatus === 'unavailable' || valuationStatus === 'incomplete'
    ? 'Incomplete'
    : riskStatus === 'provisional' || valuationStatus === 'provisional'
      ? 'Provisional'
      : 'Current';

  return createPortal(
    <ModalFrame
      backdropClassName="margin-risk-overview-backdrop"
      dialogClassName="margin-risk-overview-dialog"
      dialogRef={dialogRef}
      ariaLabelledBy="marginRiskOverviewTitle"
      closeRef={closeRef}
      onClose={onClose}
    >
        <header class="margin-risk-overview-header">
          <div>
            <span class="margin-risk-label">{translateText('ACCOUNT EQUITY HEALTH', language)}</span>
            <h2 id="marginRiskOverviewTitle">{translateText('Margin risk overview', language)}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            class="margin-risk-overview-close"
            aria-label={translateText('Close', language)}
            onClick={requestClose}
          >×</button>
        </header>

        <div class="margin-risk-overview-content">
          <div class="margin-risk-overview-grid">
            <OverviewItem label={translateText('Account equity', language)} value={equityText} />
            <OverviewItem label={translateText('Risk status', language)} value={translateText(riskLabel, language)} tone={riskStatus === 'available' ? 'positive' : 'warning'} />
            <OverviewItem label={translateText('Equity ratio', language)} value={formatPercentage(equityPct)} />
            <OverviewItem label={translateText('Cash / collateral', language)} value={collateralText} />
            <OverviewItem label={translateText('Configured maintenance threshold', language)} value={formatPercentage(maintenanceThresholdPct)} />
            <OverviewItem label={translateText('MARGIN-CALL BUFFER', language)} value={formatPercentage(marginCallBufferPct)} tone="warning" />
            <OverviewItem label={translateText('Configured stop-out buffer', language)} value={formatPercentage(stopOutBufferPct)} tone="warning" />
            <OverviewItem label={translateText('Data quality', language)} value={translateText(dataQuality, language)} tone={dataQuality === 'Current' ? 'positive' : 'warning'} />
          </div>

          {riskSnapshot && (
            <section class="mt-4" aria-label={translateText('Margin input details', language)}>
              <h3 class="margin-risk-label mb-2">{translateText('Margin input details', language)}</h3>
              <div class="margin-risk-overview-grid">
                <OverviewItem label={translateText('Long exposure', language)} value={formatMoney(riskSnapshot.longExposure, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Short exposure', language)} value={formatMoney(riskSnapshot.shortExposure, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Cash balance', language)} value={formatMoney(riskSnapshot.cashBalance, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Margin debit', language)} value={formatMoney(riskSnapshot.marginDebt, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Eligible collateral', language)} value={`${formatMoney(riskSnapshot.eligibleCollateral, riskSnapshot.currency, language)} · ${sourceLabel(riskSnapshot.eligibleCollateralSource, language)}`} />
                <OverviewItem label={translateText('Initial margin requirement', language)} value={requirementText(riskSnapshot.initialMarginRequirement.amount, riskSnapshot.initialMarginRequirement.source, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Broker maintenance requirement', language)} value={requirementText(riskSnapshot.maintenanceMarginRequirement.amount, riskSnapshot.maintenanceMarginRequirement.source, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Concentration add-on', language)} value={requirementText(riskSnapshot.concentrationAddOn.amount, riskSnapshot.concentrationAddOn.source, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Total maintenance requirement', language)} value={formatMoney(riskSnapshot.totalMaintenanceRequirement, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Estimated annual financing', language)} value={formatMoney(riskSnapshot.annualInterestCost, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Estimated daily financing', language)} value={formatMoney(riskSnapshot.dailyInterestCost, riskSnapshot.currency, language)} />
                <OverviewItem label={translateText('Input freshness', language)} value={translateText(({ fresh: 'Fresh', stale: 'Stale', delayed: 'Delayed', indicative: 'Indicative', unknown: 'Unknown' } as const)[riskSnapshot.freshness], language)} />
                <OverviewItem label={translateText('Source observation', language)} value={observedAtText(riskSnapshot.observedAt, language)} />
              </div>
            </section>
          )}
          {riskReason && <p class="margin-risk-overview-warning">{translateText(riskReason, language)}</p>}
          {warnings.length > 0 && (
            <div class="margin-risk-overview-warning">
              {warnings.map((warning, index) => <p key={index}>{translateText(warning, language)}</p>)}
            </div>
          )}
          <p class="margin-risk-overview-note">
            {translateText('Estimates use configured broker thresholds and are not live broker risk indicators.', language)}
          </p>
        </div>
      </ModalFrame>,
    document.body
  );
}
