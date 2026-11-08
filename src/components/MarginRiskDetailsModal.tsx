import { useRef, useState } from 'preact/hooks';
import { formatUSD } from '../utils/formatters';
import type { MarginRiskSnapshot } from '../domain/marginRisk';
import type { BrokerAssumptions } from '../types/portfolio';
import { useDialogFocus } from '../ui/dialogFocus';
import { getAppLanguage, translateText } from '../services/i18n';

export type MarginRiskModalTab = 'overview' | 'requirements' | 'calculations' | 'broker';

export interface MarginRiskBrokerContext {
  provider?: string | null;
  status?: string | null;
  quality?: string | null;
  source?: string | null;
  observedAt?: number | null;
  receivedAt?: number | null;
  riskObservedAt?: number | null;
}

export interface CapitalAdequacyMetrics {
  percentage: number;
  surplus: number;
  initialMarginRequired: number;
}

export interface MinimumMarginBufferMetrics {
  amount: number;
  percentage: number;
  requirement: number | null;
  thresholdPct: number | null;
  source: 'broker' | 'broker-base' | 'configured-assumption';
  complete: boolean;
}

export function getCapitalAdequacyMetrics(snapshot: MarginRiskSnapshot | null): CapitalAdequacyMetrics | null {
  const requirement = snapshot?.initialMarginRequirement;
  if (
    !snapshot ||
    requirement?.source !== 'broker' ||
    typeof requirement.amount !== 'number' ||
    !Number.isFinite(requirement.amount) ||
    requirement.amount <= 0 ||
    !Number.isFinite(snapshot.equity)
  ) return null;

  return {
    percentage: (snapshot.equity / requirement.amount) * 100,
    surplus: snapshot.equity - requirement.amount,
    initialMarginRequired: requirement.amount
  };
}

export function getMinimumMarginBufferMetrics(snapshot: MarginRiskSnapshot | null): MinimumMarginBufferMetrics | null {
  if (!snapshot) return null;

  const fullyReported = snapshot.maintenanceMarginRequirement.source === 'broker' &&
    snapshot.totalMaintenanceRequirement !== null &&
    snapshot.maintenanceBuffer !== null &&
    snapshot.maintenanceBufferPct !== null &&
    snapshot.concentrationAddOn.source === 'broker';
  const amount = fullyReported ? snapshot.maintenanceBuffer : snapshot.baseMaintenanceBuffer;
  const percentage = fullyReported ? snapshot.maintenanceBufferPct : snapshot.baseMaintenanceBufferPct;

  if (
    amount === null || percentage === null ||
    !Number.isFinite(amount) || !Number.isFinite(percentage)
  ) return null;

  const requirement = fullyReported
    ? snapshot.totalMaintenanceRequirement
    : snapshot.maintenanceMarginRequirement.amount;
  return {
    amount,
    percentage,
    requirement,
    thresholdPct: requirement !== null && snapshot.assets > 0 ? (requirement / snapshot.assets) * 100 : null,
    source: fullyReported
      ? 'broker'
      : snapshot.maintenanceMarginRequirement.source === 'broker'
        ? 'broker-base'
        : 'configured-assumption',
    complete: fullyReported
  };
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatUSD(value) : '—';
}

function percentage(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—';
}

function observationTime(timestamp: number | null | undefined, language: string): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '—';
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(timestamp));
}

function DetailRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'positive' | 'warning' | 'muted';
}) {
  const toneClass = tone === 'positive' ? 'text-emerald-300'
    : tone === 'warning' ? 'text-amber-300'
      : tone === 'muted' ? 'text-slate-500'
        : 'text-slate-100';
  return (
    <div class="margin-risk-modal-row">
      <dt>{label}</dt>
      <dd class={toneClass}>{value}</dd>
    </div>
  );
}

export function MarginRiskDetailsModal({
  onClose,
  initialTab = 'overview',
  snapshot,
  riskStatus,
  riskReason,
  warnings,
  disclaimer,
  equityText,
  equityPct,
  valuationStatus,
  accountBalanceAvailable,
  unpricedHoldings,
  collateralText,
  rules,
  brokerContext
}: {
  onClose: () => void;
  initialTab?: MarginRiskModalTab;
  snapshot: MarginRiskSnapshot | null;
  riskStatus: 'available' | 'provisional' | 'unavailable';
  riskReason?: string;
  warnings: string[];
  disclaimer?: string;
  equityText: string;
  equityPct: number;
  valuationStatus: 'current' | 'provisional' | 'incomplete';
  accountBalanceAvailable: boolean;
  unpricedHoldings: number;
  collateralText: string;
  rules: BrokerAssumptions;
  brokerContext: MarginRiskBrokerContext;
}) {
  const language = getAppLanguage();
  const [activeTab, setActiveTab] = useState<MarginRiskModalTab>(initialTab);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: onClose });

  const capital = getCapitalAdequacyMetrics(snapshot);
  const buffer = getMinimumMarginBufferMetrics(snapshot);
  const tabs: Array<{ id: MarginRiskModalTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'requirements', label: 'Requirements' },
    { id: 'calculations', label: 'Calculations' },
    { id: 'broker', label: 'Broker data' }
  ];
  const bufferLabel = buffer?.complete ? 'Broker minimum-margin buffer' : 'Estimated maintenance buffer';
  const capitalStatus = capital
    ? percentage(capital.percentage)
    : translateText('Not reported', language);

  return (
    <div
      class="margin-risk-modal-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        class="margin-risk-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marginRiskModalTitle"
        tabIndex={-1}
      >
        <header class="margin-risk-modal-header">
          <div>
            <span class="margin-risk-label">{translateText('BROKER RISK REVIEW', language)}</span>
            <h2 id="marginRiskModalTitle">{translateText('Margin health details', language)}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            class="margin-risk-modal-close"
            aria-label={translateText('Close', language)}
            onClick={onClose}
          >×</button>
        </header>

        <nav class="margin-risk-modal-tabs" aria-label={translateText('Risk detail sections', language)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              class={activeTab === tab.id ? 'is-active' : ''}
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >{translateText(tab.label, language)}</button>
          ))}
        </nav>

        <div class="margin-risk-modal-content">
          {activeTab === 'overview' && (
            <div class="margin-risk-modal-section">
              <div class="margin-risk-modal-highlight-grid">
                <div class="margin-risk-modal-highlight">
                  <span>{translateText('Account equity', language)}</span>
                  <strong>{equityText}</strong>
                  <small>{percentage(equityPct)} {translateText('of total assets', language)}</small>
                </div>
                <div class="margin-risk-modal-highlight">
                  <span>{translateText('Capital adequacy', language)}</span>
                  <strong class={capital ? (capital.percentage >= 100 ? 'text-emerald-300' : 'text-rose-300') : 'text-amber-300'}>{capitalStatus}</strong>
                  <small>{capital ? money(capital.surplus) + ' ' + translateText('surplus', language) : translateText('Broker initial margin is not available in the connected account snapshot.', language)}</small>
                </div>
              </div>
              <dl class="margin-risk-modal-list">
                <DetailRow label={translateText('Total assets', language)} value={money(snapshot?.assets)} />
                <DetailRow label={translateText('Long market exposure', language)} value={money(snapshot?.longExposure)} />
                <DetailRow label={translateText('Available cash', language)} value={collateralText} />
                <DetailRow label={translateText('Margin debt', language)} value={money(snapshot?.marginDebt)} />
                <DetailRow label={translateText('Equity ratio', language)} value={percentage(snapshot?.equityRatio !== null && snapshot?.equityRatio !== undefined ? snapshot.equityRatio * 100 : equityPct)} />
                <DetailRow label={translateText('Eligible collateral source', language)} value={translateText(snapshot?.eligibleCollateralSource === 'broker' ? 'Broker reported' : snapshot?.eligibleCollateralSource === 'configured-assumption' ? 'Configured assumption' : 'Unknown', language)} tone={snapshot?.eligibleCollateralSource === 'broker' ? 'positive' : 'warning'} />
              </dl>
            </div>
          )}

          {activeTab === 'requirements' && (
            <div class="margin-risk-modal-section">
              <p class="margin-risk-modal-intro">{translateText('Broker requirements are shown only when the connected broker snapshot supplies them. Configured assumptions are kept separate.', language)}</p>
              <dl class="margin-risk-modal-list">
                <DetailRow
                  label={translateText('Initial margin required', language)}
                  value={snapshot?.initialMarginRequirement.source === 'broker' ? money(snapshot.initialMarginRequirement.amount) : translateText('Not reported', language)}
                  tone={snapshot?.initialMarginRequirement.source === 'broker' ? 'positive' : 'warning'}
                />
                <DetailRow
                  label={translateText('Maintenance requirement', language)}
                  value={snapshot?.maintenanceMarginRequirement.source === 'broker' ? money(snapshot.maintenanceMarginRequirement.amount) : translateText('Not reported', language)}
                  tone={snapshot?.maintenanceMarginRequirement.source === 'broker' ? 'positive' : 'warning'}
                />
                <DetailRow
                  label={translateText('Configured maintenance amount', language)}
                  value={snapshot?.maintenanceMarginRequirement.source === 'configured-assumption' ? money(snapshot.maintenanceMarginRequirement.amount) : '—'}
                  tone="warning"
                />
                <DetailRow
                  label={translateText('Concentration add-on', language)}
                  value={snapshot?.concentrationAddOn.source === 'broker' ? money(snapshot.concentrationAddOn.amount) : translateText('Not reported', language)}
                  tone={snapshot?.concentrationAddOn.source === 'broker' ? 'positive' : 'warning'}
                />
                <DetailRow
                  label={translateText('Configured maintenance threshold', language)}
                  value={percentage(rules.maintenanceEquityRatio * 100)}
                  tone="warning"
                />
                <DetailRow
                  label={translateText('Configured stop-out assumption', language)}
                  value={percentage(rules.stopOutRatio * 100)}
                  tone="warning"
                />
                <DetailRow label={translateText('Broker stop-out rule', language)} value={translateText('Not reported', language)} tone="warning" />
              </dl>
              <p class="margin-risk-modal-note">{translateText('The configured stop-out percentage is an app assumption, not a confirmed broker liquidation threshold.', language)}</p>
            </div>
          )}

          {activeTab === 'calculations' && (
            <div class="margin-risk-modal-section">
              <div class="margin-risk-modal-highlight-grid">
                <div class="margin-risk-modal-highlight">
                  <span>{translateText(bufferLabel, language)}</span>
                  <strong>{buffer ? percentage(buffer.percentage) : '—'}</strong>
                  <small>{buffer ? money(buffer.amount) : translateText('Unavailable', language)}</small>
                </div>
                <div class="margin-risk-modal-highlight">
                  <span>{translateText('Capital adequacy', language)}</span>
                  <strong>{capital ? percentage(capital.percentage) : '—'}</strong>
                  <small>{capital ? money(capital.surplus) + ' ' + translateText('surplus', language) : translateText('Initial margin requirement not reported', language)}</small>
                </div>
              </div>
              <dl class="margin-risk-modal-list">
                <DetailRow label={translateText('Equity = assets − debt − short liabilities', language)} value={money(snapshot?.equity)} />
                <DetailRow label={translateText('Base maintenance requirement', language)} value={money(snapshot?.maintenanceMarginRequirement.amount)} />
                <DetailRow label={translateText('Base maintenance buffer', language)} value={money(snapshot?.baseMaintenanceBuffer)} />
                <DetailRow label={translateText('Base buffer / total assets', language)} value={percentage(snapshot?.baseMaintenanceBufferPct)} />
                <DetailRow label={translateText('Full maintenance requirement', language)} value={money(snapshot?.totalMaintenanceRequirement)} tone={snapshot?.totalMaintenanceRequirement === null || !snapshot ? 'warning' : 'normal'} />
                <DetailRow label={translateText('Full margin-call buffer', language)} value={money(snapshot?.maintenanceBuffer)} tone={snapshot?.maintenanceBuffer === null || !snapshot ? 'warning' : 'normal'} />
              </dl>
              {!buffer?.complete && <p class="margin-risk-modal-note">{translateText('The displayed buffer is provisional: the complete concentration-adjusted maintenance requirement is not available.', language)}</p>}
            </div>
          )}

          {activeTab === 'broker' && (
            <div class="margin-risk-modal-section">
              <dl class="margin-risk-modal-list">
                <DetailRow label={translateText('Provider', language)} value={brokerContext.provider || '—'} />
                <DetailRow label={translateText('Broker snapshot status', language)} value={translateText(brokerContext.status || 'Unavailable', language)} />
                <DetailRow label={translateText('Snapshot quality', language)} value={translateText(brokerContext.quality || 'Unknown', language)} />
                <DetailRow label={translateText('Snapshot source', language)} value={translateText(brokerContext.source || 'Unknown', language)} />
                <DetailRow label={translateText('Broker observed at', language)} value={observationTime(brokerContext.observedAt, language)} />
                <DetailRow label={translateText('Client received at', language)} value={observationTime(brokerContext.receivedAt, language)} />
                <DetailRow label={translateText('Risk inputs observed at', language)} value={observationTime(brokerContext.riskObservedAt, language)} />
                <DetailRow label={translateText('Valuation quality', language)} value={translateText(valuationStatus, language)} />
                <DetailRow label={translateText('Account balance available', language)} value={translateText(accountBalanceAvailable ? 'Yes' : 'No', language)} />
                <DetailRow label={translateText('Unpriced holdings', language)} value={String(unpricedHoldings)} />
                <DetailRow label={translateText('Risk calculation status', language)} value={translateText(riskStatus, language)} />
              </dl>
              {riskReason && <p class="margin-risk-modal-note">{translateText(riskReason, language)}</p>}
              {warnings.length > 0 && (
                <div class="margin-risk-modal-warning-list">
                  <strong>{translateText('Data warnings', language)}</strong>
                  {warnings.map((warning, index) => <p key={index}>{translateText(warning, language)}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {disclaimer && <footer class="margin-risk-modal-footer">{translateText(disclaimer, language)}</footer>}
      </section>
    </div>
  );
}
