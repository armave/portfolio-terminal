import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';
import { getAppLanguage, translateText } from '../services/i18n';

function formatPercentage(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
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
  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: onClose });

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
      onBackdropClick={onClose}
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
            onClick={onClose}
          >×</button>
        </header>

        <div class="margin-risk-overview-content">
          <div class="margin-risk-overview-grid">
            <OverviewItem label={translateText('Account equity', language)} value={equityText} />
            <OverviewItem label={translateText('Risk status', language)} value={translateText(riskLabel, language)} tone={riskStatus === 'available' ? 'positive' : 'warning'} />
            <OverviewItem label={translateText('Equity ratio', language)} value={formatPercentage(equityPct)} />
            <OverviewItem label={translateText('Cash / collateral', language)} value={collateralText} />
            <OverviewItem label={translateText('Maintenance threshold', language)} value={formatPercentage(maintenanceThresholdPct)} />
            <OverviewItem label={translateText('MARGIN-CALL BUFFER', language)} value={formatPercentage(marginCallBufferPct)} tone="warning" />
            <OverviewItem label={translateText('STOP-OUT BUFFER', language)} value={formatPercentage(stopOutBufferPct)} tone="warning" />
            <OverviewItem label={translateText('Data quality', language)} value={translateText(dataQuality, language)} tone={dataQuality === 'Current' ? 'positive' : 'warning'} />
          </div>

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
